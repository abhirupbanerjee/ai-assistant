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
import type { ResolvedSkills } from '../skills/types';
import { generateWithModel, generateWithModelFallback, getModelForRole } from './llm-router';
import { extractJSON } from './json-parser';
import { checkTaskQuality } from './checker';
import { transitionTaskState, incrementBudgetUsage, getTaskPlan } from '../db/compat/task-plans';
import { getExecutorSystemPrompt } from '../db/compat/agent-config';
import { documentGenerationTool } from '../tools/docgen';
import { imageGenTool } from '../tools/image-gen';
import { tavilyWebSearch } from '../tools/tavily';
import { xlsxGenTool } from '../tools/xlsx-gen';
import { pptxGenTool } from '../tools/pptx-gen';
import { diagramGenTool } from '../tools/diagram-gen';
import { runWithContextAsync } from '../request-context';
import { resolveSkills } from '../skills/resolver';
import { getCategoryBySlug } from '../db/compat/categories';
import { AVAILABLE_TOOLS, isToolEnabled } from '../tools';

// ============ Skills Resolution ============

/**
 * Resolve skills for the plan's category context
 * Returns the combined skill prompt content to inject into executor prompts
 */
async function resolveSkillsForTask(plan: AgentPlan, task: AgentTask, callbacks?: ExecutorCallbacks): Promise<string> {
  // Priority 1: Load skills tagged by planner (keyword skills resolved at plan time)
  if (task.skill_ids && task.skill_ids.length > 0) {
    try {
      const { getSkillsByIds } = await import('../db/compat/skills');
      const skills = await getSkillsByIds(task.skill_ids);
      if (skills.length > 0) {
        console.log(`[Executor] Loaded ${skills.length} planner-tagged skills for task ${task.id}:`,
          skills.map(s => s.name));
        callbacks?.onSkillsLoaded?.(skills.map(s => ({ name: s.name, triggerReason: 'keyword' as const })));
        // Combine planner-tagged skills with category-based skills
        const categoryPrompt = await resolveCategorySkills(plan, task.description, callbacks);
        const taggedPrompt = skills.map(s => s.prompt_content).join('\n\n');
        return categoryPrompt ? `${categoryPrompt}\n\n${taggedPrompt}` : taggedPrompt;
      }
    } catch (err) {
      console.warn('[Executor] Failed to load planner-tagged skills:', err);
    }
  }

  // Priority 2: Resolve keyword skills against the original user request (deterministic fallback)
  // The planner may not tag skill_ids, so match keywords against plan.original_request
  // which contains the actual user message (not technical task descriptions)
  // Handle both snake_case (AgentPlan) and camelCase (TaskPlan) property names
  const originalRequest = plan.original_request || (plan as any).originalRequest || '';
  const categoryPrompt = await resolveCategorySkills(plan, task.description, callbacks);
  if (originalRequest) {
    const keywordPrompt = await resolveKeywordSkillsByUserRequest(plan, callbacks);
    if (keywordPrompt) {
      return categoryPrompt ? `${categoryPrompt}\n\n${keywordPrompt}` : keywordPrompt;
    }
  }

  return categoryPrompt;
}

/**
 * Deterministic keyword skill resolution against the original user request.
 * This bypasses the planner-tagging approach and directly matches skill keywords
 * against what the user actually typed (stored in plan.original_request).
 * Results are cached per plan to avoid redundant resolution across tasks.
 */
const keywordSkillCache = new Map<string, string>();
const toolRoutingCache = new Map<string, ResolvedSkills['toolRouting']>();

