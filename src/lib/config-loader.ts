/**
 * Configuration Loader
 *
 * Loads settings from config/defaults.json and config/system-prompt.md
 * Provides typed getters with fallbacks to hardcoded defaults
 * Caches config in memory (reload on app restart)
 *
 * Model Discovery:
 * - Automatically discovers models from litellm_config.yaml
 * - Falls back to hardcoded defaults if YAML unavailable
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Lazy imports to avoid circular dependency
// These functions don't depend on loadConfig, so they're safe to call
let _litellmFunctions: {
  getLiteLLMChatModels: () => import('./litellm-validator').ParsedLiteLLMModel[];
  getLiteLLMToolCapableModels: () => Set<string>;
} | null = null;

function getLiteLLMFunctions() {
  if (!_litellmFunctions) {
    // Dynamic require to avoid circular dependency at module load time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const validator = require('./litellm-validator');
    _litellmFunctions = {
      getLiteLLMChatModels: validator.getLiteLLMChatModels,
      getLiteLLMToolCapableModels: validator.getLiteLLMToolCapableModels,
    };
  }
  return _litellmFunctions;
}

// ============ Types ============

export interface ModelPresetConfig {
  name: string;
  description: string;
  provider: string;
  temperature: number;
  maxTokens: number;
  topKChunks: number;
  maxContextChunks: number;
  similarityThreshold: number;
  chunkSize: number;
  chunkOverlap: number;
  queryExpansionEnabled: boolean;
  cacheEnabled: boolean;
  cacheTTLSeconds: number;
}

export interface LlmConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  promptOptimizationMaxTokens: number;
}

export interface RagConfig {
  topKChunks: number;
  maxContextChunks: number;
  similarityThreshold: number;
  chunkSize: number;
  chunkOverlap: number;
  queryExpansionEnabled: boolean;
  cacheEnabled: boolean;
  cacheTTLSeconds: number;
}

export interface EmbeddingConfig {
  model: string;
  dimensions: number;
  fallbackModel?: string;
}

export interface RerankerConfig {
  enabled: boolean;
  provider: 'cohere' | 'local';
  topKForReranking: number;
  minRerankerScore: number;
  cacheTTLSeconds: number;
}

export interface TavilyConfig {
  enabled: boolean;
  defaultTopic: 'general' | 'news' | 'finance';
  defaultSearchDepth: 'basic' | 'advanced';
  maxResults: number;
  includeDomains: string[];
  excludeDomains: string[];
  cacheTTLSeconds: number;
}

export interface UploadConfig {
  maxFilesPerInput: number;
  maxFilesPerThread: number;
  maxFileSizeMB: number;
  allowedTypes: string[];
}

export interface RetentionConfig {
  threadRetentionDays: number;
  storageAlertThreshold: number;
}

export interface MemoryConfig {
  enabled: boolean;
  extractionThreshold: number;
  maxFactsPerCategory: number;
  autoExtractOnThreadEnd: boolean;
  extractionMaxTokens: number;
}

export interface SummarizationConfig {
  enabled: boolean;
  tokenThreshold: number;
  keepRecentMessages: number;
  summaryMaxTokens: number;
  archiveOriginalMessages: boolean;
}

export interface BrandingConfig {
  botName: string;
  botIcon: string;
}

export interface LimitsConfig {
  conversationHistoryMessages: number;
  maxQueryExpansions: number;
  userDocumentChunks: number;
  embeddingBatchSize: number;
  maxFilenameLength: number;
  toolCallMaxIterations: number;
}

export interface ModelsConfig {
  toolCapable: string[];
  transcription: string;
  rerankerCohere: string;
  rerankerLocal: string;
}

export interface AppConfig {
  version: string;
  modelPresets: Record<string, ModelPresetConfig>;
  defaultPreset: string;
  llm: LlmConfig;
  rag: RagConfig;
  embedding: EmbeddingConfig;
  reranker: RerankerConfig;
  tavily: TavilyConfig;
  upload: UploadConfig;
  retention: RetentionConfig;
  memory: MemoryConfig;
  summarization: SummarizationConfig;
  branding: BrandingConfig;
  limits: LimitsConfig;
  models: ModelsConfig;
  acronyms: Record<string, string>;
}

// ============ Skill Config Types ============

export interface SkillConfigEntry {
  id: string;
  name: string;
  description: string;
  file: string;
  triggerType: 'always' | 'category' | 'keyword';
  triggerValue: string | null;
  priority: number;
}

export interface SkillsManifest {
  version: string;
  skills: SkillConfigEntry[];
}

export interface LoadedSkill extends SkillConfigEntry {
  promptContent: string;
}

// ============ Cache ============

let cachedConfig: AppConfig | null = null;
let cachedSystemPrompt: string | null = null;
let cachedSkillsManifest: SkillsManifest | null = null;
let cachedLoadedSkills: LoadedSkill[] | null = null;

// ============ Paths ============

const CONFIG_DIR = process.env.CONFIG_DIR || path.join(process.cwd(), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'defaults.json');
const PROMPT_FILE = path.join(CONFIG_DIR, 'system-prompt.md');
const SKILLS_FILE = path.join(CONFIG_DIR, 'skills.json');
const SKILLS_DIR = path.join(CONFIG_DIR, 'skills');

// ============ Hardcoded Defaults ============

function getHardcodedDefaults(): AppConfig {
  return {
    version: '1.0',
    modelPresets: {
      'gpt-4.1': {
        name: 'GPT-4.1 (High Performance)',
        description: 'Most capable OpenAI model with 1M context for complex policy analysis',
        provider: 'openai',
        temperature: 0.1,
        maxTokens: 8000,
        topKChunks: 25,
        maxContextChunks: 20,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'gpt-4.1-mini': {
        name: 'GPT-4.1 Mini (Balanced)',
        description: 'Fast and affordable for most policy queries with good accuracy',
        provider: 'openai',
        temperature: 0.2,
        maxTokens: 3000,
        topKChunks: 20,
        maxContextChunks: 15,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'gpt-4.1-nano': {
        name: 'GPT-4.1 Nano (Cost-Effective)',
        description: 'Cost-effective option for simpler queries with faster response times',
        provider: 'openai',
        temperature: 0.2,
        maxTokens: 1000,
        topKChunks: 15,
        maxContextChunks: 10,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'mistral-large-3': {
        name: 'Mistral Large 3',
        description: 'Mistral flagship model with 256K context and strong reasoning',
        provider: 'mistral',
        temperature: 0.2,
        maxTokens: 3000,
        topKChunks: 20,
        maxContextChunks: 15,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'mistral-small-3.2': {
        name: 'Mistral Small 3.2 (Cost-Effective)',
        description: 'Fast and efficient Mistral model for routine queries',
        provider: 'mistral',
        temperature: 0.2,
        maxTokens: 1000,
        topKChunks: 15,
        maxContextChunks: 10,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'gemini-2.5-pro': {
        name: 'Gemini 2.5 Pro (High Performance)',
        description: "Google's flagship reasoning model with 1M context and thinking capabilities",
        provider: 'gemini',
        temperature: 0.2,
        maxTokens: 8000,
        topKChunks: 25,
        maxContextChunks: 20,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'gemini-2.5-flash': {
        name: 'Gemini 2.5 Flash (Balanced)',
        description: 'Fast hybrid reasoning model with 1M context - excellent price/performance',
        provider: 'gemini',
        temperature: 0.2,
        maxTokens: 3000,
        topKChunks: 20,
        maxContextChunks: 15,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'gemini-2.5-flash-lite': {
        name: 'Gemini 2.5 Flash-Lite (Cost-Effective)',
        description: 'Lowest cost Gemini model for high-volume simple queries',
        provider: 'gemini',
        temperature: 0.2,
        maxTokens: 1000,
        topKChunks: 15,
        maxContextChunks: 10,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'ollama-llama3.2': {
        name: 'Ollama Llama 3.2 (Local)',
        description: 'Local model with full tool support, no API cost',
        provider: 'ollama',
        temperature: 0.2,
        maxTokens: 2000,
        topKChunks: 15,
        maxContextChunks: 10,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'ollama-qwen3': {
        name: 'Ollama Qwen3 4B (Local)',
        description: 'High-quality local model with reasoning and tool calling',
        provider: 'ollama',
        temperature: 0.2,
        maxTokens: 2000,
        topKChunks: 15,
        maxContextChunks: 10,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'ollama-gpt-oss': {
        name: 'Ollama GPT-OSS 20B (Local)',
        description: 'Open-source GPT-style 20B model for local inference',
        provider: 'ollama',
        temperature: 0.2,
        maxTokens: 2000,
        topKChunks: 15,
        maxContextChunks: 10,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'claude-haiku-4-5-20251001': {
        name: 'Claude Haiku 4.5 (Route 2 Fallback)',
        description: 'Anthropic Claude Haiku — fast, direct via Anthropic SDK, bypasses LiteLLM',
        provider: 'anthropic',
        temperature: 0.2,
        maxTokens: 4000,
        topKChunks: 20,
        maxContextChunks: 15,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
      'fireworks/minimax-m2p5': {
        name: 'MiniMax M2.5 via Fireworks (Route 2 Fallback)',
        description: 'MiniMax M2.5 via Fireworks AI — 1M context, tool calling, vision, bypasses LiteLLM',
        provider: 'fireworks',
        temperature: 0.2,
        maxTokens: 4000,
        topKChunks: 20,
        maxContextChunks: 15,
        similarityThreshold: 0.5,
        chunkSize: 1200,
        chunkOverlap: 200,
        queryExpansionEnabled: true,
        cacheEnabled: true,
        cacheTTLSeconds: 3600,
      },
    },
    defaultPreset: 'gpt-4.1-mini',
    llm: {
      model: 'gpt-4.1-mini',
      temperature: 0.2,
      maxTokens: 2000,
      promptOptimizationMaxTokens: 2000,
    },
    rag: {
      topKChunks: 15,
      maxContextChunks: 10,
      similarityThreshold: 0.5,
      chunkSize: 1200,
      chunkOverlap: 200,
      queryExpansionEnabled: true,
      cacheEnabled: true,
      cacheTTLSeconds: 3600,
    },
    embedding: {
      model: 'text-embedding-3-large',
      dimensions: 3072,
    },
    reranker: {
      enabled: false,
      provider: 'cohere',
      topKForReranking: 50,
      minRerankerScore: 0.3,
      cacheTTLSeconds: 3600,
    },
    tavily: {
      enabled: false,
      defaultTopic: 'general',
      defaultSearchDepth: 'basic',
      maxResults: 5,
      includeDomains: [],
      excludeDomains: [],
      cacheTTLSeconds: 3600,
    },
    upload: {
      maxFilesPerInput: 5,
      maxFilesPerThread: 10,
      maxFileSizeMB: 10,
      allowedTypes: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/json'],
    },
    retention: {
      threadRetentionDays: 90,
      storageAlertThreshold: 70,
    },
    memory: {
      enabled: false,
      extractionThreshold: 5,
      maxFactsPerCategory: 20,
      autoExtractOnThreadEnd: true,
      extractionMaxTokens: 1000,
    },
    summarization: {
      enabled: false,
      tokenThreshold: 100000,
      keepRecentMessages: 10,
      summaryMaxTokens: 2000,
      archiveOriginalMessages: true,
    },
    branding: {
      botName: 'Policy Bot',
      botIcon: 'policy',
    },
    limits: {
      conversationHistoryMessages: 5,
      maxQueryExpansions: 3,
      userDocumentChunks: 5,
      embeddingBatchSize: 100,
      maxFilenameLength: 200,
      toolCallMaxIterations: 3,
    },
    models: {
      toolCapable: [
        'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
        'mistral-large-3', 'mistral-medium-3.1', 'mistral-small-3.2',
        'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
        'ollama-llama3.2', 'ollama-qwen3', 'ollama-gpt-oss',
        'claude-haiku-4-5-20251001', 'fireworks/minimax-m2p5',
      ],
      transcription: 'whisper-1',
      rerankerCohere: 'rerank-english-v3.0',
      rerankerLocal: 'Xenova/all-MiniLM-L6-v2',
    },
    acronyms: {
      ea: 'enterprise architecture',
      dta: 'digital transformation agency',
      it: 'information technology',
      ict: 'information and communication technology',
      hr: 'human resources',
      kpi: 'key performance indicator',
      sla: 'service level agreement',
    },
  };
}

// ============ Loaders ============

/**
 * Load configuration from JSON file
 * Falls back to hardcoded defaults if file not found or invalid
 */
