/**
 * Mistral AI Direct Provider (Route 2)
 *
 * Handles chat completion (streaming + non-streaming), embeddings, and
 * model prefix detection for the @mistralai/mistralai SDK.
 *
 * Used by: openai.ts (chat streaming), llm-client.ts (internal services),
 *          agent/llm-router.ts (autonomous agent — already direct)
 */

import { Mistral } from '@mistralai/mistralai';
import { resolveProviderCredentialForRequest } from '../../provider-credential';

// ============ Client (per-call; Mistral SDK is not in the factory union) ============

export function resetMistralClient(): void {
  // Mistral SDK clients are constructed per call (stateless wrapper around the
  // key), so there is no module-scope client to reset. Retained for API compat.
}

async function getMistralClient(): Promise<Mistral> {
  const cred = await resolveProviderCredentialForRequest('mistral');
  if (!cred.apiKey) {
    throw new Error('Mistral API key not configured. Set MISTRAL_API_KEY or configure in Admin > LLM > Providers.');
  }
  return new Mistral({ apiKey: cred.apiKey });
}

// ============ Model Detection ============

/**
 * Check if a model ID belongs to Mistral (Route 2 direct).
 * Matches: mistral/, codestral/, pixtral/ prefixes.
 */
export function isMistralModel(model: string): boolean {
  return model.startsWith('mistral/')
    || model.startsWith('mistral-')
    || model.startsWith('codestral/')
    || model.startsWith('codestral-')
    || model.startsWith('pixtral/')
    || model.startsWith('pixtral-');
}

/**
 * Strip provider prefix for SDK calls.
 * "mistral/mistral-large-latest" → "mistral-large-latest"
 */
export function stripMistralPrefix(model: string): string {
  if (model.startsWith('mistral/')) return model.slice('mistral/'.length);
  if (model.startsWith('mistral-')) return model; // Preset models: mistral-large-2512 → pass as-is
  if (model.startsWith('codestral/')) return model.slice('codestral/'.length);
  if (model.startsWith('codestral-')) return model;
  if (model.startsWith('pixtral/')) return model.slice('pixtral/'.length);
  if (model.startsWith('pixtral-')) return model;
  return model;
}

// ============ Non-Streaming Chat ============

/**
 * Non-streaming chat completion via Mistral SDK.
 * Used by: llm-client.ts (internal services)
 */
export async function callMistralChat(
  model: string,
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    /** Thinking request params (e.g. reasoning_effort) for Magistral/reasoning models. */
    thinkingParams?: Record<string, unknown>;
  }
): Promise<{ content: string; totalTokens: number }> {
  const client = await getMistralClient();
  const cleanModel = stripMistralPrefix(model);

  const response = await client.chat.complete({
    model: cleanModel,
    messages: messages as any,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    ...(options?.thinkingParams ?? {}),
  } as any);

  const messageContent = response.choices?.[0]?.message?.content;
  const content = typeof messageContent === 'string' ? messageContent : '';

  return {
    content,
    totalTokens: response.usage?.totalTokens || 0,
  };
}

// ============ Streaming Chat ============

const FIRST_CHUNK_TIMEOUT_MS = 120_000;

export interface MistralStreamResult {
  content: string | null;
  tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] | undefined;
  thinkingContent: string | null;
  totalTokens: number;
}

/**
 * Streaming chat completion via Mistral SDK.
 * Returns the same shape as streamOneCompletion() for compatibility
 * with the generateResponseWithTools() tool call loop.
 */
