/**
 * Speech-to-Text Service
 *
 * Supports 4 providers with route-based fallback:
 * - Route 1 (LiteLLM): OpenAI Whisper, Gemini (multimodal), Mistral Voxtral
 * - Route 2 (Direct): Fireworks Whisper
 *
 * Fallback chain: route default → route fallback → other route default → other route fallback → fail
 */

import OpenAI from 'openai';
import { getApiKey } from '@/lib/provider-helpers';
import { getSpeechSettings } from '@/lib/db/compat/config';
import { getRoutesSettings } from '@/lib/db/compat/config';
import type { SttProvider, SttProviderConfig, SpeechSettings } from '@/lib/db/config';

// ============ Provider file size limits ============

export const PROVIDER_MAX_FILE_SIZE: Record<SttProvider, number> = {
  openai:    25 * 1024 * 1024,   // 25 MB
  fireworks: 1024 * 1024 * 1024, // 1 GB
  mistral:   1024 * 1024 * 1024, // 1 GB
  gemini:    100 * 1024 * 1024,  // 100 MB inline
};

// ============ Provider implementations ============

async function transcribeOpenAI(
  config: SttProviderConfig, buffer: Buffer, filename: string
): Promise<{ text: string; duration: number }> {
  const getOpenAI = (await import('@/lib/openai')).default;
  const client = await getOpenAI();
  const blob = new Blob([new Uint8Array(buffer)], { type: 'audio/webm' });
  const file = new File([blob], filename, { type: 'audio/webm' });
  const response = await client.audio.transcriptions.create({
    model: config.model,
    file,
    response_format: 'verbose_json',
  });
  return { text: response.text, duration: response.duration || 0 };
}

async function transcribeFireworks(
  config: SttProviderConfig, buffer: Buffer, filename: string
): Promise<{ text: string; duration: number }> {
  const apiKey = await getApiKey('fireworks');
  if (!apiKey) throw new Error('Fireworks API key not configured');
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.FIREWORKS_BASE_URL || 'https://api.fireworks.ai/inference/v1',
  });
  const blob = new Blob([new Uint8Array(buffer)], { type: 'audio/webm' });
  const file = new File([blob], filename, { type: 'audio/webm' });
  const response = await client.audio.transcriptions.create({
    model: config.model,
    file,
    response_format: 'verbose_json',
  });
  return { text: response.text, duration: (response as unknown as { duration?: number }).duration || 0 };
}

async function transcribeMistral(
  config: SttProviderConfig, buffer: Buffer, filename: string
): Promise<{ text: string; duration: number }> {
  const apiKey = await getApiKey('mistral');
  if (!apiKey) throw new Error('Mistral API key not configured');
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.mistral.ai/v1',
  });
  const blob = new Blob([new Uint8Array(buffer)], { type: 'audio/webm' });
  const file = new File([blob], filename, { type: 'audio/webm' });
  const response = await client.audio.transcriptions.create({
    model: config.model,
    file,
    response_format: 'verbose_json',
  });
  return { text: response.text, duration: (response as unknown as { duration?: number }).duration || 0 };
}

async function transcribeGemini(
  config: SttProviderConfig, buffer: Buffer, filename: string
): Promise<{ text: string; duration: number }> {
  const { GoogleGenAI } = await import('@google/genai');
  const apiKey = await getApiKey('gemini');
  if (!apiKey) throw new Error('Gemini API key not configured');
  const ai = new GoogleGenAI({ apiKey });

  // Detect MIME type from filename
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    mp3: 'audio/mp3', wav: 'audio/wav', m4a: 'audio/m4a',
    ogg: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm',
    aac: 'audio/aac', aiff: 'audio/aiff',
  };
  const mimeType = mimeMap[ext || ''] || 'audio/webm';
  const base64 = buffer.toString('base64');

  const response = await ai.models.generateContent({
    model: config.model,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: 'Transcribe this audio accurately. Return only the transcription text, nothing else.' },
      ],
    }],
  });

  const text = response.text?.trim() || '';
  // Estimate duration from buffer size (WebM Opus ~32kbps = ~4KB/sec)
  const estimatedDuration = Math.round(buffer.length / 4000);
  return { text, duration: estimatedDuration };
}

// ============ Dispatcher ============

const PROVIDER_FNS: Record<SttProvider, (
  config: SttProviderConfig, buffer: Buffer, filename: string
) => Promise<{ text: string; duration: number }>> = {
  openai: transcribeOpenAI,
  fireworks: transcribeFireworks,
  mistral: transcribeMistral,
  gemini: transcribeGemini,
};

async function tryProvider(
  provider: SttProvider,
  config: SttProviderConfig,
  buffer: Buffer,
  filename: string
): Promise<{ text: string; duration: number; provider: string }> {
  if (!config.enabled) {
    throw new Error(`STT provider "${provider}" is disabled`);
  }
  const result = await PROVIDER_FNS[provider](config, buffer, filename);
  return { ...result, provider };
}

// ============ Route-based fallback chain ============

/**
 * Build ordered list of providers to try based on route config and availability.
 *
 * Order: defaultRoute's default → defaultRoute's fallback →
 *        otherRoute's default → otherRoute's fallback
 */
function buildProviderChain(
  speechSettings: SpeechSettings,
  route1Active: boolean,
  route2Active: boolean
): SttProvider[] {
  const { stt } = speechSettings;
  const chain: SttProvider[] = [];
  const seen = new Set<SttProvider>();

  const addIfNew = (provider: SttProvider | 'none') => {
    if (provider !== 'none' && !seen.has(provider)) {
      seen.add(provider);
      chain.push(provider);
    }
  };

  // Primary route first
  const primaryRoute = stt.defaultRoute;
  const otherRoute = primaryRoute === 'route1' ? 'route2' : 'route1';
  const primaryActive = primaryRoute === 'route1' ? route1Active : route2Active;
  const otherActive = otherRoute === 'route1' ? route1Active : route2Active;

  if (primaryActive) {
    addIfNew(stt.routes[primaryRoute].default);
    addIfNew(stt.routes[primaryRoute].fallback);
  }
  if (otherActive) {
    addIfNew(stt.routes[otherRoute].default);
    addIfNew(stt.routes[otherRoute].fallback);
  }

  return chain;
}

// ============ Public API ============

/**
 * Transcribe audio using configured providers with route-based fallback.
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string
): Promise<{ text: string; duration: number; provider: string }> {
  const [speechSettings, routesSettings] = await Promise.all([
    getSpeechSettings(),
    getRoutesSettings(),
  ]);

  const chain = buildProviderChain(
    speechSettings,
    routesSettings.route1Enabled,
    routesSettings.route2Enabled
  );

  if (chain.length === 0) {
    throw new Error('No STT providers available. Enable at least one route with an STT provider.');
  }

  const errors: string[] = [];

  for (const provider of chain) {
    const config = speechSettings.stt.providers[provider];
    try {
      return await tryProvider(provider, config, buffer, filename);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[STT] Provider "${provider}" failed: ${msg}`);
      errors.push(`${provider}: ${msg}`);
    }
  }

  throw new Error(`All STT providers failed. ${errors.join('; ')}`);
}

/**
 * Get the max file size for the current primary STT provider.
 */
export async function getActiveMaxFileSize(): Promise<number> {
  const settings = await getSpeechSettings();
  const defaultRoute = settings.stt.defaultRoute;
  const defaultProvider = settings.stt.routes[defaultRoute].default;
  return PROVIDER_MAX_FILE_SIZE[defaultProvider];
}
