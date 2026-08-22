/**
 * Google Gemini Direct Provider (Route 2)
 *
 * Handles chat completion (streaming + non-streaming), embeddings, and
 * model prefix detection for the @google/genai SDK.
 *
 * Used by: openai.ts (chat streaming + tool completion), llm-client.ts (internal services),
 *          agent/llm-router.ts (autonomous agent — already direct, optional refactor)
 */

import { GoogleGenAI } from '@google/genai';
import { resolveProviderCredentialForRequest, sharedProviderClientFactory } from '../../provider-credential';

// ============ Client (ProviderClientFactory, keyed by credential) ============

export function resetGeminiClient(): void {
  sharedProviderClientFactory.clear();
}

async function getGeminiClient(): Promise<GoogleGenAI> {
  const cred = await resolveProviderCredentialForRequest('gemini');
  if (!cred.apiKey) {
    throw new Error('Gemini API key not configured. Set GEMINI_API_KEY or configure in Admin > LLM > Providers.');
  }
  const built = sharedProviderClientFactory.getClient({
    providerId: 'gemini',
    credentialId: cred.credentialId,
    credentialVersion: cred.credentialVersion,
    apiKey: cred.apiKey,
    apiBase: null,
  });
  if (built.kind !== 'google-genai') {
    throw new Error('ProviderClientFactory returned a non-GoogleGenAI client for gemini');
  }
  return built.client;
}

// ============ Model Detection ============

/**
 * Check if a model ID belongs to Gemini (Route 2 direct).
 * Matches: gemini/, gemini- prefixes.
 */
export function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini/') || model.startsWith('gemini-');
}

/**
 * Strip provider prefix for SDK calls.
 * "gemini/gemini-2.5-flash" → "gemini-2.5-flash"
 * "gemini-2.5-flash" → "gemini-2.5-flash" (already clean)
 */
export function stripGeminiPrefix(model: string): string {
  if (model.startsWith('gemini/')) return model.slice('gemini/'.length);
  return model;
}

// ============ Message Format Translation ============

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name: string; args: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/**
 * Convert OpenAI-format messages to Gemini contents array.
 * System messages are extracted and returned separately for systemInstruction config.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertMessagesToGemini(messages: any[]): { systemInstruction?: string; contents: GeminiContent[] } {
  let systemInstruction: string | undefined;
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    const role = msg.role;

    if (role === 'system') {
      const content = typeof msg.content === 'string' ? msg.content : '';
      systemInstruction = systemInstruction
        ? `${systemInstruction}\n\n${content}`
        : content;
      continue;
    }

    if (role === 'user') {
      const parts = buildUserParts(msg.content);
      contents.push({ role: 'user', parts });
      continue;
    }

    if (role === 'assistant') {
      const parts: GeminiPart[] = [];

      if (msg.content && typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      }

      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let args: Record<string, unknown> = {};
          if (tc.function?.arguments) {
            try {
              args = typeof tc.function.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function.arguments;
            } catch {
              args = {};
            }
          }
          parts.push({
            functionCall: {
              id: tc.id,
              name: tc.function?.name || '',
              args,
            },
          });
        }
      }

      contents.push({ role: 'model', parts });
      continue;
    }

    if (role === 'tool') {
      let responseData: Record<string, unknown> = {};
      try {
        responseData = typeof msg.content === 'string'
          ? JSON.parse(msg.content)
          : msg.content;
      } catch {
        responseData = { content: msg.content };
      }

      // Derive function name from stored metadata or tool_call_id convention
      const functionName = msg._geminiFunctionName
        || msg.name
        || extractFunctionName(msg.tool_call_id);

      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            id: msg.tool_call_id,
            name: functionName,
            response: responseData,
          },
        }],
      });
      continue;
    }
  }

  return { systemInstruction, contents };
}

/**
 * Extract function name from a tool_call_id.
 * Falls back to "unknown" if derivation fails.
 */
function extractFunctionName(toolCallId?: string): string {
  if (!toolCallId) return 'unknown';
  const parts = toolCallId.split('_');
  if (parts.length > 2) {
    return parts.slice(2).join('_');
  }
  return 'unknown';
}

