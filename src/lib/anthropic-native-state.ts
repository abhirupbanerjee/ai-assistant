/**
 * Pure Claude adapter helpers. Handoff for llm-client/agent-router/subagent owners:
 * - Enforce applyAnthropicRequestPolicy at the last SDK boundary.
 * - Only anthropicCompletionFromFinalMessage may capture native state: pass the
 *   SDK finalMessage, never streamed deltas or reconstructed thinking text.
 * - copyAnthropicNativeState(result, wrapper), then copy again onto the appended
 *   assistant message. convertOpenAIMessagesToAnthropic replays the complete
 *   content verbatim, including signatures/redacted blocks and block ordering.
 * - State is server-local (a symbol, not JSON). Never persist/log it or expose it
 *   as UI text. Display thinkingContent is NOT replayable native reasoning.
 * - Active mandatory-thinking tool history without state fails closed. On history
 *   rebuild/trim, explicitly choose boundary:'rebuild': drop ALL old tool turns
 *   and native reasoning as a unit, retaining only ordinary text/image history.
 *   Do not copy state onto edited/summarized assistant turns. Do not retry a
 *   refusal with another model, a prefill, or weakened thinking parameters.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { getModelCompatibility, normalizeModelId } from './model-compatibility';

const ANTHROPIC_STATE: unique symbol = Symbol('anthropic.native.content');
export interface AnthropicNativeStateCarrier {
  [ANTHROPIC_STATE]?: { readonly model: string; readonly content: Anthropic.ContentBlock[] };
}

export function copyAnthropicNativeState<T extends object>(source: object, target: T): T & AnthropicNativeStateCarrier {
  const state = (source as AnthropicNativeStateCarrier)[ANTHROPIC_STATE];
  return Object.assign(target, state ? { [ANTHROPIC_STATE]: state } : {});
}

export function getAnthropicNativeContent(source: object, model?: string): Anthropic.ContentBlock[] | undefined {
  const state = (source as AnthropicNativeStateCarrier)[ANTHROPIC_STATE];
  if (state && model && state.model !== normalizeModelId(model)) {
    throw new Error('Claude native state belongs to a different model; rebuild history before switching models');
  }
  // A defensive copy prevents SDK/caller mutations from corrupting the snapshot.
  return state ? structuredClone(state.content) : undefined;
}

export function isMandatoryClaudeThinking(model: string): boolean {
  const policy = getModelCompatibility(model);
  return policy?.reasoningMode === 'adaptive' && policy.alwaysThinking;
}

export type OpenAIToolChoice = 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };

export function convertToolChoiceToAnthropic(choice?: OpenAIToolChoice): Anthropic.ToolChoice {
  if (choice === 'none') return { type: 'none' };
  if (choice === 'required') return { type: 'any' };
  if (typeof choice === 'object') return { type: 'tool', name: choice.function.name };
  return { type: 'auto' };
}

/** Exact compatibility overrides win over DB capability flags and caller params. */
export function applyAnthropicRequestPolicy<T extends {
  model: string; messages: Anthropic.MessageParam[]; temperature?: number;
  top_p?: number; top_k?: number; thinking?: Anthropic.ThinkingConfigParam;
  output_config?: Anthropic.OutputConfig; tool_choice?: Anthropic.ToolChoice;
}>(params: T): T {
  const policy = getModelCompatibility(params.model);
  if (policy?.reasoningMode !== 'adaptive') return params;
  const result = { ...params };
  if (!policy.supportsPrefill && result.messages.at(-1)?.role === 'assistant') {
    throw new Error('This Claude model does not support assistant prefills; end the request with a user/tool-result turn');
  }
  if (policy.omitSampling) {
    delete result.temperature;
    delete result.top_p;
    delete result.top_k;
  }
  if (policy.alwaysThinking) {
    result.thinking = params.thinking?.type === 'adaptive' ? { ...params.thinking } : { type: 'adaptive' };
    const effort = result.output_config?.effort;
    result.output_config = { ...result.output_config,
      effort: (effort && policy.allowedEfforts.includes(effort) ? effort : policy.defaultEffort) as Anthropic.OutputConfig['effort'] };
  }
  if (!policy.supportsForcedToolChoice && (result.tool_choice?.type === 'any' || result.tool_choice?.type === 'tool')) {
    result.tool_choice = { type: 'auto' };
  }
  return result;
}

export const ANTHROPIC_REFUSAL_MESSAGE = 'Claude declined to respond to this request.';

