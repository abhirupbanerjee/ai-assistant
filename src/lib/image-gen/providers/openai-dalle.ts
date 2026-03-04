/**
 * OpenAI DALL-E Provider
 *
 * Direct API call to OpenAI for image generation.
 * Note: Image APIs are called directly (not via LiteLLM proxy).
 */

import OpenAI from 'openai';
import type {
  OpenAIProviderConfig,
  ImageGenToolArgs,
  AspectRatio,
} from '@/types/image-gen';
import { getApiKey, isProviderConfigured } from '@/lib/provider-helpers';

// ===== Client Management =====

// OpenAI client singleton (separate from LiteLLM proxy)
let openaiClient: OpenAI | null = null;

/**
 * Get or create OpenAI client
 * Uses centralized provider helper (DB-first, then env var fallback)
 * Direct to OpenAI, NOT via LiteLLM (which doesn't proxy image APIs)
 */
async function getOpenAIClient(): Promise<OpenAI> {
  if (!openaiClient) {
    const apiKey = await getApiKey('openai');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// ===== Size Mapping =====

/**
 * Map aspect ratio to DALL-E supported sizes
 */
function mapAspectRatioToSize(
  aspectRatio: AspectRatio | undefined,
  config: OpenAIProviderConfig
): '1024x1024' | '1024x1792' | '1792x1024' {
  switch (aspectRatio) {
    case '9:16':
    case '3:4':
      return '1024x1792'; // Portrait
    case '16:9':
    case '4:3':
      return '1792x1024'; // Landscape
    case '1:1':
    default:
      return config.size || '1024x1024';
  }
}

// ===== Generation Function =====

export interface DalleGenerationResult {
  /** Generated image as buffer */
  buffer: Buffer;
  /** DALL-E's revised prompt (may differ from input) */
  revisedPrompt?: string;
}

/**
 * Generate an image using DALL-E 3 or DALL-E 2
 *
 * @param args - Generation arguments from LLM
 * @param config - DALL-E provider configuration
 * @returns Image buffer and optional revised prompt
 */
export async function generateWithDalle(
  args: ImageGenToolArgs,
  config: OpenAIProviderConfig
): Promise<DalleGenerationResult> {
  const client = await getOpenAIClient();

  const size = mapAspectRatioToSize(args.aspectRatio, config);

  console.log(
    `[ImageGen:DALL-E] Generating image: "${args.prompt.substring(0, 50)}..."`
  );
  console.log(
    `[ImageGen:DALL-E] Model: ${config.model}, Size: ${size}, Quality: ${config.quality}`
  );

  const startTime = Date.now();

  const response = await client.images.generate({
    model: config.model,
    prompt: args.prompt,
    n: 1,
    size,
    quality: config.quality,
    style: config.style,
    response_format: 'b64_json', // Get base64 directly (no need to download)
  });

  const latency = Date.now() - startTime;
  console.log(`[ImageGen:DALL-E] Generation completed in ${latency}ms`);

  if (!response.data || response.data.length === 0) {
    throw new Error('DALL-E returned empty response');
  }

  const imageData = response.data[0];

  if (!imageData.b64_json) {
    throw new Error('DALL-E returned no image data');
  }

  return {
    buffer: Buffer.from(imageData.b64_json, 'base64'),
    revisedPrompt: imageData.revised_prompt,
  };
}

// ===== Connection Test =====

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latency?: number;
}

/**
 * Test DALL-E API connectivity
 *
 * Note: This only verifies API key validity, not image generation capability.
 * Actual generation would incur costs.
 */
export async function testDalleConnection(): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    const client = await getOpenAIClient();

    // Simple test - verify API key works by listing models
    // This doesn't generate an image (which would cost money)
    const response = await client.models.list();
    const hasDalle = response.data.some(
      (m) => m.id.includes('dall-e') || m.id.includes('dalle')
    );

    const latency = Date.now() - startTime;

    if (hasDalle) {
      return {
        success: true,
        message: `OpenAI DALL-E connection successful (${latency}ms)`,
        latency,
      };
    } else {
      return {
        success: true,
        message: `OpenAI API connected but DALL-E models not visible (${latency}ms). This is normal - DALL-E may still work.`,
        latency,
      };
    }
  } catch (error) {
    const latency = Date.now() - startTime;
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred';

    // Check for specific error types
    if (message.includes('API key')) {
      return {
        success: false,
        message: 'Invalid or missing OpenAI API key',
        latency,
      };
    }

    if (message.includes('rate limit')) {
      return {
        success: false,
        message: 'OpenAI rate limit exceeded',
        latency,
      };
    }

    return {
      success: false,
      message: `Connection failed: ${message}`,
      latency,
    };
  }
}

/**
 * Check if DALL-E provider is configured (DB-first, then env var fallback)
 */
export async function isDalleConfigured(): Promise<boolean> {
  return isProviderConfigured('openai');
}

/**
 * Get estimated cost for DALL-E generation
 * Based on OpenAI pricing (as of 2025)
 */
export function getDalleCost(
  model: 'dall-e-3' | 'dall-e-2',
  quality: 'standard' | 'hd',
  size: '1024x1024' | '1024x1792' | '1792x1024'
): number {
  // DALL-E 3 pricing
  if (model === 'dall-e-3') {
    if (quality === 'hd') {
      return size === '1024x1024' ? 0.08 : 0.12;
    }
    return size === '1024x1024' ? 0.04 : 0.08;
  }

  // DALL-E 2 pricing (cheaper)
  return 0.02;
}
