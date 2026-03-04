/**
 * Executor Agent
 *
 * Executes tasks with:
 * - Idempotency (crash-recoverable)
 * - Fail-fast (no retries)
 * - Task timeout enforcement
 * - Quality checking (80% threshold)
 * - Tool execution (document generation, image generation, web search)
 */

import type { AgentTask, AgentPlan, ExecutionResult, AgentModelConfig } from '@/types/agent';
import type { StreamEvent } from '@/types/stream';
import type { GeneratedDocumentInfo, GeneratedImageInfo } from '@/types';
import { generateWithModel, getModelForRole } from './llm-router';
import { checkTaskQuality } from './checker';
import { transitionTaskState, incrementBudgetUsage, getTaskPlan } from '../db/compat/task-plans';
import { documentGenerationTool } from '../tools/docgen';
import { imageGenTool } from '../tools/image-gen';
import { tavilyWebSearch } from '../tools/tavily';
import { runWithContextAsync } from '../request-context';
import { resolveSkills } from '../skills/resolver';
import { getCategoryBySlug } from '../db/compat/categories';

// ============ Skills Resolution ============

/**
 * Resolve skills for the plan's category context
 * Returns the combined skill prompt content to inject into executor prompts
 */
async function resolveSkillsForPlan(plan: AgentPlan, taskDescription: string): Promise<string> {
  // Get category slug from plan (handle both naming conventions)
  const categorySlug = (plan as any).category_slug || (plan as any).categorySlug;

  if (!categorySlug) {
    return '';
  }

  // Look up category ID from slug
  const category = await getCategoryBySlug(categorySlug);
  if (!category) {
    console.log(`[Executor] No category found for slug: ${categorySlug}`);
    return '';
  }

  // Resolve skills for this category
  const resolved = await resolveSkills([category.id], taskDescription);

  if (resolved.skills.length > 0) {
    console.log(`[Executor] Loaded ${resolved.skills.length} skills for category "${categorySlug}":`,
      resolved.activatedBy);
  }

  return resolved.combinedPrompt;
}

// ============ Tool Detection ============

/**
 * Detect which tool (if any) should be used for this task
 * Priority order: explicit type match > keyword match with scoring
 */
function detectToolForTask(task: AgentTask): 'doc_gen' | 'image_gen' | 'web_search' | null {
  const typeLC = task.type.toLowerCase();
  const targetLC = task.target.toLowerCase();
  const descLC = task.description.toLowerCase();
  const combinedText = `${targetLC} ${descLC}`;

  // Explicit type mappings (highest priority)
  if (typeLC === 'document' || typeLC === 'doc_gen' || typeLC === 'generate_document') {
    return 'doc_gen';
  }
  if (typeLC === 'image' || typeLC === 'image_gen' || typeLC === 'generate_image') {
    return 'image_gen';
  }
  if (typeLC === 'search' || typeLC === 'web_search') {
    return 'web_search';
  }

  // Keyword-based detection for generic "generate" type
  if (typeLC === 'generate') {
    // Score-based detection to handle ambiguous cases
    const docKeywords = ['document', 'report', 'word', 'docx', 'pdf', 'file', 'export', 'download', 'memo', 'letter'];
    const imageKeywords = ['image', 'infographic', 'visual', 'diagram', 'chart', 'picture', 'graphic', 'illustration', 'draw'];

    const docScore = docKeywords.filter(kw => combinedText.includes(kw)).length;
    const imageScore = imageKeywords.filter(kw => combinedText.includes(kw)).length;

    // Require at least one keyword match, prefer higher score
    if (docScore > 0 || imageScore > 0) {
      return docScore >= imageScore ? 'doc_gen' : 'image_gen';
    }
  }

  // Fallback search detection
  const searchKeywords = ['search', 'web', 'internet', 'online', 'lookup', 'find'];
  if (searchKeywords.some(kw => combinedText.includes(kw))) {
    return 'web_search';
  }

  return null;
}

// ============ Tool Execution Callbacks ============

export interface ExecutorCallbacks {
  onToolStart?: (name: string, displayName: string) => void;
  onToolEnd?: (name: string, success: boolean, duration: number, error?: string) => void;
  onArtifact?: (event: StreamEvent) => void;
  onChecking?: () => void; // When checker validates task result
}