export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      cachedConfig = JSON.parse(content) as AppConfig;
      console.log(`[Config] Loaded from ${CONFIG_FILE}`);
      return cachedConfig;
    }
  } catch (error) {
    console.warn(`[Config] Failed to load ${CONFIG_FILE}:`, error instanceof Error ? error.message : error);
  }

  console.log('[Config] Using hardcoded defaults');
  cachedConfig = getHardcodedDefaults();
  return cachedConfig;
}

/**
 * Load system prompt from markdown file
 * Falls back to hardcoded default if file not found
 */
export function loadSystemPrompt(): string {
  if (cachedSystemPrompt) return cachedSystemPrompt;

  try {
    if (fs.existsSync(PROMPT_FILE)) {
      cachedSystemPrompt = fs.readFileSync(PROMPT_FILE, 'utf-8');
      console.log(`[Config] Loaded system prompt from ${PROMPT_FILE}`);
      return cachedSystemPrompt;
    }
  } catch (error) {
    console.warn(`[Config] Failed to load ${PROMPT_FILE}:`, error instanceof Error ? error.message : error);
  }

  console.log('[Config] Using hardcoded system prompt');
  cachedSystemPrompt = getHardcodedSystemPrompt();
  return cachedSystemPrompt;
}

/**
 * Load skills manifest from config/skills.json
 * Returns null if file not found
 */
