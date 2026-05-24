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

interface TavilySearchResult {
  title?: string;
  content?: string;
  url?: string;
  raw_content?: string;
}

interface TavilySearchResponse {
  answer?: string;
  results?: TavilySearchResult[];
}

/** Tavily hard limit — queries over 400 chars return HTTP 400. */
const TAVILY_MAX_QUERY_LENGTH = 400;

/**
 * Build a directive Tavily query that asks for specific fields.
 * This format triggers Tavily's advanced answer to return structured bullet points.
 * Kept compact to stay well under the 400-character Tavily limit.
 */
function buildSearchQuery(id: string): string {
  const query = `Search for ${id}. 1) tool calling? 2) vision? 3) parallel tools? 4) thinking? 5) context window & max output tokens? 6) input/output cost USD/1M?`;
  if (query.length > TAVILY_MAX_QUERY_LENGTH) {
    // Fallback: strip the numbered list and keep only keywords
    return `Search for ${id}. tool calling vision parallel thinking context window max output tokens input output cost USD/1M`.slice(0, TAVILY_MAX_QUERY_LENGTH);
  }
  return query;
}

/**
 * Return provider-specific hints so the LLM knows which pricing/specs to prefer.
 */
function getProviderHint(id: string): string {
  if (id.startsWith('fireworks/')) {
    return 'This model is hosted on Fireworks AI. Prefer Fireworks Serverless pricing and context-window specs over the original vendor\'s numbers.';
  }
  if (id.startsWith('moonshot/')) {
    return 'This is a Moonshot AI model. Prefer Moonshot\'s official pricing and specs.';
  }
  if (id.startsWith('ollama-') || id.startsWith('ollama/')) {
    return 'This is an Ollama local model. Costs are typically zero (self-hosted). Extract context window and capabilities only.';
  }
  return '';
}

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
            query: buildSearchQuery(id),
            search_depth: 'advanced',
            max_results: 3,
            include_answer: 'advanced',
            include_raw_content: 'markdown',
          }),
        });

        if (searchResponse.ok) {
          const searchData = (await searchResponse.json()) as TavilySearchResponse;

          const answer = searchData.answer || '';

          // Build snippets from raw_content when available (much richer than summary content)
          const snippets = (searchData.results || [])
            .map(r => {
              const body = r.raw_content || r.content || '';
              return `Title: ${r.title ?? 'Untitled'}\nURL: ${r.url ?? ''}\n${body}`;
            })
            .join('\n\n---\n\n')
            .slice(0, 5000);

          const sources = (searchData.results || [])
            .map(r => r.url)
            .filter((u): u is string => Boolean(u))
            .slice(0, 3);

          const providerHint = getProviderHint(id);

          // Compose prompt that feeds Tavily's synthesized answer AND raw page content
          // to the LLM for structured extraction.
          const promptParts: string[] = [
            `Model ID: ${id}`,
            providerHint,
            '',
            '=== Tavily AI-generated Answer ===',
            answer || '(no answer provided)',
            '',
            '=== Raw Search Results ===',
            snippets,
            '',
            `Extract the exact capabilities and pricing for "${id}" from the sources above.`,
            'Field-by-field instructions:',
            '- toolCapable: true if the source mentions "tool calling", "function calling", "supports tools/functions", or shows function-calling compatibility.',
            '- visionCapable: true ONLY if the source explicitly mentions "vision", "multimodal", "image input", or "supports images". If the source says "Input: text" or does not mention vision at all, set to false.',
            '- parallelToolCapable: true ONLY if explicitly mentioned (e.g., "parallel tool calling", "multiple tools", "n-parallel"). Default false.',
            '- thinkingCapable: true if the source mentions "thinking", "reasoning", "extended thinking", or "reasoning tokens".',
            '- maxInputTokens: look for "Context Window", "context window", "Context window", "contextWindow" and extract the token number (e.g., 202800, 128000, 1000000).',
            '- maxOutputTokens: look for "Max Output", "max output tokens", "Max tokens", "maxTokens" and extract the token number. This may differ from the context window.',
            '- inputCostPer1M: look for "Input Cost / 1M", "Cost / million input", "input cost", "$1.40/1M", "$0.15/1M". Extract the USD numeric value only (e.g., 1.40).',
            '- outputCostPer1M: look for "Output Cost / 1M", "Cost / million output", "output cost", "$4.40/1M", "$0.60/1M". Extract the USD numeric value only (e.g., 4.40).',
            '',
            'Critical rules:',
            '- Only extract data for "' + id + '". Ignore sections like "More models from..." or comparison tables that discuss other models.',
            '- If multiple providers are mentioned, prefer the specs for the provider indicated above.',
            '- If a field is not clearly confirmed by the sources, use null for numbers or false for booleans. Be conservative.',
          ];

          const raw = await callLLMForJson(promptParts.join('\n'), {
            systemPrompt:
              'You are a technical assistant extracting LLM model capability and pricing data. Return JSON only with these exact fields: ' +
              'toolCapable (boolean), visionCapable (boolean), parallelToolCapable (boolean - true if the model reliably handles multiple tool calls in a single response), ' +
              'thinkingCapable (boolean - true if the model outputs reasoning/thinking content), ' +
              'maxInputTokens (number or null), maxOutputTokens (number or null), ' +
              'inputCostPer1M (number or null - USD cost per 1 million input tokens), outputCostPer1M (number or null - USD cost per 1 million output tokens), ' +
              'confidence ("high"|"medium"|"low"). ' +
              'Be conservative — only mark true/set values if explicitly confirmed by the sources.',
            maxTokens: 500,
            temperature: 0,
            timeout: 20000,
            assistantPrefix: '{',
          });

          // Greedy match from first '{' to last '}' so reasoning prose before
          // the JSON object doesn't break extraction.
          const first = raw.indexOf('{');
          const last = raw.lastIndexOf('}');
          if (first === -1 || last <= first) {
            throw new Error(`Non-JSON response from LLM: ${raw.slice(0, 80)}`);
          }
          const parsed = JSON.parse(raw.slice(first, last + 1)) as {
            toolCapable?: boolean;
            visionCapable?: boolean;
            parallelToolCapable?: boolean;
            thinkingCapable?: boolean;
            maxInputTokens?: number | null;
            maxOutputTokens?: number | null;
            inputCostPer1M?: number | null;
            outputCostPer1M?: number | null;
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
            inputCostPer1M: typeof parsed.inputCostPer1M === 'number' ? parsed.inputCostPer1M : null,
            outputCostPer1M: typeof parsed.outputCostPer1M === 'number' ? parsed.outputCostPer1M : null,
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
      inputCostPer1M: null,
      outputCostPer1M: null,
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