/**
 * Execute a single task
 *
 * @param task - The task to execute
 * @param plan - The parent plan (for context and budget tracking)
 * @param modelConfig - Model configuration
 * @param callbacks - Optional callbacks for streaming progress
 * @returns Execution result
 */
export async function executeTask(
  task: AgentTask,
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  callbacks?: ExecutorCallbacks
): Promise<ExecutionResult> {
  // Bug fix: Query fresh task status from database for accurate idempotency check
  const planId = (plan as any).id || (plan as any).planId;
  const freshPlan = await getTaskPlan(planId);
  const freshTask = freshPlan?.tasks?.find((t) => t.id === task.id);
  const currentStatus = freshTask?.status || task.status;

  // Check if already executed (idempotency)
  if (currentStatus !== 'pending') {
    return {
      success: true,
      skipReason: `Task already ${currentStatus}`,
    };
  }

  // Mark as running and save state history
  try {
    await transitionTaskState(planId, task.id, 'running');
  } catch (error) {
    return {
      success: false,
      error: `Failed to transition to running: ${error instanceof Error ? error.message : String(error)}`,
      skipped: true,
    };
  }

  try {
    // Get task timeout from plan budget (default 5 minutes)
    const timeoutMinutes = plan.budget?.task_timeout_minutes || 5;
    const timeoutMs = timeoutMinutes * 60 * 1000;

    // Perform task execution with timeout enforcement
    const result = await Promise.race([
      performTaskExecution(task, plan, modelConfig, callbacks),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Task execution timed out after ${timeoutMinutes} minutes`)), timeoutMs)
      ),
    ]);

    // Track LLM usage
    if (result.tokens_used) {
      await incrementBudgetUsage(plan.id, {
        llm_calls: result.llm_calls || 1,
        tokens_used: result.tokens_used,
      });
    }

    // Quality check with 80% threshold
    callbacks?.onChecking?.();
    const checkResult = await checkTaskQuality(task, result.content, modelConfig);

    // Track checker LLM usage
    if (checkResult.tokens_used) {
      await incrementBudgetUsage(plan.id, {
        llm_calls: 1,
        tokens_used: checkResult.tokens_used,
      });
    }

    // Handle check result
    if (checkResult.status === 'approved') {
      // Auto-approved
      await transitionTaskState(plan.id, task.id, 'done', {
        result: result.content,
        confidence_score: checkResult.confidence_score,
        tokens_used: result.tokens_used,
        llm_calls: result.llm_calls,
      });

      return {
        success: true,
        result: result.content,
        confidence: checkResult.confidence_score,
        tokens_used: result.tokens_used,
        llm_calls: result.llm_calls,
      };
    } else {
      // Low confidence - mark as needs_review
      await transitionTaskState(plan.id, task.id, 'needs_review', {
        result: result.content,
        confidence_score: checkResult.confidence_score,
        review_notes: checkResult.notes,
        tokens_used: result.tokens_used,
        llm_calls: result.llm_calls,
      });

      return {
        success: false,
        needsReview: true,
        result: result.content,
        confidence: checkResult.confidence_score,
        tokens_used: result.tokens_used,
        llm_calls: result.llm_calls,
      };
    }
  } catch (error) {
    // FAIL-FAST: No retries, skip on first failure
    const errorMsg = error instanceof Error ? error.message : String(error);

    await transitionTaskState(plan.id, task.id, 'skipped', {
      error: errorMsg,
    });

    return {
      success: false,
      error: errorMsg,
      skipped: true,
    };
  }
}

/**
 * Perform actual task execution (LLM call or tool execution)
 */
async function performTaskExecution(
  task: AgentTask,
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  callbacks?: ExecutorCallbacks
): Promise<{ content: string; tokens_used?: number; llm_calls?: number }> {
  // Detect if this task requires a tool
  const toolType = detectToolForTask(task);

  if (toolType) {
    return executeToolForTask(task, plan, modelConfig, toolType, callbacks);
  }

  // Default: LLM-based execution
  const prompt = buildExecutionPrompt(task, plan);

  // Resolve skills for this plan's category context
  const skillPrompt = await resolveSkillsForPlan(plan, task.description);

  // Build system prompt with skills injected
  let systemPrompt = EXECUTOR_SYSTEM_PROMPT;
  if (skillPrompt) {
    systemPrompt = `${EXECUTOR_SYSTEM_PROMPT}\n\n--- DOMAIN-SPECIFIC GUIDELINES ---\n${skillPrompt}`;
  }

  // Get executor model
  const executorModel = getModelForRole('executor', modelConfig);

  // Generate result
  const response = await generateWithModel(executorModel, prompt, {
    systemPrompt,
    temperature: 0.4, // Balanced creativity
  });

  return {
    content: response.content,
    tokens_used: response.tokens_used,
    llm_calls: 1,
  };
}

/**
 * Execute a tool for the task
 */
async function executeToolForTask(
  task: AgentTask,
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  toolType: 'doc_gen' | 'image_gen' | 'web_search',
  callbacks?: ExecutorCallbacks
): Promise<{ content: string; tokens_used?: number; llm_calls?: number }> {
  const startTime = Date.now();

  // Get display name for the tool
  const toolDisplayNames: Record<string, string> = {
    doc_gen: 'Document Generation',
    image_gen: 'Image Generation',
    web_search: 'Web Search',
  };

  const displayName = toolDisplayNames[toolType];
  callbacks?.onToolStart?.(toolType, displayName);

  try {
    let result: string;

    switch (toolType) {
      case 'doc_gen':
        result = await executeDocGenTool(task, plan, modelConfig, callbacks);
        break;
      case 'image_gen':
        result = await executeImageGenTool(task, plan, modelConfig, callbacks);
        break;
      case 'web_search':
        result = await executeWebSearchTool(task, callbacks);
        break;
      default:
        throw new Error(`Unknown tool type: ${toolType}`);
    }

    const duration = Date.now() - startTime;
    callbacks?.onToolEnd?.(toolType, true, duration);

    return {
      content: result,
      tokens_used: 0, // Tools don't use tokens directly
      llm_calls: toolType === 'doc_gen' || toolType === 'image_gen' ? 1 : 0, // Content generation uses LLM
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    callbacks?.onToolEnd?.(toolType, false, duration, errorMsg);
    throw error;
  }
}

/**
 * Execute document generation tool
 */
async function executeDocGenTool(
  task: AgentTask,
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  callbacks?: ExecutorCallbacks
): Promise<string> {
  // Resolve skills for this plan's category context
  const skillPrompt = await resolveSkillsForPlan(plan, task.description);

  // Build system prompt with skills injected
  // Skills are CRITICAL for document generation - they define the output structure
  let docSystemPrompt = DOC_CONTENT_SYSTEM_PROMPT;
  if (skillPrompt) {
    docSystemPrompt = `${DOC_CONTENT_SYSTEM_PROMPT}\n\n--- DOMAIN-SPECIFIC GUIDELINES ---\nFollow these guidelines precisely when generating the document:\n\n${skillPrompt}`;
  }

  // First, generate the document content using LLM
  const contentPrompt = buildDocContentPrompt(task, plan);
  const executorModel = getModelForRole('executor', modelConfig);

  const contentResponse = await generateWithModel(executorModel, contentPrompt, {
    systemPrompt: docSystemPrompt,
    temperature: 0.4,
  });

  const generatedContent = contentResponse.content;

  // Determine format from task description
  let format: 'docx' | 'pdf' | 'md' = 'docx';
  const descLower = task.description.toLowerCase();
  if (descLower.includes('pdf')) format = 'pdf';
  else if (descLower.includes('markdown') || descLower.includes('.md')) format = 'md';

  // Generate document title from task
  const title = task.target || `${plan.title} - Task ${task.id}`;

  // Execute the doc_gen tool with request context
  // Note: plan may have either snake_case (AgentPlan) or camelCase (TaskPlan) properties
  // depending on how it was loaded. Handle both cases.
  const threadId = (plan as any).thread_id || (plan as any).threadId;
  const userId = (plan as any).user_id || (plan as any).userId;

  // Bug fix: Wrap in try-catch for graceful error handling
  let result: string;
  try {
    result = await runWithContextAsync(
      { threadId, userId },
      async () => {
        return await documentGenerationTool.execute({
          title,
          content: generatedContent,
          format,
        });
      }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return `Document generation failed: ${errorMsg}`;
  }

  // Parse result and emit artifact event
  try {
    const parsed = JSON.parse(result);
    if (parsed.success && parsed.document) {
      const docInfo: GeneratedDocumentInfo = {
        id: parsed.document.id,
        filename: parsed.document.filename,
        fileType: parsed.document.fileType,
        fileSize: parsed.document.fileSize,
        fileSizeFormatted: parsed.document.fileSizeFormatted,
        downloadUrl: parsed.document.downloadUrl,
        expiresAt: parsed.document.expiresAt || null,
      };

      callbacks?.onArtifact?.({
        type: 'artifact',
        subtype: 'document',
        data: docInfo,
      });

      return `Document generated: ${parsed.document.filename} (${parsed.document.fileSizeFormatted})\nDownload: ${parsed.document.downloadUrl}`;
    } else {
      return `Document generation failed: ${parsed.error || 'Unknown error'}`;
    }
  } catch {
    return result;
  }
}

/**
 * Execute image generation tool
 */
async function executeImageGenTool(
  task: AgentTask,
  plan: AgentPlan,
  _modelConfig: AgentModelConfig,
  callbacks?: ExecutorCallbacks
): Promise<string> {
  // Build image prompt from task and context
  const imagePrompt = buildImagePrompt(task, plan);

  // Determine style from task
  let style: 'infographic' | 'diagram' | 'illustration' | 'chart' = 'infographic';
  const descLower = task.description.toLowerCase();
  if (descLower.includes('diagram')) style = 'diagram';
  else if (descLower.includes('chart')) style = 'chart';
  else if (descLower.includes('illustration')) style = 'illustration';

  // Execute image generation
  const result = await imageGenTool.execute({
    prompt: imagePrompt,
    style,
    aspectRatio: '16:9',
  });

  // Parse result and emit artifact event
  try {
    const parsed = JSON.parse(result);
    // Note: Response uses 'imageHint' (not 'image') per ImageGenResponse type
    if (parsed.success && parsed.imageHint) {
      const imageInfo: GeneratedImageInfo = {
        id: parsed.imageHint.id || `img-${Date.now()}`,
        url: parsed.imageHint.url,
        thumbnailUrl: parsed.imageHint.thumbnailUrl,
        alt: parsed.imageHint.alt || `${style} visualization: ${task.description.substring(0, 100)}`,
        provider: parsed.metadata?.provider || 'gemini',
        model: parsed.metadata?.model || 'unknown',
        width: parsed.imageHint.width || 1024,
        height: parsed.imageHint.height || 1024,
      };

      callbacks?.onArtifact?.({
        type: 'artifact',
        subtype: 'image',
        data: imageInfo,
      });

      return `Image generated: ${style} style\nURL: ${parsed.imageHint.url}`;
    } else {
      return `Image generation failed: ${parsed.error?.message || parsed.error || 'Unknown error'}`;
    }
  } catch {
    return result;
  }
}

/**
 * Execute web search tool
 */
async function executeWebSearchTool(
  task: AgentTask,
  callbacks?: ExecutorCallbacks
): Promise<string> {
  // Build search query from task
  const query = task.target || task.description;

  // Bug fix: Validate query is not empty
  if (!query || query.trim().length === 0) {
    return 'Web search failed: No search query provided. Task target and description are both empty.';
  }

  // Execute web search
  const result = await tavilyWebSearch.execute({
    query,
    max_results: 5,
    search_depth: 'basic',
  });

  // Parse and format results
  try {
    const parsed = JSON.parse(result);
    if (parsed.error) {
      return `Web search failed: ${parsed.error}`;
    }

    // Format search results
    const results = parsed.results || [];
    if (results.length === 0) {
      return 'No search results found.';
    }

    let formatted = `Found ${results.length} results:\n\n`;
    for (const r of results.slice(0, 5)) {
      formatted += `**${r.title}**\n${r.url}\n${r.content?.substring(0, 200)}...\n\n`;
    }

    // Include AI answer if available
    if (parsed.answer) {
      formatted = `**Summary:** ${parsed.answer}\n\n${formatted}`;
    }

    // Note: Removed table visualization for search results in autonomous mode
    // Search results are stored as text and passed to dependent analyze tasks
    // The analyze task should process the results, then outputs (doc/image/chart)
    // can visualize the analysis, not raw search URLs

    return formatted;
  } catch {
    return result;
  }
}

/**
 * Build prompt for document content generation
 */
function buildDocContentPrompt(task: AgentTask, plan: AgentPlan): string {
  // Handle both snake_case (AgentPlan) and camelCase (TaskPlan) property names
  const originalRequest = (plan as any).original_request || (plan as any).originalRequest || '';

  let prompt = `Generate document content for the following task.

**Plan:** ${plan.title}
${originalRequest ? `**Original Request:** ${originalRequest}\n` : ''}
**Task:**
- Target: ${task.target}
- Description: ${task.description}
`;

  // Add dependency results
  if (task.dependencies.length > 0) {
    prompt += `\n**Information from previous tasks:**\n`;
    for (const depId of task.dependencies) {
      const dep = plan.tasks.find((t) => t.id === depId);
      if (dep && dep.result) {
        prompt += `\n--- Task ${depId}: ${dep.description} ---\n${dep.result}\n`;
      }
    }
  }

  prompt += `\n**Instructions:**
Generate well-structured content in markdown format that can be converted to a document.
Include:
- Clear headings and sections
- Key findings or information
- Any relevant data or analysis
- Professional formatting suitable for a business document

Output the document content directly in markdown format.`;

  return prompt;
}

/**
 * Build prompt for image generation
 */
function buildImagePrompt(task: AgentTask, plan: AgentPlan): string {
  let prompt = `Create a professional ${task.target.toLowerCase()} visualization for: ${task.description}`;

  // Add context from dependencies
  if (task.dependencies.length > 0) {
    const depResults: string[] = [];
    for (const depId of task.dependencies) {
      const dep = plan.tasks.find((t) => t.id === depId);
      if (dep && dep.result) {
        depResults.push(dep.result.substring(0, 300));
      }
    }
    if (depResults.length > 0) {
      prompt += `\n\nKey information to visualize:\n${depResults.join('\n')}`;
    }
  }

  prompt += '\n\nStyle: Professional, clean, suitable for business presentation. Use clear typography and modern design.';

  return prompt;
}

/**
 * System prompt for document content generation
 */
const DOC_CONTENT_SYSTEM_PROMPT = `You are a professional document writer. Generate well-structured content in markdown format.

Key principles:
- Use clear headings (##, ###) to organize content
- Include executive summary for longer documents
- Use bullet points and numbered lists for clarity
- Include relevant data and findings
- Maintain professional tone
- Format for easy conversion to Word/PDF

Output markdown content directly.`;

/**
 * Build execution prompt for the executor
 */
function buildExecutionPrompt(task: AgentTask, plan: AgentPlan): string {
  // Handle both snake_case (AgentPlan) and camelCase (TaskPlan) property names
  const originalRequest = (plan as any).original_request || (plan as any).originalRequest || '';

  let prompt = `Execute this task as part of a larger plan.

**Plan:** ${plan.title}
${originalRequest ? `**Original Request:** ${originalRequest}\n` : ''}
**Task to Execute:**
- ID: ${task.id}
- Type: ${task.type}
- Target: ${task.target}
- Description: ${task.description}
`;

  // Add results from dependent tasks
  if (task.dependencies.length > 0) {
    prompt += `\n**Dependencies (already completed):**\n`;
    for (const depId of task.dependencies) {
      const dep = plan.tasks.find((t) => t.id === depId);
      if (dep && dep.result) {
        prompt += `- Task ${depId}: ${dep.description}\n  Result: ${dep.result.substring(0, 200)}...\n`;
      }
    }
  }

  prompt += `\n**Instructions:**
Execute the task based on the type:
- **analyze**: Examine and interpret the information
- **search**: Find relevant information (explain what you would search for)
- **compare**: Compare the items and highlight key differences
- **generate**: Create the requested content
- **summarize**: Provide a concise summary
- **extract**: Pull out the specific information requested
- **validate**: Check correctness and flag any issues

Provide a clear, actionable result.`;

  return prompt;
}

/**
 * System prompt for the executor agent
 */
const EXECUTOR_SYSTEM_PROMPT = `You are a task execution agent. You complete specific tasks as part of a larger plan.

Key principles:
- Follow the task type and description precisely
- Provide clear, actionable results
- Reference dependent task results when relevant
- Be concise but thorough
- If information is missing, explain what's needed

Output your result directly without JSON formatting.`;
