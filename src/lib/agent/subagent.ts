/**
 * Subagent Loop Engine
 *
 * Task-level ReAct loop for autonomous mode.
 * Within a single task, the LLM can call multiple tools in sequence,
 * observe results, and decide on subsequent actions.
 *
 * Safety: subagentSafe flag gates tool availability without HITL.
 *
 * NOTE on multi-provider support:
 * This loop uses generateToolCompletionWithFallback() which routes across
 * all direct provider routes. Anthropic tool_use blocks are normalized
 * to OpenAI-shaped tool_calls so the loop can consume them uniformly.
 */

import OpenAI from 'openai';
import type { AgentTask, AgentPlan, AgentModelConfig } from '@/types/agent';
import type { StreamEvent } from '@/types/stream';
import { AVAILABLE_TOOLS, isToolEnabled } from '@/lib/tools';
import { isToolEnabledForCategory } from '@/lib/db/compat/category-tool-config';
import { isMcpTool, getMcpToolDefinitions } from '@/lib/mcp/mcp-tools';
import { getCategoryBySlug } from '@/lib/db/compat/categories';
import { getModelForRole, getModelContextLimit, estimateTokens } from './llm-router';
import { resolveSkillsForTask, resolveExecutorModelForTask } from './executor';
import { createSubagentApprovalResolver } from '@/lib/streaming/subagent-approval-resolver';
import { generateToolCompletionWithFallback } from '@/lib/openai';
import { SubagentBudget, createSubagentBudget, checkBudget } from './subagent-budget';

export interface SubagentCallbacks {
  onStep?: (event: Extract<StreamEvent, { type: 'subagent_step' }>) => void;
  onThinking?: (event: Extract<StreamEvent, { type: 'subagent_thinking' }>) => void;
  onBudgetWarning?: (event: Extract<StreamEvent, { type: 'subagent_budget_warning' }>) => void;
  onComplete?: (event: Extract<StreamEvent, { type: 'subagent_complete' }>) => void;
  onHumanApprovalNeeded?: (event: Extract<StreamEvent, { type: 'subagent_human_approval_needed' }>) => void;
  onToolStart?: (name: string, displayName: string, taskId: number) => void;
  onToolEnd?: (name: string, success: boolean, duration: number, error?: string, taskId?: number) => void;
}

export interface SubagentResult {
  content: string;
  tools_used: string[];
  iterations: number;
  tokens_used: number;
  hit_iteration_limit: boolean;
  model_used: string;
}

const DEFAULT_MAX_TOKENS = 100000;
const HITL_TIMEOUT_MS = 300_000; // 5 minutes
const MAX_TOOL_RESULT_CHARS = 4000;
const CONTEXT_SAFETY_MARGIN = 8000; // Leave headroom for response tokens

async function getToolDefinitionsForSubagent(enabledToolNames: string[]): Promise<OpenAI.Chat.ChatCompletionTool[]> {
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];

  for (const name of enabledToolNames) {
    const tool = AVAILABLE_TOOLS[name];
    if (tool) {
      if (tool.category !== 'autonomous') continue;
      if (tool.definition) {
        tools.push(tool.definition as OpenAI.Chat.ChatCompletionTool);
      }
      // function_api has dynamic definitions — skip in generic subagent loop
    }
  }

  // Append MCP tool definitions for enabled MCP tools.
  const mcpDefinitions = await getMcpToolDefinitions();
  for (const def of mcpDefinitions) {
    if (enabledToolNames.includes(def.function.name)) {
      tools.push(def as OpenAI.Chat.ChatCompletionTool);
    }
  }

  return tools;
}

