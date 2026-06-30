/**
 * OpenAI Direct Provider (Route 2)
 *
 * Handles chat completion (streaming + non-streaming), embeddings, and
 * model prefix detection for the native OpenAI SDK.
 *
 * Used by: openai.ts (chat streaming + tool completion), llm-client.ts (internal services),
 *          agent/llm-router.ts (autonomous agent)
 */

import OpenAI from 'openai';
import { getApiKey } from '@/lib/provider-helpers';
import { isUnsupportedThinkingParamError } from '@/lib/llm-thinking';

// ============ Client Singleton ============

let openaiClient: OpenAI | null = null;

export function resetOpenAIClient(): void {
  openaiClient = null;
}

export async function getOpenAIDirectClient(): Promise<OpenAI> {
  if (!openaiClient) {
    const apiKey = await getApiKey('openai');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY or configure in Admin > LLM > Providers.');
    }
    openaiClient = new OpenAI({
      apiKey,
      baseURL: 'https://api.openai.com/v1', // Direct, bypasses LiteLLM
      timeout: 300 * 1000, // 5 minutes — matches other provider timeouts
    });
  }
  return openaiClient;
}

// ============ Model Detection ============

/**
 * Check if a model ID belongs to OpenAI (Route 2 direct).
 * Matches: openai/, gpt-, o1, o3, o4 prefixes.
 */
export function isOpenAIModel(model: string): boolean {
  return model.startsWith('openai/')
    || model.startsWith('gpt-')
    || model.startsWith('o1')
    || model.startsWith('o3')
    || model.startsWith('o4');
}

/**
 * Strip provider prefix for SDK calls.
 * "openai/gpt-4o" → "gpt-4o"
 * "gpt-4o" → "gpt-4o" (already clean)
 */
export function stripOpenAIPrefix(model: string): string {
  if (model.startsWith('openai/')) return model.slice('openai/'.length);
  return model;
}

/**
 * Detect if a model requires max_completion_tokens instead of max_tokens.
 * GPT-5.x and o-series reasoning models reject max_tokens.
 * See: https://platform.openai.com/docs/api-reference/chat/create
 */
export function requiresMaxCompletionTokens(model: string): boolean {
  const id = model.toLowerCase();
  return id.startsWith('gpt-5')
    || id.startsWith('o1')
    || id.startsWith('o3')
    || id.startsWith('o4');
}

// ============ Non-Streaming Chat ============

export interface OpenAIChatResult {
  content: string;
  totalTokens: number;
}