async function resolveKeywordSkillsByUserRequest(plan: AgentPlan, callbacks?: ExecutorCallbacks): Promise<string> {
  // Return cached result if already resolved for this plan
  if (keywordSkillCache.has(plan.id)) {
    return keywordSkillCache.get(plan.id)!;
  }

  const categorySlug = (plan as any).category_slug || (plan as any).categorySlug;
  const categoryIds: number[] = [];
  if (categorySlug) {
    const category = await getCategoryBySlug(categorySlug);
    if (category) categoryIds.push(category.id);
  }

  // Resolve skills using the original user message (not task description)
  // Handle both snake_case (AgentPlan) and camelCase (TaskPlan) property names
  const userRequest = plan.original_request || (plan as any).originalRequest || '';
  const resolved = await resolveSkills(categoryIds, userRequest);
  const keywordSkills = resolved.skills.filter(s =>
    resolved.activatedBy.keyword.includes(s.name)
  );

  let result = '';
  if (keywordSkills.length > 0) {
    console.log(`[Executor] Matched ${keywordSkills.length} keyword skills against user request:`,
      keywordSkills.map(s => s.name));
    callbacks?.onSkillsLoaded?.(keywordSkills.map(s => ({
      name: s.name,
      triggerReason: 'keyword' as const,
    })));
    result = keywordSkills.map(s => s.prompt_content).join('\n\n');
  }

  // Cache tool routing from resolved skills
  if (resolved.toolRouting && resolved.toolRouting.matches.length > 0) {
    toolRoutingCache.set(plan.id, resolved.toolRouting);
    console.log(`[Executor] Cached tool routing for plan ${plan.id}:`,
      resolved.toolRouting.matches.map(m => `${m.skillName} → ${m.toolName} (${m.forceMode})`));
  }

  keywordSkillCache.set(plan.id, result);
  return result;
}

async function resolveCategorySkills(plan: AgentPlan, taskDescription: string, callbacks?: ExecutorCallbacks): Promise<string> {
  const categorySlug = (plan as any).category_slug || (plan as any).categorySlug;
  if (!categorySlug) return '';

  const category = await getCategoryBySlug(categorySlug);
  if (!category) {
    console.log(`[Executor] No category found for slug: ${categorySlug}`);
    return '';
  }

  const resolved = await resolveSkills([category.id], taskDescription);
  if (resolved.skills.length > 0) {
    console.log(`[Executor] Loaded ${resolved.skills.length} category skills for "${categorySlug}":`,
      resolved.activatedBy);
    callbacks?.onSkillsLoaded?.(resolved.skills.map(s => ({
      name: s.name,
      triggerReason: resolved.activatedBy.always.includes(s.name) ? 'always' as const
        : resolved.activatedBy.category.includes(s.name) ? 'category' as const
        : 'keyword' as const,
    })));
  }
  return resolved.combinedPrompt;
}

// ============ Tool Detection ============

type ExecutorToolType = 'doc_gen' | 'image_gen' | 'web_search' | 'chart_gen' | 'xlsx_gen' | 'pptx_gen' | 'podcast_gen' | 'diagram_gen';

const TOOL_REGISTRY: Record<ExecutorToolType, { explicitTypes: string[]; keywords: string[] }> = {
  doc_gen:     { explicitTypes: ['document', 'doc_gen', 'generate_document'], keywords: ['document', 'report', 'word', 'docx', 'pdf', 'memo', 'letter', 'brief'] },
  image_gen:   { explicitTypes: ['image', 'image_gen', 'generate_image'], keywords: ['image', 'infographic', 'visual', 'picture', 'graphic', 'illustration', 'draw'] },
  chart_gen:   { explicitTypes: ['chart', 'chart_gen', 'generate_chart'], keywords: ['chart', 'graph', 'bar chart', 'line chart', 'pie chart', 'plot'] },
  xlsx_gen:    { explicitTypes: ['xlsx', 'xlsx_gen', 'spreadsheet'], keywords: ['spreadsheet', 'excel', 'xlsx', 'data export', 'table export'] },
  pptx_gen:    { explicitTypes: ['pptx', 'pptx_gen', 'presentation'], keywords: ['presentation', 'slides', 'powerpoint', 'pptx', 'deck'] },
  podcast_gen: { explicitTypes: ['podcast', 'podcast_gen'], keywords: ['podcast', 'audio', 'narrate', 'voice', 'listen'] },
  diagram_gen: { explicitTypes: ['diagram', 'diagram_gen'], keywords: ['diagram', 'flowchart', 'architecture', 'process flow', 'mindmap', 'mermaid'] },
  web_search:  { explicitTypes: ['search', 'web_search'], keywords: ['search', 'web', 'internet', 'online', 'lookup', 'research'] },
};

