/**
 * Podcast Generation Tool Definition
 *
 * Autonomous tool for generating audio podcasts from text content.
 * Uses a two-stage approach:
 * 1. Content formatter transforms text for audio (handles tables, lists, etc.)
 * 2. TTS provider (OpenAI or Gemini) generates the audio file
 *
 * Gemini TTS supports multi-speaker mode with Host/Expert format.
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import type { ToolDefinition, ValidationResult } from '../tools';
import { getToolConfigAsync, getThreadContext, addThreadOutput } from '@/lib/db/compat';
import { getRequestContext } from '@/lib/request-context';
import { getDisclaimerConfigIfEnabled } from '../disclaimer';
import { getApiKey } from '@/lib/provider-helpers';
import { getLlmSettings } from '@/lib/db/compat/config';
import { pcmToWav, GEMINI_TTS_PCM_OPTIONS, estimateDurationFromPCM } from '@/lib/audio/pcm-to-wav';
import type {
  PodcastGenConfig,
  PodcastGenToolArgs,
  PodcastGenResponse,
  PodcastHint,
  PodcastMetadata,
  FormatterResult,
  LENGTH_CONFIG,
  STYLE_DESCRIPTIONS,
  GeminiTTSConfig,
  GeminiVoice,
  TTSProvider,
  AudioFormat,
  VoiceCategory,
  VoiceGender,
} from '@/types/podcast-gen';
import { GEMINI_VOICE_INFO } from '@/types/podcast-gen';

// ===== Constants =====

const LENGTH_CONFIG_DATA: typeof LENGTH_CONFIG = {
  short: { words: 250, minutes: '1-2' },
  medium: { words: 600, minutes: '3-5' },
  long: { words: 1200, minutes: '8-10' },
};

const STYLE_DESCRIPTIONS_DATA: typeof STYLE_DESCRIPTIONS = {
  formal: 'Professional and authoritative, suitable for official communications',
  conversational: 'Friendly and approachable, as if explaining to a colleague',
  news: 'Clear and objective, like a news broadcast or report',
};

// ===== Default Configuration =====

export const PODCAST_GEN_DEFAULTS: PodcastGenConfig = {
  activeProvider: 'none', // Disabled by default
  providers: {
    openai: {
      enabled: false,
      model: 'gpt-4o-mini-tts',
      voice: 'marin',
      speed: 1.0,
      instructions: '',
    },
    gemini: {
      enabled: false,
      model: 'gemini-2.5-flash-preview-tts',
      multiSpeaker: true,
      hostVoice: 'Aoede',  // Breezy - good for conversational host
      expertVoice: 'Charon',  // Informative - good for expert explanations
      hostAccent: '',
      expertAccent: '',
    },
  },
  defaultStyle: 'conversational',
  defaultLength: 'medium',
  outputFormat: 'mp3',
  expirationDays: 30,
};

// ===== Configuration Helpers =====

/**
 * Get podcast generation configuration from database
 */
export async function getPodcastGenConfig(): Promise<PodcastGenConfig> {
  const config = await getToolConfigAsync('podcast_gen');

  if (config?.config) {
    const stored = config.config as Partial<PodcastGenConfig>;
    return {
      ...PODCAST_GEN_DEFAULTS,
      ...stored,
      providers: {
        openai: { ...PODCAST_GEN_DEFAULTS.providers.openai, ...stored.providers?.openai },
        gemini: { ...PODCAST_GEN_DEFAULTS.providers.gemini, ...stored.providers?.gemini },
      },
    };
  }

  return PODCAST_GEN_DEFAULTS;
}

/**
 * Check if podcast generation is enabled
 */
export async function isPodcastGenEnabled(): Promise<boolean> {
  const config = await getToolConfigAsync('podcast_gen');
  return config?.isEnabled ?? false;
}

// ===== OpenAI Clients =====

// Two separate clients needed:
// 1. chatClient: Uses LiteLLM proxy for chat completions (content formatting)
// 2. ttsClient: Direct OpenAI API for TTS (not available via LiteLLM)

let chatClient: OpenAI | null = null;
let ttsClient: OpenAI | null = null;

/**
 * Get client for chat completions (uses LiteLLM proxy if configured)
 */