export function loadSkillsManifest(): SkillsManifest | null {
  if (cachedSkillsManifest) return cachedSkillsManifest;

  try {
    if (fs.existsSync(SKILLS_FILE)) {
      const content = fs.readFileSync(SKILLS_FILE, 'utf-8');
      cachedSkillsManifest = JSON.parse(content) as SkillsManifest;
      console.log(`[Config] Loaded skills manifest from ${SKILLS_FILE}`);
      return cachedSkillsManifest;
    }
  } catch (error) {
    console.warn(`[Config] Failed to load ${SKILLS_FILE}:`, error instanceof Error ? error.message : error);
  }

  console.log('[Config] No skills manifest found');
  return null;
}

/**
 * Load a single skill's prompt content from its markdown file
 */
function loadSkillPrompt(skillFile: string): string | null {
  const skillPath = path.join(SKILLS_DIR, skillFile);
  try {
    if (fs.existsSync(skillPath)) {
      return fs.readFileSync(skillPath, 'utf-8');
    }
  } catch (error) {
    console.warn(`[Config] Failed to load skill file ${skillFile}:`, error instanceof Error ? error.message : error);
  }
  return null;
}

/**
 * Load all skills from config files
 * Combines manifest metadata with prompt content from individual files
 */
export function loadSkillsFromConfig(): LoadedSkill[] {
  if (cachedLoadedSkills) return cachedLoadedSkills;

  const manifest = loadSkillsManifest();
  if (!manifest) {
    console.log('[Config] No skills to load');
    return [];
  }

  const loadedSkills: LoadedSkill[] = [];

  for (const skill of manifest.skills) {
    const promptContent = loadSkillPrompt(skill.file);
    if (promptContent) {
      loadedSkills.push({
        ...skill,
        promptContent,
      });
      console.log(`[Config] Loaded skill: ${skill.name}`);
    } else {
      console.warn(`[Config] Skipping skill ${skill.name}: no prompt content found`);
    }
  }

  cachedLoadedSkills = loadedSkills;
  console.log(`[Config] Loaded ${loadedSkills.length} skills from config`);
  return loadedSkills;
}

