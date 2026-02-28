/**
 * AI Disclaimer Utilities
 *
 * Shared functions for adding AI-generated content disclaimers
 * to various output formats (documents, images, audio, charts, diagrams).
 */

import { getToolConfigAsync } from '@/lib/db/compat';

// ===== Types =====

export interface ImageWatermarkConfig {
  enabled: boolean;
  opacity: number;
  position: 'bottomRight' | 'bottomLeft' | 'topRight' | 'topLeft';
}

export interface DisclaimerConfig {
  enabled: boolean;
  fullText: string;
  abbreviatedText: string;
  fontSize: number;
  color: string;
  smallImageThreshold: number;
  imageWatermark: ImageWatermarkConfig;
}

// ===== Default Configuration =====

export const DEFAULT_DISCLAIMER_CONFIG: DisclaimerConfig = {
  enabled: false,
  fullText: 'This is AI generated content',
  abbreviatedText: 'AI',
  fontSize: 9,
  color: '#666666',
  smallImageThreshold: 400,
  imageWatermark: {
    enabled: true,
    opacity: 0.7,
    position: 'bottomRight',
  },
};

// ===== Core Functions =====

/**
 * Get disclaimer configuration from database
 * Falls back to defaults if not configured
 */
export async function getDisclaimerConfig(): Promise<DisclaimerConfig> {
  try {
    const toolConfig = await getToolConfigAsync('ai_disclaimer');
    if (toolConfig?.config) {
      // Merge with defaults to ensure all properties exist
      return {
        ...DEFAULT_DISCLAIMER_CONFIG,
        ...(toolConfig.config as Partial<DisclaimerConfig>),
        imageWatermark: {
          ...DEFAULT_DISCLAIMER_CONFIG.imageWatermark,
          ...((toolConfig.config as Partial<DisclaimerConfig>).imageWatermark || {}),
        },
      };
    }
  } catch (error) {
    console.error('Failed to fetch disclaimer config:', error);
  }
  return DEFAULT_DISCLAIMER_CONFIG;
}

/**
 * Check if disclaimers are enabled
 */
export async function isDisclaimerEnabled(): Promise<boolean> {
  try {
    const toolConfig = await getToolConfigAsync('ai_disclaimer');
    return toolConfig?.isEnabled ?? false;
  } catch (error) {
    console.error('Failed to check disclaimer enabled status:', error);
    return false;
  }
}

/**
 * Get appropriate disclaimer text based on image dimensions
 * Uses abbreviated text for smaller images to avoid visual clutter
 *
 * @param config - Disclaimer configuration
 * @param width - Image width in pixels (optional)
 * @param height - Image height in pixels (optional)
 * @returns Full or abbreviated disclaimer text
 */
export function getDisclaimerText(
  config: DisclaimerConfig,
  width?: number,
  height?: number
): string {
  if (width !== undefined && height !== undefined) {
    const isSmall = Math.min(width, height) < config.smallImageThreshold;
    return isSmall ? config.abbreviatedText : config.fullText;
  }
  return config.fullText;
}

/**
 * Get disclaimer config if enabled, otherwise null
 * Convenience function for conditional disclaimer application
 */
export async function getDisclaimerConfigIfEnabled(): Promise<DisclaimerConfig | null> {
  const enabled = await isDisclaimerEnabled();
  if (!enabled) {
    return null;
  }
  return getDisclaimerConfig();
}
