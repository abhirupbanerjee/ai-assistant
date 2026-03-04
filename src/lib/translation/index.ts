/**
 * Translation Module
 *
 * Multi-provider translation system supporting OpenAI, Gemini, and Mistral.
 */

export * from './provider-factory';
export { translateWithOpenAI } from './providers/openai';
export { translateWithGemini, isGeminiConfigured } from './providers/gemini';
export { translateWithMistral, isMistralConfigured } from './providers/mistral';

import type { TranslationRequest, TranslationResponse, TranslationProvider } from './provider-factory';
import { getTranslationConfig, selectProvider, getProviderSettings } from './provider-factory';
import { translateWithOpenAI } from './providers/openai';
import { translateWithGemini } from './providers/gemini';
import { translateWithMistral } from './providers/mistral';
import { toolsLogger as logger } from '../logger';

/**
 * Translate text using the configured provider
 */
export async function translate(request: TranslationRequest): Promise<TranslationResponse> {
  const config = await getTranslationConfig();

  // Select best available provider
  let provider: TranslationProvider;
  try {
    provider = selectProvider(config);
  } catch (error) {
    return {
      success: false,
      original: request.text,
      translated: '',
      sourceLanguage: request.sourceLanguage || 'auto',
      targetLanguage: request.targetLanguage,
      targetLanguageName: '',
      provider: 'openai',
      model: '',
      error: error instanceof Error ? error.message : 'No provider available',
    };
  }

  const settings = getProviderSettings(config, provider);

  logger.info('[Translation] Using provider', { provider, model: settings.model });

  // Call the appropriate provider
  switch (provider) {
    case 'openai':
      return translateWithOpenAI(request, settings);
    case 'gemini':
      return translateWithGemini(request, settings);
    case 'mistral':
      return translateWithMistral(request, settings);
    default:
      return {
        success: false,
        original: request.text,
        translated: '',
        sourceLanguage: request.sourceLanguage || 'auto',
        targetLanguage: request.targetLanguage,
        targetLanguageName: '',
        provider,
        model: settings.model,
        error: `Unknown provider: ${provider}`,
      };
  }
}