async function getChatClient(): Promise<OpenAI> {
  if (!chatClient) {
    // When using LiteLLM proxy, use LITELLM_MASTER_KEY for authentication
    const apiKey = process.env.OPENAI_BASE_URL
      ? process.env.LITELLM_MASTER_KEY || await getApiKey('openai')
      : await getApiKey('openai');

    if (!apiKey && !process.env.OPENAI_BASE_URL) {
      throw new Error('OpenAI API key or LiteLLM proxy required for podcast formatting');
    }

    chatClient = new OpenAI({
      apiKey: apiKey || 'dummy-key-for-litellm',
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  return chatClient;
}

/**
 * Get client for TTS (always direct OpenAI API)
 */
async function getTTSClient(): Promise<OpenAI> {
  if (!ttsClient) {
    // TTS always uses direct OpenAI API (not available via LiteLLM)
    const apiKey = await getApiKey('openai');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured for TTS');
    }

    ttsClient = new OpenAI({
      apiKey,
      baseURL: 'https://api.openai.com/v1', // Force direct OpenAI, bypass LiteLLM proxy
      timeout: 120 * 1000, // 2 minutes for audio generation
    });
  }
  return ttsClient;
}

// ===== Content Formatter =====

const FORMATTER_PROMPT = `You are a podcast script writer. Transform the following content into engaging audio narration.

RULES:
1. STRUCTURE: Brief intro → Main points → Concise summary
2. TABLES: Convert to narrative descriptions ("The data shows...", "Looking at the numbers...")
3. DATA/CHARTS: Describe trends and comparisons verbally, round numbers for clarity
4. LISTS: Use verbal enumeration ("First... Second... And finally...")
5. CITATIONS: Reference sources naturally ("According to the policy...", "The guidelines state...")
6. ACRONYMS: Spell out on first use, then use short form
7. TONE: {{STYLE}}
8. LENGTH: Target approximately {{WORD_COUNT}} words ({{DURATION}} minutes)
9. TRANSITIONS: Add verbal bridges between sections ("Now let's look at...", "Moving on to...")
10. SKIP: Code blocks, raw URLs, complex formulas - describe their purpose instead

OUTPUT: The podcast script only. No stage directions, no markup, no speaker labels. Just natural flowing speech.`;

/**
 * Format content for audio using the thread's LLM model
 */
async function formatContentForAudio(
  content: string,
  style: 'formal' | 'conversational' | 'news',
  length: 'short' | 'medium' | 'long'
): Promise<FormatterResult> {
  const openai = await getChatClient();
  const llmSettings = await getLlmSettings();
  const model = llmSettings.model || 'gpt-4o-mini';

  const lengthConfig = LENGTH_CONFIG_DATA[length];
  const styleDesc = STYLE_DESCRIPTIONS_DATA[style];

  const systemPrompt = FORMATTER_PROMPT
    .replace('{{STYLE}}', styleDesc)
    .replace('{{WORD_COUNT}}', lengthConfig.words.toString())
    .replace('{{DURATION}}', lengthConfig.minutes);

  // Truncate content if too long (approximately 4000 chars)
  const truncatedContent = content.length > 4000
    ? content.substring(0, 4000) + '\n\n[Content truncated for length...]'
    : content;

  const userPrompt = `Transform the following content into a podcast script:\n\n${truncatedContent}`;

  console.log(`[PodcastGen] Formatting content with model: ${model}, style: ${style}, length: ${length}`);

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: lengthConfig.words * 2, // Allow buffer
  });

  const script = completion.choices[0]?.message?.content?.trim() || '';
  const wordCount = script.split(/\s+/).length;
  const estimatedDuration = Math.ceil((wordCount / 150) * 60); // ~150 words per minute

  console.log(`[PodcastGen] Formatted script: ${wordCount} words, ~${estimatedDuration}s estimated`);

  return {
    script,
    estimatedDuration,
    wordCount,
  };
}

// ===== TTS Generation =====

/**
 * Generate audio using OpenAI TTS
 */
async function generateAudioWithOpenAI(
  script: string,
  config: PodcastGenConfig
): Promise<{ buffer: Buffer; duration: number }> {
  const openai = await getTTSClient();
  const providerConfig = config.providers.openai;

  console.log(`[PodcastGen] Generating audio with model: ${providerConfig.model}, voice: ${providerConfig.voice}`);

  const response = await openai.audio.speech.create({
    model: providerConfig.model,
    voice: providerConfig.voice,
    input: script,
    response_format: config.outputFormat,
    speed: providerConfig.speed,
  });

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Estimate duration: ~150 words per minute at speed 1.0
  const wordCount = script.split(/\s+/).length;
  const duration = Math.ceil((wordCount / 150) * 60 / providerConfig.speed);

  console.log(`[PodcastGen] Generated audio: ${buffer.length} bytes, ~${duration}s`);

  return { buffer, duration };
}

// ===== Gemini TTS Generation =====

/**
 * Multi-speaker dialogue formatter prompt
 */
