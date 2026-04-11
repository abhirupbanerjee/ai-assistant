import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import {
  getRagSettings,
  setRagSettings,
  getLlmSettings,
  setLlmSettings,
  getAcronymMappings,
  setAcronymMappings,
  getTavilySettings,
  setTavilySettings,
  getUploadLimits,
  setUploadLimits,
  getRetentionSettings,
  setRetentionSettings,
  getBrandingSettings,
  setBrandingSettings,
  getEmbeddingSettings,
  setEmbeddingSettings,
  getRerankerSettings,
  setRerankerSettings,
  getMemorySettings,
  setMemorySettings,
  getSummarizationSettings,
  setSummarizationSettings,
  setSkillsSettings,
  getOcrSettings,
  setOcrSettings,
  DEFAULT_OCR_SETTINGS,
  getLimitsSettings,
  setLimitsSettings,
  getTokenLimitsSettings,
  setTokenLimitsSettings,
  getSettingMetadata,
  deleteSetting,
  getAvailableModels,
  BRANDING_ICONS,
  getDefaultSystemPrompt,
  setPWASettings,
} from '@/lib/db/compat';
import { getConfigValue } from '@/lib/config-loader';
import { invalidateQueryCache, invalidateTavilyCache } from '@/lib/redis';
import { isProviderConfigured } from '@/lib/provider-helpers';
import { EMBEDDING_MODELS, type EmbeddingModelDefinition } from '@/lib/constants';
import { isLocalEmbeddingModel } from '@/lib/local-embeddings';
import { wasFallbackUsedRecently, clearFallbackEvents } from '@/lib/openai';
import type { ApiError } from '@/types';

// Extended embedding model info with availability status
interface AvailableEmbeddingModel extends EmbeddingModelDefinition {
  available: boolean;
}

/**
 * Get available embedding models with their availability status
 * Cloud models require the provider to be configured (env vars set)
 * Local models are always available
 */
async function getAvailableEmbeddingModels(): Promise<AvailableEmbeddingModel[]> {
  return Promise.all(EMBEDDING_MODELS.map(async model => ({
    ...model,
    available: model.local
      ? true // Local models are always available
      : await isProviderConfigured(model.provider), // Cloud models need provider configured
  })));
}

