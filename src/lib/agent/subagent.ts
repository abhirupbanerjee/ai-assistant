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
 * all 6 direct routes + LiteLLM. Anthropic tool_use blocks are normalized
 * to OpenAI-shaped tool_calls so the loop can consume them uniformly.
 */

import OpenAI from 'openai';
import type { AgentTask, AgentPlan, AgentModelConfig } from '@/types/agent';
import type { StreamEvent } from '@/types/stream';
import { AVAILABLE_TOOLS, isToolEnabled } from '@/lib/tools';
import { isToolEnabledForCategory } from '@/lib/db/compat/category-tool-config';
import { getCategoryBySlug } from '@/lib/db/compat/categories';
import { getModelForRole } from './llm-router';
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

function getToolDefinitionsForSubagent(enabledToolNames: string[]): OpenAI.Chat.ChatCompletionTool[] {
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];

  for (const name of enabledToolNames) {
    const tool = AVAILABLE_TOOLS[name];
    if (!tool) continue;
    if (tool.category !== 'autonomous') continue;

    if (tool.definition) {
      tools.push(tool.definition as OpenAI.Chat.ChatCompletionTool);
    }
    // function_api has dynamic definitions — skip in generic subagent loop
  }

  return tools;
}

async function getEnabledToolsForPlan(plan: AgentPlan): Promise<string[]> {
  const allAutonomous = Object.entries(AVAILABLE_TOOLS)
    .filter(([, tool]) => tool.category === 'autonomous')
    .map(([name]) => name);

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
 * Run a subagent ReAct loop for a single task.
 */
export async function runSubagentTaskLoop(
  task: AgentTask,
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  callbacks?: SubagentCallbacks,
  maxIterations: number = 5,
  budget?: SubagentBudget
): Promise<SubagentResult> {
  const executorSelection = resolveExecutorModelForTask(task, modelConfig, plan);
  const effectiveModel = executorSelection.model.model;

  // Resolve enabled tools for this plan/category
  const enabledToolNames = await getEnabledToolsForPlan(plan);
  const tools = getToolDefinitionsForSubagent(enabledToolNames);

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

    const response = await generateToolCompletionWithFallback(
      executorSelection.model,
      messages,
      tools,
      'auto',
      0.4,
      8000,
      subagentFirstChunkTimeout,
    );

    actualModelUsed = response.model_used;

    const messageContent = response.content;
    const toolCalls = response.tool_calls;
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

    // Push assistant message with tool_calls
    messages.push({
      role: 'assistant',
      content: messageContent || null,
      tool_calls: toolCalls as any,
    });

    // One LLM response with tool calls = one ReAct iteration
    iterations++;

    // Execute tool calls
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const tool = AVAILABLE_TOOLS[toolName];

      if (!tool || tool.category !== 'autonomous') {
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

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
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

  const finalResponse = await generateToolCompletionWithFallback(
    executorSelection.model,
    messages,
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