const DIALOGUE_FORMATTER_PROMPT = `You are a podcast script writer. Transform the following content into a natural two-person podcast dialogue.

FORMAT RULES:
1. Use exactly two speakers: "Host" and "Expert"
2. Format each turn as: "Host: [text]" or "Expert: [text]"
3. Host asks questions, guides conversation, and provides transitions
4. Expert provides detailed explanations and insights
5. Keep exchanges natural and conversational
6. Include brief transitions and acknowledgments
7. The Expert should sound knowledgeable but approachable
8. The Host should be curious and help guide the listener through complex topics

TONE: {{STYLE}}
TARGET LENGTH: ~{{WORD_COUNT}} words total

OUTPUT: The dialogue script only. No stage directions besides speaker labels (Host: or Expert:).`;

/**
 * Format content for multi-speaker dialogue (Gemini TTS)
 */
async function formatContentForDialogue(
  content: string,
  style: 'formal' | 'conversational' | 'news',
  length: 'short' | 'medium' | 'long'
): Promise<FormatterResult> {
  const openai = await getChatClient();
  const llmSettings = await getLlmSettings();
  const model = llmSettings.model || 'gpt-4o-mini';

  const lengthConfig = LENGTH_CONFIG_DATA[length];
  const styleDesc = STYLE_DESCRIPTIONS_DATA[style];

  const systemPrompt = DIALOGUE_FORMATTER_PROMPT
    .replace('{{STYLE}}', styleDesc)
    .replace('{{WORD_COUNT}}', lengthConfig.words.toString());

  // Truncate content if too long
  const truncatedContent = content.length > 4000
    ? content.substring(0, 4000) + '\n\n[Content truncated for length...]'
    : content;

  const userPrompt = `Transform the following content into a two-person podcast dialogue:\n\n${truncatedContent}`;

  console.log(`[PodcastGen] Formatting content for dialogue with model: ${model}`);

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: lengthConfig.words * 2,
  });

  const script = completion.choices[0]?.message?.content?.trim() || '';
  const wordCount = script.split(/\s+/).length;
  const estimatedDuration = Math.ceil((wordCount / 150) * 60);

  console.log(`[PodcastGen] Formatted dialogue: ${wordCount} words, ~${estimatedDuration}s estimated`);

  return {
    script,
    estimatedDuration,
    wordCount,
  };
}

/**
 * Generate audio using Gemini TTS with multi-speaker support
 */
async function generateAudioWithGemini(
  script: string,
  config: PodcastGenConfig
): Promise<{ buffer: Buffer; duration: number; format: AudioFormat }> {
  const { GoogleGenAI } = await import('@google/genai');

  const apiKey = await getApiKey('gemini');
  if (!apiKey) {
    throw new Error('Gemini API key not configured for TTS');
  }

  const ai = new GoogleGenAI({ apiKey });
  const geminiConfig = config.providers.gemini;

  console.log(`[PodcastGen] Generating audio with Gemini: model=${geminiConfig.model}, multiSpeaker=${geminiConfig.multiSpeaker}`);

  // Build Director's Notes for accents if specified
  let directorNotes = '';
  if (geminiConfig.hostAccent || geminiConfig.expertAccent) {
    const notes: string[] = [];
    if (geminiConfig.hostAccent) {
      notes.push(`Host's accent: ${geminiConfig.hostAccent}`);
    }
    if (geminiConfig.expertAccent) {
      notes.push(`Expert's accent: ${geminiConfig.expertAccent}`);
    }
    directorNotes = `[Director's Notes: ${notes.join('. ')}]\n\n`;
  }

  const fullScript = directorNotes + script;

  // Build request config based on multi-speaker mode
  const requestConfig: Record<string, unknown> = {
    responseModalities: ['AUDIO'],
  };

  if (geminiConfig.multiSpeaker) {
    // Multi-speaker mode with Host and Expert voices
    requestConfig.speechConfig = {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          {
            speaker: 'Host',
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: geminiConfig.hostVoice },
            },
          },
          {
            speaker: 'Expert',
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: geminiConfig.expertVoice },
            },
          },
        ],
      },
    };
  } else {
    // Single speaker mode (uses hostVoice)
    requestConfig.speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: geminiConfig.hostVoice },
      },
    };
  }

  const response = await ai.models.generateContent({
    model: geminiConfig.model,
    contents: [{ parts: [{ text: fullScript }] }],
    config: requestConfig,
  });

  // Extract audio data from response
  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  let audioData: string | undefined;
  for (const part of parts) {
    if (part.inlineData?.data) {
      audioData = part.inlineData.data;
      break;
    }
  }

  if (!audioData) {
    console.error('[PodcastGen] Gemini response:', JSON.stringify(response, null, 2));
    throw new Error('Gemini TTS returned no audio data');
  }

  // Decode base64 PCM data
  const pcmBuffer = Buffer.from(audioData, 'base64');

  // Convert PCM to WAV
  const wavBuffer = await pcmToWav(pcmBuffer, GEMINI_TTS_PCM_OPTIONS);

  // Calculate duration from PCM data
  const duration = Math.ceil(estimateDurationFromPCM(pcmBuffer, GEMINI_TTS_PCM_OPTIONS));

  console.log(`[PodcastGen] Generated Gemini audio: ${wavBuffer.length} bytes, ${duration}s`);

  return { buffer: wavBuffer, duration, format: 'wav' };
}