/**
 * Map skill tool_name to executor tool type
 */
function mapSkillToolToExecutorTool(toolName: string): ExecutorToolType | null {
  const mapping: Record<string, ExecutorToolType> = {
    'web_search': 'web_search',
    'document': 'doc_gen', 'document_gen': 'doc_gen', 'doc_gen': 'doc_gen',
    'image': 'image_gen', 'image_gen': 'image_gen',
    'chart': 'chart_gen', 'chart_gen': 'chart_gen',
    'spreadsheet': 'xlsx_gen', 'xlsx_gen': 'xlsx_gen',
    'presentation': 'pptx_gen', 'pptx_gen': 'pptx_gen',
    'podcast': 'podcast_gen', 'podcast_gen': 'podcast_gen',
    'diagram': 'diagram_gen', 'diagram_gen': 'diagram_gen',
  };
  return mapping[toolName.toLowerCase()] || null;
}

/**
 * Detect which tool (if any) should be used for this task
 * Priority order: planner tool_name > skill routing > explicit type match > keyword scoring > fallback search
 */
function detectToolForTask(task: AgentTask, planId?: string): string | null {
  // 0. Planner-specified tool_name (highest priority — planner already evaluated)
  if (task.tool_name && AVAILABLE_TOOLS[task.tool_name]) {
    return task.tool_name;
  }

  const typeLC = task.type.toLowerCase();
  const combinedText = `${task.target.toLowerCase()} ${task.description.toLowerCase()}`;

  // 1. Skill-based tool routing (cached from keyword skill resolution)
  if (planId && toolRoutingCache.has(planId)) {
    const routing = toolRoutingCache.get(planId)!;
    for (const match of routing.matches) {
      const mappedTool = mapSkillToolToExecutorTool(match.toolName);
      if (mappedTool && (match.forceMode === 'required' || match.forceMode === 'preferred')) {
        // Check if this task relates to the routed tool's domain
        const toolKeywords = TOOL_REGISTRY[mappedTool]?.keywords || [];
        if (toolKeywords.some(kw => combinedText.includes(kw))) {
          console.log(`[Executor] Skill routing override: ${match.skillName} → ${mappedTool} (${match.forceMode})`);
          return mappedTool;
        }
      }
    }
  }

  // 1. Explicit type match
  for (const [tool, config] of Object.entries(TOOL_REGISTRY)) {
    if (config.explicitTypes.includes(typeLC)) {
      return tool as ExecutorToolType;
    }
  }

  // 2. Keyword scoring for generic "generate" type
  if (typeLC === 'generate') {
    const scores: Partial<Record<ExecutorToolType, number>> = {};
    for (const [tool, config] of Object.entries(TOOL_REGISTRY)) {
      if (tool === 'web_search') continue; // search is not a generation tool
      const score = config.keywords.filter(kw => combinedText.includes(kw)).length;
      if (score > 0) scores[tool as ExecutorToolType] = score;
    }
    if (Object.keys(scores).length > 0) {
      return Object.entries(scores).sort(([, a], [, b]) => b - a)[0][0] as ExecutorToolType;
    }
  }

  // 3. Fallback search detection
  if (TOOL_REGISTRY.web_search.keywords.some(kw => combinedText.includes(kw))) {
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
  onSkillsLoaded?: (skills: { name: string; triggerReason: 'always' | 'category' | 'keyword' }[]) => void;
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
        retry_suggestion: checkResult.retry_suggestion,
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
  // On retry with fallback strategy, skip tool detection and use LLM instead
  const isRetryWithFallback = task.retry_count && task.retry_count > 0 &&
    (task.retry_strategy === 'fallback_ascii_diagram' || task.retry_strategy === 'fallback_text_description');

  const toolType = isRetryWithFallback ? null : detectToolForTask(task, plan.id);

  if (toolType) {
    return executeToolForTask(task, plan, modelConfig, toolType, callbacks);
  }

  // Default: LLM-based execution
  let prompt = buildExecutionPrompt(task, plan);

  // Handle retry strategies that augment the prompt
  if (task.retry_count && task.retry_count > 0 && task.retry_strategy) {
    if (task.retry_strategy === 'fallback_ascii_diagram') {
      prompt += '\n\n**FALLBACK: Generate an ASCII/text-based diagram instead of Mermaid. Use box-drawing characters or simple text layout.**';
    } else if (task.retry_strategy === 'fallback_text_description') {
      prompt += '\n\n**FALLBACK: Instead of generating an image, provide a detailed textual description of the visual with key data points and layout.**';
    } else if (task.retry_strategy === 'expand_web_search') {
      // Prepend web search results to provide additional context
      try {
        const searchResult = await executeWebSearchTool(
          { ...task, target: task.target || task.description } as AgentTask,
          callbacks
        );
        prompt += `\n\n**Additional web search context (added on retry):**\n${searchResult}`;
      } catch {
        prompt += '\n\n**Note: Web search augmentation was attempted but failed. Use available context to improve the response.**';
      }
    } else if (task.retry_strategy === 'more_specific_prompt') {
      prompt += `\n\n**Be more specific and detailed. Expected output: ${task.expected_output || task.description}**`;
    }
  }

  // Resolve skills for this plan's category context
  const skillPrompt = await resolveSkillsForTask(plan, task, callbacks);

  // Load configurable system prompt (falls back to default)
  const basePrompt = await getExecutorSystemPrompt();

  // Build system prompt with skills injected
  let systemPrompt = basePrompt;
  if (skillPrompt) {
    systemPrompt = `${basePrompt}\n\n--- DOMAIN-SPECIFIC GUIDELINES ---\n${skillPrompt}`;
  }

  // Get executor model (with escalation on retries)
  let executorModel = getModelForRole('executor', modelConfig);

  if (task.retry_count && task.retry_count > 0) {
    try {
      const { getDefaultLLMModel } = await import('../config-loader');
      const { getLlmFallbackSettings } = await import('../db/compat/config');

      if (task.retry_count === 1) {
        const globalDefault = getDefaultLLMModel();
        if (globalDefault && globalDefault !== executorModel.model) {
          console.log(`[Executor] Retry 1: escalating to global default ${globalDefault}`);
          executorModel = { ...executorModel, model: globalDefault };
        }
      } else if (task.retry_count >= 2) {
        const fallbackSettings = await getLlmFallbackSettings();
        if (fallbackSettings.universalFallback && fallbackSettings.universalFallback !== executorModel.model) {
          console.log(`[Executor] Retry 2: escalating to fallback ${fallbackSettings.universalFallback}`);
          executorModel = { ...executorModel, model: fallbackSettings.universalFallback };
        }
      }
    } catch (e) {
      console.warn('[Executor] Model escalation failed, using default:', e);
    }
  }

  // Generate result (with fallback chain on recoverable errors)
  const response = await generateWithModelFallback(executorModel, prompt, {
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
  toolType: string,
  callbacks?: ExecutorCallbacks
): Promise<{ content: string; tokens_used?: number; llm_calls?: number }> {
  const startTime = Date.now();

  // Get display name for the tool (static map for built-in tools, dynamic for others)
  const toolDisplayNames: Record<string, string> = {
    doc_gen: 'Document Generation',
    image_gen: 'Image Generation',
    web_search: 'Web Search',
    chart_gen: 'Chart Generation',
    xlsx_gen: 'Spreadsheet Generation',
    pptx_gen: 'Presentation Generation',
    podcast_gen: 'Podcast Generation',
    diagram_gen: 'Diagram Generation',
  };

  const displayName = toolDisplayNames[toolType]
    || AVAILABLE_TOOLS[toolType]?.displayName
    || toolType;
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
      case 'chart_gen':
        // Charts are visual artifacts — route through image generation with chart context
        result = await executeImageGenTool(task, plan, modelConfig, callbacks);
        break;
      case 'xlsx_gen':
        result = await executeXlsxGenTool(task, plan, modelConfig, callbacks);
        break;
      case 'pptx_gen':
        result = await executePptxGenTool(task, plan, modelConfig, callbacks);
        break;
      case 'podcast_gen':
        result = await executePodcastGenTool(task, plan, modelConfig, callbacks);
        break;
      case 'diagram_gen':
        result = await executeDiagramGenTool(task, plan, modelConfig, callbacks);
        break;
      case 'web_search':
        result = await executeWebSearchTool(task, callbacks);
        break;
      default:
        // Generic bridge — handles any AVAILABLE_TOOLS tool
        if (AVAILABLE_TOOLS[toolType]) {
          result = await executeGenericTool(task, toolType, callbacks);
        } else {
          throw new Error(`Unknown tool type: ${toolType}`);
        }
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
  const skillPrompt = await resolveSkillsForTask(plan, task, callbacks);

  // Build system prompt with skills injected
  // Skills are CRITICAL for document generation - they define the output structure
  let docSystemPrompt = DOC_CONTENT_SYSTEM_PROMPT;
  if (skillPrompt) {
    docSystemPrompt = `${DOC_CONTENT_SYSTEM_PROMPT}\n\n--- DOMAIN-SPECIFIC GUIDELINES ---\nFollow these guidelines precisely when generating the document:\n\n${skillPrompt}`;
  }

  // First, generate the document content using LLM
  const contentPrompt = buildDocContentPrompt(task, plan);
  const executorModel = getModelForRole('executor', modelConfig);

  const contentResponse = await generateWithModelFallback(executorModel, contentPrompt, {
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
 * Generic tool bridge — executes any tool from AVAILABLE_TOOLS registry.
 * The planner already decided which tool to use; this just executes it.
 * Extracts URL from task target for URL-based tools.
 */
async function executeGenericTool(
  task: AgentTask,
  toolName: string,
  callbacks?: ExecutorCallbacks
): Promise<string> {
  const enabled = await isToolEnabled(toolName);
  if (!enabled) {
    return JSON.stringify({ success: false, errorCode: 'TOOL_DISABLED',
      message: `Tool "${toolName}" is not enabled` });
  }

  const tool = AVAILABLE_TOOLS[toolName];
  if (!tool) {
    return `Tool "${toolName}" not found in registry`;
  }

  // Extract URL from task target (covers all URL-based tools)
  const urlMatch = task.target.match(/https?:\/\/[^\s,)]+/);
  let url: string;

  if (urlMatch) {
    url = urlMatch[0];
  } else {
    // Extract domain from target — first token only, strip description text
    // e.g. "gea.abhirup.app - SSL/TLS Configuration" → "gea.abhirup.app"
    url = task.target.trim().split(/[\s,]+/)[0];
    if (!url.includes('://')) {
      url = `https://${url}`;
    }
  }

  // Build args — URL-based tools get { url }, tool-specific enrichment
  const args: Record<string, unknown> = { url };
  if (toolName === 'website_analysis') {
    args.accessibilityAudit = true;
  }

  console.log(`[Executor] Generic tool bridge: ${toolName}(${url})`);
  return await tool.execute(args);
}

/**
 * Execute spreadsheet generation tool
 */
async function executeXlsxGenTool(
  task: AgentTask,
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  callbacks?: ExecutorCallbacks
): Promise<string> {
  // Use LLM to generate structured spreadsheet data from task context
  const depContext = buildDependencyContext(task, plan);
  const prompt = `Generate spreadsheet data for: ${task.description}\n\n${depContext}\n\nRespond with JSON: { "filename": "...", "sheets": [{ "name": "...", "headers": [...], "rows": [[...], ...] }] }`;
  const executorModel = getModelForRole('executor', modelConfig);
  const response = await generateWithModelFallback(executorModel, prompt, { temperature: 0.3 });

  try {
    const extracted = extractJSON(response.content);
    if (!extracted.found) {
      return `Spreadsheet generation failed: could not find JSON in LLM response`;
    }
    const data = JSON.parse(extracted.json);
    // Normalize: LLM may return "title" instead of "filename"
    if (!data.filename && data.title) data.filename = data.title;
    if (!data.filename) data.filename = task.target || 'spreadsheet';

    // Validate sheets structure before passing to tool (LLM may return wrong format)
    if (!Array.isArray(data.sheets)) {
      // Try to recover: if sheets is an object with a single sheet's data, wrap it
      if (data.sheets && typeof data.sheets === 'object' && data.sheets.headers) {
        data.sheets = [{ name: 'Sheet1', ...data.sheets }];
      } else if (data.headers && Array.isArray(data.rows)) {
        // LLM returned flat structure instead of sheets array
        data.sheets = [{ name: 'Sheet1', headers: data.headers, rows: data.rows }];
      } else {
        return `Spreadsheet generation failed: LLM returned invalid sheets format (expected array, got ${typeof data.sheets})`;
      }
    }
    // Ensure each sheet has required fields
    for (const sheet of data.sheets) {
      if (!sheet.name) sheet.name = 'Sheet1';
      if (!Array.isArray(sheet.headers)) sheet.headers = [];
      if (!Array.isArray(sheet.rows)) sheet.rows = [];
    }

    const threadId = (plan as any).thread_id || (plan as any).threadId;
    const userId = (plan as any).user_id || (plan as any).userId;

    const result = await runWithContextAsync(
      { threadId, userId },
      () => xlsxGenTool.execute(data)
    );

    const parsed = JSON.parse(result);
    if (parsed.success && parsed.document) {
      callbacks?.onArtifact?.({ type: 'artifact', subtype: 'document', data: parsed.document });
      return `Spreadsheet generated: ${parsed.document.filename} (${parsed.document.fileSizeFormatted})`;
    }
    return `Spreadsheet generation failed: ${parsed.error || 'Unknown error'}`;
  } catch (error) {
    return `Spreadsheet generation failed: ${error instanceof Error ? error.message : 'could not parse structured data from LLM response'}`;
  }
}

/**
 * Execute presentation generation tool
 */
async function executePptxGenTool(
  task: AgentTask,
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  callbacks?: ExecutorCallbacks
): Promise<string> {
  const depContext = buildDependencyContext(task, plan);
  const prompt = `Generate presentation slide data for: ${task.description}\n\n${depContext}\n\nRespond with JSON: { "title": "...", "slides": [{ "title": "...", "content": "...", "notes": "..." }] }`;
  const executorModel = getModelForRole('executor', modelConfig);
  const response = await generateWithModelFallback(executorModel, prompt, { temperature: 0.4 });

  try {
    const extracted = extractJSON(response.content);
    if (!extracted.found) {
      return `Presentation generation failed: could not find JSON in LLM response`;
    }
    const data = JSON.parse(extracted.json);
    const threadId = (plan as any).thread_id || (plan as any).threadId;
    const userId = (plan as any).user_id || (plan as any).userId;

    const result = await runWithContextAsync(
      { threadId, userId },
      () => pptxGenTool.execute(data)
    );

    const parsed = JSON.parse(result);
    if (parsed.success && parsed.document) {
      callbacks?.onArtifact?.({ type: 'artifact', subtype: 'document', data: parsed.document });
      return `Presentation generated: ${parsed.document.filename} (${parsed.document.fileSizeFormatted})`;
    }
    return `Presentation generation failed: ${parsed.error || 'Unknown error'}`;
  } catch (error) {
    return `Presentation generation failed: ${error instanceof Error ? error.message : 'could not parse structured data from LLM response'}`;
  }
}

/**
 * Execute podcast generation tool
 */
async function executePodcastGenTool(
  task: AgentTask,
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  callbacks?: ExecutorCallbacks
): Promise<string> {
  const depContext = buildDependencyContext(task, plan);
  const prompt = `Write a podcast script for: ${task.description}\n\n${depContext}\n\nWrite a natural, conversational script suitable for text-to-speech narration. 2-5 minutes length.`;
  const executorModel = getModelForRole('executor', modelConfig);
  const response = await generateWithModelFallback(executorModel, prompt, { temperature: 0.5 });

  try {
    const { generatePodcast } = await import('../tools/podcast-gen');
    const result = await generatePodcast({
      topic: task.target || `${plan.title} - Podcast`,
      content: response.content,
    });

    if (result.success && result.podcastHint) {
      callbacks?.onArtifact?.({ type: 'artifact', subtype: 'podcast', data: result.podcastHint });
      return `Podcast generated: ${result.podcastHint.filename || 'podcast.mp3'}`;
    }
    return `Podcast generation failed: ${result.message || 'Unknown error'}`;
  } catch (error) {
    return `Podcast generation failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Execute diagram generation tool
 */
async function executeDiagramGenTool(
  task: AgentTask,
  plan: AgentPlan,
  modelConfig: AgentModelConfig,
  callbacks?: ExecutorCallbacks
): Promise<string> {
  const depContext = buildDependencyContext(task, plan);
  const prompt = `Generate a Mermaid diagram definition for: ${task.description}\n\n${depContext}\n\nRespond with valid Mermaid syntax only (no markdown fences).`;
  const executorModel = getModelForRole('executor', modelConfig);
  const response = await generateWithModelFallback(executorModel, prompt, { temperature: 0.3 });

  try {
    const threadId = (plan as any).thread_id || (plan as any).threadId;
    const userId = (plan as any).user_id || (plan as any).userId;

    const result = await runWithContextAsync(
      { threadId, userId },
      () => diagramGenTool.execute({
        mermaidCode: response.content.replace(/```mermaid\n?/g, '').replace(/```\n?/g, '').trim(),
        title: task.target || task.description.substring(0, 50),
      })
    );

    const parsed = JSON.parse(result);
    if (parsed.success && parsed.diagram) {
      callbacks?.onArtifact?.({ type: 'artifact', subtype: 'diagram', data: parsed.diagram });
      return `Diagram generated: ${parsed.diagram.title || 'diagram'}`;
    }
    return `Diagram generation failed: ${parsed.error || 'Unknown error'}`;
  } catch (error) {
    return `Diagram generation failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Build dependency context string for tool execution prompts
 */
function buildDependencyContext(task: AgentTask, plan: AgentPlan): string {
  if (task.dependencies.length === 0) return '';
  let context = '**Context from previous tasks:**\n';
  for (const depId of task.dependencies) {
    const dep = plan.tasks.find(t => t.id === depId);
    if (dep && dep.result) {
      context += `\n--- Task ${depId}: ${dep.description} ---\n${dep.result.substring(0, 3000)}\n`;
    }
  }
  return context;
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
        depResults.push(dep.result.substring(0, 1500));
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
${task.expected_output ? `- Expected Output: ${task.expected_output}\n` : ''}
`;

  // Add results from dependent tasks
  if (task.dependencies.length > 0) {
    prompt += `\n**Dependencies (already completed):**\n`;
    for (const depId of task.dependencies) {
      const dep = plan.tasks.find((t) => t.id === depId);
      if (dep && dep.result) {
        prompt += `- Task ${depId}: ${dep.description}\n  Result: ${dep.result.substring(0, 3000)}...\n`;
      }
    }
  }

  // Add retry context if this is a retry attempt
  if (task.retry_count && task.retry_count > 0 && task.retry_context) {
    prompt += `\n**RETRY — Previous attempt feedback:**\n${task.retry_context}\nAddress this feedback in your response.\n`;
  }

  prompt += `\n**Instructions:**
Execute the task based on the type:
- **analyze**: Examine and interpret the information
- **search**: Find relevant information (explain what you would search for)
- **compare**: Compare the items and highlight key differences
- **synthesize**: Consolidate findings from multiple completed tasks — identify cross-cutting themes, patterns, and unified insights
- **generate**: Create the requested content
- **summarize**: Provide a concise summary
- **extract**: Pull out the specific information requested
- **validate**: Check correctness and flag any issues

Provide a clear, actionable result.`;

  return prompt;
}

/**
 * Default system prompt for the executor agent.
 * Can be overridden via Admin → Agent Config → Executor System Prompt.
 */
export const DEFAULT_EXECUTOR_SYSTEM_PROMPT = `You are a task execution agent. You complete specific tasks as part of a larger plan.

Key principles:
- Follow the task type and description precisely
- Provide clear, actionable results
- Reference dependent task results when relevant
- Be concise but thorough
- If information is missing, explain what's needed

Output your result directly without JSON formatting.`;
