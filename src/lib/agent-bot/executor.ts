/**
 * Agent Bot Executor
 *
 * Execution pipeline for agent bot invocations:
 * - Version resolution (default, specific, latest)
 * - Context building (skills, system prompt, RAG)
 * - LLM execution with tools
 * - Output generation (text, json, documents)
 */

import { v4 as uuidv4 } from 'uuid';
import {
  getDefaultVersion,
  getVersionByNumber,
  getVersionWithRelations,
  createJob,
  startJob,
  completeJob,
  failJob,
  addJobOutput,
} from '@/lib/db/compat';
import { generateResponseWithTools } from '@/lib/openai';
import { performRAGRetrieval } from '@/lib/streaming';
import { getSkillById } from '@/lib/db/compat/skills';
import { getToolDefinitions, AVAILABLE_TOOLS, isToolEnabled } from '@/lib/tools';
import { generateOutput as generateOutputFile } from './output-generator';
import type {
  AgentBot,
  AgentBotApiKey,
  AgentBotVersionWithRelations,
  AgentBotJob,
  InvokeRequest,
  InvokeResponse,
  InvokeOutputItem,
  OutputType,
  TokenUsage,
} from '@/types/agent-bot';
import type { Message } from '@/types';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionContext {
  agentBot: AgentBot;
  apiKey: AgentBotApiKey;
  version: AgentBotVersionWithRelations;
  request: InvokeRequest;
  outputType: OutputType;
  job: AgentBotJob;
}

export interface ExecutionResult {
  success: boolean;
  job: AgentBotJob;
  outputs: InvokeOutputItem[];
  tokenUsage?: TokenUsage;
  processingTimeMs: number;
  error?: {
    message: string;
    code: string;
  };
}

// ============================================================================
// Version Resolution
// ============================================================================

/**
 * Resolve which version to use for execution
 */
export async function resolveVersion(
  agentBotId: string,
  versionSpec?: number | 'latest' | 'default'
): Promise<AgentBotVersionWithRelations | null> {
  // Default behavior: use default version
  if (!versionSpec || versionSpec === 'default') {
    return await getDefaultVersion(agentBotId);
  }

  // Latest: get the highest version number
  if (versionSpec === 'latest') {
    const defaultVersion = await getDefaultVersion(agentBotId);
    // Default version lookup already falls back to highest version number
    return defaultVersion;
  }

  // Specific version number
  if (typeof versionSpec === 'number') {
    return await getVersionByNumber(agentBotId, versionSpec);
  }

  return null;
}

// ============================================================================
// Context Building
// ============================================================================

/**
 * Build system prompt from version config and skills
 */
export async function buildSystemPrompt(version: AgentBotVersionWithRelations): Promise<string> {
  const parts: string[] = [];

  // Add version's custom system prompt if set
  if (version.system_prompt) {
    parts.push(version.system_prompt);
  }

  // Add prompts from linked skills
  for (const skillId of version.skill_ids) {
    const skill = await getSkillById(skillId);
    if (skill && skill.prompt_content) {
      parts.push(skill.prompt_content);
    }
  }

  // Default prompt if none configured
  if (parts.length === 0) {
    parts.push(
      'You are a helpful assistant. Answer the user\'s questions accurately and concisely.'
    );
  }

  return parts.join('\n\n');
}

/**
 * Build RAG context from linked categories
 */
export async function buildRagContext(
  version: AgentBotVersionWithRelations,
  userQuery: string
): Promise<string> {
  // Use category names as slugs for RAG retrieval
  const categorySlugs = version.category_names || [];

  if (categorySlugs.length === 0) {
    return '';
  }

  try {
    // Perform RAG retrieval with category filtering
    const ragResult = await performRAGRetrieval(
      userQuery,
      categorySlugs,
      [], // No user document paths for agent bot API
      undefined, // No memory context
      undefined, // No summary context
      undefined, // No streaming callback
      [] // Empty conversation history for single-turn API
    );

    return ragResult.context;
  } catch (error) {
    console.error('[Executor] RAG query failed:', error);
    return '';
  }
}

/**
 * Get enabled tool names for the version
 */
export async function getEnabledTools(version: AgentBotVersionWithRelations): Promise<string[]> {
  const enabledTools: string[] = [];

  for (const tool of version.tools) {
    // Check if tool is enabled in version config AND globally enabled
    if (tool.is_enabled && (await isToolEnabled(tool.tool_name))) {
      enabledTools.push(tool.tool_name);
    }
  }

  return enabledTools;
}

/**
 * Get tools to exclude (all tools not in enabled list)
 */
export function getExcludedTools(enabledTools: string[]): string[] {
  const allTools = Object.keys(AVAILABLE_TOOLS);
  return allTools.filter((tool) => !enabledTools.includes(tool));
}

// ============================================================================
// Execution
// ============================================================================

/**
 * Execute the agent bot and get LLM response
 */
async function executeLlm(
  ctx: ExecutionContext,
  systemPrompt: string,
  ragContext: string
): Promise<{
  content: string;
  tokenUsage?: TokenUsage;
}> {
  const { version, request } = ctx;

  // Build user message from input
  const userMessage = formatUserInput(request.input);

  // Empty conversation history for single-turn API calls
  const conversationHistory: Message[] = [];

  // Get excluded tools (inverse of enabled tools)
  const enabledTools = await getEnabledTools(version);
  const excludedTools = getExcludedTools(enabledTools);

  // Execute LLM with tools
  const result = await generateResponseWithTools(
    systemPrompt,
    conversationHistory,
    ragContext,
    userMessage,
    enabledTools.length > 0, // enableTools
    version.category_ids,
    undefined, // No streaming callbacks for API
    undefined, // No images yet
    undefined, // No summary context
    undefined, // No memory context
    version.category_names, // categorySlugs
    excludedTools,
    undefined, // No image capabilities
    version.llm_model || undefined // Model override
  );

  // Estimate token usage (actual tracking would require OpenAI response)
  // This is a rough estimate - actual would come from response.usage
  const promptTokens = Math.ceil((systemPrompt.length + ragContext.length + userMessage.length) / 4);
  const completionTokens = Math.ceil(result.content.length / 4);

  return {
    content: result.content,
    tokenUsage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  };
}

