/**
 * Checker Agent
 *
 * Quality validation agent that evaluates task results
 * - Auto-approves at ≥80% confidence
 * - Flags for review at <80%
 * - Never auto-approves on parse failure
 * - Skips quality check for summarize tasks
 * - Smart tool detection: verifies tool output without LLM evaluation
 */

import type { AgentTask, CheckerResult, AgentModelConfig } from '@/types/agent';
import { generateWithModel, getModelForRole } from './llm-router';
import { parseCheckerResponse } from './json-parser';

// Confidence threshold from database settings
const DEFAULT_CONFIDENCE_THRESHOLD = 80;

// ============ Tool Detection ============

/**
 * Detect which tool (if any) was used for this task
 * Same logic as executor.ts for consistency
 */
type CheckerToolType = 'doc_gen' | 'image_gen' | 'web_search' | 'chart_gen' | 'xlsx_gen' | 'pptx_gen' | 'podcast_gen' | 'diagram_gen';

function detectToolForTask(task: AgentTask): CheckerToolType | null {
  const typeLC = task.type.toLowerCase();
  const combinedText = `${task.target.toLowerCase()} ${task.description.toLowerCase()}`;

  // Explicit type mappings
  const explicitMap: Record<string, CheckerToolType> = {
    document: 'doc_gen', doc_gen: 'doc_gen', generate_document: 'doc_gen',
    image: 'image_gen', image_gen: 'image_gen', generate_image: 'image_gen',
    chart: 'chart_gen', chart_gen: 'chart_gen', generate_chart: 'chart_gen',
    xlsx: 'xlsx_gen', xlsx_gen: 'xlsx_gen', spreadsheet: 'xlsx_gen',
    pptx: 'pptx_gen', pptx_gen: 'pptx_gen', presentation: 'pptx_gen',
    podcast: 'podcast_gen', podcast_gen: 'podcast_gen',
    diagram: 'diagram_gen', diagram_gen: 'diagram_gen',
    search: 'web_search', web_search: 'web_search',
  };
  if (explicitMap[typeLC]) return explicitMap[typeLC];

  // Keyword scoring for "generate" type
  if (typeLC === 'generate') {
    const toolKeywords: Record<CheckerToolType, string[]> = {
      doc_gen: ['document', 'report', 'word', 'docx', 'pdf', 'memo', 'letter'],
      image_gen: ['image', 'infographic', 'visual', 'picture', 'graphic', 'illustration'],
      chart_gen: ['chart', 'graph', 'visualization', 'plot'],
      xlsx_gen: ['spreadsheet', 'excel', 'xlsx', 'data export'],
      pptx_gen: ['presentation', 'slides', 'powerpoint', 'pptx', 'deck'],
      podcast_gen: ['podcast', 'audio', 'narrate', 'voice'],
      diagram_gen: ['diagram', 'flowchart', 'architecture', 'mindmap', 'mermaid'],
      web_search: [],
    };
    let bestTool: CheckerToolType | null = null;
    let bestScore = 0;
    for (const [tool, keywords] of Object.entries(toolKeywords)) {
      const score = keywords.filter(kw => combinedText.includes(kw)).length;
      if (score > bestScore) { bestScore = score; bestTool = tool as CheckerToolType; }
    }
    if (bestTool) return bestTool;
  }

  // Fallback search detection
  if (['search', 'web', 'internet', 'online', 'lookup'].some(kw => combinedText.includes(kw))) {
    return 'web_search';
  }

  return null;
}

/**
 * Verify tool output without LLM evaluation
 * Simply checks if the tool produced valid output - no confidence scoring for tools
 */