// ===== Storage =====

/**
 * Get output directory for generated podcasts
 */
function getOutputDirectory(): string {
  const outputDir = process.env.DOC_OUTPUT_DIR || path.join(process.cwd(), 'data', 'outputs');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

/**
 * Save podcast to disk and database
 */
async function savePodcast(
  buffer: Buffer,
  args: PodcastGenToolArgs,
  config: PodcastGenConfig,
  formatterResult: FormatterResult,
  duration: number,
  actualFormat: AudioFormat,
  provider: TTSProvider,
  providerModel: string,
  providerVoice: string
): Promise<{ id: string; docId: number; downloadUrl: string }> {
  const podcastId = uuidv4();
  const outputDir = getOutputDirectory();

  // Create safe filename from topic
  const safeTopic = args.topic
    .replace(/[^a-zA-Z0-9-_\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
  const filename = `${safeTopic}_podcast.${actualFormat}`;
  const filepath = path.join(outputDir, `${podcastId}.${actualFormat}`);

  // Save file
  fs.writeFileSync(filepath, buffer);

  // Get thread context
  const requestContext = getRequestContext();
  const threadId = requestContext.threadId;

  if (!threadId) {
    throw new Error('No thread context available for podcast generation');
  }

  const threadContext = await getThreadContext(threadId);

  if (!threadContext.exists) {
    console.error('[PodcastGen] Thread not found:', { threadId, requestContext });
    throw new Error(`Thread ${threadId} not found - cannot save generated podcast`);
  }

  // Calculate expiration
  const expiresAt = config.expirationDays > 0
    ? new Date(Date.now() + config.expirationDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  // Build metadata for storage
  const metadata: PodcastMetadata = {
    duration,
    format: actualFormat,
    provider,
    model: providerModel,
    voice: providerVoice,
    style: (args.style || config.defaultStyle) as 'formal' | 'conversational' | 'news',
    length: (args.length || config.defaultLength) as 'short' | 'medium' | 'long',
    wordCount: formatterResult.wordCount,
    expiresAt,
  };

  // Store in database using existing addThreadOutput
  const result = await addThreadOutput(
    threadId,
    null, // message_id
    filename,
    filepath,
    actualFormat,  // 'mp3' or 'wav'
    buffer.length,
    JSON.stringify(metadata),
    expiresAt
  );

  return {
    id: podcastId,
    docId: result.id,
    downloadUrl: `/api/documents/${result.id}/download`,
  };
}

// ===== Voice Selection =====

/**
 * Filter voices by gender and category preferences
 */
function filterVoices(
  genderPreference: VoiceGender | 'any' | undefined,
  categoryPreference: VoiceCategory | 'any' | undefined
): GeminiVoice[] {
  const voices = Object.entries(GEMINI_VOICE_INFO) as [GeminiVoice, typeof GEMINI_VOICE_INFO[GeminiVoice]][];

  return voices
    .filter(([, info]) => {
      if (genderPreference && genderPreference !== 'any' && info.gender !== genderPreference) {
        return false;
      }
      if (categoryPreference && categoryPreference !== 'any' && info.category !== categoryPreference) {
        return false;
      }
      return true;
    })
    .map(([voice]) => voice);
}

/**
 * Select best voices using LLM based on topic and character descriptions
 */
async function selectVoicesWithLLM(
  topic: string,
  geminiConfig: GeminiTTSConfig
): Promise<{ hostVoice: GeminiVoice; expertVoice: GeminiVoice }> {
  const openai = await getChatClient();
  const llmSettings = await getLlmSettings();
  const model = llmSettings.model || 'gpt-4o-mini';

  // Filter available voices by preferences
  const hostVoices = filterVoices(geminiConfig.hostGenderPreference, geminiConfig.hostCategoryPreference);
  const expertVoices = filterVoices(geminiConfig.expertGenderPreference, geminiConfig.expertCategoryPreference);

  // If no voices match filters, fall back to all voices
  const availableHostVoices = hostVoices.length > 0 ? hostVoices : (Object.keys(GEMINI_VOICE_INFO) as GeminiVoice[]);
  const availableExpertVoices = expertVoices.length > 0 ? expertVoices : (Object.keys(GEMINI_VOICE_INFO) as GeminiVoice[]);

  // Build voice descriptions for the prompt
  const formatVoiceList = (voices: GeminiVoice[]) =>
    voices.map(v => {
      const info = GEMINI_VOICE_INFO[v];
      return `- ${v}: ${info.description} (${info.gender}, ${info.category})`;
    }).join('\n');

  const systemPrompt = `You are a voice casting assistant. Select the most appropriate voices for a podcast based on the topic and character descriptions.

Consider:
- Match gender to character description (e.g., "mother" = female, "father" = male)
- Match tone/style to character description (e.g., "professional" = informative, "friendly" = conversational)
- Match age/energy to character description (e.g., "young" = youthful/upbeat, "mature" = mature/warm)

Respond with ONLY valid JSON in this format:
{"hostVoice": "VoiceName", "expertVoice": "VoiceName"}`;

  const userPrompt = `Topic: ${topic}

Host character: ${geminiConfig.hostAccent || 'Not specified - choose a good conversational voice'}
Expert character: ${geminiConfig.expertAccent || 'Not specified - choose a good informative voice'}

Available voices for Host:
${formatVoiceList(availableHostVoices)}

Available voices for Expert:
${formatVoiceList(availableExpertVoices)}

Select the best matching voice for each role.`;

  console.log(`[PodcastGen] Auto-selecting voices with LLM for: Host="${geminiConfig.hostAccent || 'default'}", Expert="${geminiConfig.expertAccent || 'default'}"`);

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 100,
    });

    const response = completion.choices[0]?.message?.content?.trim() || '';

    // Parse JSON response
    const jsonMatch = response.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { hostVoice?: string; expertVoice?: string };

      // Validate voices exist
      const hostVoice = (parsed.hostVoice && parsed.hostVoice in GEMINI_VOICE_INFO)
        ? parsed.hostVoice as GeminiVoice
        : geminiConfig.hostVoice;
      const expertVoice = (parsed.expertVoice && parsed.expertVoice in GEMINI_VOICE_INFO)
        ? parsed.expertVoice as GeminiVoice
        : geminiConfig.expertVoice;

      console.log(`[PodcastGen] LLM selected voices: Host=${hostVoice} (${GEMINI_VOICE_INFO[hostVoice].gender}), Expert=${expertVoice} (${GEMINI_VOICE_INFO[expertVoice].gender})`);

      return { hostVoice, expertVoice };
    }
  } catch (error) {
    console.warn('[PodcastGen] Voice auto-selection failed, using defaults:', error);
  }

  // Fall back to configured defaults
  return {
    hostVoice: geminiConfig.hostVoice,
    expertVoice: geminiConfig.expertVoice,
  };
}