/**
 * Build Gemini parts from user message content.
 * Handles text, image (inlineData), and mixed content arrays.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildUserParts(content: string | any[]): GeminiPart[] {
  if (typeof content === 'string') {
    return [{ text: content }];
  }

  if (Array.isArray(content)) {
    const parts: GeminiPart[] = [];
    for (const item of content) {
      if (item.type === 'text') {
        parts.push({ text: item.text });
      } else if (item.type === 'image_url' && item.image_url?.url) {
        const url = item.image_url.url as string;
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            },
          });
        }
      }
    }
    return parts;
  }

  return [{ text: String(content) }];
}

/**
 * Convert OpenAI tool definitions to Gemini function declarations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertToolsToGemini(tools: any[] | undefined): any[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  const functionDeclarations: any[] = [];
  for (const tool of tools) {
    if (tool.type === 'function' && tool.function) {
      functionDeclarations.push({
        name: tool.function.name,
        description: tool.function.description || '',
        parameters: tool.function.parameters,
      });
    }
  }

  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined;
}

/**
 * Convert OpenAI tool_choice to Gemini toolConfig.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertToolChoiceToGemini(toolChoice: any): any | undefined {
  if (!toolChoice) return undefined;

  if (toolChoice === 'auto') {
    return { functionCallingConfig: { mode: 'AUTO' } };
  }
  if (toolChoice === 'required') {
    return { functionCallingConfig: { mode: 'ANY' } };
  }
  if (typeof toolChoice === 'object' && toolChoice.function?.name) {
    return {
      functionCallingConfig: {
        mode: 'ANY',
        allowedFunctionNames: [toolChoice.function.name],
      },
    };
  }

  return undefined;
}

// ============ Non-Streaming Chat ============

export interface GeminiChatResult {
  content: string;
  totalTokens: number;
}

/**
 * Non-streaming chat completion via Gemini SDK.
 * Used by: llm-client.ts (internal services), llm-utils.ts (callLLMForJson)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function callGeminiChat(
  model: string,
  messages: any[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    responseSchema?: object;
    systemPrompt?: string;
    /** Thinking config for Gemini 2.5 reasoning models. thinkingBudget: -1 = auto. */
    thinkingConfig?: { thinkingBudget?: number; thinkingLevel?: string };
  },
): Promise<GeminiChatResult> {
  const client = await getGeminiClient();
  const cleanModel = stripGeminiPrefix(model);

  const { systemInstruction, contents } = convertMessagesToGemini(messages);
  const effectiveSystemInstruction = options?.systemPrompt || systemInstruction;

  const config: Record<string, unknown> = {
    maxOutputTokens: options?.maxTokens ?? 4096,
  };

  if (options?.temperature !== undefined) {
    config.temperature = options.temperature;
  }

  if (options?.responseSchema) {
    config.responseSchema = options.responseSchema;
  }

  // Gemini 2.5 thinking models: enable thinking with auto budget.
  if (options?.thinkingConfig) {
    config.thinkingConfig = options.thinkingConfig;
  }

  const response = await client.models.generateContent({
    model: cleanModel,
    contents,
    config: {
      ...config,
      ...(effectiveSystemInstruction ? { systemInstruction: { parts: [{ text: effectiveSystemInstruction }] } } : {}),
    } as any,
  });

  const text = response.text || '';
  const totalTokens = response.usageMetadata?.totalTokenCount || 0;

  return { content: text, totalTokens };
}

// ============ Streaming Chat ============

const FIRST_CHUNK_TIMEOUT_MS = 120_000;

export interface GeminiStreamResult {
  content: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool_calls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] | undefined;
  thinkingContent: string | null;
  totalTokens: number;
}