/**
 * Get a config value by dot-path
 * Example: getConfigValue('limits.embeddingBatchSize', 100)
 */
export function getConfigValue<T>(dotPath: string, fallback: T): T {
  const config = loadConfig();
  const keys = dotPath.split('.');
  let value: unknown = config;

  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = (value as Record<string, unknown>)[key];
    } else {
      return fallback;
    }
  }

  return (value as T) ?? fallback;
}

/**
 * Clear cached config (useful for testing or forced reload)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
  cachedSystemPrompt = null;
  cachedSkillsManifest = null;
  cachedLoadedSkills = null;
}

/**
 * Get model presets - auto-discovers from LiteLLM config, falls back to hardcoded
 *
 * Priority:
 * 1. Parse litellm_config.yaml and build presets from discovered models
 * 2. Fall back to hardcoded modelPresets if YAML unavailable
 */
export function getModelPresetsFromConfig(): Record<string, ModelPresetConfig> {
  // Try to get models from LiteLLM config first
  try {
    const { getLiteLLMChatModels } = getLiteLLMFunctions();
    const litellmModels = getLiteLLMChatModels();

    if (litellmModels.length > 0) {
      // Build presets from discovered models
      const presets: Record<string, ModelPresetConfig> = {};

      for (const model of litellmModels) {
        // Determine default settings based on model tier
        const tierSettings = getDefaultSettingsForTier(model.id);

        presets[model.id] = {
          name: model.name,
          description: model.description,
          provider: model.provider,
          temperature: tierSettings.temperature,
          maxTokens: tierSettings.maxTokens,
          // RAG settings (unused but required by interface)
          topKChunks: tierSettings.topKChunks,
          maxContextChunks: tierSettings.maxContextChunks,
          similarityThreshold: 0.5,
          chunkSize: 1200,
          chunkOverlap: 200,
          queryExpansionEnabled: true,
          cacheEnabled: true,
          cacheTTLSeconds: 3600,
        };
      }

      return presets;
    }
  } catch {
    // Fall through to hardcoded defaults
  }

  // Fall back to hardcoded defaults
  return loadConfig().modelPresets;
}