// Available models are now loaded from getAvailableModels() in db/config

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    // Allow both admin and superuser to read settings (for dashboard overview)
    if (user.role !== 'admin' && user.role !== 'superuser') {
      return NextResponse.json<ApiError>(
        { error: 'Admin or superuser access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    // Get all settings from SQLite
    const ragSettings = await getRagSettings();
    const llmSettings = await getLlmSettings();
    const acronymMappings = await getAcronymMappings();
    const tavilySettings = await getTavilySettings();
    const uploadLimits = await getUploadLimits();
    const retentionSettings = await getRetentionSettings();
    const brandingSettings = await getBrandingSettings();
    const embeddingSettings = await getEmbeddingSettings();
    const rerankerSettings = await getRerankerSettings();
    const memorySettings = await getMemorySettings();
    const summarizationSettings = await getSummarizationSettings();
    const limitsSettings = await getLimitsSettings();
    const tokenLimitsSettings = await getTokenLimitsSettings();
    const ocrSettings = await getOcrSettings();

    // Get metadata for last updated info
    const ragMeta = await getSettingMetadata('rag-settings');
    const llmMeta = await getSettingMetadata('llm-settings');
    const acronymsMeta = await getSettingMetadata('acronym-mappings');
    const tavilyMeta = await getSettingMetadata('tavily-settings');
    const brandingMeta = await getSettingMetadata('branding-settings');
    const embeddingMeta = await getSettingMetadata('embedding-settings');
    const rerankerMeta = await getSettingMetadata('reranker-settings');
    const memoryMeta = await getSettingMetadata('memory-settings');
    const summarizationMeta = await getSettingMetadata('summarization-settings');
    const limitsMeta = await getSettingMetadata('limits-settings');
    const tokenLimitsMeta = await getSettingMetadata('token-limits-settings');
    const uploadMeta = await getSettingMetadata('upload-limits');
    const ocrMeta = await getSettingMetadata('ocr-settings');

    return NextResponse.json({
      rag: {
        ...ragSettings,
        updatedAt: ragMeta?.updatedAt || new Date().toISOString(),
        updatedBy: ragMeta?.updatedBy || 'system',
      },
      llm: {
        ...llmSettings,
        updatedAt: llmMeta?.updatedAt || new Date().toISOString(),
        updatedBy: llmMeta?.updatedBy || 'system',
      },
      acronyms: {
        mappings: acronymMappings,
        updatedAt: acronymsMeta?.updatedAt || new Date().toISOString(),
        updatedBy: acronymsMeta?.updatedBy || 'system',
      },
      tavily: {
        ...tavilySettings,
        // Show masked key if exists in DB or env, empty string otherwise
        apiKey: (tavilySettings.apiKey || process.env.TAVILY_API_KEY) ? '••••••••••••••••••••' : '',
        hasApiKey: !!(tavilySettings.apiKey || process.env.TAVILY_API_KEY),
        apiKeyFromEnv: !!process.env.TAVILY_API_KEY,
        updatedAt: tavilyMeta?.updatedAt || new Date().toISOString(),
        updatedBy: tavilyMeta?.updatedBy || 'system',
      },
      branding: {
        ...brandingSettings,
        updatedAt: brandingMeta?.updatedAt || new Date().toISOString(),
        updatedBy: brandingMeta?.updatedBy || 'system',
      },
      embedding: {
        ...embeddingSettings,
        updatedAt: embeddingMeta?.updatedAt || new Date().toISOString(),
        updatedBy: embeddingMeta?.updatedBy || 'system',
        // Include recent fallback event if any (last 60 minutes)
        recentFallback: wasFallbackUsedRecently(60),
      },
      availableEmbeddingModels: await getAvailableEmbeddingModels(),
      reranker: {
        ...rerankerSettings,
        // Mask key if exists in DB or env, empty string otherwise
        cohereApiKey: (rerankerSettings.cohereApiKey || process.env.COHERE_API_KEY) ? '••••••••' : '',
        hasCohereApiKey: !!(rerankerSettings.cohereApiKey || process.env.COHERE_API_KEY),
        cohereApiKeyFromEnv: !!process.env.COHERE_API_KEY,
        updatedAt: rerankerMeta?.updatedAt || new Date().toISOString(),
        updatedBy: rerankerMeta?.updatedBy || 'system',
      },
      memory: {
        ...memorySettings,
        updatedAt: memoryMeta?.updatedAt || new Date().toISOString(),
        updatedBy: memoryMeta?.updatedBy || 'system',
      },
      summarization: {
        ...summarizationSettings,
        updatedAt: summarizationMeta?.updatedAt || new Date().toISOString(),
        updatedBy: summarizationMeta?.updatedBy || 'system',
      },
      limits: {
        ...limitsSettings,
        updatedAt: limitsMeta?.updatedAt || new Date().toISOString(),
        updatedBy: limitsMeta?.updatedBy || 'system',
      },
      tokenLimits: {
        ...tokenLimitsSettings,
        updatedAt: tokenLimitsMeta?.updatedAt || new Date().toISOString(),
        updatedBy: tokenLimitsMeta?.updatedBy || 'system',
      },
      uploadLimits: {
        ...uploadLimits,
        updatedAt: uploadMeta?.updatedAt || new Date().toISOString(),
        updatedBy: uploadMeta?.updatedBy || 'system',
      },
      retentionSettings,
      ocr: {
        ...ocrSettings,
        // Mask sensitive credentials
        mistralApiKey: ocrSettings.mistralApiKey ? '••••••••' : '',
        azureDiKey: ocrSettings.azureDiKey ? '••••••••' : '',
        // Availability flags
        hasMistralApiKey: !!(ocrSettings.mistralApiKey),
        hasAzureDiCredentials: !!(ocrSettings.azureDiEndpoint && ocrSettings.azureDiKey),
        // Check if Mistral key is available from LLM provider config
        mistralFromLlmProvider: !ocrSettings.mistralApiKey && await isProviderConfigured('mistral'),
        mistralOcrApiKeyFromEnv: !!process.env.MISTRAL_API_KEY,
        azureDiFromEnv: !!(process.env.AZURE_DI_ENDPOINT && process.env.AZURE_DI_KEY),
        updatedAt: ocrMeta?.updatedAt || new Date().toISOString(),
        updatedBy: ocrMeta?.updatedBy || 'system',
        providerAvailability: {
          mistral: Boolean(ocrSettings.mistralApiKey) || await isProviderConfigured('mistral'),
          'azure-di': Boolean((ocrSettings.azureDiEndpoint && ocrSettings.azureDiKey) || (process.env.AZURE_DI_ENDPOINT && process.env.AZURE_DI_KEY)),
          'pdf-parse': true,
        },
      },
      availableModels: await getAvailableModels(),
      brandingIcons: BRANDING_ICONS,
      models: {
        transcription: getConfigValue('models.transcription', 'whisper-1'),
      },
      defaults: {
        systemPrompt: await getDefaultSystemPrompt(),
        acronyms: { mappings: {} },
        tavily: await getTavilySettings(),
        branding: await getBrandingSettings(),
        embedding: { model: 'text-embedding-3-large', dimensions: 3072 },
        reranker: { enabled: false, provider: 'cohere', topKForReranking: 50, minRerankerScore: 0.3, cacheTTLSeconds: 3600 },
        memory: { enabled: false, extractionThreshold: 5, maxFactsPerCategory: 20, autoExtractOnThreadEnd: true },
        summarization: { enabled: false, tokenThreshold: 100000, keepRecentMessages: 10, summaryMaxTokens: 2000, archiveOriginalMessages: true },
        ocr: DEFAULT_OCR_SETTINGS,
      },
    });
  } catch (error) {
    console.error('Get settings error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get settings',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { type, settings } = body;

    if (!type || !settings) {
      return NextResponse.json<ApiError>(
        { error: 'Type and settings are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    let result;

    switch (type) {
      case 'rag': {
        // Validate RAG settings
        const {
          topKChunks,
          maxContextChunks,
          similarityThreshold,
          chunkSize,
          chunkOverlap,
          queryExpansionEnabled,
          cacheEnabled,
          cacheTTLSeconds,
          chunkingStrategy,
          semanticBreakpointThreshold,
        } = settings;

        if (typeof topKChunks !== 'number' || topKChunks < 1 || topKChunks > 50) {
          return NextResponse.json<ApiError>(
            { error: 'Top K chunks must be between 1 and 50', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof maxContextChunks !== 'number' || maxContextChunks < 1 || maxContextChunks > 30) {
          return NextResponse.json<ApiError>(
            { error: 'Max context chunks must be between 1 and 30', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof similarityThreshold !== 'number' || similarityThreshold < 0 || similarityThreshold > 1) {
          return NextResponse.json<ApiError>(
            { error: 'Similarity threshold must be between 0 and 1', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof chunkSize !== 'number' || chunkSize < 100 || chunkSize > 2000) {
          return NextResponse.json<ApiError>(
            { error: 'Chunk size must be between 100 and 2000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof chunkOverlap !== 'number' || chunkOverlap < 0 || chunkOverlap > chunkSize / 2) {
          return NextResponse.json<ApiError>(
            { error: 'Chunk overlap must be between 0 and half of chunk size', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof cacheTTLSeconds !== 'number' || cacheTTLSeconds < 0 || cacheTTLSeconds > 86400) {
          return NextResponse.json<ApiError>(
            { error: 'Cache TTL must be between 0 and 86400 seconds (24 hours)', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate chunking strategy
        if (chunkingStrategy !== undefined && !['recursive', 'semantic'].includes(chunkingStrategy)) {
          return NextResponse.json<ApiError>(
            { error: 'Chunking strategy must be "recursive" or "semantic"', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate semantic breakpoint threshold
        if (semanticBreakpointThreshold !== undefined) {
          if (typeof semanticBreakpointThreshold !== 'number' || semanticBreakpointThreshold < 0.3 || semanticBreakpointThreshold > 0.8) {
            return NextResponse.json<ApiError>(
              { error: 'Semantic breakpoint threshold must be between 0.3 and 0.8', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
        }

        result = await setRagSettings({
          topKChunks,
          maxContextChunks,
          similarityThreshold,
          chunkSize,
          chunkOverlap,
          queryExpansionEnabled: Boolean(queryExpansionEnabled),
          cacheEnabled: Boolean(cacheEnabled),
          cacheTTLSeconds,
          chunkingStrategy: chunkingStrategy || 'recursive',
          semanticBreakpointThreshold: semanticBreakpointThreshold ?? 0.5,
        }, user.email);
        break;
      }

      case 'llm': {
        // Auto-populate missing fields from current stored settings
        const currentLlm = await getLlmSettings();
        const model = settings.model || currentLlm.model;
        const temperature = settings.temperature ?? currentLlm.temperature;
        const maxTokens = settings.maxTokens ?? currentLlm.maxTokens;
        const promptOptimizationMaxTokens = settings.promptOptimizationMaxTokens ?? currentLlm.promptOptimizationMaxTokens;

        if (!model || !(await getAvailableModels()).some(m => m.id === model)) {
          return NextResponse.json<ApiError>(
            { error: 'Invalid model selected', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof temperature !== 'number' || temperature < 0 || temperature > 1) {
          return NextResponse.json<ApiError>(
            { error: 'Temperature must be between 0 and 1', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof maxTokens !== 'number' || maxTokens < 100 || maxTokens > 16000) {
          return NextResponse.json<ApiError>(
            { error: 'Max tokens must be between 100 and 16000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof promptOptimizationMaxTokens !== 'number' || promptOptimizationMaxTokens < 100 || promptOptimizationMaxTokens > 8000) {
          return NextResponse.json<ApiError>(
            { error: 'Prompt optimization max tokens must be between 100 and 8000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = await setLlmSettings({
          model,
          temperature,
          maxTokens,
          promptOptimizationMaxTokens,
        }, user.email);

        // Return with metadata
        const llmMeta = await getSettingMetadata('llm-settings');
        return NextResponse.json({
          success: true,
          settings: {
            ...result,
            updatedAt: llmMeta?.updatedAt || new Date().toISOString(),
            updatedBy: llmMeta?.updatedBy || user.email,
          },
        });
      }

      case 'acronyms': {
        // Validate acronym mappings
        const { mappings } = settings;

        if (!mappings || typeof mappings !== 'object') {
          return NextResponse.json<ApiError>(
            { error: 'Mappings must be an object', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Convert string values to arrays for new format
        const normalizedMappings: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(mappings)) {
          if (typeof key !== 'string') {
            return NextResponse.json<ApiError>(
              { error: 'All mapping keys must be strings', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
          // Accept both string and string[] for backward compatibility
          if (typeof value === 'string') {
            normalizedMappings[key.toLowerCase()] = [value];
          } else if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
            normalizedMappings[key.toLowerCase()] = value;
          } else {
            return NextResponse.json<ApiError>(
              { error: 'Mapping values must be strings or arrays of strings', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
        }

        await setAcronymMappings(normalizedMappings, user.email);
        result = { mappings: normalizedMappings };
        break;
      }

      case 'tavily': {
        const {
          apiKey,
          enabled,
          defaultTopic,
          defaultSearchDepth,
          maxResults,
          includeDomains,
          excludeDomains,
          cacheTTLSeconds,
        } = settings;

        // Validate API key (optional - can use env var as fallback)
        if (apiKey !== undefined && typeof apiKey !== 'string') {
          return NextResponse.json<ApiError>(
            { error: 'API key must be a string', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate enabled flag
        if (typeof enabled !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'Enabled must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate topic
        if (!['general', 'news', 'finance'].includes(defaultTopic)) {
          return NextResponse.json<ApiError>(
            { error: 'Topic must be general, news, or finance', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate search depth
        if (!['basic', 'advanced'].includes(defaultSearchDepth)) {
          return NextResponse.json<ApiError>(
            { error: 'Search depth must be basic or advanced', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate max results
        if (typeof maxResults !== 'number' || maxResults < 1 || maxResults > 20) {
          return NextResponse.json<ApiError>(
            { error: 'Max results must be between 1 and 20', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate cache TTL (1 minute to 1 month)
        if (typeof cacheTTLSeconds !== 'number' || cacheTTLSeconds < 60 || cacheTTLSeconds > 2592000) {
          return NextResponse.json<ApiError>(
            { error: 'Cache TTL must be between 60 seconds and 2592000 seconds (1 month)', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate domains
        if (!Array.isArray(includeDomains) || !includeDomains.every(d => typeof d === 'string')) {
          return NextResponse.json<ApiError>(
            { error: 'Include domains must be an array of strings', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (!Array.isArray(excludeDomains) || !excludeDomains.every(d => typeof d === 'string')) {
          return NextResponse.json<ApiError>(
            { error: 'Exclude domains must be an array of strings', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = await setTavilySettings({
          ...(apiKey !== undefined && apiKey !== '' ? { apiKey } : {}),
          enabled,
          defaultTopic,
          defaultSearchDepth,
          maxResults,
          includeDomains,
          excludeDomains,
          cacheTTLSeconds,
        }, user.email);

        // Invalidate Tavily cache when settings change
        await invalidateTavilyCache();

        break;
      }

      case 'uploadLimits': {
        const { maxFilesPerInput, maxFilesPerThread, maxFileSizeMB, allowedTypes } = settings;

        if (typeof maxFilesPerThread !== 'number' || maxFilesPerThread < 0 || maxFilesPerThread > 100) {
          return NextResponse.json<ApiError>(
            { error: 'Max files per thread must be between 0 and 100', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof maxFilesPerInput !== 'number' || maxFilesPerInput < 0 || maxFilesPerInput > maxFilesPerThread) {
          return NextResponse.json<ApiError>(
            { error: `Max files per input must be between 0 and ${maxFilesPerThread} (max per thread)`, code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof maxFileSizeMB !== 'number' || maxFileSizeMB < 1 || maxFileSizeMB > 100) {
          return NextResponse.json<ApiError>(
            { error: 'Max file size must be between 1 and 100 MB', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (!Array.isArray(allowedTypes) || !allowedTypes.every(t => typeof t === 'string')) {
          return NextResponse.json<ApiError>(
            { error: 'Allowed types must be an array of strings', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = await setUploadLimits({
          maxFilesPerInput,
          maxFilesPerThread,
          maxFileSizeMB,
          allowedTypes,
        }, user.email);
        break;
      }

      case 'retention': {
        const { threadRetentionDays, storageAlertThreshold } = settings;

        if (typeof threadRetentionDays !== 'number' || threadRetentionDays < 1 || threadRetentionDays > 365) {
          return NextResponse.json<ApiError>(
            { error: 'Thread retention days must be between 1 and 365', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (typeof storageAlertThreshold !== 'number' || storageAlertThreshold < 50 || storageAlertThreshold > 100) {
          return NextResponse.json<ApiError>(
            { error: 'Storage alert threshold must be between 50 and 100 percent', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = await setRetentionSettings({
          threadRetentionDays,
          storageAlertThreshold,
        }, user.email);
        break;
      }

      case 'branding': {
        const { botName, botIcon, subtitle, welcomeTitle, welcomeMessage, accentColor } = settings;

        // Validate bot name
        if (typeof botName !== 'string' || botName.trim().length === 0) {
          return NextResponse.json<ApiError>(
            { error: 'Bot name is required', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (botName.length > 50) {
          return NextResponse.json<ApiError>(
            { error: 'Bot name must be 50 characters or less', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate bot icon
        const validIcons = BRANDING_ICONS.map(i => i.key);
        if (!validIcons.includes(botIcon)) {
          return NextResponse.json<ApiError>(
            { error: 'Invalid icon selected', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate optional subtitle
        if (subtitle !== undefined && typeof subtitle !== 'string') {
          return NextResponse.json<ApiError>(
            { error: 'Subtitle must be a string', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }
        if (subtitle && subtitle.length > 100) {
          return NextResponse.json<ApiError>(
            { error: 'Subtitle must be 100 characters or less', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate optional welcome title
        if (welcomeTitle !== undefined && typeof welcomeTitle !== 'string') {
          return NextResponse.json<ApiError>(
            { error: 'Welcome title must be a string', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }
        if (welcomeTitle && welcomeTitle.length > 50) {
          return NextResponse.json<ApiError>(
            { error: 'Welcome title must be 50 characters or less', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate optional welcome message
        if (welcomeMessage !== undefined && typeof welcomeMessage !== 'string') {
          return NextResponse.json<ApiError>(
            { error: 'Welcome message must be a string', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }
        if (welcomeMessage && welcomeMessage.length > 200) {
          return NextResponse.json<ApiError>(
            { error: 'Welcome message must be 200 characters or less', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate optional accent color
        if (accentColor !== undefined && accentColor !== null) {
          if (typeof accentColor !== 'string') {
            return NextResponse.json<ApiError>(
              { error: 'Accent color must be a string', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
          if (!/^#[0-9A-Fa-f]{6}$/.test(accentColor)) {
            return NextResponse.json<ApiError>(
              { error: 'Accent color must be a valid hex color (e.g., #2563eb)', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
        }

        result = await setBrandingSettings({
          botName: botName.trim(),
          botIcon,
          subtitle: subtitle || undefined,
          welcomeTitle: welcomeTitle || undefined,
          welcomeMessage: welcomeMessage || undefined,
          accentColor: accentColor || undefined,
        }, user.email);

        // Auto-update PWA icons based on selected bot icon
        const selectedIcon = BRANDING_ICONS.find(i => i.key === botIcon);
        if (selectedIcon) {
          await setPWASettings({
            icon192Path: selectedIcon.png192,
            icon512Path: selectedIcon.png512,
          }, user.email);
        }

        // Return the updated branding with metadata
        const brandingMeta = await getSettingMetadata('branding-settings');
        return NextResponse.json({
          success: true,
          branding: {
            ...result,
            updatedAt: brandingMeta?.updatedAt || new Date().toISOString(),
            updatedBy: brandingMeta?.updatedBy || user.email,
          },
        });
      }

      case 'embedding': {
        const { model, dimensions, fallbackModel } = settings;

        // Validate model name
        if (typeof model !== 'string' || model.trim().length === 0) {
          return NextResponse.json<ApiError>(
            { error: 'Embedding model is required', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate model is in the allowed list
        const modelDef = EMBEDDING_MODELS.find(m => m.id === model);
        if (!modelDef) {
          return NextResponse.json<ApiError>(
            { error: 'Invalid embedding model selected', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Check if model is available (provider configured or local)
        const modelAvailable = modelDef.local || await isProviderConfigured(modelDef.provider);
        if (!modelAvailable) {
          return NextResponse.json<ApiError>(
            { error: `Provider ${modelDef.provider} is not configured for ${model}`, code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate fallback model if provided
        let validatedFallbackModel: string | undefined;
        if (fallbackModel && typeof fallbackModel === 'string') {
          const fallbackModelDef = EMBEDDING_MODELS.find(m => m.id === fallbackModel);
          if (!fallbackModelDef) {
            return NextResponse.json<ApiError>(
              { error: 'Invalid fallback embedding model selected', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
          // Check if fallback model is available
          const fallbackAvailable = fallbackModelDef.local || await isProviderConfigured(fallbackModelDef.provider);
          if (!fallbackAvailable) {
            return NextResponse.json<ApiError>(
              { error: `Provider ${fallbackModelDef.provider} is not configured for fallback model ${fallbackModel}`, code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
          validatedFallbackModel = fallbackModel.trim();
        }

        // Validate dimensions matches the model (use the model's dimensions, not user input)
        const expectedDimensions = modelDef.dimensions;
        if (typeof dimensions !== 'number' || dimensions !== expectedDimensions) {
          // Auto-correct dimensions to match the model
          console.log(`[Settings] Auto-correcting embedding dimensions from ${dimensions} to ${expectedDimensions} for model ${model}`);
        }

        result = await setEmbeddingSettings({
          model: model.trim(),
          dimensions: expectedDimensions, // Use the model's defined dimensions
          fallbackModel: validatedFallbackModel,
        }, user.email);

        // Return with metadata
        const embeddingMeta = await getSettingMetadata('embedding-settings');
        return NextResponse.json({
          success: true,
          settings: {
            ...result,
            updatedAt: embeddingMeta?.updatedAt || new Date().toISOString(),
            updatedBy: embeddingMeta?.updatedBy || user.email,
          },
        });
      }

      case 'reranker': {
        const {
          enabled,
          providers,
          cohereApiKey,
          topKForReranking,
          minRerankerScore,
          cacheTTLSeconds,
        } = settings;

        // Validate enabled flag (optional — omit to keep existing value)
        if (enabled !== undefined && typeof enabled !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'Enabled must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate providers array (optional — omit to keep existing providers)
        const validProviders = ['bge-large', 'cohere', 'fireworks', 'bge-base', 'local'];
        if (providers !== undefined) {
          if (!Array.isArray(providers) || providers.length === 0 || providers.length > validProviders.length) {
            return NextResponse.json<ApiError>(
              { error: `Providers must be an array with 1-${validProviders.length} providers`, code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
          for (const p of providers) {
            if (!validProviders.includes(p.provider) || typeof p.enabled !== 'boolean') {
              return NextResponse.json<ApiError>(
                { error: 'Each provider must have a valid provider name and enabled boolean', code: 'VALIDATION_ERROR' },
                { status: 400 }
              );
            }
          }
        }

        // Validate Cohere API key (optional - can use env var as fallback)
        if (cohereApiKey !== undefined && typeof cohereApiKey !== 'string') {
          return NextResponse.json<ApiError>(
            { error: 'Cohere API key must be a string', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate topKForReranking (optional — omit to keep existing value)
        if (topKForReranking !== undefined && (typeof topKForReranking !== 'number' || topKForReranking < 5 || topKForReranking > 100)) {
          return NextResponse.json<ApiError>(
            { error: 'topKForReranking must be between 5 and 100', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate minRerankerScore (optional — omit to keep existing value)
        if (minRerankerScore !== undefined && (typeof minRerankerScore !== 'number' || minRerankerScore < 0 || minRerankerScore > 1)) {
          return NextResponse.json<ApiError>(
            { error: 'minRerankerScore must be between 0 and 1', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate cacheTTLSeconds (optional — omit to keep existing value)
        if (cacheTTLSeconds !== undefined && (typeof cacheTTLSeconds !== 'number' || cacheTTLSeconds < 0 || cacheTTLSeconds > 86400)) {
          return NextResponse.json<ApiError>(
            { error: 'cacheTTLSeconds must be between 0 and 86400', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Reset Cohere client if API key is being changed (including when cleared)
        if (cohereApiKey !== undefined) {
          const { resetCohereClient } = await import('@/lib/reranker');
          resetCohereClient();
        }

        result = await setRerankerSettings({
          ...(enabled !== undefined ? { enabled } : {}),
          ...(providers !== undefined ? { providers } : {}),
          ...(cohereApiKey !== undefined ? { cohereApiKey: cohereApiKey || undefined } : {}),
          ...(topKForReranking !== undefined ? { topKForReranking } : {}),
          ...(minRerankerScore !== undefined ? { minRerankerScore } : {}),
          ...(cacheTTLSeconds !== undefined ? { cacheTTLSeconds } : {}),
        }, user.email);
        break;
      }

      case 'memory': {
        const {
          enabled,
          extractionThreshold,
          maxFactsPerCategory,
          autoExtractOnThreadEnd,
          extractionMaxTokens,
        } = settings;

        // Validate enabled flag
        if (typeof enabled !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'Enabled must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate extractionThreshold
        if (typeof extractionThreshold !== 'number' || extractionThreshold < 1 || extractionThreshold > 50) {
          return NextResponse.json<ApiError>(
            { error: 'Extraction threshold must be between 1 and 50', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate maxFactsPerCategory
        if (typeof maxFactsPerCategory !== 'number' || maxFactsPerCategory < 1 || maxFactsPerCategory > 100) {
          return NextResponse.json<ApiError>(
            { error: 'Max facts per category must be between 1 and 100', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate autoExtractOnThreadEnd
        if (typeof autoExtractOnThreadEnd !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'Auto extract on thread end must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate extractionMaxTokens
        if (typeof extractionMaxTokens !== 'number' || extractionMaxTokens < 100 || extractionMaxTokens > 8000) {
          return NextResponse.json<ApiError>(
            { error: 'Extraction max tokens must be between 100 and 8000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = await setMemorySettings({
          enabled,
          extractionThreshold,
          maxFactsPerCategory,
          autoExtractOnThreadEnd,
          extractionMaxTokens,
        }, user.email);
        break;
      }

      case 'summarization': {
        const {
          enabled,
          tokenThreshold,
          keepRecentMessages,
          summaryMaxTokens,
          archiveOriginalMessages,
        } = settings;

        // Validate enabled flag
        if (typeof enabled !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'Enabled must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate tokenThreshold
        if (typeof tokenThreshold !== 'number' || tokenThreshold < 1000 || tokenThreshold > 1000000) {
          return NextResponse.json<ApiError>(
            { error: 'Token threshold must be between 1,000 and 1,000,000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate keepRecentMessages
        if (typeof keepRecentMessages !== 'number' || keepRecentMessages < 1 || keepRecentMessages > 50) {
          return NextResponse.json<ApiError>(
            { error: 'Keep recent messages must be between 1 and 50', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate summaryMaxTokens
        if (typeof summaryMaxTokens !== 'number' || summaryMaxTokens < 100 || summaryMaxTokens > 10000) {
          return NextResponse.json<ApiError>(
            { error: 'Summary max tokens must be between 100 and 10,000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate archiveOriginalMessages
        if (typeof archiveOriginalMessages !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'Archive original messages must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = await setSummarizationSettings({
          enabled,
          tokenThreshold,
          keepRecentMessages,
          summaryMaxTokens,
          archiveOriginalMessages,
        }, user.email);
        break;
      }

      case 'skills': {
        const {
          enabled,
          maxTotalTokens,
          debugMode,
        } = settings;

        // Validate enabled flag
        if (typeof enabled !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'Enabled must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate maxTotalTokens
        if (typeof maxTotalTokens !== 'number' || maxTotalTokens < 500 || maxTotalTokens > 20000) {
          return NextResponse.json<ApiError>(
            { error: 'Max total tokens must be between 500 and 20,000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate debugMode
        if (typeof debugMode !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'Debug mode must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = await setSkillsSettings({
          enabled,
          maxTotalTokens,
          debugMode,
        }, user.email);
        break;
      }

      case 'ocr': {
        const { providers, mistralApiKey, azureDiEndpoint, azureDiKey } = settings;

        // Validate providers (optional — omit to keep existing providers)
        if (providers !== undefined) {
          if (!Array.isArray(providers) || providers.length !== 3) {
            return NextResponse.json<ApiError>(
              { error: 'Providers must be an array of exactly 3 items', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }

          const validProviders = ['mistral', 'azure-di', 'pdf-parse'];
          const seen = new Set<string>();

          for (const item of providers) {
            if (!item || typeof item !== 'object') {
              return NextResponse.json<ApiError>(
                { error: 'Each provider must be an object with provider and enabled fields', code: 'VALIDATION_ERROR' },
                { status: 400 }
              );
            }

            if (!validProviders.includes(item.provider)) {
              return NextResponse.json<ApiError>(
                { error: `Invalid provider: ${item.provider}. Must be one of: ${validProviders.join(', ')}`, code: 'VALIDATION_ERROR' },
                { status: 400 }
              );
            }

            if (typeof item.enabled !== 'boolean') {
              return NextResponse.json<ApiError>(
                { error: 'Each provider enabled field must be a boolean', code: 'VALIDATION_ERROR' },
                { status: 400 }
              );
            }

            if (seen.has(item.provider)) {
              return NextResponse.json<ApiError>(
                { error: `Duplicate provider: ${item.provider}`, code: 'VALIDATION_ERROR' },
                { status: 400 }
              );
            }
            seen.add(item.provider);
          }

          // At least one provider must be enabled
          if (!providers.some((p: { enabled: boolean }) => p.enabled)) {
            return NextResponse.json<ApiError>(
              { error: 'At least one OCR provider must be enabled', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
        }

        // Validate Mistral API key (optional)
        if (mistralApiKey !== undefined && typeof mistralApiKey !== 'string') {
          return NextResponse.json<ApiError>(
            { error: 'Mistral API key must be a string', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate Azure DI endpoint (optional)
        if (azureDiEndpoint !== undefined && typeof azureDiEndpoint !== 'string') {
          return NextResponse.json<ApiError>(
            { error: 'Azure DI endpoint must be a string', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        if (azureDiEndpoint && !azureDiEndpoint.startsWith('https://')) {
          return NextResponse.json<ApiError>(
            { error: 'Azure DI endpoint must be a valid HTTPS URL (e.g., https://your-resource.cognitiveservices.azure.com)', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate Azure DI key (optional)
        if (azureDiKey !== undefined && typeof azureDiKey !== 'string') {
          return NextResponse.json<ApiError>(
            { error: 'Azure DI key must be a string', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Reset OCR clients if credentials changed (including when cleared)
        if (mistralApiKey !== undefined) {
          const { resetMistralOcrClient } = await import('@/lib/mistral-ocr');
          resetMistralOcrClient();
        }
        if (azureDiEndpoint !== undefined || azureDiKey !== undefined) {
          const { resetAzureDIClient } = await import('@/lib/azure-document-intelligence');
          resetAzureDIClient();
        }

        result = await setOcrSettings({
          ...(providers !== undefined ? {
            providers: providers.map((p: { provider: string; enabled: boolean }) => ({
              provider: p.provider as 'mistral' | 'azure-di' | 'pdf-parse',
              enabled: p.enabled,
            })),
          } : {}),
          ...(mistralApiKey !== undefined ? { mistralApiKey: mistralApiKey || undefined } : {}),
          ...(azureDiEndpoint !== undefined ? { azureDiEndpoint: azureDiEndpoint || undefined } : {}),
          ...(azureDiKey !== undefined ? { azureDiKey: azureDiKey || undefined } : {}),
        }, user.email);
        break;
      }

      case 'limits': {
        const { conversationHistoryMessages, maxTotalToolCalls, maxPerToolCalls } = settings;
        const limitsUpdate: Record<string, number> = {};

        if (conversationHistoryMessages !== undefined) {
          if (typeof conversationHistoryMessages !== 'number' || conversationHistoryMessages < 3 || conversationHistoryMessages > 50) {
            return NextResponse.json<ApiError>(
              { error: 'Conversation history messages must be between 3 and 50', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
          limitsUpdate.conversationHistoryMessages = conversationHistoryMessages;
        }
        if (maxTotalToolCalls !== undefined) {
          if (typeof maxTotalToolCalls !== 'number' || maxTotalToolCalls < 5 || maxTotalToolCalls > 200) {
            return NextResponse.json<ApiError>(
              { error: 'Max total tool calls must be between 5 and 200', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
          limitsUpdate.maxTotalToolCalls = maxTotalToolCalls;
        }
        if (maxPerToolCalls !== undefined) {
          if (typeof maxPerToolCalls !== 'number' || maxPerToolCalls < 1 || maxPerToolCalls > 50) {
            return NextResponse.json<ApiError>(
              { error: 'Max per-tool calls must be between 1 and 50', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
          limitsUpdate.maxPerToolCalls = maxPerToolCalls;
        }

        result = await setLimitsSettings(limitsUpdate, user.email);
        break;
      }

      case 'token-limits': {
        const {
          promptOptimizationMaxTokens,
          skillsMaxTotalTokens,
          memoryExtractionMaxTokens,
          summaryMaxTokens,
          systemPromptMaxTokens,
          categoryPromptMaxTokens,
          starterLabelMaxChars,
          starterPromptMaxChars,
          maxStartersPerCategory,
        } = settings;

        // Validate promptOptimizationMaxTokens
        if (typeof promptOptimizationMaxTokens !== 'number' || promptOptimizationMaxTokens < 100 || promptOptimizationMaxTokens > 8000) {
          return NextResponse.json<ApiError>(
            { error: 'Prompt optimization max tokens must be between 100 and 8,000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate skillsMaxTotalTokens
        if (typeof skillsMaxTotalTokens !== 'number' || skillsMaxTotalTokens < 500 || skillsMaxTotalTokens > 20000) {
          return NextResponse.json<ApiError>(
            { error: 'Skills max total tokens must be between 500 and 20,000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate memoryExtractionMaxTokens
        if (typeof memoryExtractionMaxTokens !== 'number' || memoryExtractionMaxTokens < 100 || memoryExtractionMaxTokens > 8000) {
          return NextResponse.json<ApiError>(
            { error: 'Memory extraction max tokens must be between 100 and 8,000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate summaryMaxTokens
        if (typeof summaryMaxTokens !== 'number' || summaryMaxTokens < 100 || summaryMaxTokens > 10000) {
          return NextResponse.json<ApiError>(
            { error: 'Summary max tokens must be between 100 and 10,000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate systemPromptMaxTokens
        if (typeof systemPromptMaxTokens !== 'number' || systemPromptMaxTokens < 500 || systemPromptMaxTokens > 4000) {
          return NextResponse.json<ApiError>(
            { error: 'System prompt max tokens must be between 500 and 4,000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate categoryPromptMaxTokens
        if (typeof categoryPromptMaxTokens !== 'number' || categoryPromptMaxTokens < 250 || categoryPromptMaxTokens > 2000) {
          return NextResponse.json<ApiError>(
            { error: 'Category prompt max tokens must be between 250 and 2,000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate starterLabelMaxChars
        if (typeof starterLabelMaxChars !== 'number' || starterLabelMaxChars < 20 || starterLabelMaxChars > 50) {
          return NextResponse.json<ApiError>(
            { error: 'Starter label max chars must be between 20 and 50', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate starterPromptMaxChars
        if (typeof starterPromptMaxChars !== 'number' || starterPromptMaxChars < 200 || starterPromptMaxChars > 1000) {
          return NextResponse.json<ApiError>(
            { error: 'Starter prompt max chars must be between 200 and 1,000', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate maxStartersPerCategory
        if (typeof maxStartersPerCategory !== 'number' || maxStartersPerCategory < 3 || maxStartersPerCategory > 10) {
          return NextResponse.json<ApiError>(
            { error: 'Max starters per category must be between 3 and 10', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = await setTokenLimitsSettings({
          promptOptimizationMaxTokens,
          skillsMaxTotalTokens,
          memoryExtractionMaxTokens,
          summaryMaxTokens,
          systemPromptMaxTokens,
          categoryPromptMaxTokens,
          starterLabelMaxChars,
          starterPromptMaxChars,
          maxStartersPerCategory,
        }, user.email);

        // Return with metadata
        const meta = await getSettingMetadata('token-limits-settings');
        return NextResponse.json({
          success: true,
          tokenLimits: {
            ...result,
            updatedAt: meta?.updatedAt || new Date().toISOString(),
            updatedBy: meta?.updatedBy || user.email,
          },
        });
      }

      case 'restoreAllDefaults': {
        // Delete all settings from SQLite to fall back to JSON config defaults
        const settingKeys = [
          'rag-settings',
          'llm-settings',
          'tavily-settings',
          'upload-limits',
          'system-prompt',
          'acronym-mappings',
          'retention-settings',
          'branding-settings',
          'embedding-settings',
          'reranker-settings',
          'memory-settings',
          'summarization-settings',
          'skills-settings',
          'ocr-settings',
        ] as const;

        for (const key of settingKeys) {
          await deleteSetting(key);
        }

        // Return the new values (which will be from JSON config)
        result = {
          message: 'All settings have been reset to JSON config defaults',
          rag: await getRagSettings(),
          llm: await getLlmSettings(),
          tavily: await getTavilySettings(),
          branding: await getBrandingSettings(),
          embedding: await getEmbeddingSettings(),
          reranker: await getRerankerSettings(),
          memory: await getMemorySettings(),
          summarization: await getSummarizationSettings(),
          systemPrompt: await getDefaultSystemPrompt(),
        };

        // Also invalidate Tavily cache since settings changed
        await invalidateTavilyCache();
        break;
      }

      default:
        return NextResponse.json<ApiError>(
          { error: 'Invalid settings type', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
    }

    // Invalidate query cache when settings change
    await invalidateQueryCache();

    return NextResponse.json({
      success: true,
      settings: result,
    });
  } catch (error) {
    console.error('Update settings error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to update settings',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
