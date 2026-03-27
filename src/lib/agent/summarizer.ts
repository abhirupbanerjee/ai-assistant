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
  let prompt = `Compile ALL task outputs below into a single, comprehensive response that answers the user's original request.

**Original Request:** ${plan.original_request}

**Completed Outputs:**
`;

  // Add only completed task results — no status emojis or confidence scores
  for (const task of plan.tasks) {
    if (task.status === 'done' && task.result) {
      prompt += `\n--- ${task.description} ---\n${task.result}\n`;
    } else if (task.status === 'needs_review' && task.result) {
      // Include needs_review results too — they may have useful content
      prompt += `\n--- ${task.description} ---\n${task.result}\n`;
    }
  }

  // Collect generated files separately for clear listing
  const generatedFiles: string[] = [];
  for (const task of plan.tasks) {
    if (task.result) {
      const fileMatches = task.result.match(/(?:Download|URL): (https?:\/\/[^\s]+)/g);
      if (fileMatches) {
        generatedFiles.push(...fileMatches);
      }
      if (task.result.includes('generated:')) {
        const genMatch = task.result.match(/(?:Document|Spreadsheet|Presentation|Image|Diagram|Podcast) generated: (.+?)(?:\n|$)/);
        if (genMatch) {
          generatedFiles.push(genMatch[0].trim());
        }
      }
    }
  }

  if (generatedFiles.length > 0) {
    prompt += `\n**Generated Files:**\n${generatedFiles.map(f => `- ${f}`).join('\n')}\n`;
  }

  // Note gaps from failures without mentioning task IDs or error details
  const failedTypes = plan.tasks
    .filter(t => t.status === 'skipped' || t.status === 'failed')
    .map(t => t.type);
  if (failedTypes.length > 0) {
    const uniqueTypes = [...new Set(failedTypes)];
    prompt += `\n**Note:** Some outputs were unavailable: ${uniqueTypes.join(', ')}\n`;
  }

  prompt += `\n**Instructions:**
1. Present this as YOUR direct answer to the user — not a report about tasks
2. Include ALL findings, data, analysis, and insights from the outputs above
3. Structure with headings, bullet points, and tables as appropriate
4. List all generated files with download links at the end
5. Do NOT mention task IDs, confidence scores, or execution status
6. If some outputs are missing, note gaps naturally (e.g., "Diagram generation was unavailable") — do not mention error messages or task numbers`;

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
