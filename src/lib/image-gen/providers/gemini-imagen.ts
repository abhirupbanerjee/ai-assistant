/**
 * Google Gemini Nano Banana Pro Provider
 *
 * Direct API call to Gemini for image generation.
 * Uses gemini-3-pro-image-preview (Nano Banana Pro) which excels at:
 * - Infographics with legible text
 * - Diagrams and charts
 * - Professional data visualizations
 */

import type {
  GeminiProviderConfig,
  ImageGenToolArgs,
  AspectRatio,
  GeminiResponse,
} from '@/types/image-gen';
import { getApiKey, isProviderConfigured } from '@/lib/provider-helpers';

// ===== Constants =====

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ===== API Key Management =====

/**
 * Get Gemini API key using centralized provider helper (DB-first, then env var fallback)
 */
async function getGeminiApiKey(): Promise<string> {
  const apiKey = await getApiKey('gemini');
  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }
  return apiKey;
}

// ===== Generation Functions =====

export interface GeminiGenerationResult {
  /** Generated image as buffer */
  buffer: Buffer;
  /** Enhanced prompt or description from Gemini */
  enhancedPrompt?: string;
}

/**
 * Generate an image using Gemini Nano Banana Pro
 *
 * @param args - Generation arguments from LLM
 * @param config - Gemini provider configuration
 * @returns Image buffer and optional enhanced prompt
 */
export async function generateWithGemini(
  args: ImageGenToolArgs,
  config: GeminiProviderConfig
): Promise<GeminiGenerationResult> {
  const apiKey = await getGeminiApiKey();

  console.log(
    `[ImageGen:Gemini] Generating image: "${args.prompt.substring(0, 50)}..."`
  );
  console.log(
    `[ImageGen:Gemini] Model: ${config.model}, Aspect: ${args.aspectRatio || config.aspectRatio}`
  );

  const startTime = Date.now();

  // Use Nano Banana Pro (gemini-3-pro-image-preview) for best results
  const result = await generateWithNanoBananaPro(args, config, apiKey);

  const latency = Date.now() - startTime;
  console.log(`[ImageGen:Gemini] Generation completed in ${latency}ms`);

  return result;
}

/**
 * Generate using Gemini 3 Pro Image (Nano Banana Pro)
 *
 * This model excels at:
 * - Infographics with legible text
 * - Diagrams and charts
 * - Professional data visualizations
 */
async function generateWithNanoBananaPro(
  args: ImageGenToolArgs,
  config: GeminiProviderConfig,
  apiKey: string
): Promise<GeminiGenerationResult> {
  // Build prompt with aspect ratio guidance
  const aspectRatio = args.aspectRatio || config.aspectRatio;
  const promptWithAspect = buildPromptWithAspectRatio(args.prompt, aspectRatio);

  const requestBody = {
    contents: [
      {
        parts: [{ text: promptWithAspect }],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${config.model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[ImageGen:Gemini] API Error:', errorText);

    // Parse specific error types
    if (response.status === 400) {
      throw new Error(`Gemini rejected the prompt: ${errorText}`);
    }
    if (response.status === 401) {
      throw new Error('Invalid Gemini API key');
    }
    if (response.status === 429) {
      throw new Error('Gemini rate limit exceeded');
    }
    if (response.status === 503) {
      throw new Error('Gemini service temporarily unavailable');
    }

    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data: GeminiResponse = await response.json();

  // Extract image from response parts
  return extractImageFromResponse(data);
}

/**
 * Extract image buffer and text from Gemini response
 */
function extractImageFromResponse(response: GeminiResponse): GeminiGenerationResult {
  const parts = response.candidates?.[0]?.content?.parts || [];

  let imageBuffer: Buffer | null = null;
  let textContent: string | undefined;

  for (const part of parts) {
    if (part.inlineData?.data) {
      // Found image data
      imageBuffer = Buffer.from(part.inlineData.data, 'base64');
    } else if (part.text) {
      // Found text (description or enhanced prompt)
      textContent = part.text;
    }
  }

  if (!imageBuffer) {
    console.error('[ImageGen:Gemini] Response structure:', JSON.stringify(response, null, 2));
    throw new Error('Gemini returned no image data. The model may have declined to generate the image.');
  }

  return {
    buffer: imageBuffer,
    enhancedPrompt: textContent,
  };
}

/**
 * Build prompt with aspect ratio guidance
 * Gemini responds better to natural language aspect ratio descriptions
 */
function buildPromptWithAspectRatio(
  prompt: string,
  aspectRatio: AspectRatio
): string {
  const aspectGuidance = getAspectRatioGuidance(aspectRatio);
  return `${prompt}\n\nImage format: ${aspectGuidance}`;
}

/**
 * Get natural language description for aspect ratio
 */
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

// ===== Connection Test =====

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latency?: number;
  hasImageModels?: boolean;
}

/**
 * Test Gemini API connectivity
 */
export async function testGeminiConnection(): Promise<ConnectionTestResult> {
  const startTime = Date.now();

  try {
    const apiKey = await getGeminiApiKey();

    // Test by listing models
    const response = await fetch(
      `${GEMINI_API_BASE}/models?key=${apiKey}`,
      { method: 'GET' }
    );

    const latency = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        return {
          success: false,
          message: 'Invalid Gemini API key',
          latency,
        };
      }
      return {
        success: false,
        message: `Gemini API error: ${response.status} - ${errorText}`,
        latency,
      };
    }

    const data = await response.json();
    const models = data.models || [];

    // Check for image generation capable models
    const hasImageModel = models.some(
      (m: { name: string; supportedGenerationMethods?: string[] }) =>
        m.name.includes('gemini-3-pro-image') ||
        m.name.includes('imagen') ||
        m.supportedGenerationMethods?.includes('generateContent')
    );

    return {
      success: true,
      message: hasImageModel
        ? `Gemini connection successful, image models available (${latency}ms)`
        : `Gemini connected. Image generation may require gemini-3-pro-image-preview model (${latency}ms)`,
      latency,
      hasImageModels: hasImageModel,
    };
  } catch (error) {
    const latency = Date.now() - startTime;
    const message =
      error instanceof Error ? error.message : 'Unknown error occurred';

    return {
      success: false,
      message: `Connection failed: ${message}`,
      latency,
    };
  }
}

/**
 * Check if Gemini provider is configured (DB-first, then env var fallback)
 */
export async function isGeminiConfigured(): Promise<boolean> {
  return isProviderConfigured('gemini');
}

/**
 * Get estimated cost for Gemini image generation
 * Based on Google pricing (as of 2025)
 */
export function getGeminiCost(model: string): number {
  // Nano Banana Pro pricing
  if (model.includes('gemini-3-pro-image')) {
    return 0.039; // Per image
  }
  // Imagen 3 pricing
  if (model.includes('imagen')) {
    return 0.03; // Per image
  }
  return 0.04; // Default estimate
}
