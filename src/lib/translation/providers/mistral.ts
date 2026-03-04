/**
 * Mistral Translation Provider
 *
 * Supports Mistral family models for translation.
 * Uses the official @mistralai/mistralai SDK.
 */

import { Mistral } from '@mistralai/mistralai';
import { toolsLogger as logger } from '../../logger';
import type {
  TranslationRequest,
  TranslationResponse,
  ProviderSettings,
} from '../provider-factory';
import { SUPPORTED_LANGUAGES, buildTranslationPrompt } from '../provider-factory';
import { getApiKey, isProviderConfigured } from '@/lib/provider-helpers';

let mistralClient: Mistral | null = null;

/**
 * Get or create Mistral client using centralized provider helper (DB-first, then env var fallback)
 */
async function getMistralClient(): Promise<Mistral> {
  if (!mistralClient) {
    const apiKey = await getApiKey('mistral');
    if (!apiKey) {
      throw new Error('Mistral API key not configured');
    }
    mistralClient = new Mistral({ apiKey });
  }
  return mistralClient;
}

/**
 * Translate text using Mistral models
 */
export async function translateWithMistral(
  request: TranslationRequest,
  settings: ProviderSettings
): Promise<TranslationResponse> {
  const { text, sourceLanguage, targetLanguage, context, formalStyle } = request;

  try {
    // Validate target language
    const targetLangName = SUPPORTED_LANGUAGES[targetLanguage];
    if (!targetLangName) {
      return {
        success: false,
        original: text,
        translated: '',
        sourceLanguage: sourceLanguage || 'auto',
        targetLanguage,
        targetLanguageName: '',
        provider: 'mistral',
        model: settings.model,
        error: `Unsupported target language: ${targetLanguage}`,
      };
    }

    // Validate source language if provided
    if (sourceLanguage && !SUPPORTED_LANGUAGES[sourceLanguage]) {
      return {
        success: false,
        original: text,
        translated: '',
        sourceLanguage,
        targetLanguage,
        targetLanguageName: targetLangName,
        provider: 'mistral',
        model: settings.model,
        error: `Unsupported source language: ${sourceLanguage}`,
      };
    }

    // Same language - return as-is
    if (sourceLanguage === targetLanguage) {
      return {
        success: true,
        original: text,
        translated: text,
        sourceLanguage,
        targetLanguage,
        targetLanguageName: targetLangName,
        provider: 'mistral',
        model: settings.model,
      };
    }

    const client = await getMistralClient();
    const sourceLangDesc = sourceLanguage
      ? SUPPORTED_LANGUAGES[sourceLanguage]
      : 'the source language (auto-detect)';

    const systemPrompt = buildTranslationPrompt(
      sourceLangDesc,
      targetLangName,
      formalStyle,
      context
    );

    logger.info('[Translation:Mistral] Starting translation', {
      model: settings.model,
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      textLength: text.length,
    });

    const response = await client.chat.complete({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: settings.temperature,
      maxTokens: Math.min(text.length * 2, 4000),
    });

    const translatedText = response.choices?.[0]?.message?.content || '';

    if (!translatedText || typeof translatedText !== 'string') {
      throw new Error('No translation returned from Mistral');
    }

    logger.info('[Translation:Mistral] Translation complete', {
      originalLength: text.length,
      translatedLength: translatedText.length,
    });

    return {
      success: true,
      original: text,
      translated: translatedText.trim(),
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      targetLanguageName: targetLangName,
      provider: 'mistral',
      model: settings.model,
    };
  } catch (error) {
    logger.error('[Translation:Mistral] Translation failed', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      original: text,
      translated: '',
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      targetLanguageName: SUPPORTED_LANGUAGES[targetLanguage] || '',
      provider: 'mistral',
      model: settings.model,
      error: `Mistral translation failed: ${errorMessage}`,
    };
  }
}

/**
 * Check if Mistral provider is configured (DB-first, then env var fallback)
 */
export async function isMistralConfigured(): Promise<boolean> {
  return isProviderConfigured('mistral');
}