/** Never produce executable tools/native replay from a partial or unsigned turn. */
export function anthropicCompletionFromFinalMessage(message: Anthropic.Message, model: string) {
  if (!message.stop_reason || message.stop_reason === 'max_tokens' || message.stop_reason === 'pause_turn') {
    throw new Error(`Incomplete Claude response (${message.stop_reason ?? 'missing stop reason'}); native state cannot be replayed`);
  }
  for (const block of message.content) {
    if (block.type === 'thinking' && !block.signature) {
      throw new Error('Incomplete Claude thinking block: missing native signature');
    }
  }
  const refused = message.stop_reason === 'refusal';
  const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = [];
  if (!refused) {
    for (const block of message.content) {
      if (block.type === 'tool_use') calls.push({ id: block.id, type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input) } });
    }
  }
  return {
    content: text || (refused ? ANTHROPIC_REFUSAL_MESSAGE : null),
    tool_calls: calls.length ? calls : undefined,
    thinkingContent: message.content.filter(b => b.type === 'thinking').map(b => b.thinking).join('') || null,
    stopReason: message.stop_reason,
    totalTokens: (message.usage.input_tokens ?? 0) + (message.usage.output_tokens ?? 0),
    [ANTHROPIC_STATE]: { model: normalizeModelId(model), content: structuredClone(
      refused ? message.content.filter(block => block.type !== 'tool_use') : message.content,
    ) },
  };
}

/** Every raw event, including thinking/signature-only deltas, is stream activity. */
export function handleAnthropicStreamEvent(
  event: Anthropic.RawMessageStreamEvent,
  onActivity: () => void,
  onThinkingChunk?: (text: string) => void,
): void {
  onActivity();
  if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
    onThinkingChunk?.(event.delta.thinking);
  }
}

export interface AnthropicConvertibleMessage extends AnthropicNativeStateCarrier {
  role: string;
  content?: unknown;
  tool_calls?: unknown;
  tool_call_id?: string;
}

function contentParts(content: unknown): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  if (content == null) return [];
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) throw new TypeError('Unsupported Claude message content');
  return content.map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text };
    if (part.type === 'image_url') {
      const url = part.image_url?.url;
      if (typeof url !== 'string') throw new TypeError('Invalid image URL');
      const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([\s\S]+)$/.exec(url);
      if (match) return { type: 'image', source: { type: 'base64',
        media_type: match[1] as Anthropic.Base64ImageSource['media_type'], data: match[2] } };
      if (/^https?:\/\//.test(url)) return { type: 'image', source: { type: 'url', url } };
      throw new TypeError('Unsupported Claude image URL or media type');
    }
    throw new TypeError(`Unsupported Claude content part: ${String(part.type)}`);
  });
}

export function convertOpenAIMessagesToAnthropic(
  messages: readonly AnthropicConvertibleMessage[],
  options: { model?: string; boundary?: 'active' | 'rebuild' } = {},
): { system?: string; anthropicMessages: Anthropic.MessageParam[] } {
  const anthropicMessages: Anthropic.MessageParam[] = [];
  const system: string[] = [];
  const rebuild = options.boundary === 'rebuild';
  const pendingTools = new Set<string>();
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') {
      system.push(contentParts(message.content).map(p => p.type === 'text' ? p.text : '').join(''));
      continue;
    }
    if (rebuild && (message.role === 'tool' || (message.role === 'assistant' && message.tool_calls))) continue;
    if (message.role !== 'tool' && pendingTools.size) {
      throw new Error('Incomplete Claude tool exchange; rebuild trimmed history before continuing');
    }
    if (message.role === 'assistant') {
      const native = !rebuild ? getAnthropicNativeContent(message, options.model) : undefined;
      if (native) {
        for (const block of native) if (block.type === 'tool_use') pendingTools.add(block.id);
        anthropicMessages.push({ role: 'assistant', content: native });
        continue;
      }
      if (message.tool_calls && options.model && isMandatoryClaudeThinking(options.model)) {
        throw new Error('Missing Claude native state for active tool history; explicitly rebuild history instead of replaying partial reasoning');
      }
      const blocks: Anthropic.ContentBlockParam[] = contentParts(message.content);
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          if (call.type !== 'function') throw new TypeError('Unsupported Claude tool call');
          pendingTools.add(call.id);
          blocks.push({ type: 'tool_use', id: call.id, name: call.function.name,
            input: JSON.parse(call.function.arguments || '{}') });
        }
      }
      if (blocks.length) anthropicMessages.push({ role: 'assistant', content: blocks });
    } else if (message.role === 'tool') {
      if (!message.tool_call_id) throw new TypeError('Missing tool result ID');
      if (!pendingTools.delete(message.tool_call_id)) {
        throw new Error('Orphaned Claude tool result; rebuild trimmed history before continuing');
      }
      const block: Anthropic.ToolResultBlockParam = { type: 'tool_result', tool_use_id: message.tool_call_id,
        content: contentParts(message.content) };
      const previous = anthropicMessages.at(-1);
      if (previous?.role === 'user' && Array.isArray(previous.content) && previous.content.every(p => p.type === 'tool_result')) {
        previous.content.push(block);
      } else anthropicMessages.push({ role: 'user', content: [block] });
    } else if (message.role === 'user') {
      anthropicMessages.push({ role: 'user', content: contentParts(message.content) });
    } else throw new TypeError(`Unsupported Claude message role: ${message.role}`);
  }
  if (pendingTools.size) throw new Error('Incomplete Claude tool exchange; missing tool results');
  return { system: system.length ? system.join('\n\n') : undefined, anthropicMessages };
}