function verifyToolOutput(
  toolType: CheckerToolType,
  result: string
): CheckerResult {
  const resultLC = result.toLowerCase();

  switch (toolType) {
    case 'doc_gen': {
      // Check for successful document generation
      const hasDocument = resultLC.includes('document generated') ||
                          resultLC.includes('.docx') ||
                          resultLC.includes('.pdf') ||
                          resultLC.includes('download:');
      const hasFailed = resultLC.includes('failed') || resultLC.includes('error');

      if (hasDocument && !hasFailed) {
        return {
          status: 'approved',
          confidence_score: 100,
          notes: 'Document generated successfully',
          tokens_used: 0,
        };
      }
      return {
        status: 'needs_review',
        confidence_score: 0,
        notes: hasFailed ? 'Document generation failed' : 'No document output detected',
        tokens_used: 0,
      };
    }

    case 'image_gen': {
      // Check for successful image generation
      const hasImage = resultLC.includes('image generated') ||
                       resultLC.includes('url:') ||
                       resultLC.includes('.png') ||
                       resultLC.includes('.jpg');
      const hasFailed = resultLC.includes('failed') || resultLC.includes('error');

      if (hasImage && !hasFailed) {
        return {
          status: 'approved',
          confidence_score: 100,
          notes: 'Image generated successfully',
          tokens_used: 0,
        };
      }
      return {
        status: 'needs_review',
        confidence_score: 0,
        notes: hasFailed ? 'Image generation failed' : 'No image output detected',
        tokens_used: 0,
      };
    }

    case 'chart_gen': {
      // Check for successful chart generation
      const hasChart = resultLC.includes('chart') ||
                       resultLC.includes('visualization') ||
                       resultLC.includes('generated');
      const hasFailed = resultLC.includes('failed') || resultLC.includes('error');

      if (hasChart && !hasFailed) {
        return {
          status: 'approved',
          confidence_score: 100,
          notes: 'Chart generated successfully',
          tokens_used: 0,
        };
      }
      return {
        status: 'needs_review',
        confidence_score: 0,
        notes: hasFailed ? 'Chart generation failed' : 'No chart output detected',
        tokens_used: 0,
      };
    }

    case 'web_search': {
      // Check for successful web search
      const hasResults = resultLC.includes('found') ||
                         resultLC.includes('results') ||
                         resultLC.includes('http');
      const noResults = resultLC.includes('no search results') || resultLC.includes('no results found');
      const hasFailed = resultLC.includes('failed') || resultLC.includes('error');

      if (hasResults && !noResults && !hasFailed) {
        return {
          status: 'approved',
          confidence_score: 100,
          notes: 'Web search completed with results',
          tokens_used: 0,
        };
      }
      if (noResults) {
        // No results is still a valid completion
        return {
          status: 'approved',
          confidence_score: 100,
          notes: 'Web search completed (no results found)',
          tokens_used: 0,
        };
      }
      return {
        status: 'needs_review',
        confidence_score: 0,
        notes: hasFailed ? 'Web search failed' : 'Web search status unclear',
        tokens_used: 0,
      };
    }

    case 'xlsx_gen': {
      const hasFile = resultLC.includes('spreadsheet generated') || resultLC.includes('.xlsx');
      const hasFailed = resultLC.includes('failed') || resultLC.includes('error');
      if (hasFile && !hasFailed) {
        return { status: 'approved', confidence_score: 100, notes: 'Spreadsheet generated successfully', tokens_used: 0 };
      }
      return { status: 'needs_review', confidence_score: 0, notes: hasFailed ? 'Spreadsheet generation failed' : 'No spreadsheet output detected', tokens_used: 0 };
    }

    case 'pptx_gen': {
      const hasFile = resultLC.includes('presentation generated') || resultLC.includes('.pptx');
      const hasFailed = resultLC.includes('failed') || resultLC.includes('error');
      if (hasFile && !hasFailed) {
        return { status: 'approved', confidence_score: 100, notes: 'Presentation generated successfully', tokens_used: 0 };
      }
      return { status: 'needs_review', confidence_score: 0, notes: hasFailed ? 'Presentation generation failed' : 'No presentation output detected', tokens_used: 0 };
    }

    case 'podcast_gen': {
      const hasFile = resultLC.includes('podcast generated') || resultLC.includes('.mp3');
      const hasFailed = resultLC.includes('failed') || resultLC.includes('error');
      if (hasFile && !hasFailed) {
        return { status: 'approved', confidence_score: 100, notes: 'Podcast generated successfully', tokens_used: 0 };
      }
      return { status: 'needs_review', confidence_score: 0, notes: hasFailed ? 'Podcast generation failed' : 'No podcast output detected', tokens_used: 0 };
    }

    case 'diagram_gen': {
      const hasDiagram = resultLC.includes('diagram generated') || resultLC.includes('mermaid');
      const hasFailed = resultLC.includes('failed') || resultLC.includes('error');
      if (hasDiagram && !hasFailed) {
        return { status: 'approved', confidence_score: 100, notes: 'Diagram generated successfully', tokens_used: 0 };
      }
      return { status: 'needs_review', confidence_score: 0, notes: hasFailed ? 'Diagram generation failed' : 'No diagram output detected', tokens_used: 0 };
    }

    default:
      return {
        status: 'needs_review',
        confidence_score: 0,
        notes: 'Unknown tool type',
        tokens_used: 0,
      };
  }
}