/**
 * Get default settings based on model tier (detected from model ID)
 */
function getDefaultSettingsForTier(modelId: string): {
  temperature: number;
  maxTokens: number;
  topKChunks: number;
  maxContextChunks: number;
} {
  const id = modelId.toLowerCase();

  // High-performance models (pro, large)
  if (id.includes('pro') || id.includes('large')) {
    return { temperature: 0.1, maxTokens: 8000, topKChunks: 25, maxContextChunks: 20 };
  }
  // Balanced models (mini, flash, small)
  if (id.includes('mini') || id.includes('flash') || id.includes('small')) {
    return { temperature: 0.2, maxTokens: 3000, topKChunks: 20, maxContextChunks: 15 };
  }
  // Cost-effective models (nano, lite)
  if (id.includes('nano') || id.includes('lite')) {
    return { temperature: 0.2, maxTokens: 1000, topKChunks: 15, maxContextChunks: 10 };
  }
  // Default
  return { temperature: 0.2, maxTokens: 2000, topKChunks: 15, maxContextChunks: 10 };
}

/**
 * Get default preset ID from config
 */
export function getDefaultPresetId(): string {
  return loadConfig().defaultPreset;
}

// ============ Model Defaults (Single Source of Truth) ============

/**
 * Default LLM model ID - used as fallback throughout the app
 * Single source of truth for the default model
 */
