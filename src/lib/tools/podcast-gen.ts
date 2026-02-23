/**
 * Podcast Generation Tool Definition
 *
 * Autonomous tool for generating audio podcasts from text content.
 * Uses a two-stage approach:
 * 1. Content formatter transforms text for audio (handles tables, lists, etc.)
 * 2. OpenAI TTS generates the audio file
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import type { ToolDefinition, ValidationResult } from '../tools';
import { getToolConfigAsync, getThreadContext, addThreadOutput } from '@/lib/db/compat';
import { getRequestContext } from '@/lib/request-context';
import { getApiKey } from '@/lib/provider-helpers';
import { getLlmSettings } from '@/lib/db/config';
import type {
  PodcastGenConfig,
  PodcastGenToolArgs,
  PodcastGenResponse,
  PodcastHint,
  PodcastMetadata,
  FormatterResult,
  LENGTH_CONFIG,
  STYLE_DESCRIPTIONS,
} from '@/types/podcast-gen';

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
      model: 'tts-1-hd',
      voice: 'nova',
      speed: 1.0,
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

// ===== OpenAI Client =====

let ttsClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!ttsClient) {
    // For TTS, we always use direct OpenAI API (not LiteLLM proxy)
    const apiKey = getApiKey('openai');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured for TTS');
    }

    ttsClient = new OpenAI({
      apiKey,
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
  const openai = getOpenAIClient();
  const llmSettings = getLlmSettings();
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
  const openai = getOpenAIClient();
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
  duration: number
): Promise<{ id: string; docId: number; downloadUrl: string }> {
  const podcastId = uuidv4();
  const outputDir = getOutputDirectory();

  // Create safe filename from topic
  const safeTopic = args.topic
    .replace(/[^a-zA-Z0-9-_\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
  const filename = `${safeTopic}_podcast.${config.outputFormat}`;
  const filepath = path.join(outputDir, `${podcastId}.${config.outputFormat}`);

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
    format: config.outputFormat,
    provider: config.activeProvider as 'openai',
    model: config.providers.openai.model,
    voice: config.providers.openai.voice,
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
    'mp3',
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

// ===== Main Generation Function =====

/**
 * Generate a podcast from text content
 */
export async function generatePodcast(args: PodcastGenToolArgs): Promise<PodcastGenResponse> {
  const config = await getPodcastGenConfig();
  const startTime = Date.now();

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

  // Validate OpenAI is configured
  if (!config.providers.openai.enabled) {
    return {
      success: false,
      error: {
        code: 'PROVIDER_DISABLED',
        message: 'OpenAI TTS provider is not enabled.',
      },
    };
  }

  try {
    const style = args.style || config.defaultStyle;
    const length = args.length || config.defaultLength;

    console.log(`[PodcastGen] Starting generation: topic="${args.topic}", style=${style}, length=${length}`);

    // Step 1: Format content for audio
    const formatterResult = await formatContentForAudio(args.content, style, length);

    if (!formatterResult.script) {
      return {
        success: false,
        error: {
          code: 'FORMAT_ERROR',
          message: 'Failed to format content for audio',
        },
      };
    }

    // Step 2: Generate audio with TTS
    const { buffer, duration } = await generateAudioWithOpenAI(formatterResult.script, config);

    // Step 3: Save to disk and database
    const saved = await savePodcast(buffer, args, config, formatterResult, duration);

    const processingTimeMs = Date.now() - startTime;
    console.log(`[PodcastGen] Completed in ${processingTimeMs}ms: ${saved.downloadUrl}`);

    // Build response with podcast hint for frontend
    const podcastHint: PodcastHint = {
      id: saved.id,
      filename: `${args.topic.substring(0, 50)}_podcast.${config.outputFormat}`,
      duration,
      format: config.outputFormat,
      downloadUrl: saved.downloadUrl,
      streamUrl: saved.downloadUrl, // Same endpoint, browser will stream
    };

    return {
      success: true,
      message: `Podcast generated successfully (${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, '0')}). Do NOT call podcast_gen again unless the user explicitly requests another podcast.`,
      podcastHint,
      metadata: {
        provider: config.activeProvider as 'openai',
        model: config.providers.openai.model,
        voice: config.providers.openai.voice,
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
      enum: ['none', 'openai'],
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
              enum: ['tts-1', 'tts-1-hd'],
              default: 'tts-1-hd',
            },
            voice: {
              type: 'string',
              title: 'Voice',
              enum: ['alloy', 'echo', 'fable', 'nova', 'onyx', 'shimmer'],
              default: 'nova',
            },
            speed: {
              type: 'number',
              title: 'Speed',
              description: 'Playback speed (0.25 to 4.0)',
              minimum: 0.25,
              maximum: 4.0,
              default: 1.0,
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
  if (config.activeProvider && !['none', 'openai'].includes(config.activeProvider as string)) {
    errors.push('activeProvider must be none or openai');
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

  // Validate OpenAI provider config
  if (config.providers) {
    const providers = config.providers as Record<string, unknown>;
    if (providers.openai) {
      const openai = providers.openai as Record<string, unknown>;
      if (openai.speed !== undefined) {
        const speed = openai.speed as number;
        if (typeof speed !== 'number' || speed < 0.25 || speed > 4.0) {
          errors.push('OpenAI speed must be between 0.25 and 4.0');
        }
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

  execute: async (args: Record<string, unknown>): Promise<string> => {
    const typedArgs = args as unknown as PodcastGenToolArgs;

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

    // Generate podcast
    const result = await generatePodcast(typedArgs);
    return JSON.stringify(result);
  },
};

export default podcastGenTool;