/**
 * Check task quality and return confidence score
 *
 * @param task - The task to check
 * @param result - The task result to evaluate
 * @param modelConfig - Model configuration for agent roles
 * @returns Checker result with approval status and confidence score
 */
export async function checkTaskQuality(
  task: AgentTask,
  result: string,
  modelConfig: AgentModelConfig
): Promise<CheckerResult> {
  // Auto-approve summarize tasks (as per plan requirements)
  if (task.type === 'summarize') {
    return {
      status: 'approved',
      confidence_score: 100,
      notes: 'Summary tasks auto-approved',
      tokens_used: 0,
    };
  }

  // Smart tool detection: Skip LLM evaluation for tool-based tasks
  const toolType = detectToolForTask(task);
  if (toolType) {
    console.log(`[Checker] Tool detected (${toolType}) - using simple verification`);
    return verifyToolOutput(toolType, result);
  }

  // Get confidence threshold from settings
  const { getSetting } = await import('../db/config');
  const threshold = parseInt(getSetting('agent_confidence_threshold', String(DEFAULT_CONFIDENCE_THRESHOLD)), 10);

  // Build evaluation prompt
  const prompt = buildEvaluationPrompt(task, result, threshold);

  try {
    // Get checker model
    const checkerModel = getModelForRole('checker', modelConfig);

    // Generate evaluation
    const response = await generateWithModel(checkerModel, prompt, {
      systemPrompt: 'You are a quality checker. Evaluate task results objectively and provide confidence scores.',
      temperature: 0.2, // Low temperature for consistency
    });

    // Parse response with schema validation
    const parseResult = await parseCheckerResponse(response.content, checkerModel);

    // CRITICAL: Never auto-approve on parse failure
    if (!parseResult.success) {
      console.error('[Checker] Parse failed:', parseResult.error);
      return {
        status: 'needs_review',
        confidence_score: 0,
        notes: `Parse failed, manual review needed: ${parseResult.error}`,
        tokens_used: response.tokens_used,
      };
    }

    // Extract confidence and notes
    const { confidence, notes } = parseResult.data;

    // Auto-approve if >= threshold
    if (confidence >= threshold) {
      return {
        status: 'approved',
        confidence_score: confidence,
        notes: notes || 'Meets quality threshold',
        tokens_used: response.tokens_used,
      };
    }

    // Needs review if < threshold
    return {
      status: 'needs_review',
      confidence_score: confidence,
      notes: notes || `Confidence ${confidence}% below threshold ${threshold}%`,
      tokens_used: response.tokens_used,
    };
  } catch (error) {
    // NEVER auto-approve on error
    console.error('[Checker] Error during quality check:', error);
    return {
      status: 'needs_review',
      confidence_score: 0,
      notes: `Checker error: ${error instanceof Error ? error.message : String(error)}`,
      tokens_used: 0,
    };
  }
}

/**
 * Build evaluation prompt for the checker
 */
function buildEvaluationPrompt(task: AgentTask, result: string, threshold: number): string {
  return `Evaluate this task result quality on a scale of 0-100% confidence.

**Task Details:**
- Type: ${task.type}
- Target: ${task.target}
- Description: ${task.description}

**Task Result:**
${result || '(No result provided)'}

**Evaluation Criteria:**
- Completeness: Does the result fully address the task?
- Accuracy: Is the information correct and reliable?
- Relevance: Is the result relevant to the task target?
- Quality: Is the result well-structured and clear?

**Confidence Threshold:** ${threshold}%
- ≥${threshold}%: Task will be auto-approved
- <${threshold}%: Task will be flagged for manual review

Respond with JSON only:
{
  "confidence": 85,
  "notes": "Brief explanation of the confidence score"
}`;
}

/**
 * Batch check multiple tasks (for efficiency)
 */
export async function batchCheckTasks(
  tasks: Array<{ task: AgentTask; result: string }>,
  modelConfig: AgentModelConfig
): Promise<CheckerResult[]> {
  const results: CheckerResult[] = [];

  // Process tasks sequentially (parallel could be added later)
  for (const { task, result } of tasks) {
    try {
      const checkResult = await checkTaskQuality(task, result, modelConfig);
      results.push(checkResult);
    } catch (error) {
      // On error, flag for review
      results.push({
        status: 'needs_review',
        confidence_score: 0,
        notes: `Batch check error: ${error instanceof Error ? error.message : String(error)}`,
        tokens_used: 0,
      });
    }
  }

  return results;
}
