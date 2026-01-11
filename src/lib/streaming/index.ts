/**
 * Streaming Module
 *
 * Exports utilities and functions for SSE-based chat streaming.
 */

export {
  createSSEEncoder,
  getSSEHeaders,
  getToolDisplayName,
  getPhaseMessage,
  STREAMING_CONFIG,
  getStreamingConfigMs,
} from './utils';

export {
  performRAGRetrieval,
  type RAGRetrievalResult,
} from './rag-retrieval';