/**
 * Format user input for LLM
 */
function formatUserInput(input: Record<string, unknown>): string {
  // If there's a single 'query' or 'message' field, use it directly
  if (typeof input.query === 'string') {
    return input.query;
  }
  if (typeof input.message === 'string') {
    return input.message;
  }
  if (typeof input.prompt === 'string') {
    return input.prompt;
  }

  // Otherwise, format all input as structured text
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      parts.push(`${key}: ${value}`);
    } else {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return parts.join('\n');
}

// ============================================================================
// Main Execution Entry Point
// ============================================================================

/**
 * Execute an agent bot invocation (sync mode)
 */
export async function executeInvocation(
  agentBot: AgentBot,
  apiKey: AgentBotApiKey,
  request: InvokeRequest
): Promise<ExecutionResult> {
  const startTime = Date.now();

  // 1. Resolve version
  const version = await resolveVersion(agentBot.id, request.version);
  if (!version) {
    return {
      success: false,
      job: null as unknown as AgentBotJob,
      outputs: [],
      processingTimeMs: Date.now() - startTime,
      error: {
        message: 'Version not found',
        code: 'VERSION_NOT_FOUND',
      },
    };
  }

  if (!version.is_active) {
    return {
      success: false,
      job: null as unknown as AgentBotJob,
      outputs: [],
      processingTimeMs: Date.now() - startTime,
      error: {
        message: 'Version is not active',
        code: 'VERSION_NOT_FOUND',
      },
    };
  }

  // 2. Determine output type
  const outputType = request.outputType || version.output_config.defaultType;

  // 3. Create job record
  const job = await createJob({
    agentBotId: agentBot.id,
    versionId: version.id,
    apiKeyId: apiKey.id,
    inputJson: request.input,
    outputType: outputType,
    webhookUrl: request.webhookUrl,
    webhookSecret: request.webhookSecret,
  });

  // 4. Start job
  await startJob(job.id);

  try {
    // 5. Build execution context
    const ctx: ExecutionContext = {
      agentBot,
      apiKey,
      version,
      request,
      outputType,
      job,
    };

    // 6. Build system prompt
    const systemPrompt = await buildSystemPrompt(version);

    // 7. Build RAG context from categories
    const userQuery = formatUserInput(request.input);
    const ragContext = await buildRagContext(version, userQuery);

    // 8. Execute LLM
    const llmResult = await executeLlm(ctx, systemPrompt, ragContext);

    // 9. Generate output using the output generator module
    const generatedOutput = await generateOutputFile({
      outputType,
      content: llmResult.content,
      jobId: job.id,
      version,
      title: request.input.title as string | undefined,
    });

    // 10. Save output to database
    const savedOutput = await addJobOutput({
      jobId: job.id,
      outputType: outputType,
      content: generatedOutput.content,
      filename: generatedOutput.filename,
      filepath: generatedOutput.filepath,
      fileSize: generatedOutput.fileSize,
      mimeType: generatedOutput.mimeType,
    });

    // 11. Complete job
    const processingTimeMs = Date.now() - startTime;
    const completedJob = await completeJob(job.id, llmResult.tokenUsage, processingTimeMs);

    // 12. Format output for response
    const outputs: InvokeOutputItem[] = [
      {
        type: generatedOutput.type,
        content: generatedOutput.filepath ? undefined : generatedOutput.content,
        filename: generatedOutput.filename,
        mimeType: generatedOutput.mimeType,
        downloadUrl: generatedOutput.filepath
          ? `/api/agent-bots/${agentBot.slug}/jobs/${job.id}/outputs/${savedOutput.id}/download`
          : undefined,
      },
    ];

    return {
      success: true,
      job: completedJob || job,
      outputs,
      tokenUsage: llmResult.tokenUsage,
      processingTimeMs,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Mark job as failed
    await failJob(job.id, errorMessage, 'PROCESSING_ERROR');

    return {
      success: false,
      job,
      outputs: [],
      processingTimeMs,
      error: {
        message: errorMessage,
        code: 'PROCESSING_ERROR',
      },
    };
  }
}

/**
 * Create async job for background processing
 */
export async function createAsyncJob(
  agentBot: AgentBot,
  apiKey: AgentBotApiKey,
  request: InvokeRequest,
  version: AgentBotVersionWithRelations
): Promise<AgentBotJob> {
  const outputType = request.outputType || version.output_config.defaultType;

  return await createJob({
    agentBotId: agentBot.id,
    versionId: version.id,
    apiKeyId: apiKey.id,
    inputJson: request.input,
    outputType: outputType,
    webhookUrl: request.webhookUrl,
    webhookSecret: request.webhookSecret,
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get MIME type for output type
 */
function getMimeType(outputType: OutputType): string {
  const mimeTypes: Record<OutputType, string> = {
    text: 'text/plain',
    json: 'application/json',
    md: 'text/markdown',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    image: 'image/png',
    podcast: 'audio/mpeg',
  };
  return mimeTypes[outputType] || 'application/octet-stream';
}
