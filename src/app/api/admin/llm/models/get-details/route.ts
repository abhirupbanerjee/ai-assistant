/**
 * Get Model Details API
 *
 * POST /api/admin/llm/models/get-details?id=<modelId>
 *
 * Fetch capability details for a model using AI search (primary)
 * or pattern matching (fallback). Does NOT auto-save — returns
 * data for admin review before applying.
 *
 * Uses a query parameter for the model ID to avoid catch-all routing
 * conflicts (model IDs like fireworks/minimax-m2p5 contain slashes).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { getEnabledModel } from '@/lib/db/compat/enabled-models';
import { isTavilyConfigured } from '@/lib/tools/tavily';
import { getWebSearchConfig } from '@/lib/db/compat/tool-config';
import { callLLMForJson } from '@/lib/llm-utils';
import { isToolCapable, isVisionCapable, isParallelToolCapable, isThinkingCapable, getContextWindow } from '@/lib/services/model-discovery';
import type { ApiError } from '@/types';

// POST /api/admin/llm/models/get-details?id=<modelId>
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user?.isAdmin) {
      return NextResponse.json<ApiError>(
        { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
        { status: 403 }
      );
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json<ApiError>(
        { error: 'Model ID required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const model = await getEnabledModel(id);
    if (!model) {
      return NextResponse.json<ApiError>(
        { error: 'Model not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // ── Primary: Tavily web search + LLM extraction ──
    const tavilyAvailable = await isTavilyConfigured();

    if (tavilyAvailable) {
      try {
        const { config: tavilyConfig } = await getWebSearchConfig();
        const apiKey = (tavilyConfig.apiKey as string | undefined) || process.env.TAVILY_API_KEY;

        const searchResponse = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: apiKey,
            query: `${id} LLM model context window tokens tool calling function calling vision multimodal capabilities`,
            search_depth: 'advanced',
            max_results: 5,
            include_answer: 'basic',
          }),
        });

        if (searchResponse.ok) {
          const searchData = await searchResponse.json() as {
            results?: Array<{ title?: string; content?: string; url?: string }>;
          };

          const snippets = (searchData.results || [])
            .map(r => `${r.title ?? ''}: ${r.content ?? ''}`)
            .join('\n\n')
            .slice(0, 3000);

          const sources = (searchData.results || [])
            .map(r => r.url)
            .filter((u): u is string => Boolean(u))
            .slice(0, 3);

          const raw = await callLLMForJson(
            `Model ID: ${id}\n\nWeb search results:\n${snippets}\n\nExtract capabilities for this specific model. If a field is not clearly confirmed, use null for numbers or false for booleans.`,
            {
              systemPrompt:
                'You are a technical assistant extracting LLM model capability data. Return JSON only with these exact fields: toolCapable (boolean), visionCapable (boolean), parallelToolCapable (boolean - true if the model reliably handles multiple tool calls in a single response), thinkingCapable (boolean - true if the model outputs reasoning/thinking content), maxInputTokens (number or null), maxOutputTokens (number or null), confidence ("high"|"medium"|"low"). Be conservative — only mark true/set values if explicitly confirmed by the sources.',
              maxTokens: 300,
              temperature: 0,
              timeout: 15000,
            }
          );

          const parsed = JSON.parse(raw) as {
            toolCapable?: boolean;
            visionCapable?: boolean;
            parallelToolCapable?: boolean;
            thinkingCapable?: boolean;
            maxInputTokens?: number | null;
            maxOutputTokens?: number | null;
            confidence?: string;
          };

          return NextResponse.json({
            found: true,
            toolCapable: Boolean(parsed.toolCapable),
            visionCapable: Boolean(parsed.visionCapable),
            parallelToolCapable: Boolean(parsed.parallelToolCapable),
            thinkingCapable: Boolean(parsed.thinkingCapable),
            maxInputTokens: typeof parsed.maxInputTokens === 'number' ? parsed.maxInputTokens : null,
            maxOutputTokens: typeof parsed.maxOutputTokens === 'number' ? parsed.maxOutputTokens : null,
            confidence: parsed.confidence || 'medium',
            source: 'web_search',
            sources,
          });
        }
      } catch (err) {
        console.warn('[GetDetails] AI/Tavily search failed, falling back to patterns:', err);
      }
    }

    // ── Fallback: pattern matching (read-only, no DB write) ──
    const toolCapable = isToolCapable(id);
    const visionCapable = isVisionCapable(id);
    const parallelToolCapable = isParallelToolCapable(id);
    const thinkingCapable = isThinkingCapable(id);
    const maxInputTokens = getContextWindow(id);

    return NextResponse.json({
      found: true,
      toolCapable,
      visionCapable,
      parallelToolCapable,
      thinkingCapable,
      maxInputTokens,
      maxOutputTokens: null,
      confidence: 'medium',
      source: 'pattern_match',
      sources: [],
    });
  } catch (error) {
    console.error('[GetDetails] POST error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Failed to get model details',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
