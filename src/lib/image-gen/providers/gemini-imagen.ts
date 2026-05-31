/**
 * Google Image Generation Provider
 *
 * Unified handler for Google's image generation APIs:
 * - Gemini Native Models (Nano Banana series): gemini-3.1-flash-image-preview, gemini-3-pro-image-preview
 *   Endpoint: :generateContent
 * - Imagen 4 Models: imagen-4.0-fast-generate-001, imagen-4.0-generate-001, imagen-4.0-ultra-generate-001
 *   Endpoint: :predict
 *
 * Both families share the same API base URL and key but use different request/response schemas.
 */

import type {
  GeminiProviderConfig,
  ImagenProviderConfig,
  ImageGenToolArgs,
  AspectRatio,
  Resolution,
  GeminiResponse,
  ImagenResponse,
} from '@/types/image-gen';
import { getApiKey, isProviderConfigured } from '@/lib/provider-helpers';

// ===== Constants =====

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ===== API Key Management =====

async function getGoogleApiKey(): Promise<string> {
  const apiKey = await getApiKey('gemini');
  if (!apiKey) {
    throw new Error('Google API key not configured');
  }
  return apiKey;
}

// ===== Generation Result =====

export interface GoogleGenerationResult {
  buffer: Buffer;
  enhancedPrompt?: string;
}

// ===== Unified Generation Entry Point =====

export async function generateWithGoogle(
  args: ImageGenToolArgs,
  model: string,
  config: { aspectRatio: AspectRatio }
): Promise<GoogleGenerationResult> {
  const apiKey = await getGoogleApiKey();

  console.log(
    `[ImageGen:Google] Generating image: "${args.prompt.substring(0, 50)}..."`
  );
  console.log(
    `[ImageGen:Google] Model: ${model}, Aspect: ${args.aspectRatio || config.aspectRatio}`
  );

  const startTime = Date.now();

  let result: GoogleGenerationResult;

  if (model.includes('imagen')) {
    result = await generateWithImagen(args, model, config.aspectRatio, apiKey);
  } else {
    result = await generateWithGeminiNative(args, model, config.aspectRatio, apiKey);
  }

  const latency = Date.now() - startTime;
  console.log(`[ImageGen:Google] Generation completed in ${latency}ms`);

  return result;
}

// ===== Gemini Native Endpoint (:generateContent) =====

