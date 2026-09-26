/**
 * Stateless OpenAI Responses adapter. No credentials, DB, or network globals.
 *
 * SDK callers pass their existing client to callOpenAIResponses or
 * streamOpenAIResponses. Both return chat-shaped content/tool_calls plus native
 * continuation state. Before appending an assistant turn, use:
 *   copyOpenAIResponsesState(result, { role: 'assistant', content, tool_calls })
 * Copy state through intermediate result wrappers too. Object spread preserves
 * the symbol; JSON serialization intentionally does not. Keep it in the active
 * server-side loop, never in UI text or persisted conversation JSON. Native
 * output replaces (not supplements) that assistant turn when replayed, preserving
 * encrypted reasoning, message phase, output-item IDs, and function call IDs.
 *
 * Requests use store:false and include reasoning.encrypted_content. They never
 * retry, including SDK retries, and never downgrade mandatory reasoning. An
 * incomplete/error/interrupted turn throws and must not execute partial tools.
 */
import type OpenAI from 'openai';
import type { ReasoningEffort } from 'openai/resources/shared';
import type {
  Response,
  ResponseCreateParamsBase,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputContent,
  ResponseOutputMessage,
  ResponseReasoningItem,
  ResponseStreamEvent,
  ResponseUsage,
} from 'openai/resources/responses/responses';
import { getModelCompatibility, normalizeModelId, type ModelReasoningEffort } from '../../model-compatibility';
import { guardFallbackAfterOutput } from '../../llm-fallback-policy';

type ReplayItem = ResponseOutputMessage | ResponseFunctionToolCall | ResponseReasoningItem;
const RESPONSES_STATE: unique symbol = Symbol('openai.responses.continuation');

export interface OpenAIResponsesStateCarrier {
  /** Opaque, server-local state; transfer using copyOpenAIResponsesState. */
  [RESPONSES_STATE]?: { readonly output: readonly ReplayItem[] };
}

export function getOpenAIResponsesOutput(source: object): readonly ReplayItem[] | undefined {
  return (source as OpenAIResponsesStateCarrier)[RESPONSES_STATE]?.output;
}

export function copyOpenAIResponsesState<T extends object>(
  source: OpenAIResponsesStateCarrier,
  target: T,
): T & OpenAIResponsesStateCarrier {
  return Object.assign(target, source[RESPONSES_STATE] ? { [RESPONSES_STATE]: source[RESPONSES_STATE] } : {});
}

/** Structural input accepts SDK chat messages and existing application messages. */
export interface OpenAIResponsesMessage extends OpenAIResponsesStateCarrier {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
  refusal?: string | null;
}

export interface OpenAIResponsesOptions {
  tools?: readonly unknown[];
  toolChoice?: unknown;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  systemPrompt?: string;
  responseSchema?: object;
  responseFormat?: { type: 'json_object' | 'text' } | {
    type: 'json_schema'; json_schema: { name: string; schema: object; strict?: boolean };
  };
  signal?: AbortSignal;
  firstChunkTimeoutMsOverride?: number;
  interChunkTimeoutMsOverride?: number;
  onChunk?: (text: string) => void;
  onThinkingChunk?: (text: string) => void;
}

export interface OpenAIResponsesResult extends OpenAIResponsesStateCarrier {
  content: string | null;
  tool_calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] | undefined;
  thinkingContent: string | null;
  refusal: string | null;
  totalTokens: number;
  usage: ResponseUsage | null;
  responseId: string;
}

/** Minimal injectable SDK surface; real OpenAI clients satisfy this interface. */
export interface OpenAIResponsesClient {
  responses: {
    create(body: ResponseCreateParamsNonStreaming, options?: { signal?: AbortSignal; maxRetries?: number }): PromiseLike<Response>;
    create(body: ResponseCreateParamsStreaming, options?: { signal?: AbortSignal; maxRetries?: number }): PromiseLike<AsyncIterable<ResponseStreamEvent>>;
  };
}

export class OpenAIResponsesError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly outputStarted = false,
    public readonly usage: ResponseUsage | null = null,
  ) {
    super(message);
    this.name = code === 'aborted' ? 'AbortError' : 'OpenAIResponsesError';
  }
}

