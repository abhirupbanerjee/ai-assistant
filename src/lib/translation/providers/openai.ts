/**
 * OpenAI Translation Provider
 *
 * Supports GPT-4.1 family models for translation.
 */

import { toolsLogger as logger } from '../../logger';
import type {
  TranslationRequest,
  TranslationResponse,
  ProviderSettings,
} from '../provider-factory';
import { SUPPORTED_LANGUAGES, buildTranslationPrompt } from '../provider-factory';
import { createInternalCompletion } from '@/lib/llm-client';

/**
 * Translate text using OpenAI's GPT models
 */
export async function translateWithOpenAI(
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
        provider: 'openai',
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
        provider: 'openai',
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
        provider: 'openai',
        model: settings.model,
      };
    }

    const sourceLangDesc = sourceLanguage
      ? SUPPORTED_LANGUAGES[sourceLanguage]
      : 'the source language (auto-detect)';

    const systemPrompt = buildTranslationPrompt(
      sourceLangDesc,
      targetLangName,
      formalStyle,
      context
    );

    logger.info('[Translation:OpenAI] Starting translation', {
      model: settings.model,
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      textLength: text.length,
    });

    // Calculate max tokens (roughly 2x input for language expansion)
    const maxTokens = Math.min(text.length * 2, 4000);

    const translatedText = await createInternalCompletion({
      model: settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: settings.temperature,
      maxTokens,
    });

    if (!translatedText) {
      throw new Error('No translation returned from OpenAI');
    }

    logger.info('[Translation:OpenAI] Translation complete', {
      originalLength: text.length,
      translatedLength: translatedText.length,
    });

    return {
      success: true,
      original: text,
      translated: translatedText,
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      targetLanguageName: targetLangName,
      provider: 'openai',
      model: settings.model,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[Translation:OpenAI] Translation failed', error);

    return {
      success: false,
      original: text,
      translated: '',
      sourceLanguage: sourceLanguage || 'auto',
      targetLanguage,
      targetLanguageName: SUPPORTED_LANGUAGES[targetLanguage] || '',
      provider: 'openai',
      model: settings.model,
      error: `OpenAI translation failed: ${errorMessage}`,
    };
  }
}
