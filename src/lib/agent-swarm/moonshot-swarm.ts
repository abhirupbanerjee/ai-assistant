/**
 * Moonshot Agent Swarm Execution Engine
 *
 * Uses kimi-k2.6's native multi-agent reasoning via streaming.
 * Parses reasoning_content for agent activity signals, handles tool calls
 * via local tool adapter, and orchestrates multi-turn execution.
 */

import type { OpenAI } from 'openai';
import { getApiKey } from '@/lib/provider-helpers';
import { getSwarmTools, executeSwarmToolCall } from './tool-adapter';
import type { StreamEvent } from '@/types/stream';

export interface SwarmExecutionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  categoryIds?: number[];
  maxIterations?: number;
}

export interface SwarmExecutionResult {
  content: string;
  reasoningContent: string;
  toolCalls: number;
  iterations: number;
  agentActivities: Array<{ agentName: string; activity: string; timestamp: number }>;
}

const DEFAULT_SYSTEM_PROMPT = `You are an expert problem-solving agent. When presented with a task, think step-by-step about the best approach. You have access to tools that can help you gather information and complete tasks.

When working on complex problems, clearly identify which "expert" or "agent" perspective you are adopting at each step. For example, you might think as a "Research Agent", "Code Agent", "Analysis Agent", etc.

Be thorough in your reasoning but concise in your final output. Always ground your responses in facts gathered from tools when available.`;

// Agent name detection patterns from reasoning_content
const AGENT_PATTERNS = [
  { pattern: /(?:作为|as\s+an?|acting\s+as)\s*["']?([^"'\n.:]{2,30})["']?/i, name: 1 },
  { pattern: /(?:research|调研|调查)\s*(?:agent|助手|agent)?/i, name: 'Research Agent' },
  { pattern: /(?:code|coding|编程|代码)\s*(?:agent|助手|agent)?/i, name: 'Code Agent' },
  { pattern: /(?:analysis|analyzing|分析)\s*(?:agent|助手|agent)?/i, name: 'Analysis Agent' },
  { pattern: /(?:planning|planner|计划|规划)\s*(?:agent|助手|agent)?/i, name: 'Planning Agent' },
  { pattern: /(?:verification|verifying|验证|检查)\s*(?:agent|助手|agent)?/i, name: 'Verification Agent' },
  { pattern: /(?:writing|writer|写作|撰写)\s*(?:agent|助手|agent)?/i, name: 'Writing Agent' },
];

function detectAgentActivity(reasoning: string): { agentName: string; activity: string } | null {
  // Look for explicit agent mentions
  for (const { pattern, name } of AGENT_PATTERNS) {
    const match = reasoning.match(pattern);
    if (match) {
      const agentName = typeof name === 'string' ? name : (match[name] || 'Unknown Agent');
      const activity = reasoning.slice(0, 120).trim();
      return { agentName, activity };
    }
  }

  // Fallback: if reasoning is substantial, report it as general thinking
  if (reasoning.length > 20) {
    return {
      agentName: 'Thinking',
      activity: reasoning.slice(0, 120).trim(),
    };
  }

  return null;
}

