/**
 * Autonomous Agent Settings API
 *
 * Manages global autonomous mode settings:
 * - Budget limits (LLM calls, tokens, web searches)
 * - Confidence threshold
 * - Task timeouts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getSetting, setSetting, getAgentModelConfigs, setAgentModelConfigs, validateAgentModelConfig, getStreamingConfig, setStreamingConfig, getSummarizerSystemPrompt, setSummarizerSystemPrompt, getPlannerSystemPrompt, setPlannerSystemPrompt } from '@/lib/db/compat';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get agent settings from database
    const modelConfigs = await getAgentModelConfigs();
    const streamingConfig = await getStreamingConfig();
    const summarizerSystemPrompt = await getSummarizerSystemPrompt();
    const plannerSystemPrompt = await getPlannerSystemPrompt();

    const settings = {
      budgetMaxLlmCalls: parseInt(await getSetting('agent_budget_max_llm_calls', '500'), 10),
      budgetMaxTokens: parseInt(await getSetting('agent_budget_max_tokens', '2000000'), 10),
      budgetMaxWebSearches: parseInt(await getSetting('agent_budget_max_web_searches', '100'), 10),
      confidenceThreshold: parseInt(await getSetting('agent_confidence_threshold', '80'), 10),
      budgetMaxDurationMinutes: parseInt(await getSetting('agent_budget_max_duration_minutes', '30'), 10),
      taskTimeoutMinutes: parseInt(await getSetting('agent_task_timeout_minutes', '5'), 10),
      plannerModel: modelConfigs.planner,
      executorModel: modelConfigs.executor,
      checkerModel: modelConfigs.checker,
      summarizerModel: modelConfigs.summarizer,
      summarizerSystemPrompt,
      plannerSystemPrompt,
      // Streaming configuration
      streamingKeepaliveInterval: streamingConfig.keepalive_interval_seconds,
      streamingMaxDuration: streamingConfig.max_stream_duration_seconds,
      streamingToolTimeout: streamingConfig.tool_timeout_seconds,
    };

    return NextResponse.json(settings);
  } catch (error) {
    console.error('[Agent Settings API] Error fetching settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agent settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      budgetMaxLlmCalls,
      budgetMaxTokens,
      budgetMaxWebSearches,
      confidenceThreshold,
      budgetMaxDurationMinutes,
      taskTimeoutMinutes,
      plannerModel,
      executorModel,
      checkerModel,
      summarizerModel,
      summarizerSystemPrompt,
      plannerSystemPrompt,
      // Streaming configuration
      streamingKeepaliveInterval,
      streamingMaxDuration,
      streamingToolTimeout,
    } = body;

    // Validate budget inputs
    if (
      typeof budgetMaxLlmCalls !== 'number' ||
      typeof budgetMaxTokens !== 'number' ||
      typeof budgetMaxWebSearches !== 'number' ||
      typeof confidenceThreshold !== 'number' ||
      typeof budgetMaxDurationMinutes !== 'number' ||
      typeof taskTimeoutMinutes !== 'number'
    ) {
      return NextResponse.json(
        { error: 'Invalid input: all budget fields must be numbers' },
        { status: 400 }
      );
    }

    // Validate streaming inputs (optional - use defaults if not provided)
    const hasStreamingConfig =
      streamingKeepaliveInterval !== undefined ||
      streamingMaxDuration !== undefined ||
      streamingToolTimeout !== undefined;

    if (hasStreamingConfig) {
      if (
        (streamingKeepaliveInterval !== undefined && typeof streamingKeepaliveInterval !== 'number') ||
        (streamingMaxDuration !== undefined && typeof streamingMaxDuration !== 'number') ||
        (streamingToolTimeout !== undefined && typeof streamingToolTimeout !== 'number')
      ) {
        return NextResponse.json(
          { error: 'Invalid input: streaming fields must be numbers' },
          { status: 400 }
        );
      }
    }

    // Validate model configurations
    if (
      !validateAgentModelConfig(plannerModel) ||
      !validateAgentModelConfig(executorModel) ||
      !validateAgentModelConfig(checkerModel) ||
      !validateAgentModelConfig(summarizerModel)
    ) {
      return NextResponse.json(
        { error: 'Invalid model configuration' },
        { status: 400 }
      );
    }

    // Validate ranges
    if (
      budgetMaxLlmCalls < 1 ||
      budgetMaxLlmCalls > 10000 ||
      budgetMaxTokens < 1000 ||
      budgetMaxTokens > 100000000 ||
      budgetMaxWebSearches < 1 ||
      budgetMaxWebSearches > 1000 ||
      confidenceThreshold < 0 ||
      confidenceThreshold > 100 ||
      budgetMaxDurationMinutes < 1 ||
      budgetMaxDurationMinutes > 480 ||
      taskTimeoutMinutes < 1 ||
      taskTimeoutMinutes > 60
    ) {
      return NextResponse.json(
        { error: 'Values out of valid range' },
        { status: 400 }
      );
    }

    // Validate streaming ranges (if provided)
    if (hasStreamingConfig) {
      const keepalive = streamingKeepaliveInterval ?? 10;
      const maxDuration = streamingMaxDuration ?? 300;
      const toolTimeout = streamingToolTimeout ?? 60;

      if (
        keepalive < 5 || keepalive > 60 ||
        maxDuration < 60 || maxDuration > 600 ||
        toolTimeout < 30 || toolTimeout > 300
      ) {
        return NextResponse.json(
          { error: 'Streaming values out of valid range' },
          { status: 400 }
        );
      }
    }

    // Save budget settings to database
    await setSetting('agent_budget_max_llm_calls', String(budgetMaxLlmCalls), user.email);
    await setSetting('agent_budget_max_tokens', String(budgetMaxTokens), user.email);
    await setSetting('agent_budget_max_web_searches', String(budgetMaxWebSearches), user.email);
    await setSetting('agent_confidence_threshold', String(confidenceThreshold), user.email);
    await setSetting('agent_budget_max_duration_minutes', String(budgetMaxDurationMinutes), user.email);
    await setSetting('agent_task_timeout_minutes', String(taskTimeoutMinutes), user.email);

    // Save model configurations
    await setAgentModelConfigs(
      {
        planner: plannerModel,
        executor: executorModel,
        checker: checkerModel,
        summarizer: summarizerModel,
      },
      user.email
    );

    // Save summarizer system prompt (if provided)
    if (typeof summarizerSystemPrompt === 'string') {
      await setSummarizerSystemPrompt(summarizerSystemPrompt, user.email);
    }

    // Save planner system prompt (if provided)
    if (typeof plannerSystemPrompt === 'string') {
      await setPlannerSystemPrompt(plannerSystemPrompt, user.email);
    }

    // Save streaming configuration (if provided)
    if (hasStreamingConfig) {
      const currentStreaming = await getStreamingConfig();
      await setStreamingConfig(
        {
          keepalive_interval_seconds: streamingKeepaliveInterval ?? currentStreaming.keepalive_interval_seconds,
          max_stream_duration_seconds: streamingMaxDuration ?? currentStreaming.max_stream_duration_seconds,
          tool_timeout_seconds: streamingToolTimeout ?? currentStreaming.tool_timeout_seconds,
        },
        user.email
      );
    }

    // Get current configs for response
    const finalStreamingConfig = await getStreamingConfig();
    const finalSummarizerPrompt = await getSummarizerSystemPrompt();
    const finalPlannerPrompt = await getPlannerSystemPrompt();

    return NextResponse.json({
      success: true,
      settings: {
        budgetMaxLlmCalls,
        budgetMaxTokens,
        budgetMaxWebSearches,
        confidenceThreshold,
        budgetMaxDurationMinutes,
        taskTimeoutMinutes,
        plannerModel,
        executorModel,
        checkerModel,
        summarizerModel,
        summarizerSystemPrompt: finalSummarizerPrompt,
        plannerSystemPrompt: finalPlannerPrompt,
        streamingKeepaliveInterval: finalStreamingConfig.keepalive_interval_seconds,
        streamingMaxDuration: finalStreamingConfig.max_stream_duration_seconds,
        streamingToolTimeout: finalStreamingConfig.tool_timeout_seconds,
        updatedAt: new Date().toISOString(),
        updatedBy: user.email,
      },
    });
  } catch (error) {
    console.error('[Agent Settings API] Error saving settings:', error);
    return NextResponse.json(
      { error: 'Failed to save agent settings' },
      { status: 500 }
    );
  }
}
