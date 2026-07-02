/**
 * Prompt Category Classifier
 *
 * Classifies user prompts into semantic categories for Auto model selection.
 * Uses a two-tier approach:
 *   1. Fast path: signal-based detection (keywords, hasImages, forced tool)
 *   2. Slow path: cheap LLM call for ambiguous prompts (2s timeout)
 *
 * Results are cached in-memory by prompt hash with 5-min TTL.
 */

import { callLLMForJson } from '@/lib/llm-utils';
import type { CapabilityScores } from '@/lib/db/enabled-models';

// ============ Types ============

export type PromptCategory =
  | 'code'
  | 'data'
  | 'creative'
  | 'translate'
  | 'summarize'
  | 'tools'
  | 'visual'
  | 'chat'
  | 'research';

export interface ClassificationResult {
  category: PromptCategory;
  source: 'signal' | 'llm' | 'default';
  /** Primary capability dimension for this category */
  dimension: keyof CapabilityScores;
}

// ============ Category → Dimension Mapping ============

export const CATEGORY_DIMENSION: Record<PromptCategory, keyof CapabilityScores> = {
  code:       'code_quality',
  data:       'function_calling',
  creative:   'reasoning',
  translate:  'reasoning',
  summarize:  'reasoning',
  tools:      'function_calling',
  visual:     'visual_reasoning',
  chat:       'reasoning',
  research:   'reasoning',
};

// ============ Fast-Path Keyword Detection ============

const FAST_PATH_RULES: Array<{
  test: (input: string, hasImages: boolean, hasToolMatch: boolean) => boolean;
  category: PromptCategory;
}> = [
  {
    // Images present → visual category
    test: (_msg, hasImages) => hasImages,
    category: 'visual',
  },
  {
    // Tool routing matched (forced or preferred/suggested) → tools category
    test: (_msg, _hasImages, hasToolMatch) => hasToolMatch,
    category: 'tools',
  },
  {
    // Document/presentation generation requests
    test: (msg) => /\b(generate|create|make|build|produce)\s+(a |an )?(document|report|pdf|docx|memo|letter|proposal|slides|presentation|spreadsheet|excel|csv)\b/i.test(msg),
    category: 'tools',
  },
  {
    // Image/diagram generation requests
    test: (msg) => /\b(generate|create|make|draw|design)\s+(a |an )?(image|picture|photo|illustration|diagram|infographic|logo|icon|chart|graph|flowchart)\b/i.test(msg),
    category: 'tools',
  },
  {
    // Spreadsheet/presentation by file type
    test: (msg) => /\b(spreadsheet|excel|\.xlsx|\.csv|powerpoint|\.pptx|slide deck)\b/i.test(msg),
    category: 'tools',
  },
  {
    // Code-related keywords
    test: (msg) => /\b(code|function|class |import |export |debug|refactor|bug|api |endpoint|algorithm|regex|sql |query |database)\b/i.test(msg),
    category: 'code',
  },
  {
    // Translation keywords
    test: (msg) => /\b(translate|traduci|übersetzen|traduire|traducir|translation)\b/i.test(msg),
    category: 'translate',
  },
  {
    // Summarization keywords
    test: (msg) => /\b(summarize|summary|summarise|tldr|key points|bullet points)\b/i.test(msg),
    category: 'summarize',
  },
  {
    // Data analysis keywords (catch after generation rules above)
    test: (msg) => /\b(analyze|analysis|statistics|trend|compare|metrics|kpi)\b/i.test(msg),
    category: 'data',
  },
  {
    // RAG / document Q&A — queries about internal policies, procedures, manuals
    test: (msg) => /\b(policy|procedure|guideline|regulation|compliance|standard|protocol|manual|handbook|according to|what does.*say|per the)\b/i.test(msg),
    category: 'research',
  },
  {
    // Web search and fact-finding requests
    test: (msg) => /\b(search|find|look\s*up|google|what is|who is|when did|where is|latest|recent|news about)\b/i.test(msg),
    category: 'research',
  },
  {
    // Research keywords
    test: (msg) => /\b(research|investigate|explore|deep dive|comprehensive|in[- ]depth|thorough)\b/i.test(msg),
    category: 'research',
  },
];