export async function executeSwarmWithStreaming(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  options: SwarmExecutionOptions = {},
  send: (event: StreamEvent) => void
): Promise<SwarmExecutionResult> {
  const {
    model = 'kimi-k2.6',
    maxTokens = 32768,
    temperature = 1.0,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    categoryIds,
    maxIterations = 10,
  } = options;

  const apiKey = await getApiKey('moonshot');
  if (!apiKey) {
    send({ type: 'swarm_status', phase: 'error', message: 'Moonshot API key not configured' });
    throw new Error('Moonshot API key not configured');
  }

  // Lazy import OpenAI to avoid issues
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, baseURL: 'https://api.moonshot.ai/v1' });

  const tools = await getSwarmTools(categoryIds);
  const toolDefinitions = tools.length > 0 ? tools.map(t => t.definition) : undefined;

  // Build conversation with system prompt
  const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  let finalContent = '';
  let finalReasoning = '';
  let totalToolCalls = 0;
  const agentActivities: Array<{ agentName: string; activity: string; timestamp: number }> = [];

  send({ type: 'swarm_status', phase: 'swarm_orchestrating', message: 'Coordinating agent swarm...' });

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const stream = await client.chat.completions.create({
      model,
      messages: conversation,
      max_tokens: maxTokens,
      temperature,
      stream: true,
      ...(toolDefinitions ? { tools: toolDefinitions, tool_choice: 'auto' } : {}),
      // Preserve reasoning chains across multi-turn tool call loops.
      // Moonshot docs: dropping reasoning_content causes degradation.
      thinking: { type: 'enabled', keep: 'all' },
    } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming);

    let iterationContent = '';
    let iterationReasoning = '';
    let toolCalls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      // Handle reasoning content (Kimi K2.6 specific)
      // Moonshot sends reasoning content in a custom field
      const reasoningChunk = (delta as Record<string, unknown>).reasoning_content as string | undefined;
      if (reasoningChunk) {
        iterationReasoning += reasoningChunk;
        // Emit agent activity periodically
        if (iterationReasoning.length > 50 && iterationReasoning.length % 100 < 20) {
          const activity = detectAgentActivity(iterationReasoning);
          if (activity) {
            const alreadyReported = agentActivities.some(
              a => a.agentName === activity.agentName &&
                   a.activity.slice(0, 50) === activity.activity.slice(0, 50)
            );
            if (!alreadyReported) {
              agentActivities.push({ ...activity, timestamp: Date.now() });
              send({ type: 'swarm_agent', agentName: activity.agentName, activity: activity.activity });
            }
          }
        }
      }

      // Handle content
      if (delta.content) {
        iterationContent += delta.content;
        send({ type: 'chunk', content: delta.content });
      }

      // Handle tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const funcTc = tc as OpenAI.Chat.ChatCompletionMessageFunctionToolCall;
          const existing = toolCalls[tc.index];
          if (existing) {
            existing.function.arguments += funcTc.function?.arguments || '';
          } else if (tc.id && funcTc.function?.name) {
            toolCalls[tc.index] = {
              id: tc.id,
              type: 'function',
              function: {
                name: funcTc.function.name,
                arguments: funcTc.function.arguments || '',
              },
            };
          }
        }
      }
    }

    finalContent += iterationContent;
    finalReasoning += iterationReasoning;

    // Process tool calls if any
    if (toolCalls.length > 0) {
      totalToolCalls += toolCalls.length;

      // Add assistant message with tool calls
      conversation.push({
        role: 'assistant',
        content: iterationContent || null,
        tool_calls: toolCalls,
      });

      // Execute each tool call
      for (const toolCall of toolCalls) {
        if (!toolCall) continue;

        send({
          type: 'swarm_status',
          phase: 'tool_call',
          message: `Executing ${(toolCall as OpenAI.Chat.ChatCompletionMessageFunctionToolCall).function.name}...`,
        });

        const result = await executeSwarmToolCall(toolCall as OpenAI.Chat.ChatCompletionMessageFunctionToolCall, categoryIds);

        send({
          type: 'swarm_status',
          phase: 'tool_result',
          message: `${result.displayName} completed`,
        });

        // Add tool result to conversation
        conversation.push({
          role: 'tool',
          tool_call_id: result.toolCallId,
          content: result.result,
        });
      }

      // Continue to next iteration
      continue;
    }

    // No tool calls - we're done
    send({ type: 'swarm_status', phase: 'swarm_complete', message: 'Agent swarm complete' });

    return {
      content: finalContent,
      reasoningContent: finalReasoning,
      toolCalls: totalToolCalls,
      iterations: iteration + 1,
      agentActivities,
    };
  }

  // Max iterations reached
  send({ type: 'swarm_status', phase: 'swarm_complete', message: 'Agent swarm complete (max iterations)' });

  return {
    content: finalContent,
    reasoningContent: finalReasoning,
    toolCalls: totalToolCalls,
    iterations: maxIterations,
    agentActivities,
  };
}
