/**
 * Image Processing Capability Checker
 *
 * Centralized detection for vision/OCR capabilities.
 * Determines the best strategy for processing uploaded images.
 *
 * Strategies:
 * - 'vision-and-ocr': Model supports vision + OCR available for text extraction
 * - 'vision-only': Model supports vision but no OCR configured
 * - 'ocr-only': No vision support but OCR can extract text
 * - 'none': No image processing available
 */

import { getEnabledModel, getDefaultModel, isModelVisionCapable } from '@/lib/db/compat/enabled-models';
import { getOcrSettings } from '@/lib/db/compat/config';
import { isProviderConfigured } from '@/lib/provider-helpers';

// ============ Types ============

export type ImageStrategy = 'vision-and-ocr' | 'vision-only' | 'ocr-only' | 'none';

export interface ImageCapabilities {
  /** Can the system process images at all? */
  canProcessImages: boolean;
  /** Does the current model support visual image analysis? */
  hasVisionSupport: boolean;
  /** Is OCR available for text extraction from images? */
  hasOcrSupport: boolean;
  /** Processing strategy to use */
  strategy: ImageStrategy;
  /** User-facing message explaining capabilities */
  message: string;
  /** Model ID used for this capability check */
  modelId: string;
}

// ============ Core Functions ============

/**
 * Check if a specific model supports vision/image input
 * Uses the database as the authoritative source
 */
export async function isVisionCapableModel(modelId: string): Promise<boolean> {
  return await isModelVisionCapable(modelId);
}

/**
 * Check if image-capable OCR is available
 * Note: pdf-parse only supports PDFs, not images
 * Returns true if Mistral or Azure DI is configured and enabled
 */
export async function isImageOcrAvailable(): Promise<boolean> {
  const ocrSettings = await getOcrSettings();

  for (const { provider, enabled } of ocrSettings.providers) {
    if (!enabled) continue;

    switch (provider) {
      case 'mistral': {
        // Check DB settings first, then provider config (which includes env vars)
        const hasMistral = ocrSettings.mistralApiKey || await isProviderConfigured('mistral');
        if (hasMistral) return true;
        break;
      }
      case 'azure-di': {
        // Check DB settings first, then env vars
        const hasAzure =
          (ocrSettings.azureDiEndpoint && ocrSettings.azureDiKey) ||
          (process.env.AZURE_DI_ENDPOINT && process.env.AZURE_DI_KEY);
        if (hasAzure) return true;
        break;
      }
      // pdf-parse doesn't support images, skip
    }
  }

  return false;
}

/**
 * Get comprehensive image processing capabilities for a model
 * Determines the best strategy based on available resources
 */
export async function getImageCapabilities(modelId: string): Promise<ImageCapabilities> {
  const hasVision = await isVisionCapableModel(modelId);
  const hasOcr = await isImageOcrAvailable();

  // Scenario 1: No vision, no OCR - cannot process images
  if (!hasVision && !hasOcr) {
    return {
      canProcessImages: false,
      hasVisionSupport: false,
      hasOcrSupport: false,
      strategy: 'none',
      modelId,
      message:
        'Image uploads are not available. Enable Mistral OCR or Azure Document Intelligence in Settings, or switch to a vision-capable model (GPT-4o, Gemini 2.5, Pixtral).',
    };
  }

  // Scenario 2: No vision, has OCR - OCR fallback mode
  if (!hasVision && hasOcr) {
    return {
      canProcessImages: true,
      hasVisionSupport: false,
      hasOcrSupport: true,
      strategy: 'ocr-only',
      modelId,
      message: `Current model (${modelId}) does not support visual analysis. Text will be extracted via OCR. For full image analysis, switch to a vision-capable model.`,
    };
  }

  // Scenario 3: Has vision, has OCR - optimal hybrid mode
  if (hasVision && hasOcr) {
    return {
      canProcessImages: true,
      hasVisionSupport: true,
      hasOcrSupport: true,
      strategy: 'vision-and-ocr',
      modelId,
      message: `Images will be analyzed visually by ${modelId} with OCR text extraction for enhanced context.`,
    };
  }

  // Scenario 4: Has vision, no OCR - vision only
  return {
    canProcessImages: true,
    hasVisionSupport: true,
    hasOcrSupport: false,
    strategy: 'vision-only',
    modelId,
    message: `Images will be analyzed visually by ${modelId}. OCR text extraction is not configured.`,
  };
}

/**
 * Get image capabilities for the system default model
 * Useful when no specific model is selected
 */
export async function getDefaultImageCapabilities(): Promise<ImageCapabilities> {
  const defaultModel = await getDefaultModel();
  const modelId = defaultModel?.id || 'unknown';
  return await getImageCapabilities(modelId);
}

/**
 * Get a list of vision-capable model names for user messaging
 */
export function getVisionCapableModelSuggestions(): string[] {
  // Common vision-capable model patterns
  return ['GPT-4o', 'GPT-4.1', 'Gemini 2.5', 'Gemini 1.5', 'Pixtral', 'Mistral Large 3'];
}