/** Route every tool/history turn, even when tools are disabled on the final turn. */
export function shouldUseOpenAIResponses(
  model: string,
  messages: readonly OpenAIResponsesMessage[],
  options?: Pick<OpenAIResponsesOptions, 'tools' | 'toolChoice'>,
): boolean {
  return getModelCompatibility(model)?.toolEndpoint === 'responses'
    && (!!options?.tools?.length || options?.toolChoice !== undefined
      || messages.some(message => message.role === 'tool' || message.role === 'function'
        || !!message.tool_calls || !!message[RESPONSES_STATE]));
}

function record(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid ${description}`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, description: string): string {
  if (typeof value !== 'string') throw new TypeError(`Invalid ${description}`);
  return value;
}

function messageContent(content: unknown): string | ResponseInputContent[] {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) throw new TypeError('Unsupported message content');
  return content.map((part: unknown): ResponseInputContent => {
    const item = record(part, 'content part');
    if (item.type === 'text' || item.type === 'input_text') {
      return { type: 'input_text', text: text(item.text, 'text content') };
    }
    if (item.type === 'image_url') {
      const image = record(item.image_url, 'image_url');
      const detail = image.detail ?? 'auto';
      if (detail !== 'auto' && detail !== 'low' && detail !== 'high') throw new TypeError('Invalid image detail');
      return { type: 'input_image', image_url: text(image.url, 'image URL'), detail };
    }
    throw new TypeError(`Unsupported message content part: ${String(item.type)}`);
  });
}

export function toOpenAIResponsesInput(
  messages: readonly OpenAIResponsesMessage[],
  systemPrompt?: string,
): ResponseInput {
  const input: ResponseInput = [];
  if (systemPrompt) input.push({ role: 'system', content: systemPrompt });
  for (const message of messages) {
    if (systemPrompt && message.role === 'system') continue;
    if (message.role === 'assistant' && message[RESPONSES_STATE]) {
      input.push(...message[RESPONSES_STATE].output);
      continue;
    }
    if (message.role === 'tool' || message.role === 'function') {
      if (!message.tool_call_id) throw new TypeError('Tool result requires tool_call_id (the native call_id, not item id)');
      input.push({ type: 'function_call_output', call_id: message.tool_call_id, output: messageContent(message.content) });
      continue;
    }
    if (message.role !== 'system' && message.role !== 'developer' && message.role !== 'user' && message.role !== 'assistant') {
      throw new TypeError(`Unsupported message role: ${message.role}`);
    }
    const content = messageContent(message.content);
    if (content.length || message.role !== 'assistant') input.push({ role: message.role, content });
    if (message.refusal) input.push({ role: 'assistant', content: message.refusal });
    if (message.tool_calls != null) {
      if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) throw new TypeError('Invalid assistant tool_calls');
      for (const rawCall of message.tool_calls) {
        const call = record(rawCall, 'tool call');
        if (call.type !== 'function') throw new TypeError('Only function tools are supported');
        const fn = record(call.function, 'tool function');
        input.push({ type: 'function_call', call_id: text(call.id, 'tool call id'),
          name: text(fn.name, 'function name'), arguments: text(fn.arguments, 'function arguments') });
      }
    }
  }
  return input;
}

/** Resolve policy without allowing "none" (or an invalid effort) on Astra. */
export function openAIReasoningEffort(model: string, requested?: string): string | undefined {
  const policy = getModelCompatibility(model);
  if (!policy) return requested;
  if (requested && policy.allowedEfforts.includes(requested as ModelReasoningEffort)) return requested;
  return policy.alwaysThinking || requested !== undefined ? policy.defaultEffort : undefined;
}

export function buildOpenAIResponsesRequest(
  model: string,
  messages: readonly OpenAIResponsesMessage[],
  options: OpenAIResponsesOptions = {},
): ResponseCreateParamsBase {
  const policy = getModelCompatibility(model);
  const effort = openAIReasoningEffort(model, options.reasoningEffort);
  const params: ResponseCreateParamsBase = {
    model: policy ? normalizeModelId(model) : model.replace(/^openai\//, ''),
    input: toOpenAIResponsesInput(messages, options.systemPrompt),
    store: false,
    include: ['reasoning.encrypted_content'],
    max_output_tokens: options.maxTokens ?? 4096,
    // SDK 6.25 predates GPT-6's policy-approved "max" effort. Only this literal
    // union is widened at the SDK boundary; the wire value is not downgraded.
    ...(effort && { reasoning: { effort: effort as ReasoningEffort } }),
    ...(!policy?.omitSampling && options.temperature !== undefined && { temperature: options.temperature }),
    ...(!policy?.omitSampling && options.topP !== undefined && { top_p: options.topP }),
  };
  if (options.tools?.length) {
    params.tools = options.tools.map(rawTool => {
      const tool = record(rawTool, 'tool');
      if (tool.type !== 'function') throw new TypeError('Only function tools are supported');
      const fn = record(tool.function, 'tool function');
      if (fn.strict !== undefined && typeof fn.strict !== 'boolean') throw new TypeError('Invalid tool strict setting');
      return { type: 'function', name: text(fn.name, 'tool name'),
        ...(fn.description !== undefined && { description: text(fn.description, 'tool description') }),
        parameters: fn.parameters == null ? null : record(fn.parameters, 'tool parameters'),
        // Chat defaults to non-strict; Responses defaults to strict. Preserve chat semantics.
        strict: fn.strict ?? false };
    });
  }
  if (options.toolChoice !== undefined) {
    if (options.toolChoice === 'auto' || options.toolChoice === 'none' || options.toolChoice === 'required') {
      params.tool_choice = options.toolChoice;
    } else {
      const choice = record(options.toolChoice, 'tool choice');
      if (choice.type !== 'function') throw new TypeError('Only function tool choices are supported');
      params.tool_choice = { type: 'function', name: text(record(choice.function, 'tool choice function').name, 'tool choice name') };
    }
  }
  const format = options.responseFormat;
  if (format?.type === 'json_schema') {
    params.text = { format: { type: 'json_schema', name: format.json_schema.name,
      schema: record(format.json_schema.schema, 'response schema'), strict: format.json_schema.strict ?? false } };
  } else if (format) {
    params.text = { format };
  } else if (options.responseSchema) {
    params.text = { format: { type: 'json_schema', name: 'response', schema: record(options.responseSchema, 'response schema'), strict: true } };
  }
  return params;
}

function completedResult(response: Response, outputStarted: boolean): OpenAIResponsesResult {
  if (response.error || response.status !== 'completed') {
    const reason = response.error?.message ?? response.incomplete_details?.reason ?? response.status ?? 'missing status';
    throw new OpenAIResponsesError(`OpenAI response ${response.status}: ${reason}`,
      response.error?.code ?? response.incomplete_details?.reason ?? response.status ?? 'invalid_response', outputStarted, response.usage ?? null);
  }
  const output: ReplayItem[] = [];
  const calls: NonNullable<OpenAIResponsesResult['tool_calls']> = [];
  let content = '';
  let thinking = '';
  let refusal = '';
  for (const item of response.output) {
    if ('status' in item && item.status && item.status !== 'completed') {
      throw new OpenAIResponsesError('OpenAI returned an incomplete output item', 'incomplete_output', outputStarted, response.usage ?? null);
    }
    switch (item.type) {
      case 'message':
        for (const part of item.content) {
          if (part.type === 'output_text') content += part.text;
          else if (part.type === 'refusal') { content += part.refusal; refusal += part.refusal; }
        }
        output.push(item);
        break;
      case 'function_call':
        if (!item.call_id || !item.name) throw new OpenAIResponsesError('Missing function call ID/name', 'invalid_tool_call', outputStarted);
        // Validate the entire batch before exposing any executable call. A valid
        // first call must not execute before a later truncated call is noticed.
        try {
          const args: unknown = JSON.parse(item.arguments);
          if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Expected an object');
        } catch {
          throw new OpenAIResponsesError('Invalid function call arguments', 'invalid_tool_call', outputStarted);
        }
        calls.push({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } });
        output.push(item);
        break;
      case 'reasoning':
        thinking += item.summary.map(part => part.text).join('');
        output.push(item);
        break;
      default:
        throw new OpenAIResponsesError(`Unsupported native output item: ${item.type}`, 'unsupported_output', outputStarted);
    }
  }
  return { content: content || null, tool_calls: !refusal && calls.length ? calls : undefined,
    thinkingContent: thinking || null, refusal: refusal || null,
    totalTokens: response.usage?.total_tokens ?? 0, usage: response.usage ?? null,
    responseId: response.id, [RESPONSES_STATE]: { output: refusal ? output.filter(item => item.type !== 'function_call') : output } };
}

/** Race pending SDK work as well as abort its fetch; mocks/blocked iterators need not cooperate. */
async function withAbort<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The caller may already have started iterator.next()/create(). Observe any
    // rejection even though cancellation wins, avoiding unhandled rejections.
    void Promise.resolve(work).catch(() => {});
    throw signal.reason;
  }
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work, interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}

async function executeResponses(
  client: OpenAIResponsesClient,
  model: string,
  messages: readonly OpenAIResponsesMessage[],
  options: OpenAIResponsesOptions,
  streaming: boolean,
): Promise<OpenAIResponsesResult> {
  const params = buildOpenAIResponsesRequest(model, messages, options);
  const controller = new AbortController();
  let outputStarted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => controller.abort(new OpenAIResponsesError('OpenAI Responses request aborted', 'aborted', outputStarted));
  const armTimeout = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new OpenAIResponsesError('OpenAI Responses timeout', 'timeout', outputStarted)), ms);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let iterator: AsyncIterator<ResponseStreamEvent> | undefined;
  try {
    controller.signal.throwIfAborted();
    armTimeout(options.firstChunkTimeoutMsOverride ?? 120_000);
    const requestOptions = { signal: controller.signal, maxRetries: 0 };
    if (!streaming) {
      const response = await withAbort(client.responses.create({ ...params, stream: false }, requestOptions), controller.signal);
      return completedResult(response, false);
    }
    const stream = await withAbort(client.responses.create({ ...params, stream: true }, requestOptions), controller.signal);
    iterator = stream[Symbol.asyncIterator]();
    let sawText = false;
    let sawThinking = false;
    while (true) {
      const next = await withAbort(iterator.next(), controller.signal);
      if (next.done) throw new OpenAIResponsesError('OpenAI Responses stream ended without a terminal response', 'interrupted', outputStarted);
      armTimeout(options.interChunkTimeoutMsOverride ?? 120_000);
      const event = next.value;
      switch (event.type) {
        case 'response.output_text.delta':
        case 'response.refusal.delta':
          outputStarted = true;
          sawText = true;
          options.onChunk?.(event.delta);
          break;
        case 'response.reasoning_summary_text.delta':
          outputStarted = true;
          sawThinking = true;
          options.onThinkingChunk?.(event.delta);
          break;
        case 'response.output_item.added':
        case 'response.output_item.done':
        case 'response.function_call_arguments.delta':
          outputStarted = true;
          break;
        case 'error':
          throw new OpenAIResponsesError(event.message, event.code ?? 'stream_error', outputStarted);
        case 'response.failed':
        case 'response.incomplete':
          throw new OpenAIResponsesError(`OpenAI ${event.type}: ${event.response.error?.message ?? event.response.incomplete_details?.reason ?? 'unknown error'}`,
            event.response.error?.code ?? event.response.incomplete_details?.reason ?? event.type, outputStarted, event.response.usage ?? null);
        case 'response.completed': {
          const result = completedResult(event.response, outputStarted);
          if (!sawText && result.content) options.onChunk?.(result.content);
          if (!sawThinking && result.thinkingContent) options.onThinkingChunk?.(result.thinkingContent);
          controller.signal.throwIfAborted();
          return result;
        }
      }
    }
  } catch (error) {
    // SDK iterator/network/callback errors do not carry our replay-safety flag.
    // Preserve typed adapter errors (including usage) and guard all other errors.
    if (error instanceof OpenAIResponsesError) throw error;
    throw guardFallbackAfterOutput(error, outputStarted);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    // Stop the underlying HTTP stream on terminal events, errors and callback failures.
    controller.abort();
    // Never await an uncooperative iterator's return while next() is pending.
    if (iterator?.return) void Promise.resolve(iterator.return()).catch(() => {});
  }
}

export function callOpenAIResponses(
  client: OpenAIResponsesClient,
  model: string,
  messages: readonly OpenAIResponsesMessage[],
  options: OpenAIResponsesOptions = {},
): Promise<OpenAIResponsesResult> {
  return executeResponses(client, model, messages, options, false);
}

export function streamOpenAIResponses(
  client: OpenAIResponsesClient,
  model: string,
  messages: readonly OpenAIResponsesMessage[],
  options: OpenAIResponsesOptions = {},
): Promise<OpenAIResponsesResult> {
  return executeResponses(client, model, messages, options, true);
}