async function generateWithGeminiNative(
  args: ImageGenToolArgs,
  model: string,
  defaultAspectRatio: AspectRatio,
  apiKey: string
): Promise<GoogleGenerationResult> {
  const aspectRatio = args.aspectRatio || defaultAspectRatio;
  const resolution = args.resolution || '1K';
  const promptWithAspect = buildPromptWithAspectRatio(args.prompt, aspectRatio, resolution);

  const requestBody: Record<string, unknown> = {
    contents: [
      {
        parts: [{ text: promptWithAspect }],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  // Add image size configuration if supported by the model
  if (model.includes('gemini-3.1-flash-image') || model.includes('gemini-3-pro-image')) {
    (requestBody.generationConfig as Record<string, unknown>).imageConfig = {
      imageSize: resolution,
    };
  }

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[ImageGen:Google] Gemini API Error:', errorText);
    throw parseApiError(response.status, errorText, 'Gemini');
  }

  const data: GeminiResponse = await response.json();
  return extractFromGeminiResponse(data);
}

function extractFromGeminiResponse(response: GeminiResponse): GoogleGenerationResult {
  const parts = response.candidates?.[0]?.content?.parts || [];

  let imageBuffer: Buffer | null = null;
  let textContent: string | undefined;

  for (const part of parts) {
    if (part.inlineData?.data) {
      imageBuffer = Buffer.from(part.inlineData.data, 'base64');
    } else if (part.text) {
      textContent = part.text;
    }
  }

  if (!imageBuffer) {
    console.error('[ImageGen:Google] Gemini response structure:', JSON.stringify(response, null, 2));
    throw new Error('Gemini returned no image data. The model may have declined to generate the image.');
  }

  return {
    buffer: imageBuffer,
    enhancedPrompt: textContent,
  };
}

// ===== Imagen 4 Endpoint (:predict) =====

async function generateWithImagen(
  args: ImageGenToolArgs,
  model: string,
  defaultAspectRatio: AspectRatio,
  apiKey: string
): Promise<GoogleGenerationResult> {
  const aspectRatio = args.aspectRatio || defaultAspectRatio;
  const resolution = args.resolution || '1K';
  const promptWithAspect = buildPromptWithAspectRatio(args.prompt, aspectRatio, resolution);

  const requestBody = {
    instances: [{ prompt: promptWithAspect }],
    parameters: {
      sampleCount: 1,
      aspectRatio,
    },
  };

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${model}:predict?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[ImageGen:Google] Imagen API Error:', errorText);
    throw parseApiError(response.status, errorText, 'Imagen 4');
  }

  const data: ImagenResponse = await response.json();
  return extractFromImagenResponse(data);
}

function extractFromImagenResponse(response: ImagenResponse): GoogleGenerationResult {
  const prediction = response.predictions?.[0];

  if (!prediction?.bytesBase64Encoded) {
    console.error('[ImageGen:Google] Imagen response structure:', JSON.stringify(response, null, 2));
    throw new Error('Imagen 4 returned no image data.');
  }

  return {
    buffer: Buffer.from(prediction.bytesBase64Encoded, 'base64'),
  };
}

// ===== Shared Helpers =====

function parseApiError(status: number, errorText: string, providerName: string): Error {
  if (status === 400) {
    return new Error(`${providerName} rejected the prompt: ${errorText}`);
  }
  if (status === 401) {
    return new Error(`Invalid Google API key`);
  }
  if (status === 429) {
    return new Error(`${providerName} rate limit exceeded`);
  }
  if (status === 503) {
    return new Error(`${providerName} service temporarily unavailable`);
  }
  return new Error(`${providerName} API error (${status}): ${errorText}`);
}

function buildPromptWithAspectRatio(
  prompt: string,
  aspectRatio: AspectRatio,
  resolution: string
): string {
  const aspectGuidance = getAspectRatioGuidance(aspectRatio);
  const resolutionGuidance = getResolutionGuidance(resolution);
  return `${prompt}\n\nImage format: ${aspectGuidance}\n${resolutionGuidance}`;
}

function getAspectRatioGuidance(ratio: AspectRatio): string {
  switch (ratio) {
    case '16:9':
      return 'Wide landscape format (16:9), suitable for presentations and displays.';
    case '9:16':
      return 'Tall portrait format (9:16), suitable for mobile screens and stories.';
    case '4:3':
      return 'Standard landscape format (4:3), suitable for documents and prints.';
    case '3:4':
      return 'Portrait format (3:4), suitable for posters and documents.';
    case '1:1':
    default:
      return 'Square format (1:1), suitable for social media and icons.';
  }
}

function getResolutionGuidance(resolution: string): string {
  switch (resolution) {
    case '512':
      return 'Resolution: 512px preview quality.';
    case '1K':
      return 'Resolution: 1K (1024px) standard production quality.';
    case '2K':
      return 'Resolution: 2K (2048px) high-fidelity display quality.';
    case '4K':
      return 'Resolution: 4K (4096px) maximum print-ready quality.';
    default:
      return 'Resolution: 1K standard quality.';
  }
}

// ===== Connection Tests =====

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latency?: number;
  hasImageModels?: boolean;
}

export async function testGeminiConnection(): Promise<ConnectionTestResult> {
  return testGoogleConnection('gemini', ['gemini-3.1-flash-image', 'gemini-3-pro-image']);
}

export async function testImagenConnection(): Promise<ConnectionTestResult> {
  return testGoogleConnection('imagen', ['imagen-4.0-fast-generate', 'imagen-4.0-generate', 'imagen-4.0-ultra-generate']);
}

async function testGoogleConnection(
  label: string,
  modelPatterns: string[]
): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    const apiKey = await getGoogleApiKey();

    const response = await fetch(
      `${GEMINI_API_BASE}/models?key=${apiKey}`,
      { method: 'GET' }
    );

    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        return { success: false, message: 'Invalid Google API key', latency };
      }
      return { success: false, message: `${label} API error: ${response.status} - ${errorText}`, latency };
    }

    const data = await response.json();
    const models = data.models || [];

    const hasImageModel = models.some(
      (m: { name: string; supportedGenerationMethods?: string[] }) =>
        modelPatterns.some((pattern) => m.name.includes(pattern)) ||
        m.supportedGenerationMethods?.includes('generateContent')
    );

    return {
      success: true,
      message: hasImageModel
        ? `${label} connection successful, image models available (${latency}ms)`
        : `${label} connected but expected image models not visible (${latency}ms)`,
      latency,
      hasImageModels: hasImageModel,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    return { success: false, message: `Connection failed: ${message}`, latency };
  }
}

export async function isGoogleConfigured(): Promise<boolean> {
  return isProviderConfigured('gemini');
}

/**
 * Get estimated cost for Google image generation
 */
export function getGoogleCost(model: string): number {
  if (model.includes('gemini-3.1-flash-image')) return 0.067;
  if (model.includes('gemini-3-pro-image')) return 0.134;
  if (model.includes('imagen-4.0-fast')) return 0.02;
  if (model.includes('imagen-4.0-ultra')) return 0.06;
  if (model.includes('imagen-4.0')) return 0.04;
  return 0.04;
}