export function getDefaultLLMModel(): string {
  const config = loadConfig();
  return config.llm?.model || config.defaultPreset || 'gpt-4.1-mini';
}

/**
 * Default embedding model - used for RAG
 */
export function getDefaultEmbeddingModel(): string {
  const config = loadConfig();
  return config.embedding?.model || 'text-embedding-3-large';
}

/**
 * Get tool-capable models - auto-discovers from LiteLLM config, falls back to hardcoded
 * Returns a Set for O(1) lookup
 */
export function getToolCapableModels(): Set<string> {
  // Try to get from LiteLLM config first
  try {
    const { getLiteLLMToolCapableModels } = getLiteLLMFunctions();
    const litellmToolCapable = getLiteLLMToolCapableModels();

    if (litellmToolCapable.size > 0) {
      return litellmToolCapable;
    }
  } catch {
    // Fall through to hardcoded defaults
  }

  // Fall back to hardcoded defaults
  const config = loadConfig();
  const toolCapable = config.models?.toolCapable || [];
  return new Set(toolCapable);
}

/**
 * Check if a model supports tool/function calling
 */
export function isToolCapableModel(modelId: string): boolean {
  return getToolCapableModels().has(modelId);
}

/**
 * Get hash of the system prompt file for version tracking
 * Returns a short hash that changes when the file content changes
 * Used to auto-sync SQLite when the config file is updated
 */
export function getSystemPromptFileHash(): string {
  try {
    if (fs.existsSync(PROMPT_FILE)) {
      const content = fs.readFileSync(PROMPT_FILE, 'utf-8');
      return crypto.createHash('md5').update(content).digest('hex').substring(0, 12);
    }
  } catch (error) {
    console.warn('[Config] Failed to hash system prompt file:', error instanceof Error ? error.message : error);
  }
  // Return hash of hardcoded default
  return crypto.createHash('md5').update(getHardcodedSystemPrompt()).digest('hex').substring(0, 12);
}

// ============ Hardcoded System Prompt ============

