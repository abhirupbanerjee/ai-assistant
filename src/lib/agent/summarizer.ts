/**
 * Summarizer Agent
 *
 * Generates consolidated responses from completed plans
 * Compiles all task results into a cohesive answer to the user's original request
 */

import type { AgentPlan, AgentModelConfig } from '@/types/agent';
import { generateWithModel, getModelForRole } from './llm-router';
import { getSummarizerSystemPrompt } from '@/lib/db/compat/agent-config';

/**
 * Generate summary of completed plan
 *
 * @param plan - The completed plan
 * @param modelConfig - Model configuration
 * @returns Summary text and token usage
 */
export async function generateSummary(
  plan: AgentPlan,
  modelConfig: AgentModelConfig
): Promise<{ summary: string; tokens_used: number }> {
  const prompt = buildSummaryPrompt(plan);

  try {
    // Get summarizer model
    const summarizerModel = getModelForRole('summarizer', modelConfig);

    // Load configurable system prompt (falls back to default)
    const systemPrompt = await getSummarizerSystemPrompt();

    // Generate summary
    const response = await generateWithModel(summarizerModel, prompt, {
      systemPrompt,
      temperature: 0.5, // Moderate creativity for natural language
    });

    return {
      summary: response.content,
      tokens_used: response.tokens_used,
    };
  } catch (error) {
    console.error('[Summarizer] Error generating summary:', error);
    return {
      summary: generateFallbackSummary(plan),
      tokens_used: 0,
    };
  }
}

/**
 * Build summary prompt
 */
function buildSummaryPrompt(plan: AgentPlan): string {
  let prompt = `Using the task results below, create a consolidated response that directly answers the user's original request.

**Plan:** ${plan.title}
**Original Request:** ${plan.original_request}

**Task Results:**
`;

  // Add all completed task results
  for (const task of plan.tasks) {
    const statusEmoji =
      task.status === 'done'
        ? '✓'
        : task.status === 'skipped'
          ? '⊘'
          : task.status === 'needs_review'
            ? '⚠'
            : '✗';

    prompt += `\n${statusEmoji} Task ${task.id}: ${task.description}\n`;

    if (task.status === 'done' && task.result) {
      prompt += `  Result: ${task.result}\n`;
      if (task.confidence_score !== undefined) {
        prompt += `  Confidence: ${task.confidence_score}%\n`;
      }
    } else if (task.status === 'skipped' && task.error) {
      prompt += `  Skipped: ${task.error}\n`;
    } else if (task.status === 'needs_review') {
      prompt += `  Needs Review: ${task.review_notes || 'Low confidence'}\n`;
      if (task.result) {
        prompt += `  Result: ${task.result.substring(0, 200)}...\n`;
      }
    }
  }

  // Add statistics
  if (plan.stats) {
    prompt += `\n**Statistics:**
- Total Tasks: ${plan.stats.total_tasks}
- Completed: ${plan.stats.completed_tasks}
- Failed/Skipped: ${plan.stats.failed_tasks + plan.stats.skipped_tasks}
- Needs Review: ${plan.stats.needs_review_tasks}
- Average Confidence: ${plan.stats.average_confidence.toFixed(1)}%
`;
  }

  prompt += `\n**Instructions:**
1. Answer the user's original request directly using the task results above
2. Present findings, data, and content — NOT a description of what tasks did
3. Include all important details: data points, URLs, file links, analysis results
4. Structure the response logically (headings, bullet points, tables as appropriate)
5. If any tasks produced downloadable files, list them with links
6. Only briefly note failed/skipped tasks at the end if the user should be aware`;

  return prompt;
}

/**
 * Generate fallback summary if LLM fails
 */
function generateFallbackSummary(plan: AgentPlan): string {
  const completed = plan.tasks.filter((t) => t.status === 'done').length;
  const skipped = plan.tasks.filter((t) => t.status === 'skipped').length;
  const needsReview = plan.tasks.filter((t) => t.status === 'needs_review').length;
  const failed = plan.tasks.filter((t) => t.status === 'failed').length;

  let summary = `# ${plan.title}\n\n`;
  summary += `Completed ${completed} of ${plan.tasks.length} tasks`;

  if (skipped > 0) summary += `, ${skipped} skipped`;
  if (needsReview > 0) summary += `, ${needsReview} need review`;
  if (failed > 0) summary += `, ${failed} failed`;

  summary += '.\n\n**Completed Tasks:**\n';

  for (const task of plan.tasks.filter((t) => t.status === 'done')) {
    summary += `- ${task.description}`;
    if (task.confidence_score) {
      summary += ` (${task.confidence_score}% confidence)`;
    }
    summary += '\n';
  }

  if (needsReview > 0) {
    summary += '\n**Tasks Needing Review:**\n';
    for (const task of plan.tasks.filter((t) => t.status === 'needs_review')) {
      summary += `- ${task.description}: ${task.review_notes || 'Low confidence'}\n`;
    }
  }

  return summary;
}

/**
 * Default system prompt for the summarizer agent.
 * Can be overridden via Admin → Agent Config → Summarizer System Prompt.
 */
export const DEFAULT_SUMMARIZER_SYSTEM_PROMPT = `You are a content consolidation agent. You compile task results into a single, cohesive response that directly answers the user's original request.

Key principles:
- Present the ACTUAL CONTENT and FINDINGS from task results — not commentary about how well the tasks ran
- Structure the output as if YOU are answering the user's original question directly
- Include all data, links, files, and key information from task results
- If tasks produced downloadable files (documents, spreadsheets, images), list them clearly
- Only mention failed/skipped tasks briefly at the end if relevant
- Write as a direct answer, not as a plan execution report

Output your response in markdown format.`;
