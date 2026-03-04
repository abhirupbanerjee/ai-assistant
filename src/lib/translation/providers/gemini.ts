/**
 * Gemini Translation Provider
 *
 * Supports Gemini 2.5 family models for translation.
 * Uses the REST API directly.
 */

import { toolsLogger as logger } from '../../logger';
import type {
  TranslationRequest,
  TranslationResponse,
  ProviderSettings,
} from '../provider-factory';
import { SUPPORTED_LANGUAGES, buildTranslationPrompt } from '../provider-factory';
import { getApiKey, isProviderConfigured } from '@/lib/provider-helpers';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

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

/**
 * Translate text using Gemini models
 */
export async function translateWithGemini(
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
        provider: 'gemini',
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
        provider: 'gemini',
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
        provider: 'gemini',
        model: settings.model,
      };
    }

    const apiKey = await getGeminiApiKey();
    const sourceLangDesc = sourceLanguage
      ? SUPPORTED_LANGUAGES[sourceLanguage]
      : 'the source language (auto-detect)';

    const systemPrompt = buildTranslationPrompt(
      sourceLangDesc,
      targetLangName,
      formalStyle,
      context
    );

    logger.info('[Translation:Gemini] Starting translation', {
      model: settings.model,
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      textLength: text.length,
    });

    // Build request for Gemini API
    const requestBody = {
      contents: [
        {
          parts: [
            { text: `${systemPrompt}\n\nTranslate the following text:\n\n${text}` },
          ],
        },
      ],
      generationConfig: {
        temperature: settings.temperature,
        maxOutputTokens: Math.min(text.length * 2, 4000),
      },
    };

    const response = await fetch(
      `${GEMINI_API_BASE}/models/${settings.model}:generateContent?key=${apiKey}`,
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
      logger.error('[Translation:Gemini] API Error:', { status: response.status, error: errorText });

      if (response.status === 401) {
        throw new Error('Invalid Gemini API key');
      }
      if (response.status === 429) {
        throw new Error('Gemini rate limit exceeded');
      }

      throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (!translatedText) {
      throw new Error('No translation returned from Gemini');
    }

    logger.info('[Translation:Gemini] Translation complete', {
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
      provider: 'gemini',
      model: settings.model,
    };
  } catch (error) {
    logger.error('[Translation:Gemini] Translation failed', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      original: text,
      translated: '',
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      targetLanguageName: SUPPORTED_LANGUAGES[targetLanguage] || '',
      provider: 'gemini',
      model: settings.model,
      error: `Gemini translation failed: ${errorMessage}`,
    };
  }
}

/**
 * Check if Gemini provider is configured (DB-first, then env var fallback)
 */
export async function isGeminiConfigured(): Promise<boolean> {
  return isProviderConfigured('gemini');
}