/**
 * Non-streaming chat completion via OpenAI SDK.
 * Used by: llm-client.ts (internal services), llm-utils.ts (callLLMForJson)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function callOpenAIChat(
  model: string,
  messages: any[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    responseSchema?: object;
    responseFormat?: { type: 'json_object' | 'text' } | { type: 'json_schema'; json_schema: { name: string; schema: object; strict?: boolean } };
    systemPrompt?: string;
  },
): Promise<OpenAIChatResult> {
  const client = await getOpenAIDirectClient();
  const cleanModel = stripOpenAIPrefix(model);

  // Build messages array with optional system prompt override
  const requestMessages: any[] = [];
  if (options?.systemPrompt) {
    requestMessages.push({ role: 'system', content: options.systemPrompt });
  }
  // Filter out system messages from input if we already added one
  for (const msg of messages) {
    if (msg.role === 'system' && options?.systemPrompt) continue;
    requestMessages.push(msg);
  }

  const maxTokensParam = requiresMaxCompletionTokens(cleanModel)
    ? { max_completion_tokens: options?.maxTokens ?? 4096 }
    : { max_tokens: options?.maxTokens ?? 4096 };

  const requestParams: Record<string, unknown> = {
    model: cleanModel,
    messages: requestMessages,
    ...(options?.temperature !== undefined && { temperature: options.temperature }),
    ...maxTokensParam,
  };

  // Native OpenAI structured output support
  // responseFormat takes precedence over responseSchema when both are provided
  if (options?.responseFormat) {
    requestParams.response_format = options.responseFormat;
  } else if (options?.responseSchema) {
    requestParams.response_format = {
      type: 'json_schema',
      json_schema: {
        name: 'response',
        schema: options.responseSchema,
        strict: true,
      },
    };
  }

  const response = await client.chat.completions.create(requestParams as any);

  const content = response.choices?.[0]?.message?.content?.trim() || '';
  const totalTokens = response.usage?.total_tokens || 0;

  return { content, totalTokens };
}

// ============ Streaming Chat ============

const FIRST_CHUNK_TIMEOUT_MS = 120_000;

export interface OpenAIStreamResult {
  content: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] | undefined;
  thinkingContent: string | null;
  totalTokens: number;
}

/**
 * Streaming chat completion via OpenAI SDK.
 * Returns the same shape as streamOneCompletion() for compatibility
 * with the generateResponseWithTools() tool call loop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function streamOpenAICompletion(
  model: string,
  messages: any[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    tools?: any[];
    toolChoice?: any;
    systemPrompt?: string;
    reasoningEffort?: string;
    onChunk?: (text: string) => void;
    onThinkingChunk?: (text: string) => void;
    interChunkTimeoutMsOverride?: number;
    firstChunkTimeoutMsOverride?: number;
  },
): Promise<OpenAIStreamResult> {
  const client = await getOpenAIDirectClient();
  const cleanModel = stripOpenAIPrefix(model);

  // Build messages array with optional system prompt override
  const requestMessages: any[] = [];
  if (options?.systemPrompt) {
    requestMessages.push({ role: 'system', content: options.systemPrompt });
  }
  for (const msg of messages) {
    if (msg.role === 'system' && options?.systemPrompt) continue;
    requestMessages.push(msg);
  }

  // Import streaming config lazily to avoid circular deps
  const { getStreamingConfigMs } = await import('@/lib/streaming/utils');
  const streamingConfig = await getStreamingConfigMs();
  const interChunkTimeoutMs = options?.interChunkTimeoutMsOverride ?? streamingConfig.TOOL_TIMEOUT_MS;
  const firstChunkTimeoutMs = options?.firstChunkTimeoutMsOverride ?? FIRST_CHUNK_TIMEOUT_MS;

  // Build request params. Use `as any` on the create call — the OpenAI SDK v6
  // overload resolution is strict about ReasoningEffort being a union literal,
  // and conditional spreads widen `string` types. Matching the pattern used
  // in streamOneCompletion() throughout openai.ts.
  const maxTokensParam = requiresMaxCompletionTokens(cleanModel)
    ? { max_completion_tokens: options?.maxTokens ?? 4096 }
    : { max_tokens: options?.maxTokens ?? 4096 };

  const requestParams: Record<string, unknown> = {
    model: cleanModel,
    messages: requestMessages,
    ...(options?.temperature !== undefined && { temperature: options.temperature }),
    ...maxTokensParam,
    ...(options?.tools?.length && { tools: options.tools }),
    ...(options?.toolChoice !== undefined && { tool_choice: options.toolChoice }),
    ...(options?.reasoningEffort && { reasoning_effort: options.reasoningEffort }),
  };

  /**
   * Inner helper: execute the streaming request with the given params.
   * Extracted so the outer function can retry with modified params
   * (e.g., stripping reasoning_effort on API rejection).
   */
  const doStream = async (params: Record<string, unknown>): Promise<OpenAIStreamResult> => {
    let wasAborted = false;

    let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      console.warn(`[OpenAI Direct] Streaming timed out waiting for first chunk`, { model: cleanModel });
      wasAborted = true;
    }, firstChunkTimeoutMs);

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        console.warn(`[OpenAI Direct] Streaming timed out between chunks`, { model: cleanModel });
        wasAborted = true;
      }, interChunkTimeoutMs);
    };

    let content = '';
    let thinkingContent = '';
    let streamTotalTokens = 0;
    const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      // OpenAI SDK v6 overloads: stream:true returns Stream<ChatCompletionChunk>.
      // The spread of Omit<..., 'stream'> with {stream:true} should produce
      // ChatCompletionCreateParamsStreaming, but TS strict mode sometimes
      // widens conditional spreads. The `as any` matches the pattern used
      // in streamOneCompletion() calls throughout openai.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await (client.chat.completions as any).create({
        ...params,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        resetTimeout();

        // Usage may appear in final chunk with stream_options: { include_usage: true }
        if (chunk.usage) {
          streamTotalTokens = chunk.usage.total_tokens ?? 0;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Content delta
        if (delta.content) {
          content += delta.content;
          options?.onChunk?.(delta.content);
        }

        // Reasoning / thinking content (o1, o3, o4, gpt-5 series)
        if ((delta as any).reasoning_content) {
          thinkingContent += (delta as any).reasoning_content;
          options?.onThinkingChunk?.((delta as any).reasoning_content);
        }

        // Tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallMap.has(idx)) {
              toolCallMap.set(idx, { id: '', name: '', arguments: '' });
            }
            const acc = toolCallMap.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) {
              acc.arguments += tc.function.arguments;
            }
          }
        }
      }

      if (wasAborted) {
        throw new Error(
          `OpenAI streaming timeout (model: ${cleanModel}). The model may be unresponsive.`
        );
      }
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
        throw new Error(
          `OpenAI streaming timeout (model: ${cleanModel}). The model may be unresponsive.`
        );
      }
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    const tool_calls = toolCallMap.size > 0
      ? [...toolCallMap.values()].map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }))
      : undefined;

    return {
      content: content || null,
      tool_calls,
      thinkingContent: thinkingContent || null,
      totalTokens: streamTotalTokens,
    };
  };

  // First attempt with full params (may include reasoning_effort)
  try {
    return await doStream(requestParams);
  } catch (error) {
    // Retry without reasoning_effort if the model rejects it with function tools.
    // This handles models like gpt-5.5 that require /v1/responses for tools+reasoning.
    if (requestParams.reasoning_effort && isUnsupportedThinkingParamError(error)) {
      console.warn('[OpenAI Direct] Retrying without reasoning_effort', { model: cleanModel });
      const { reasoning_effort, ...retryParams } = requestParams;
      return await doStream(retryParams);
    }
    throw error;
  }
}