async function getEnabledToolsForPlan(plan: AgentPlan): Promise<string[]> {
  const builtinAutonomous = Object.entries(AVAILABLE_TOOLS)
    .filter(([, tool]) => tool.category === 'autonomous')
    .map(([name]) => name);
  const mcpDefinitions = await getMcpToolDefinitions();
  const mcpAutonomous = mcpDefinitions.map(d => d.function.name);
  const allAutonomous = [...builtinAutonomous, ...mcpAutonomous];

  const categorySlug = (plan as any).category_slug || (plan as any).categorySlug;
  let categoryId: number | undefined;
  if (categorySlug) {
    try {
      const cat = await getCategoryBySlug(categorySlug);
      if (cat) categoryId = cat.id;
    } catch {
      // ignore
    }
  }

  const enabled: string[] = [];
  for (const name of allAutonomous) {
    const globalEnabled = await isToolEnabled(name);
    if (!globalEnabled) continue;
    if (categoryId != null) {
      try {
        const catEnabled = await isToolEnabledForCategory(name, categoryId);
        if (!catEnabled) continue;
      } catch {
        continue;
      }
    }
    enabled.push(name);
  }

  return enabled;
}

/**
 * Trim messages array to stay within a model's context window.
 * Always preserves system prompt [0] and task definition [1].
 * Drops oldest complete assistant+tool turns first.
 */
function trimMessagesForContext(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  maxTokens: number
): { trimmedMessages: OpenAI.Chat.ChatCompletionMessageParam[]; droppedTurns: number } {
  if (messages.length <= 2) {
    return { trimmedMessages: messages, droppedTurns: 0 };
  }

  const preserved = messages.slice(0, 2);
  let tail = messages.slice(2);
  let droppedTurns = 0;

  // Safety guard: if tail starts with a tool, drop it (shouldn't happen with proper turn tracking)
  while (tail.length > 0 && tail[0].role === 'tool') {
    tail = tail.slice(1);
  }

  let totalTokens = estimateTokens(JSON.stringify([...preserved, ...tail]));
  if (totalTokens <= maxTokens) {
    return { trimmedMessages: messages, droppedTurns: 0 };
  }

  while (tail.length > 0) {
    // Find the first assistant message — that's a turn boundary
    const firstAssistantIdx = tail.findIndex((m) => m.role === 'assistant');
    if (firstAssistantIdx === -1) break;

    // Count this assistant + all consecutive tool messages after it
    let dropCount = 1;
    for (let i = firstAssistantIdx + 1; i < tail.length; i++) {
      if (tail[i].role === 'tool') {
        dropCount++;
      } else {
        break;
      }
    }

    tail = tail.slice(dropCount);
    droppedTurns++;

    // Re-check token count
    totalTokens = estimateTokens(JSON.stringify([...preserved, ...tail]));
    if (totalTokens <= maxTokens) break;
  }

  return { trimmedMessages: [...preserved, ...tail], droppedTurns };
}

/**
 * Truncate a tool result to a maximum character count.
 * Attempts structured truncation for JSON, falls back to plain text.
 */
function truncateToolResult(result: string, maxChars: number = MAX_TOOL_RESULT_CHARS): string {
  if (!result || result.length <= maxChars) {
    return result;
  }

  // Attempt JSON structured truncation
  try {
    const parsed = JSON.parse(result);
    const truncated = truncateObjectValue(parsed, maxChars);
    const serialized = JSON.stringify(truncated);
    if (serialized.length <= maxChars) {
      return serialized;
    }
  } catch {
    // Not valid JSON, fall through to plain text truncation
  }

  const suffix = `... [truncated, ${result.length - maxChars + 50} chars omitted]`;
  return result.substring(0, maxChars - suffix.length) + suffix;
}

function truncateObjectValue(obj: unknown, maxChars: number): unknown {
  const str = JSON.stringify(obj);
  if (str.length <= maxChars) {
    return obj;
  }

  if (Array.isArray(obj)) {
    const result: unknown[] = [];
    for (const item of obj) {
      const test = [...result, item];
      if (JSON.stringify(test).length > maxChars * 0.6) break;
      result.push(item);
    }
    if (result.length < obj.length) {
      result.push(`... ${obj.length - result.length} more items truncated`);
    }
    return result;
  }

  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.length > 200) {
        result[key] = value.substring(0, 200) + '... [truncated]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = truncateObjectValue(value, maxChars);
      } else {
        result[key] = value;
      }
      if (JSON.stringify(result).length > maxChars * 0.8) {
        result['_truncated'] = 'Additional fields omitted due to length';
        break;
      }
    }
    return result;
  }

  return obj;
}

