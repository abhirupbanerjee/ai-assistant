/**
 * Tool Adapter for Moonshot Agent Swarm
 *
 * Adapts Policy Bot's local tools to OpenAI function schema for Moonshot API.
 * Reuses existing tool definitions and execution logic.
 */

import type { OpenAI } from 'openai';
import { getToolDefinitions, getTool, type ToolDefinition } from '@/lib/tools';
import { getToolDisplayName } from '@/lib/streaming';

export interface AdaptedTool {
  definition: OpenAI.Chat.ChatCompletionTool;
  execute: (args: Record<string, unknown>) => Promise<string>;
  displayName: string;
}

/**
 * Get all enabled tools adapted for Moonshot function calling
 */
export async function getSwarmTools(categoryIds?: number[]): Promise<AdaptedTool[]> {
  const definitions = await getToolDefinitions(categoryIds);
  const adapted: AdaptedTool[] = [];

  for (const def of definitions) {
    const toolName = def.function.name;
    const tool = getTool(toolName);
    if (!tool) continue;

    adapted.push({
      definition: def as OpenAI.Chat.ChatCompletionTool,
      execute: async (args: Record<string, unknown>) => {
        try {
          return await tool.execute(args);
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Tool execution failed';
          return JSON.stringify({ error: msg });
        }
      },
      displayName: getToolDisplayName(toolName),
    });
  }

  return adapted;
}

/**
 * Execute a tool call from Moonshot's response
 */
export async function executeSwarmToolCall(
  toolCall: OpenAI.Chat.ChatCompletionMessageToolCall,
  categoryIds?: number[]
): Promise<{ toolCallId: string; name: string; displayName: string; result: string }> {
  const funcCall = toolCall as OpenAI.Chat.ChatCompletionMessageFunctionToolCall;
  const toolName = funcCall.function.name;
  const tool = getTool(toolName);

  if (!tool) {
    return {
      toolCallId: toolCall.id,
      name: toolName,
      displayName: getToolDisplayName(toolName),
      result: JSON.stringify({ error: `Tool ${toolName} not found` }),
    };
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(funcCall.function.arguments);
  } catch {
    return {
      toolCallId: toolCall.id,
      name: toolName,
      displayName: getToolDisplayName(toolName),
      result: JSON.stringify({ error: 'Invalid tool arguments JSON' }),
    };
  }

  try {
    const result = await tool.execute(args);
    return {
      toolCallId: toolCall.id,
      name: toolName,
      displayName: getToolDisplayName(toolName),
      result,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Tool execution failed';
    return {
      toolCallId: toolCall.id,
      name: toolName,
      displayName: getToolDisplayName(toolName),
      result: JSON.stringify({ error: msg }),
    };
  }
}