// ===== Main Generation Function =====

/**
 * Generate a podcast from text content
 * @param args - Tool arguments (topic, content, style, length)
 * @param configOverride - Optional skill-level config override
 */
export async function generatePodcast(
  args: PodcastGenToolArgs,
  configOverride?: Record<string, unknown>
): Promise<PodcastGenResponse> {
  const baseConfig = await getPodcastGenConfig();
  const startTime = Date.now();

  // Merge skill-level config override with global config
  let config: PodcastGenConfig = baseConfig;
  if (configOverride) {
    const overrideProviders = configOverride.providers as Record<string, Record<string, unknown>> | undefined;
    config = {
      ...baseConfig,
      ...configOverride,
      providers: {
        openai: { ...baseConfig.providers.openai, ...(overrideProviders?.openai || {}) },
        gemini: { ...baseConfig.providers.gemini, ...(overrideProviders?.gemini || {}) },
      },
    } as PodcastGenConfig;
  }

  // Check if enabled
  if (config.activeProvider === 'none') {
    return {
      success: false,
      error: {
        code: 'DISABLED',
        message: 'Podcast generation is disabled. Configure a TTS provider in Admin settings.',
      },
    };
  }

  // Check Speech settings TTS provider is enabled globally
  try {
    const { getSpeechSettings } = await import('@/lib/db/compat/config');
    const speechSettings = await getSpeechSettings();
    const ttsProvider = config.activeProvider as 'openai' | 'gemini';
    if (speechSettings.tts.providers[ttsProvider] && !speechSettings.tts.providers[ttsProvider].enabled) {
      return {
        success: false,
        error: {
          code: 'PROVIDER_DISABLED',
          message: `${ttsProvider === 'openai' ? 'OpenAI' : 'Gemini'} TTS is disabled in Speech settings. Enable it in Admin > Settings > Speech.`,
        },
      };
    }
  } catch {
    // If speech settings unavailable, fall through to existing checks
  }

  // Validate selected provider is enabled in podcast config
  if (config.activeProvider === 'openai' && !config.providers.openai.enabled) {
    return {
      success: false,
      error: {
        code: 'PROVIDER_DISABLED',
        message: 'OpenAI TTS provider is not enabled.',
      },
    };
  }

  if (config.activeProvider === 'gemini' && !config.providers.gemini.enabled) {
    return {
      success: false,
      error: {
        code: 'PROVIDER_DISABLED',
        message: 'Gemini TTS provider is not enabled.',
      },
    };
  }

  try {
    const style = args.style || config.defaultStyle;
    const length = args.length || config.defaultLength;
    const provider = config.activeProvider as TTSProvider;

    console.log(`[PodcastGen] Starting generation: topic="${args.topic}", provider=${provider}, style=${style}, length=${length}`);

    let formatterResult: FormatterResult;
    let buffer: Buffer;
    let duration: number;
    let actualFormat: AudioFormat;
    let providerModel: string;
    let providerVoice: string;

    if (provider === 'gemini') {
      // Gemini path: Multi-speaker dialogue format + Gemini TTS
      const geminiConfig = config.providers.gemini;

      // Step 0: Auto-select voices if enabled
      if (geminiConfig.autoSelectVoices && (geminiConfig.hostAccent || geminiConfig.expertAccent)) {
        const selectedVoices = await selectVoicesWithLLM(args.topic, geminiConfig);
        geminiConfig.hostVoice = selectedVoices.hostVoice;
        geminiConfig.expertVoice = selectedVoices.expertVoice;
      }

      // Step 1: Format content for dialogue (if multi-speaker) or single narrator
      if (geminiConfig.multiSpeaker) {
        formatterResult = await formatContentForDialogue(args.content, style, length);
      } else {
        formatterResult = await formatContentForAudio(args.content, style, length);
      }

      if (!formatterResult.script) {
        return {
          success: false,
          error: {
            code: 'FORMAT_ERROR',
            message: 'Failed to format content for audio',
          },
        };
      }

      // Append AI disclaimer to script if enabled
      const disclaimerConfig = await getDisclaimerConfigIfEnabled();
      if (disclaimerConfig) {
        const disclaimerLine = geminiConfig.multiSpeaker
          ? `\n\nHost: ${disclaimerConfig.fullText}.`
          : `\n\n${disclaimerConfig.fullText}.`;
        formatterResult.script += disclaimerLine;
      }

      // Step 2: Generate audio with Gemini TTS
      const geminiResult = await generateAudioWithGemini(formatterResult.script, config);
      buffer = geminiResult.buffer;
      duration = geminiResult.duration;
      actualFormat = geminiResult.format;  // 'wav' for Gemini
      providerModel = geminiConfig.model;
      providerVoice = geminiConfig.multiSpeaker
        ? `${geminiConfig.hostVoice}/${geminiConfig.expertVoice}`
        : geminiConfig.hostVoice;
    } else {
      // OpenAI path: Single narrator + OpenAI TTS
      formatterResult = await formatContentForAudio(args.content, style, length);

      if (!formatterResult.script) {
        return {
          success: false,
          error: {
            code: 'FORMAT_ERROR',
            message: 'Failed to format content for audio',
          },
        };
      }

      // Append AI disclaimer to script if enabled
      const disclaimerConfig = await getDisclaimerConfigIfEnabled();
      if (disclaimerConfig) {
        formatterResult.script += `\n\n${disclaimerConfig.fullText}.`;
      }

      // Step 2: Generate audio with OpenAI TTS
      const openaiResult = await generateAudioWithOpenAI(formatterResult.script, config);
      buffer = openaiResult.buffer;
      duration = openaiResult.duration;
      actualFormat = config.outputFormat;  // 'mp3' for OpenAI
      providerModel = config.providers.openai.model;
      providerVoice = config.providers.openai.voice;
    }

    // Step 3: Save to disk and database
    const saved = await savePodcast(
      buffer,
      args,
      config,
      formatterResult,
      duration,
      actualFormat,
      provider,
      providerModel,
      providerVoice
    );

    const processingTimeMs = Date.now() - startTime;
    console.log(`[PodcastGen] Completed in ${processingTimeMs}ms: ${saved.downloadUrl}`);

    // Build response with podcast hint for frontend
    const podcastHint: PodcastHint = {
      id: saved.id,
      filename: `${args.topic.substring(0, 50)}_podcast.${actualFormat}`,
      duration,
      format: actualFormat,
      downloadUrl: saved.downloadUrl,
      streamUrl: saved.downloadUrl, // Same endpoint, browser will stream
    };

    return {
      success: true,
      message: `Podcast generated successfully (${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}). Do NOT call podcast_gen again unless the user explicitly requests another podcast.`,
      podcastHint,
      metadata: {
        provider,
        model: providerModel,
        voice: providerVoice,
        style,
        length,
        processingTimeMs,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('[PodcastGen] Generation failed:', errorMessage);

    let errorCode = 'GENERATION_ERROR';
    if (errorMessage.includes('API key')) {
      errorCode = 'INVALID_API_KEY';
    } else if (errorMessage.includes('rate limit')) {
      errorCode = 'RATE_LIMIT';
    }

    return {
      success: false,
      error: {
        code: errorCode,
        message: errorMessage,
      },
    };
  }
}

// ===== Configuration Schema =====

const podcastGenConfigSchema = {
  type: 'object',
  properties: {
    activeProvider: {
      type: 'string',
      title: 'Active TTS Provider',
      description: 'Select the text-to-speech provider to use',
      enum: ['none', 'openai', 'gemini'],
      default: 'none',
    },
    providers: {
      type: 'object',
      title: 'Provider Settings',
      properties: {
        openai: {
          type: 'object',
          title: 'OpenAI TTS',
          properties: {
            enabled: { type: 'boolean', title: 'Enable OpenAI TTS', default: false },
            model: {
              type: 'string',
              title: 'Model',
              enum: ['gpt-4o-mini-tts'],
              default: 'gpt-4o-mini-tts',
            },
            voice: {
              type: 'string',
              title: 'Voice',
              description: 'marin and cedar are recommended for best quality',
              enum: [
                'marin', 'cedar',  // Best quality
                'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
                'nova', 'onyx', 'sage', 'shimmer', 'verse',
              ],
              default: 'marin',
            },
            speed: {
              type: 'number',
              title: 'Speed',
              description: 'Playback speed (0.25 to 4.0)',
              minimum: 0.25,
              maximum: 4.0,
              default: 1.0,
            },
            instructions: {
              type: 'string',
              title: 'Voice Instructions',
              description: 'Control voice style with natural language (e.g., "Speak calmly")',
              default: '',
            },
          },
        },
        gemini: {
          type: 'object',
          title: 'Google Gemini TTS (Multi-Speaker)',
          properties: {
            enabled: { type: 'boolean', title: 'Enable Gemini TTS', default: false },
            model: {
              type: 'string',
              title: 'Model',
              enum: ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'],
              default: 'gemini-2.5-flash-preview-tts',
            },
            multiSpeaker: {
              type: 'boolean',
              title: 'Multi-Speaker Mode',
              description: 'Enable Host/Expert dialogue format (recommended)',
              default: true,
            },
            hostVoice: {
              type: 'string',
              title: 'Host Voice',
              description: 'Voice for the podcast host',
              default: 'Aoede',
            },
            expertVoice: {
              type: 'string',
              title: 'Expert Voice',
              description: 'Voice for the expert (multi-speaker mode)',
              default: 'Charon',
            },
            hostAccent: {
              type: 'string',
              title: 'Host Accent (optional)',
              description: 'e.g., "British English from London"',
              default: '',
            },
            expertAccent: {
              type: 'string',
              title: 'Expert Accent (optional)',
              description: 'e.g., "American English from New York"',
              default: '',
            },
          },
        },
      },
    },
    defaultStyle: {
      type: 'string',
      title: 'Default Style',
      description: 'Default podcast narration style',
      enum: ['formal', 'conversational', 'news'],
      default: 'conversational',
    },
    defaultLength: {
      type: 'string',
      title: 'Default Length',
      description: 'Default podcast duration target',
      enum: ['short', 'medium', 'long'],
      default: 'medium',
    },
    expirationDays: {
      type: 'number',
      title: 'Expiration (days)',
      description: 'Days until generated podcasts expire (0 = never)',
      minimum: 0,
      maximum: 365,
      default: 30,
    },
  },
};

// ===== Validation =====

function validatePodcastGenConfig(config: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  // Validate activeProvider
  if (config.activeProvider && !['none', 'openai', 'gemini'].includes(config.activeProvider as string)) {
    errors.push('activeProvider must be none, openai, or gemini');
  }

  // Validate defaultStyle
  const validStyles = ['formal', 'conversational', 'news'];
  if (config.defaultStyle && !validStyles.includes(config.defaultStyle as string)) {
    errors.push(`defaultStyle must be one of: ${validStyles.join(', ')}`);
  }

  // Validate defaultLength
  const validLengths = ['short', 'medium', 'long'];
  if (config.defaultLength && !validLengths.includes(config.defaultLength as string)) {
    errors.push(`defaultLength must be one of: ${validLengths.join(', ')}`);
  }

  // Validate provider configs
  if (config.providers) {
    const providers = config.providers as Record<string, unknown>;

    // Validate OpenAI provider config
    if (providers.openai) {
      const openai = providers.openai as Record<string, unknown>;
      if (openai.speed !== undefined) {
        const speed = openai.speed as number;
        if (typeof speed !== 'number' || speed < 0.25 || speed > 4.0) {
          errors.push('OpenAI speed must be between 0.25 and 4.0');
        }
      }
    }

    // Validate Gemini provider config
    if (providers.gemini) {
      const gemini = providers.gemini as Record<string, unknown>;
      const validModels = ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'];
      if (gemini.model && !validModels.includes(gemini.model as string)) {
        errors.push(`Gemini model must be one of: ${validModels.join(', ')}`);
      }
    }
  }

  // Validate expirationDays
  if (config.expirationDays !== undefined) {
    const days = config.expirationDays as number;
    if (typeof days !== 'number' || days < 0 || days > 365) {
      errors.push('expirationDays must be between 0 and 365');
    }
  }

  return { valid: errors.length === 0, errors };
}

// ===== Tool Definition =====

export const podcastGenTool: ToolDefinition = {
  name: 'podcast_gen',
  displayName: 'Podcast Generation',
  description: 'Generate audio podcasts from text content using text-to-speech',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'podcast_gen',
      description: `Generate an audio podcast from text content. The content will be automatically reformatted for audio narration (tables become verbal descriptions, lists become enumerated points, etc.).

Use this when the user asks to:
- Create a podcast or audio version of content
- Generate an audio summary
- Make content available as audio
- Convert text to speech

The generated podcast will be available for playback and download.

IMPORTANT: Do NOT call this tool again unless the user explicitly requests another podcast.`,
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'Title or topic for the podcast (used in filename)',
          },
          content: {
            type: 'string',
            description: 'The text content to convert into a podcast. Include all relevant information.',
          },
          style: {
            type: 'string',
            enum: ['formal', 'conversational', 'news'],
            description: 'Narration style: formal (professional), conversational (friendly), news (report-like)',
          },
          length: {
            type: 'string',
            enum: ['short', 'medium', 'long'],
            description: 'Target length: short (1-2 min), medium (3-5 min), long (8-10 min)',
          },
        },
        required: ['topic', 'content'],
      },
    },
  },

  configSchema: podcastGenConfigSchema,
  defaultConfig: PODCAST_GEN_DEFAULTS as unknown as Record<string, unknown>,
  validateConfig: validatePodcastGenConfig,

  execute: async (args: Record<string, unknown>, options?: { configOverride?: Record<string, unknown> }): Promise<string> => {
    const typedArgs = args as unknown as PodcastGenToolArgs;
    const configOverride = options?.configOverride;

    // Check if enabled
    if (!(await isPodcastGenEnabled())) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'DISABLED',
          message: 'Podcast generation is currently disabled. Contact your administrator to enable it.',
        },
      });
    }

    // Validate topic
    if (!typedArgs.topic || typeof typedArgs.topic !== 'string') {
      return JSON.stringify({
        success: false,
        error: {
          code: 'INVALID_TOPIC',
          message: 'A topic is required for the podcast',
        },
      });
    }

    // Validate content
    if (!typedArgs.content || typeof typedArgs.content !== 'string') {
      return JSON.stringify({
        success: false,
        error: {
          code: 'INVALID_CONTENT',
          message: 'Content is required to generate a podcast',
        },
      });
    }

    if (typedArgs.content.length < 50) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'CONTENT_TOO_SHORT',
          message: 'Content must be at least 50 characters long',
        },
      });
    }

    // Validate style if provided
    const validStyles = ['formal', 'conversational', 'news'];
    if (typedArgs.style && !validStyles.includes(typedArgs.style)) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'INVALID_STYLE',
          message: `Style must be one of: ${validStyles.join(', ')}`,
        },
      });
    }

    // Validate length if provided
    const validLengths = ['short', 'medium', 'long'];
    if (typedArgs.length && !validLengths.includes(typedArgs.length)) {
      return JSON.stringify({
        success: false,
        error: {
          code: 'INVALID_LENGTH',
          message: `Length must be one of: ${validLengths.join(', ')}`,
        },
      });
    }

    // Generate podcast (pass configOverride for skill-level settings)
    const result = await generatePodcast(typedArgs, configOverride);
    return JSON.stringify(result);
  },
};

export default podcastGenTool;