// ============ Cache ============

const classificationCache = new Map<string, { result: ClassificationResult; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 500;

function cacheKey(msg: string, hasImages: boolean, hasToolMatch: boolean): string {
  // Use first 200 chars as cache key (enough to distinguish prompts)
  return `${hasImages ? 'V' : 'v'}:${hasToolMatch ? 'T' : 't'}:${msg.slice(0, 200)}`;
}

function cacheGet(key: string): ClassificationResult | null {
  const entry = classificationCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    classificationCache.delete(key);
    return null;
  }
  return entry.result;
}

function cacheSet(key: string, result: ClassificationResult): void {
  if (classificationCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry
    const firstKey = classificationCache.keys().next().value;
    if (firstKey) classificationCache.delete(firstKey);
  }
  classificationCache.set(key, { result, ts: Date.now() });
}

// ============ LLM Classifier (Slow Path) ============

const CLASSIFIER_SYSTEM_PROMPT = 'Classify user requests into ONE category. Reply with ONLY the category name.';

const CLASSIFIER_PROMPT = `Classify: "{{msg}}"

Categories:
- code: programming, debugging, SQL, API design, refactoring
- data: analysis, statistics, metrics, trends, KPI review
- creative: writing, storytelling, poetry, brainstorming
- translate: language translation between languages
- summarize: condensing text, key points, TLDR, bullet summary
- tools: document generation, image creation, web search, spreadsheets, presentations, function calling
- visual: image input provided, photo analysis, diagram reading
- chat: casual conversation, advice, opinions, how-to questions
- research: in-depth investigation, fact-finding, policy lookup, comprehensive analysis

Pick ONE category. Reply with only the category name.`;

const VALID_CATEGORIES = new Set<string>([
  'code', 'data', 'creative', 'translate', 'summarize', 'tools', 'visual', 'chat', 'research',
]);

async function classifyViaLLM(userMessage: string): Promise<PromptCategory | null> {
  try {
    const prompt = CLASSIFIER_PROMPT.replace('{{msg}}', userMessage.slice(0, 200));
    const raw = await callLLMForJson(prompt, {
      systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
      temperature: 0,
      maxTokens: 10,
      timeout: 2000,
    });

    // Extract just the category word
    const match = raw.trim().toLowerCase().match(/\b(code|data|creative|translate|summarize|tools|visual|chat|research)\b/);
    if (match && VALID_CATEGORIES.has(match[1])) {
      return match[1] as PromptCategory;
    }
    return null;
  } catch {
    // LLM call failed or timed out — fall through to default
    return null;
  }
}

// ============ Public API ============

/**
 * Classify a user prompt into a semantic category.
 *
 * @param userMessage - The user's message text
 * @param hasImages - Whether the message includes image attachments
 * @param hasForcedTool - Whether a forced tool was matched by routing rules
 * @returns ClassificationResult with category, source, and capability dimension
 */
export async function classifyPrompt(
  userMessage: string,
  hasImages: boolean = false,
  hasToolMatch: boolean = false,
): Promise<ClassificationResult> {
  // Check cache
  const key = cacheKey(userMessage, hasImages, hasToolMatch);
  const cached = cacheGet(key);
  if (cached) return cached;

  // ── Tier 1: Fast-path signal detection ──
  for (const rule of FAST_PATH_RULES) {
    if (rule.test(userMessage, hasImages, hasToolMatch)) {
      const result: ClassificationResult = {
        category: rule.category,
        source: 'signal',
        dimension: CATEGORY_DIMENSION[rule.category],
      };
      cacheSet(key, result);
      return result;
    }
  }

  // ── Tier 2: Cheap LLM call ──
  const llmCategory = await classifyViaLLM(userMessage);
  if (llmCategory) {
    const result: ClassificationResult = {
      category: llmCategory,
      source: 'llm',
      dimension: CATEGORY_DIMENSION[llmCategory],
    };
    cacheSet(key, result);
    return result;
  }

  // ── Tier 3: Default fallback ──
  const result: ClassificationResult = {
    category: 'chat',
    source: 'default',
    dimension: 'reasoning',
  };
  cacheSet(key, result);
  return result;
}