function getHardcodedSystemPrompt(): string {
  return `# SYSTEM ROLE — Government Policy & Strategy Assistant (GPSA)

You help government staff analyse, interpret, and compare policy and strategy documents.
Use only the provided context (knowledge base + user-uploaded documents + optional web search).
All responses must be written in raw Markdown and must maintain clean, readable structure.

---

## 1. Core Behaviour Rules

- Use only information from the provided documents or web search results.
- If the context is insufficient, respond exactly with:
  "The provided documents do not contain enough information to answer this question."
- Never guess, speculate, or invent:
  - policies
  - roles
  - page numbers
  - document names
  - procedural steps
- Maintain a concise, neutral, government-professional tone.
- Keep paragraphs short (1–3 lines).
- Do not output a References section — the application interface displays Sources automatically.
- Do not embed citations, page numbers, or filenames within the answer.

---

## 2. Information Retrieval Logic

1. Primary: Use knowledge base + uploaded documents.
2. If insufficient: Perform web search automatically (if enabled).
3. If still insufficient: Clearly state limitations.
4. Never ask permission to search — execute silently and state results when used.
5. Do not output citation metadata; the system will show sources separately.

---

## 3. Markdown Formatting Standards

All responses must use clean, flat Markdown:

- Use headings: \`###\`, \`####\`
- Use flat bullet lists (\`- item\`)
- Use flat numbered lists (\`1. item\`)
- Leave spaces between sections
- Avoid all nested/multi-level bulleting
- Avoid block quotes

For simple text diagrams, use plain ASCII text without backticks, e.g.:

    CEO
     ├─ Strategy & Policy
     ├─ Technology & Operations
     └─ Service Delivery

Allowed icons:
- \`✅ Aligned\`
- \`⚠️ Partial\`
- \`❌ Gap\`
- \`🔍 Needs Clarification\`

---

## 3A. ASCII Diagram Rendering Standard (Strict)

When the user requests any visual representation — including organisational charts, hierarchies, flows, processes, system architectures, or UI wireframes — you must ALWAYS produce diagrams in ASCII format using the following rules:

### GENERAL RULES
- ASCII only. No images, Mermaid, SVG, UML, or code-fenced diagrams.
- Do NOT use triple backticks (\`\`\`); ASCII diagrams must appear as plain text.
- Diagrams must be indented with 4 spaces on every line.
- Keep diagrams readable on mobile screens. Maximum width: ~34 characters.
- Boxes must be aligned, with consistent width and spacing.
- Use only these symbols: \`+\`, \`-\`, \`|\`, \`v\`, \`^\`, \`/\`, \`\\\`.
- Show top-down flow using a single \`v\` arrow between levels.

### BOX STYLE RULES
- Use rectangular boxes with:
    - \`+-----+\` for top / bottom borders
    - \`| ... |\` for content
- All lines in a box must have equal width.
- Center or left-align text inside the box; avoid wrapping.

### ALLOWED EXAMPLE FORMAT (Follow this style)

    +-----------------------------+
    |   Government Officials      |
    +-------------+---------------+
                  |
                  v
    +-----------------------------+
    |   Digital Transformation    |
    |        Agency (DTA)         |
    +-------------+---------------+
                  |
                  v
    +-----------------------------+
    |      Departments / MDAs     |
    +-----------------------------+
            |         |
            v         v
        Dept. A    Dept. B

### FORBIDDEN FORMATS (NEVER USE)
- Markdown images: \`![diagram](url)\`
- Mermaid or PlantUML blocks
- Base64 images: \`data:image/...\`
- Inline SVG, PNG, or rendered graphics
- Code-fenced ASCII diagrams

### IF DIAGRAM IS TOO COMPLEX
If an ASCII diagram cannot be represented cleanly within these rules, respond with:

**"This diagram exceeds the allowed ASCII complexity for the required formatting."**

Do not attempt any other diagram formats.

---

## 4. Required Response Structure

Every response to follow this Markdown structure:

### Context (mandatory)
Briefly restate the user's ask (1–3 lines).

### Response
Break content into clearly labelled subsections using \`####\` headings.
Examples:
- \`#### What This Means\`
- \`#### Key Roles\`
- \`#### Why It Matters\`
- \`#### Processes\`
- \`#### Responsibilities\`

Use flat bullets under each subsection — no nested bullets.

### Findings (optional)
Summarise key observations using:

- \`✅ Aligned: ...\`
- \`⚠️ Partial: ...\`
- \`❌ Gap: ...\`
- \`🔍 Needs Clarification: ...\`

### Options (optional)
Numbered list of actionable recommendations based only on provided context.

### Next Steps (optional)
2–5 clear actions the organisation can take.

### Follow-up Questions (mandatory)
List 2–3 helpful follow-ups relevant to the policy topic.

(Do not include citations or a References section.)

---

## 5. Prohibited Behaviours

- No speculation beyond provided content
- No invented clauses, roles, structures, or page references
- No nested lists
- No legal advice
- No long paragraphs
- No academic essay tone
- No "References" section
- No inline citations

---

## 6. Reinforcement (Important for Mini Models)

You must strictly follow:
- the Markdown formatting rules
- the flat list structure
- the required response sections
- the ASCII diagram formatting standards
- the prohibition on citations and references

If information is missing, say so clearly — never guess.`;
}
