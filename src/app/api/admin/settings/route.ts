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
  getDiagramSettings,
  setDiagramSettings,
  getOcrSettings,
  setOcrSettings,
  DEFAULT_OCR_SETTINGS,
  getLimitsSettings,
  setLimitsSettings,
  getModelTokenLimits,
  setModelTokenLimit,
  getTokenLimitsSettings,
  setTokenLimitsSettings,
  getSettingMetadata,
  deleteSetting,
  getAvailableModels,
  BRANDING_ICONS,
  getDefaultSystemPrompt,
  setPWASettings,
} from '@/lib/db/config';
import { getConfigValue } from '@/lib/config-loader';
import { invalidateQueryCache, invalidateTavilyCache } from '@/lib/redis';
import type { ApiError } from '@/types';

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

    if (!user.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    // Get all settings from SQLite
    const ragSettings = getRagSettings();
    const llmSettings = getLlmSettings();
    const acronymMappings = getAcronymMappings();
    const tavilySettings = getTavilySettings();
    const uploadLimits = getUploadLimits();
    const retentionSettings = getRetentionSettings();
    const brandingSettings = getBrandingSettings();
    const embeddingSettings = getEmbeddingSettings();
    const rerankerSettings = getRerankerSettings();
    const memorySettings = getMemorySettings();
    const summarizationSettings = getSummarizationSettings();
    const limitsSettings = getLimitsSettings();
    const modelTokenLimits = getModelTokenLimits();
    const tokenLimitsSettings = getTokenLimitsSettings();
    const ocrSettings = getOcrSettings();

    // Get metadata for last updated info
    const ragMeta = getSettingMetadata('rag-settings');
    const llmMeta = getSettingMetadata('llm-settings');
    const acronymsMeta = getSettingMetadata('acronym-mappings');
    const tavilyMeta = getSettingMetadata('tavily-settings');
    const brandingMeta = getSettingMetadata('branding-settings');
    const embeddingMeta = getSettingMetadata('embedding-settings');
    const rerankerMeta = getSettingMetadata('reranker-settings');
    const memoryMeta = getSettingMetadata('memory-settings');
    const summarizationMeta = getSettingMetadata('summarization-settings');
    const limitsMeta = getSettingMetadata('limits-settings');
    const modelTokensMeta = getSettingMetadata('model-token-limits');
    const tokenLimitsMeta = getSettingMetadata('token-limits-settings');
    const uploadMeta = getSettingMetadata('upload-limits');
    const ocrMeta = getSettingMetadata('ocr-settings');

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
      },
      reranker: {
        ...rerankerSettings,
        cohereApiKey: process.env.COHERE_API_KEY ? '••••••••' : '',
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
      modelTokenLimits: {
        limits: modelTokenLimits,
        updatedAt: modelTokensMeta?.updatedAt || new Date().toISOString(),
        updatedBy: modelTokensMeta?.updatedBy || 'system',
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
        updatedAt: ocrMeta?.updatedAt || new Date().toISOString(),
        updatedBy: ocrMeta?.updatedBy || 'system',
        providerAvailability: {
          mistral: Boolean(process.env.MISTRAL_API_KEY),
          'azure-di': Boolean(process.env.AZURE_DI_ENDPOINT && process.env.AZURE_DI_KEY),
          'pdf-parse': true,
        },
      },
      availableModels: getAvailableModels(),
      brandingIcons: BRANDING_ICONS,
      models: {
        transcription: getConfigValue('models.transcription', 'whisper-1'),
      },
      defaults: {
        systemPrompt: getDefaultSystemPrompt(),
        acronyms: { mappings: {} },
        tavily: getTavilySettings(),
        branding: getBrandingSettings(),
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
        const { topKChunks, maxContextChunks, similarityThreshold, chunkSize, chunkOverlap, queryExpansionEnabled, cacheEnabled, cacheTTLSeconds } = settings;

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

        result = setRagSettings({
          topKChunks,
          maxContextChunks,
          similarityThreshold,
          chunkSize,
          chunkOverlap,
          queryExpansionEnabled: Boolean(queryExpansionEnabled),
          cacheEnabled: Boolean(cacheEnabled),
          cacheTTLSeconds,
        }, user.email);
        break;
      }

      case 'llm': {
        // Validate LLM settings
        const { model, temperature, maxTokens, promptOptimizationMaxTokens } = settings;

        if (!model || !getAvailableModels().some(m => m.id === model)) {
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

        result = setLlmSettings({
          model,
          temperature,
          maxTokens,
          promptOptimizationMaxTokens,
        }, user.email);
        break;
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

        setAcronymMappings(normalizedMappings, user.email);
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

        result = setTavilySettings({
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

        result = setUploadLimits({
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

        result = setRetentionSettings({
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

        result = setBrandingSettings({
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
          setPWASettings({
            icon192Path: selectedIcon.png192,
            icon512Path: selectedIcon.png512,
          }, user.email);
        }

        // Return the updated branding with metadata
        const brandingMeta = getSettingMetadata('branding-settings');
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
        const { model, dimensions } = settings;

        // Validate model name
        if (typeof model !== 'string' || model.trim().length === 0) {
          return NextResponse.json<ApiError>(
            { error: 'Embedding model is required', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate dimensions
        if (typeof dimensions !== 'number' || dimensions < 256 || dimensions > 8192) {
          return NextResponse.json<ApiError>(
            { error: 'Dimensions must be between 256 and 8192', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = setEmbeddingSettings({
          model: model.trim(),
          dimensions,
        }, user.email);
        break;
      }

      case 'reranker': {
        const {
          enabled,
          provider,
          topKForReranking,
          minRerankerScore,
          cacheTTLSeconds,
        } = settings;

        // Validate enabled flag
        if (typeof enabled !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'Enabled must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate provider
        if (!['cohere', 'jina', 'local'].includes(provider)) {
          return NextResponse.json<ApiError>(
            { error: 'Provider must be "cohere", "jina", or "local"', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate topKForReranking
        if (typeof topKForReranking !== 'number' || topKForReranking < 5 || topKForReranking > 100) {
          return NextResponse.json<ApiError>(
            { error: 'topKForReranking must be between 5 and 100', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate minRerankerScore
        if (typeof minRerankerScore !== 'number' || minRerankerScore < 0 || minRerankerScore > 1) {
          return NextResponse.json<ApiError>(
            { error: 'minRerankerScore must be between 0 and 1', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate cacheTTLSeconds
        if (typeof cacheTTLSeconds !== 'number' || cacheTTLSeconds < 0 || cacheTTLSeconds > 86400) {
          return NextResponse.json<ApiError>(
            { error: 'cacheTTLSeconds must be between 0 and 86400', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = setRerankerSettings({
          enabled,
          provider,
          topKForReranking,
          minRerankerScore,
          cacheTTLSeconds,
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

        result = setMemorySettings({
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

        result = setSummarizationSettings({
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

        result = setSkillsSettings({
          enabled,
          maxTotalTokens,
          debugMode,
        }, user.email);
        break;
      }

      case 'diagrams': {
        const { mermaidEnabled } = settings;

        // Validate mermaidEnabled flag
        if (typeof mermaidEnabled !== 'boolean') {
          return NextResponse.json<ApiError>(
            { error: 'Mermaid enabled must be a boolean', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = setDiagramSettings({
          mermaidEnabled,
        }, user.email);
        break;
      }

      case 'ocr': {
        const { providers } = settings;

        // Validate providers is an array of exactly 3 items
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

        result = setOcrSettings({
          providers: providers.map((p: { provider: string; enabled: boolean }) => ({
            provider: p.provider as 'mistral' | 'azure-di' | 'pdf-parse',
            enabled: p.enabled,
          })),
        }, user.email);
        break;
      }

      case 'limits': {
        const { conversationHistoryMessages } = settings;

        // Validate conversationHistoryMessages
        if (typeof conversationHistoryMessages !== 'number' || conversationHistoryMessages < 3 || conversationHistoryMessages > 50) {
          return NextResponse.json<ApiError>(
            { error: 'Conversation history messages must be between 3 and 50', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        result = setLimitsSettings({
          conversationHistoryMessages,
        }, user.email);
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

        result = setTokenLimitsSettings({
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
        const meta = getSettingMetadata('token-limits-settings');
        return NextResponse.json({
          success: true,
          tokenLimits: {
            ...result,
            updatedAt: meta?.updatedAt || new Date().toISOString(),
            updatedBy: meta?.updatedBy || user.email,
          },
        });
      }

      case 'model-tokens': {
        const { model, maxTokens } = settings;

        // Validate model exists
        if (!model || typeof model !== 'string') {
          return NextResponse.json<ApiError>(
            { error: 'Model name is required', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Check if model is valid (exists in presets or available models)
        const availableModels = getAvailableModels();
        if (!availableModels.some(m => m.id === model)) {
          return NextResponse.json<ApiError>(
            { error: 'Invalid model selected', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        // Validate maxTokens (number between 100-16000 or 'default')
        if (maxTokens !== 'default') {
          if (typeof maxTokens !== 'number' || maxTokens < 100 || maxTokens > 16000) {
            return NextResponse.json<ApiError>(
              { error: 'Max tokens must be between 100 and 16000, or "default"', code: 'VALIDATION_ERROR' },
              { status: 400 }
            );
          }
        }

        result = setModelTokenLimit(model, maxTokens, user.email);

        // Return with metadata
        const meta = getSettingMetadata('model-token-limits');
        return NextResponse.json({
          success: true,
          modelTokenLimits: {
            limits: result,
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
          'model-token-limits',
          'ocr-settings',
        ] as const;

        for (const key of settingKeys) {
          deleteSetting(key);
        }

        // Return the new values (which will be from JSON config)
        result = {
          message: 'All settings have been reset to JSON config defaults',
          rag: getRagSettings(),
          llm: getLlmSettings(),
          tavily: getTavilySettings(),
          branding: getBrandingSettings(),
          embedding: getEmbeddingSettings(),
          reranker: getRerankerSettings(),
          memory: getMemorySettings(),
          summarization: getSummarizationSettings(),
          systemPrompt: getDefaultSystemPrompt(),
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
