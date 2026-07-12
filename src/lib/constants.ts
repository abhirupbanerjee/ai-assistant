/**
 * Application Constants
 *
 * Centralized location for magic numbers and configuration values
 * that were previously hardcoded throughout the codebase.
 */

// ============ RAG Constants ============

/** Maximum number of query expansions for acronym-based search */
export const MAX_QUERY_EXPANSIONS = 3;

/** Maximum chunks to process from user-uploaded documents */
export const MAX_USER_DOC_CHUNKS = 10;

/** Maximum user chunks returned in RAG context */
export const MAX_USER_CHUNKS_RETURNED = 5;

/** Maximum chunks to process when the user explicitly asks about an uploaded document */
export const MAX_USER_DOC_CHUNKS_FOR_SUMMARY = 40;

/** Maximum uploaded-document chunks returned for explicit document review/summary requests */
export const MAX_USER_CHUNKS_RETURNED_FOR_SUMMARY = 20;

/** Character limit for chunk preview in sources */
export const CHUNK_PREVIEW_LENGTH = 200;

/**
 * Character budget for including the full text of a user-uploaded document
 * directly in the RAG context (without summarization). Roughly ~8K tokens.
 * Documents shorter than this are injected as-is; longer ones get an LLM summary.
 */
export const FULL_DOC_CHAR_BUDGET = 30000;

/**
 * Character threshold above which an LLM summarization call is made to condense
 * the document before injecting it as context. Below this, the full text is used.
 */
export const SUMMARY_DOC_CHAR_THRESHOLD = 30000;

/**
 * Character threshold above which a chapter-wise summarization strategy is used
 * (the document is split into sections, each summarized individually, and the
 * summaries are concatenated). Below this, a single whole-document summary call
 * is made.
 */
export const CHAPTER_DOC_CHAR_THRESHOLD = 120000;

/** Maximum characters per chapter section for chapter-wise summarization */
export const CHAPTER_SECTION_CHAR_SIZE = 25000;

/** Default conversation history limit (when not configured in settings) */
export const DEFAULT_CONVERSATION_HISTORY_LIMIT = 5;

// ============ Embedding Constants ============

/** Batch size for creating embeddings */
export const EMBEDDING_BATCH_SIZE = 100;

/** Embedding model definition */
export interface EmbeddingModelDefinition {
  id: string;
  name: string;
  provider: 'openai' | 'mistral' | 'gemini' | 'fireworks' | 'local';
  dimensions: number;
  local: boolean;
}

/**
 * Available embedding models
 * Cloud providers require API keys; local models use @xenova/transformers
 */
export const EMBEDDING_MODELS: EmbeddingModelDefinition[] = [
  // Cloud providers
  { id: 'text-embedding-3-large', name: 'OpenAI Large', provider: 'openai', dimensions: 3072, local: false },
  { id: 'text-embedding-3-small', name: 'OpenAI Small', provider: 'openai', dimensions: 1536, local: false },
  { id: 'mistral-embed', name: 'Mistral Embed', provider: 'mistral', dimensions: 1024, local: false },
  { id: 'text-embedding-004', name: 'Gemini Embed', provider: 'gemini', dimensions: 768, local: false },
  // Fireworks AI (OpenAI-compatible, requires FIREWORKS_AI_API_KEY)
  { id: 'nomic-ai/nomic-embed-text-v1.5', name: 'Nomic Embed v1.5 (Fireworks)', provider: 'fireworks', dimensions: 768, local: false },
  { id: 'fireworks/qwen3-embedding-8b', name: 'Qwen3 Embedding 8B (Fireworks)', provider: 'fireworks', dimensions: 4096, local: false },
  // Local models (via @xenova/transformers - no API key required)
  { id: 'mxbai-embed-large', name: 'MixedBread Large (Local)', provider: 'local', dimensions: 1024, local: true },
  { id: 'bge-m3', name: 'BGE-M3 (Local)', provider: 'local', dimensions: 1024, local: true },
];

/** Get embedding model by ID */
export function getEmbeddingModelById(modelId: string): EmbeddingModelDefinition | undefined {
  return EMBEDDING_MODELS.find(m => m.id === modelId);
}

/** Get dimensions for an embedding model */
export function getEmbeddingModelDimensions(modelId: string): number {
  const model = getEmbeddingModelById(modelId);
  return model?.dimensions ?? 3072; // Default to OpenAI Large dimensions
}

// ============ Reranker Constants ============

/** Maximum tokens for local reranker model input */
export const LOCAL_RERANKER_MAX_TOKENS = 512;

/** Minimum reranker score for user-uploaded documents (filters obviously irrelevant uploads)
 * HIGH SEVERITY FIX: Raised from 0.05 to 0.30 to prevent flooding context with irrelevant chunks.
 * The old value of 0.05 was barely any filtering, causing poor retrieval quality.
 * Can be overridden via USER_UPLOAD_MIN_RERANK_SCORE env var for testing.
 */
export const USER_UPLOAD_MIN_RERANK_SCORE = parseFloat(
  process.env.USER_UPLOAD_MIN_RERANK_SCORE || '0.30'
);

// ============ Tool Constants ============

/**
 * Check if a model supports tool/function calling
 * Re-exported from config-loader for convenience
 */
export { isToolCapableModel, getToolCapableModels } from './config-loader';

// ============ Ingestion Constants ============

/** Maximum filename length after sanitization */
export const MAX_FILENAME_LENGTH = 200;

/** Maximum URLs per batch for web ingestion */
export const MAX_URLS_PER_BATCH = 5;

// ============ Thread Constants ============

/** Maximum thread title length */
export const MAX_THREAD_TITLE_LENGTH = 100;

/** Auto-generated title preview length */
export const AUTO_TITLE_PREVIEW_LENGTH = 50;

// ============ API Response Constants ============

/** Maximum error text length in API responses */
export const MAX_ERROR_TEXT_LENGTH = 500;

// ============ Data Source Constants ============

/** Sample data rows for CSV preview */
export const CSV_SAMPLE_ROWS = 5;

/** Rows to analyze for column type inference */
export const CSV_TYPE_INFERENCE_ROWS = 100;

/** Sample data rows for API response preview */
export const API_SAMPLE_ROWS = 3;

// ============ Auto Model Selection Constants ============

/**
 * Re-exported from `auto-model-constants.ts` for server-side convenience.
 *
 * ⚠️ Client components MUST import from `@/lib/auto-model-constants` directly,
 * NOT from this module. This file re-exports `config-loader.ts` which uses
 * `fs` — a server-only API that breaks the client bundle.
 */
export { AUTO_MODEL_SENTINEL } from './auto-model-constants';
