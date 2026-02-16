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

/** Character limit for chunk preview in sources */
export const CHUNK_PREVIEW_LENGTH = 200;

/** Default conversation history limit (when not configured in settings) */
export const DEFAULT_CONVERSATION_HISTORY_LIMIT = 5;

// ============ Embedding Constants ============

/** Batch size for creating embeddings */
export const EMBEDDING_BATCH_SIZE = 100;

// ============ Reranker Constants ============

/** Maximum tokens for local reranker model input */
export const LOCAL_RERANKER_MAX_TOKENS = 512;

// ============ Tool Constants ============

/** Maximum tool call iterations to prevent runaway loops */
export const MAX_TOOL_CALL_ITERATIONS = 10;

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
