/**
 * Streaming Utilities
 *
 * SSE encoder, phase messages, and tool display name mappings
 * for the streaming chat API.
 */

import type { StreamEvent, StreamPhase } from '@/types/stream';
import { getStreamingConfig } from '@/lib/db/compat/agent-config';

/**
 * Create SSE encoder for streaming responses
 */
export function createSSEEncoder() {
  const encoder = new TextEncoder();

  return {
    /**
     * Encode a stream event as SSE data
     */
    encode(event: StreamEvent): Uint8Array {
      return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
    },

    /**
     * Encode a keep-alive comment
     */
    keepAlive(): Uint8Array {
      return encoder.encode(`: keep-alive\n\n`);
    },
  };
}

/**
 * SSE response headers
 */
export function getSSEHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  };
}

/**
 * Tool display name mapping
 * Maps internal tool names to user-friendly display names
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  web_search: 'Web Search',
  doc_gen: 'Document Generator',
  chart_gen: 'Chart Generator',
  data_source: 'Data Query',
  function_api: 'External API',
  youtube: 'YouTube',
};

/**
 * Get user-friendly display name for a tool
 */
export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] || toolName;
}

/**
 * Phase status messages for UI display
 */
const PHASE_MESSAGES: Record<StreamPhase, string> = {
  init: 'Starting...',
  rag: 'Searching knowledge base...',
  clarifying_question: 'Waiting for your input...',
  tools: 'Processing tools...',
  generating: 'Generating response...',
  agent_planning: 'Creating task plan...',
  agent_executing: 'Executing tasks...',
  agent_checking: 'Checking task quality...',
  agent_summarizing: 'Generating summary...',
  awaiting_approval: 'Waiting for plan approval...',
  complete: 'Complete',
};

/**
 * Get status message for a stream phase
 */
export function getPhaseMessage(phase: StreamPhase): string {
  return PHASE_MESSAGES[phase] || 'Processing...';
}

/**
 * Default streaming configuration (fallback values)
 */
const DEFAULT_STREAMING_CONFIG = {
  KEEPALIVE_INTERVAL_MS: 10000,
  MAX_STREAM_DURATION_MS: 300000,
  TOOL_TIMEOUT_MS: 60000,
} as const;

/**
 * Get streaming configuration from database (with fallback to defaults)
 * Returns values in milliseconds for direct use
 */
export async function getStreamingConfigMs(): Promise<{
  KEEPALIVE_INTERVAL_MS: number;
  MAX_STREAM_DURATION_MS: number;
  TOOL_TIMEOUT_MS: number;
}> {
  try {
    const config = await getStreamingConfig();
    return {
      KEEPALIVE_INTERVAL_MS: config.keepalive_interval_seconds * 1000,
      MAX_STREAM_DURATION_MS: config.max_stream_duration_seconds * 1000,
      TOOL_TIMEOUT_MS: config.tool_timeout_seconds * 1000,
    };
  } catch {
    // Fallback to defaults if DB not available
    return DEFAULT_STREAMING_CONFIG;
  }
}

/**
 * Constants for streaming configuration (deprecated - use getStreamingConfigMs() for dynamic values)
 * Kept for backward compatibility
 */
export const STREAMING_CONFIG = DEFAULT_STREAMING_CONFIG;
