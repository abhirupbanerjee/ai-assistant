/**
 * YouTube Transcript Tool
 *
 * Provides YouTube transcript extraction via Supadata API (primary)
 * with youtube-transcript npm package as fallback.
 *
 * Configuration is managed through the Tools admin UI.
 */

import { getToolConfig } from '../db/compat/tool-config';
import type { ToolDefinition, ValidationResult } from '../tools';

// ============ Types ============

export interface YouTubeToolConfig {
  apiKey: string;
  preferredLanguage: string;
  fallbackEnabled: boolean;
}

export interface SupadataResult {
  success: boolean;
  transcript: string;
  language: string;
  availableLanguages: string[];
}

// ============ Tool Configuration ============

/**
 * Get YouTube tool configuration from database
 */
export async function getYouTubeConfig(): Promise<{ enabled: boolean; config: YouTubeToolConfig }> {
  const toolConfig = await getToolConfig('youtube');
  if (toolConfig) {
    const config = toolConfig.config as Record<string, unknown>;
    return {
      enabled: toolConfig.isEnabled,
      config: {
        apiKey: (config.apiKey as string) || '',
        preferredLanguage: (config.preferredLanguage as string) || 'en',
        fallbackEnabled: config.fallbackEnabled !== false, // Default true
      },
    };
  }
  return {
    enabled: false,
    config: { apiKey: '', preferredLanguage: 'en', fallbackEnabled: true },
  };
}

/**
 * Check if Supadata API is configured
 */
export async function isSupadataConfigured(): Promise<boolean> {
  const { config } = await getYouTubeConfig();
  return !!config.apiKey;
}

// ============ Supadata API ============

/**
 * Extract YouTube transcript using Supadata API
 *
 * API: GET https://api.supadata.ai/v1/youtube/transcript
 * Auth: x-api-key header
 * Pricing: 1 credit per transcript
 */
export async function extractWithSupadata(
  videoId: string,
  apiKey: string,
  lang?: string
): Promise<SupadataResult> {
  const url = new URL('https://api.supadata.ai/v1/youtube/transcript');
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('text', 'true'); // Get plain text format
  if (lang) url.searchParams.set('lang', lang);

  const response = await fetch(url.toString(), {
    headers: { 'x-api-key': apiKey },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = (errorData as { message?: string }).message;
    throw new Error(message || `Supadata API error: ${response.status}`);
  }

  const data = await response.json() as {
    content: string;
    lang: string;
    availableLangs: string[];
  };

  return {
    success: true,
    transcript: data.content,
    language: data.lang,
    availableLanguages: data.availableLangs || [],
  };
}

// ============ Tool Definition for Admin UI ============

/**
 * YouTube tool definition for the Tools admin page
 */
export const youtubeToolDefinition: ToolDefinition = {
  name: 'youtube',
  displayName: 'YouTube Transcript',
  description: 'Extract transcripts from YouTube videos for document ingestion using Supadata API',
  category: 'processor', // Used by document ingestion, not chat
  configSchema: {
    type: 'object',
    properties: {
      apiKey: {
        type: 'string',
        title: 'Supadata API Key',
        description: 'Get your API key from https://supadata.ai (free $5 credit = ~5000 transcripts)',
        format: 'password',
      },
      preferredLanguage: {
        type: 'string',
        title: 'Preferred Language',
        description: 'ISO 639-1 language code (e.g., en, es, fr, de)',
        default: 'en',
      },
      fallbackEnabled: {
        type: 'boolean',
        title: 'Enable Fallback',
        description: 'Use free youtube-transcript npm package as fallback (may be unreliable on cloud servers)',
        default: true,
      },
    },
  },
  defaultConfig: {
    apiKey: '',
    preferredLanguage: 'en',
    fallbackEnabled: true,
  },
  validateConfig: (config: Record<string, unknown>): ValidationResult => {
    const errors: string[] = [];
    // API key is optional (fallback available), but if provided should be non-empty
    if (config.apiKey !== undefined && config.apiKey !== '' && typeof config.apiKey !== 'string') {
      errors.push('API key must be a string');
    }
    if (config.preferredLanguage !== undefined && typeof config.preferredLanguage !== 'string') {
      errors.push('Preferred language must be a string');
    }
    return { valid: errors.length === 0, errors };
  },
  // YouTube tool doesn't execute during chat - it's used by document ingestion
  execute: async () => {
    return JSON.stringify({
      error: 'YouTube tool is used for document ingestion, not chat execution',
    });
  },
};