// ============ Embeddings ============

/**
 * Create embeddings directly via OpenAI SDK.
 * Returns 3072-dimensional vectors (text-embedding-3-large).
 *
 * This is the canonical embedding provider. 3072d matches existing
 * Qdrant collections — no dimension migration needed.
 */
export async function createOpenAIEmbedding(text: string, model?: string): Promise<number[]> {
  const client = await getOpenAIDirectClient();
  const embedModel = model || 'text-embedding-3-large';

  const response = await client.embeddings.create({
    model: embedModel,
    input: text,
  });

  return response.data?.[0]?.embedding ?? [];
}

export async function createOpenAIEmbeddings(texts: string[], model?: string): Promise<number[][]> {
  const client = await getOpenAIDirectClient();
  const embedModel = model || 'text-embedding-3-large';

  const response = await client.embeddings.create({
    model: embedModel,
    input: texts,
  });

  return response.data?.map(d => d.embedding).filter((e): e is number[] => e !== undefined) ?? [];
}

/**
 * Check if an embedding model ID belongs to OpenAI.
 */
export function isOpenAIEmbeddingModel(model: string): boolean {
  return model === 'text-embedding-3-large'
    || model === 'text-embedding-3-small'
    || model === 'text-embedding-ada-002'
    || (model.startsWith('text-embedding') && !model.includes('mistral') && !model.includes('gemini'));
}