/**
 * Run a subagent ReAct loop for a single task.
 */
export async function runSubagentTaskLoop(
  task: AgentTask,
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  callbacks?: SubagentCallbacks,
  maxIterations: number = 15,
  budget?: SubagentBudget
): Promise<SubagentResult> {
  const executorSelection = await resolveExecutorModelForTask(task, modelConfig, plan);
  const effectiveModel = executorSelection.model.model;

  // Resolve enabled tools for this plan/category
  const enabledToolNames = await getEnabledToolsForPlan(plan);
  const tools = await getToolDefinitionsForSubagent(enabledToolNames);

  if (tools.length === 0) {
    const result: SubagentResult = {
      content: 'No tools are available for this task.',
      tools_used: [],
      iterations: 0,
      tokens_used: 0,
      hit_iteration_limit: false,
      model_used: effectiveModel,
    };
    callbacks?.onComplete?.({
      type: 'subagent_complete',
      task_id: task.id,
      result: result.content,
      iterations: result.iterations,
      hit_limit: result.hit_iteration_limit,
    });
    return result;
  }

  // Resolve skills for context injection
  const skillPrompt = await resolveSkillsForTask(plan, task);

  // Build conversation with plan context and skills
  const categorySlug = (plan as any).category_slug || (plan as any).categorySlug;
  const originalRequest = plan.original_request || (plan as any).originalRequest || '';

  let systemPrompt = `You are a focused subagent executing a single task. You have access to tools. ` +
    `Think step by step. Use tools when needed. After each tool result, decide if you need ` +
    `more tools or if you can provide the final answer.\n\n` +
    `Task: ${task.description}\n` +
    `Target: ${task.target || '(none)'}`;

  // Prompt injection for non-thinking providers to preserve reasoning across turns
  if (!executorSelection.model.thinking_enabled) {
    systemPrompt += `\n\nIf you reason through multiple steps, include your reasoning in <thinking></thinking> tags before your final answer or tool calls. These tags will be preserved across turns.`;
  }

  if (originalRequest) {
    systemPrompt += `\n\nOriginal user request: ${originalRequest}`;
  }
  if (categorySlug) {
    systemPrompt += `\n\nCategory: ${categorySlug}`;
  }
  if (skillPrompt) {
    systemPrompt += `\n\n--- DOMAIN-SPECIFIC GUIDELINES ---\n${skillPrompt}`;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `Execute this task: ${task.description}` },
  ];

  const toolsUsed: string[] = [];
  let iterations = 0;
  let totalTokens = 0;
  let tokenBudget = budget?.maxTokens ?? DEFAULT_MAX_TOKENS;
  let tokensUsed = budget?.tokensUsed ?? 0;

  let loopError: Error | undefined;
  let actualModelUsed = effectiveModel;

  // Tool call deduplication: track hashes of name+args to avoid redundant execution
  const toolCallHistory = new Set<string>();
  const toolResultCache = new Map<string, string>();

  // Extended first-chunk timeout for subagent: thinking-enabled models get 4 min,
  // others get 3 min (vs default 2 min for interactive chat)
  const subagentFirstChunkTimeout = executorSelection.model.thinking_enabled ? 240_000 : 180_000;

  while (iterations < maxIterations) {
    try {
    // Budget check
    if (tokensUsed >= tokenBudget) {
      callbacks?.onBudgetWarning?.({
        type: 'subagent_budget_warning',
        task_id: task.id,
        pct: 100,
      });
      break;
    }

    // Trim messages to fit within model context window before LLM call
    const contextLimit = await getModelContextLimit(executorSelection.model.model);
    const safeLimit = Math.max(contextLimit - CONTEXT_SAFETY_MARGIN, 32000);
    const { trimmedMessages, droppedTurns } = trimMessagesForContext(messages, safeLimit);
    if (droppedTurns > 0) {
      console.warn(`[Subagent] Task ${task.id}: dropped ${droppedTurns} oldest turns to fit context limit (${safeLimit} tokens)`);
    }

    const response = await generateToolCompletionWithFallback(
      executorSelection.model,
      trimmedMessages,
      tools,
      'auto',
      0.4,
      8000,
      subagentFirstChunkTimeout,
    );

    actualModelUsed = response.model_used;

    const messageContent = response.content;
    const toolCalls = response.tool_calls;
    const thinkingContent = response.thinkingContent;
    const iterTokens = response.tokens_used;
    totalTokens += iterTokens;
    tokensUsed += iterTokens;

    // Emit thinking content
    if (messageContent) {
      callbacks?.onThinking?.({
        type: 'subagent_thinking',
        task_id: task.id,
        thought: messageContent,
      });
    }

    // No tool calls — task is complete
    if (!toolCalls || toolCalls.length === 0) {
      const result: SubagentResult = {
        content: messageContent || 'Task completed.',
        tools_used: toolsUsed,
        iterations,
        tokens_used: totalTokens,
        hit_iteration_limit: false,
        model_used: actualModelUsed,
      };
      if (budget) {
        budget.tokensUsed = tokensUsed;
        budget.iterationsUsed = iterations;
      }
      callbacks?.onComplete?.({
        type: 'subagent_complete',
        task_id: task.id,
        result: result.content,
        iterations: result.iterations,
        hit_limit: result.hit_iteration_limit,
      });
      return result;
    }

    // Push assistant message with tool_calls and preserved reasoning
    const MAX_REASONING_CHARS = 2000;
    const assistantMsg: any = {
      role: 'assistant',
      content: messageContent || null,
      tool_calls: toolCalls as any,
    };
    if (thinkingContent) {
      assistantMsg.reasoning_content = thinkingContent.length > MAX_REASONING_CHARS
        ? thinkingContent.slice(0, MAX_REASONING_CHARS) + '\n...[reasoning truncated]'
        : thinkingContent;
    }
    messages.push(assistantMsg);

    // One LLM response with tool calls = one ReAct iteration
    iterations++;

    // Execute tool calls
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const tool = AVAILABLE_TOOLS[toolName];

      if (!tool || tool.category !== 'autonomous') {
        // MCP tools are not in AVAILABLE_TOOLS but are dispatched through executeTool.
        if (isMcpTool(toolName)) {
          const { executeTool } = await import('@/lib/tools');
          const result = await executeTool(toolName, toolCall.function.arguments);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
          continue;
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: `Tool "${toolName}" is not available.` }),
        });
        continue;
      }

      // HITL gate for non-subagentSafe tools
      let approvedArgs: Record<string, unknown>;
      if (tool.subagentSafe === false) {
        let rawArgs: Record<string, unknown>;
        try {
          rawArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Invalid tool arguments for "${toolName}".` }),
          });
          continue;
        }
        callbacks?.onHumanApprovalNeeded?.({
          type: 'subagent_human_approval_needed',
          task_id: task.id,
          plan_id: plan.id,
          request: {
            tool_name: toolName,
            arguments: rawArgs,
            reasoning: messageContent || '',
            risk_level: 'medium',
          },
        });

        const approval = await createSubagentApprovalResolver(task.id, HITL_TIMEOUT_MS);
        if (!approval || !approval.approved) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Tool "${toolName}" was denied by user.` }),
          });
          continue;
        }
        // Honor modified args from HITL approval
        approvedArgs = approval.modifiedArgs ?? rawArgs;
      } else {
        try {
          approvedArgs = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Invalid tool arguments for "${toolName}".` }),
          });
          continue;
        }
      }

      // Deduplication: check if this exact tool+args was already called in this subagent loop
      const callHash = `${toolName}:${JSON.stringify(approvedArgs)}`;
      if (toolCallHistory.has(callHash)) {
        const cachedResult = toolResultCache.get(callHash);
        callbacks?.onToolEnd?.(toolName, true, 0, undefined, task.id);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: cachedResult || JSON.stringify({ warning: `Tool ${toolName} was already called with the same arguments.` }),
        });
        if (!toolsUsed.includes(toolName)) {
          toolsUsed.push(toolName);
        }
        continue;
      }

      callbacks?.onToolStart?.(toolName, tool.displayName, task.id);

      callbacks?.onStep?.({
        type: 'subagent_step',
        task_id: task.id,
        iteration: iterations,
        tool_name: toolName,
        args: approvedArgs,
      });

      let result: string;
      const startTime = Date.now();
      try {
        result = await tool.execute(approvedArgs);
        callbacks?.onToolEnd?.(toolName, true, Date.now() - startTime, undefined, task.id);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result = JSON.stringify({ error: errorMsg });
        callbacks?.onToolEnd?.(toolName, false, Date.now() - startTime, errorMsg, task.id);
      }

      if (!toolsUsed.includes(toolName)) {
        toolsUsed.push(toolName);
      }

      // Cache result for deduplication
      toolCallHistory.add(callHash);
      toolResultCache.set(callHash, result);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: truncateToolResult(result),
      });
    }

    // Budget warning at 80%
    if (tokensUsed >= tokenBudget * 0.8) {
      callbacks?.onBudgetWarning?.({
        type: 'subagent_budget_warning',
        task_id: task.id,
        pct: Math.round((tokensUsed / tokenBudget) * 100),
      });
    }
    } catch (error) {
      loopError = error instanceof Error ? error : new Error(String(error));
      console.error(`[Subagent] Loop error for task ${task.id}:`, loopError.message);
      break;
    }
  }

  // Handle unexpected loop errors
  if (loopError) {
    const result: SubagentResult = {
      content: `Subagent failed: ${loopError.message}`,
      tools_used: toolsUsed,
      iterations,
      tokens_used: totalTokens,
      hit_iteration_limit: false,
      model_used: actualModelUsed,
    };
    callbacks?.onComplete?.({
      type: 'subagent_complete',
      task_id: task.id,
      result: result.content,
      iterations: result.iterations,
      hit_limit: result.hit_iteration_limit,
    });
    return result;
  }

  // Max iterations reached — force a final summarization call
  messages.push({
    role: 'user',
    content: 'You have reached the iteration limit. Please summarize your findings and provide a final answer.',
  });

  // Trim before final summarization call too
  const finalContextLimit = await getModelContextLimit(executorSelection.model.model);
  const finalSafeLimit = Math.max(finalContextLimit - CONTEXT_SAFETY_MARGIN, 32000);
  const { trimmedMessages: finalTrimmedMessages } = trimMessagesForContext(messages, finalSafeLimit);

  const finalResponse = await generateToolCompletionWithFallback(
    executorSelection.model,
    finalTrimmedMessages,
    undefined,
    undefined,
    0.4,
    8000,
    subagentFirstChunkTimeout,
  );

  const finalContent = finalResponse.content || 'Max iterations reached.';
  totalTokens += finalResponse.tokens_used;

  if (budget) {
    budget.tokensUsed = tokensUsed;
    budget.iterationsUsed = iterations;
  }

  const result: SubagentResult = {
    content: finalContent,
    tools_used: toolsUsed,
    iterations,
    tokens_used: totalTokens,
    hit_iteration_limit: true,
    model_used: actualModelUsed,
  };

  callbacks?.onComplete?.({
    type: 'subagent_complete',
    task_id: task.id,
    result: result.content,
    iterations: result.iterations,
    hit_limit: result.hit_iteration_limit,
  });

  return result;
}