/**
 * Streaming chat completion via Gemini SDK.
 * Returns the same shape as streamOneCompletion() for compatibility
 * with the generateResponseWithTools() tool call loop.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function streamGeminiCompletion(
  model: string,
  messages: any[],
  options?: {
    temperature?: number;
    maxTokens?: number;
    tools?: any[];
    toolChoice?: any;
    systemPrompt?: string;
    thinkingConfig?: { thinkingBudget?: number; thinkingLevel?: string };
    responseSchema?: object;
    onChunk?: (text: string) => void;
    onThinkingChunk?: (text: string) => void;
    interChunkTimeoutMsOverride?: number;
    firstChunkTimeoutMsOverride?: number;
  },
): Promise<GeminiStreamResult> {
  const client = await getGeminiClient();
  const cleanModel = stripGeminiPrefix(model);

  const { systemInstruction, contents } = convertMessagesToGemini(messages);
  const effectiveSystemInstruction = options?.systemPrompt || systemInstruction;

  const geminiTools = convertToolsToGemini(options?.tools);
  const geminiToolConfig = convertToolChoiceToGemini(options?.toolChoice);

  // Import streaming config lazily to avoid circular deps
  const { getStreamingConfigMs } = await import('@/lib/streaming/utils');
  const streamingConfig = await getStreamingConfigMs();
  const interChunkTimeoutMs = options?.interChunkTimeoutMsOverride ?? streamingConfig.TOOL_TIMEOUT_MS;
  const firstChunkTimeoutMs = options?.firstChunkTimeoutMsOverride ?? FIRST_CHUNK_TIMEOUT_MS;

  let wasAborted = false;

  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    console.warn(`[Gemini] Streaming timed out waiting for first chunk`, { model: cleanModel });
    wasAborted = true;
  }, firstChunkTimeoutMs);

  const resetTimeout = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      console.warn(`[Gemini] Streaming timed out between chunks`, { model: cleanModel });
      wasAborted = true;
    }, interChunkTimeoutMs);
  };

  let content = '';
  let thinkingContent = '';
  let streamTotalTokens = 0;
  const toolCallMap = new Map<number, { id: string; name: string; arguments: string }>();

  // Build generation config
  const config: Record<string, unknown> = {
    ...(options?.temperature !== undefined && { temperature: options.temperature }),
    maxOutputTokens: options?.maxTokens ?? 4096,
  };

  if (effectiveSystemInstruction) {
    config.systemInstruction = { parts: [{ text: effectiveSystemInstruction }] } as any;
  }

  if (options?.thinkingConfig) {
    config.thinkingConfig = options.thinkingConfig;
  }

  if (options?.responseSchema) {
    config.responseSchema = options.responseSchema;
  }

  try {
    const stream = await client.models.generateContentStream({
      model: cleanModel,
      contents,
      config: {
        ...config,
        ...(geminiTools ? { tools: geminiTools } : {}),
        ...(geminiToolConfig ? { toolConfig: geminiToolConfig } : {}),
      } as any,
    });

    for await (const chunk of stream) {
      resetTimeout();

      if (chunk.usageMetadata?.totalTokenCount) {
        streamTotalTokens = chunk.usageMetadata.totalTokenCount;
      }

      const candidates = chunk.candidates;
      if (!candidates || candidates.length === 0) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const candidate of candidates as any[]) {
        const parts = candidate.content?.parts;
        if (!parts) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const part of parts as any[]) {
          if (part.text) {
            content += part.text;
            options?.onChunk?.(part.text);
          }

          if (part.thought) {
            const thoughtText = typeof part.thought === 'string' ? part.thought : '';
            if (thoughtText) {
              thinkingContent += thoughtText;
              options?.onThinkingChunk?.(thoughtText);
            }
          }

          if (part.functionCall) {
            const fc = part.functionCall;
            const idx = toolCallMap.size;
            toolCallMap.set(idx, {
              id: fc.id || `call_${idx}`,
              name: fc.name || '',
              arguments: fc.args ? JSON.stringify(fc.args) : '{}',
            });
          }
        }
      }
    }

    if (wasAborted) {
      throw new Error(
        `Gemini streaming timeout (model: ${cleanModel}). The model may be unresponsive.`
      );
    }
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
      throw new Error(
        `Gemini streaming timeout (model: ${cleanModel}). The model may be unresponsive.`
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
 * Create embeddings directly via Gemini SDK.
 * Returns 768-dimensional vectors.
 *
 * IMPORTANT: Gemini embeddings (768d) are incompatible with existing
 * Qdrant collections (3072d). Use dimension-suffixed collections
 * (policy_{slug}_768) or keep OpenAI as primary embedding provider.
 */
export async function createGeminiEmbedding(text: string): Promise<number[]> {
  const client = await getGeminiClient();

  const response = await client.models.embedContent({
    model: 'text-embedding-004',
    contents: [{ parts: [{ text }] }],
  });

  return response.embeddings?.[0]?.values ?? [];
}

export async function createGeminiEmbeddings(texts: string[]): Promise<number[][]> {
  const client = await getGeminiClient();

  const response = await client.models.embedContent({
    model: 'text-embedding-004',
    contents: texts.map(text => ({ parts: [{ text }] })),
  });

  return (response.embeddings?.map(e => e.values ?? []).filter(v => v.length > 0) ?? []);
}

/**
 * Check if an embedding model ID belongs to Gemini.
 */
export function isGeminiEmbeddingModel(model: string): boolean {
  return model === 'text-embedding-004'
    || model === 'gemini-embedding'
    || (model.startsWith('gemini') && model.includes('embed'));
}