export async function streamMistralCompletion(
  model: string,
  messages: Array<{ role: string; content: string | any }>,
  options?: {
    temperature?: number;
    maxTokens?: number;
    tools?: any[];
    toolChoice?: any;
    onChunk?: (text: string) => void;
    onThinkingChunk?: (text: string) => void;
    interChunkTimeoutMsOverride?: number;
    firstChunkTimeoutMsOverride?: number;
  }
): Promise<MistralStreamResult> {
  const client = await getMistralClient();
  const cleanModel = stripMistralPrefix(model);

  const controller = new AbortController();
  let wasAborted = false;

  // Import streaming config lazily to avoid circular deps
  const { getStreamingConfigMs } = await import('@/lib/streaming/utils');
  const streamingConfig = await getStreamingConfigMs();
  const interChunkTimeoutMs = options?.interChunkTimeoutMsOverride ?? streamingConfig.TOOL_TIMEOUT_MS;
  const firstChunkTimeoutMs = options?.firstChunkTimeoutMsOverride ?? FIRST_CHUNK_TIMEOUT_MS;

  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    console.warn(`[Mistral] Streaming timed out waiting for first chunk`, { model: cleanModel });
    wasAborted = true;
    controller.abort();
  }, firstChunkTimeoutMs);

  const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      console.warn(`[Mistral] Streaming timed out between chunks`, { model: cleanModel });
      wasAborted = true;
      controller.abort();
    }, interChunkTimeoutMs);
  };

  let content = '';
  let thinkingContent = '';
  let streamTotalTokens = 0;
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

  try {
    const stream = await client.chat.stream({
      model: cleanModel,
      messages: messages as any,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      tools: options?.tools as any,
      toolChoice: options?.toolChoice as any,
    } as any);

    for await (const event of stream) {
      resetTimeout();

      const chunk = event.data;
      if (!chunk) continue;

      // Usage may appear in final chunk
      if (chunk.usage) {
        streamTotalTokens = chunk.usage.totalTokens ?? 0;
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      // Content delta
      if (delta.content) {
        const text = typeof delta.content === 'string' ? delta.content : '';
        if (text) {
          content += text;
          options?.onChunk?.(text);
        }
      }

      // Tool call deltas (camelCase: toolCalls not tool_calls)
      if (delta.toolCalls) {
        for (const tc of delta.toolCalls) {
          const idx = tc.index ?? 0;
          if (!toolCallMap.has(idx)) {
            toolCallMap.set(idx, { id: '', name: '', arguments: '' });
          }
          const acc = toolCallMap.get(idx)!;
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name = tc.function.name;
          if (tc.function?.arguments) {
            acc.arguments += typeof tc.function.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function.arguments);
          }
        }
      }
    }

    if (wasAborted) {
      throw new Error(
        `Mistral streaming timeout (model: ${cleanModel}). The model may be unresponsive.`
      );
    }
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'APIUserAbortError' || error.message.includes('aborted'))) {
      throw new Error(
        `Mistral streaming timeout (model: ${cleanModel}). The model may be unresponsive.`
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
}

// ============ Embeddings ============

/**
 * Create embeddings directly via Mistral SDK.
 * Returns 1024-dimensional vectors.
 *
 * IMPORTANT: Mistral embeddings (1024d) are incompatible with existing
 * Qdrant collections (3072d). Use dimension-suffixed collections
 * (policy_{slug}_1024) or keep OpenAI as primary embedding provider.
 */
export async function createMistralEmbedding(text: string): Promise<number[]> {
  const client = await getMistralClient();
  const response = await client.embeddings.create({
    model: 'mistral-embed',
    inputs: [text],
  });
  return response.data?.[0]?.embedding ?? [];
}

export async function createMistralEmbeddings(texts: string[]): Promise<number[][]> {
  const client = await getMistralClient();
  const response = await client.embeddings.create({
    model: 'mistral-embed',
    inputs: texts,
  });
  return (response.data?.map(d => d.embedding).filter((e): e is number[] => e !== undefined) ?? []);
}

/**
 * Check if an embedding model ID belongs to Mistral.
 */
export function isMistralEmbeddingModel(model: string): boolean {
  return model === 'mistral-embed' || (model.startsWith('mistral') && model.includes('embed'));
}
