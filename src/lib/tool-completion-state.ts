/**
 * Pure handoff for completion wrappers and delegated agent loops. Copy at EVERY
 * result wrapper and assistant append, before the next provider request. Never
 * project messages down to role/content: tool IDs and opaque state are required.
 * JSON/history compaction is a deliberate boundary, not a state-copy operation;
 * rebuild a tool-free history there rather than reattaching state to summaries.
 */
import { copyAnthropicNativeState, type AnthropicNativeStateCarrier } from './anthropic-native-state';
import { copyOpenAIResponsesState, type OpenAIResponsesStateCarrier } from './llm/providers/openai-responses';

export type ToolCompletionStateCarrier = AnthropicNativeStateCarrier & OpenAIResponsesStateCarrier;

export function copyToolCompletionState<T extends object>(source: object, target: T): T & ToolCompletionStateCarrier {
  return copyAnthropicNativeState(source, copyOpenAIResponsesState(source as OpenAIResponsesStateCarrier, target));
}
