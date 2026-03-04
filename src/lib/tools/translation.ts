/**
 * Translation Tool
 *
 * Multi-provider LLM translation supporting OpenAI, Gemini, and Mistral.
 * Uses formal/government terminology with configurable providers.
 *
 * Configuration is managed through the Tools admin UI.
 */

import type { ToolDefinition, ValidationResult } from '../tools';
import { toolsLogger as logger } from '../logger';
import {
  translate,
  ALL_LANGUAGES,
  TRANSLATION_DEFAULTS,
  isTranslationAvailable,
  getTranslationConfig,
  getEnabledLanguages,
} from '../translation';

// ============ Types ============

export interface TranslationArgs {
  text: string;
  source_language?: string;
  target_language: string;
  context?: string;
}

// ============ Tool Definition ============

export const translationTool: ToolDefinition = {
  name: 'translation',
  displayName: 'Translation',
  description: 'Translate text between English, Hindi, French, Spanish, and Portuguese using formal terminology',
  category: 'autonomous',

  definition: {
    type: 'function',
    function: {
      name: 'translation',
      description: 'Translate text between languages. Uses formal government/legal terminology. Supports English, Hindi, French, Spanish, and Portuguese.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to translate',
          },
          source_language: {
            type: 'string',
            enum: Object.keys(ALL_LANGUAGES),
            description: 'Source language code (auto-detect if omitted). Options: en, hi, fr, es, pt',
          },
          target_language: {
            type: 'string',
            enum: Object.keys(ALL_LANGUAGES),
            description: 'Target language code. Options: en (English), hi (Hindi), fr (French), es (Spanish), pt (Portuguese)',
          },
          context: {
            type: 'string',
            description: 'Additional context to improve translation quality (e.g., "legal document", "policy brief", "technical manual")',
          },
        },
        required: ['text', 'target_language'],
      },
    },
  },

  configSchema: {
    type: 'object',
    properties: {
      activeProvider: {
        type: 'string',
        title: 'Active Provider',
        description: 'Primary translation provider to use',
        enum: ['openai', 'gemini', 'mistral'],
        default: 'openai',
      },
      providers: {
        type: 'object',
        title: 'Provider Settings',
        properties: {
          openai: {
            type: 'object',
            title: 'OpenAI',
            properties: {
              enabled: {
                type: 'boolean',
                title: 'Enabled',
                description: 'Enable OpenAI translation',
                default: true,
              },
              model: {
                type: 'string',
                title: 'Model',
                description: 'OpenAI model for translation',
                enum: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'],
                default: 'gpt-4.1-mini',
              },
              temperature: {
                type: 'number',
                title: 'Temperature',
                description: 'Lower values produce more consistent translations (0.0-1.0)',
                default: 0.3,
                minimum: 0,
                maximum: 1,
              },
            },
          },
          gemini: {
            type: 'object',
            title: 'Gemini',
            properties: {
              enabled: {
                type: 'boolean',
                title: 'Enabled',
                description: 'Enable Gemini translation',
                default: true,
              },
              model: {
                type: 'string',
                title: 'Model',
                description: 'Gemini model for translation',
                enum: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
                default: 'gemini-2.5-flash',
              },
              temperature: {
                type: 'number',
                title: 'Temperature',
                description: 'Lower values produce more consistent translations (0.0-1.0)',
                default: 0.3,
                minimum: 0,
                maximum: 1,
              },
            },
          },
          mistral: {
            type: 'object',
            title: 'Mistral',
            properties: {
              enabled: {
                type: 'boolean',
                title: 'Enabled',
                description: 'Enable Mistral translation',
                default: true,
              },
              model: {
                type: 'string',
                title: 'Model',
                description: 'Mistral model for translation',
                enum: ['mistral-large-3', 'mistral-small-3.2'],
                default: 'mistral-small-3.2',
              },
              temperature: {
                type: 'number',
                title: 'Temperature',
                description: 'Lower values produce more consistent translations (0.0-1.0)',
                default: 0.3,
                minimum: 0,
                maximum: 1,
              },
            },
          },
        },
      },
      languages: {
        type: 'object',
        title: 'Enabled Languages',
        description: 'Toggle which languages are available for translation',
        properties: {
          en: {
            type: 'boolean',
            title: 'English',
            default: true,
          },
          hi: {
            type: 'boolean',
            title: 'Hindi',
            default: true,
          },
          fr: {
            type: 'boolean',
            title: 'French',
            default: true,
          },
          es: {
            type: 'boolean',
            title: 'Spanish',
            default: true,
          },
          pt: {
            type: 'boolean',
            title: 'Portuguese',
            default: true,
          },
        },
      },
      formalStyle: {
        type: 'boolean',
        title: 'Formal Style',
        description: 'Use formal/official language style (recommended for government documents)',
        default: true,
      },
    },
  },

  defaultConfig: TRANSLATION_DEFAULTS as unknown as Record<string, unknown>,

  validateConfig: (config: Record<string, unknown>): ValidationResult => {
    const errors: string[] = [];

    // Check active provider
    if (config.activeProvider !== undefined) {
      const validProviders = ['openai', 'gemini', 'mistral'];
      if (!validProviders.includes(config.activeProvider as string)) {
        errors.push(`Invalid active provider: ${config.activeProvider}. Must be one of: ${validProviders.join(', ')}`);
      }
    }

    // Check that at least one provider is enabled
    if (!isTranslationAvailable()) {
      errors.push('At least one translation provider must be enabled');
    }

    // Check provider settings if provided
    const providers = config.providers as Record<string, Record<string, unknown>> | undefined;
    if (providers) {
      for (const [name, settings] of Object.entries(providers)) {
        if (settings.temperature !== undefined) {
          const temp = settings.temperature as number;
          if (typeof temp !== 'number' || temp < 0 || temp > 1) {
            errors.push(`${name}: Temperature must be a number between 0 and 1`);
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  },

  execute: async (args: TranslationArgs): Promise<string> => {
    try {
      logger.info('[Translation] Starting translation', {
        sourceLanguage: args.source_language || 'auto',
        targetLanguage: args.target_language,
        textLength: args.text?.length || 0,
      });

      // Validate input
      if (!args.text?.trim()) {
        return JSON.stringify({
          success: false,
          error: 'No text provided for translation',
        });
      }

      // Get config to check enabled languages and formal style
      const config = await getTranslationConfig();
      const enabledLanguages = getEnabledLanguages(config);

      // Validate target language is enabled
      if (!enabledLanguages[args.target_language]) {
        const enabledList = Object.entries(enabledLanguages)
          .map(([code, name]) => `${code} (${name})`)
          .join(', ');
        return JSON.stringify({
          success: false,
          error: `Target language '${args.target_language}' is not enabled. Available: ${enabledList}`,
        });
      }

      // Validate source language is enabled (if specified)
      if (args.source_language && !enabledLanguages[args.source_language]) {
        const enabledList = Object.entries(enabledLanguages)
          .map(([code, name]) => `${code} (${name})`)
          .join(', ');
        return JSON.stringify({
          success: false,
          error: `Source language '${args.source_language}' is not enabled. Available: ${enabledList}`,
        });
      }

      // Execute translation
      const result = await translate({
        text: args.text,
        sourceLanguage: args.source_language,
        targetLanguage: args.target_language,
        context: args.context,
        formalStyle: config.formalStyle,
      });

      // Format response for LLM
      return JSON.stringify({
        success: result.success,
        original: result.original,
        translated: result.translated,
        source_language: result.sourceLanguage,
        target_language: result.targetLanguage,
        target_language_name: result.targetLanguageName,
        provider: result.provider,
        model: result.model,
        error: result.error,
      });
    } catch (error) {
      logger.error('[Translation] Translation failed', { error });

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return JSON.stringify({
        success: false,
        error: `Translation failed: ${errorMessage}`,
        original: args.text || '',
        translated: '',
        source_language: args.source_language || 'auto',
        target_language: args.target_language || '',
        target_language_name: ALL_LANGUAGES[args.target_language] || '',
      });
    }
  },
};
