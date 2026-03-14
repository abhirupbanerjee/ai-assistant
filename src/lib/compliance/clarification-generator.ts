/**
 * Clarification Generator
 *
 * Generates intelligent contextual clarification questions when HITL is triggered.
 * Uses LLM for dynamic questions with template fallbacks.
 */

import type {
  ClarificationQuestion,
  ClarificationOption,
  ClarificationRequest,
  ComplianceCheckResult,
  TemplateClarification,
  ComplianceGlobalConfig,
  ResolvedPreflightConfig,
} from '../../types/compliance';

// ============ Template Clarifications ============

const TEMPLATE_CLARIFICATIONS: Record<string, TemplateClarification> = {
  web_search_empty: {
    context: 'Web search returned no results',
    question: 'How should I proceed?',
    options: [
      { id: 'broaden', label: 'Try broader search terms', action: 'retry_with' },
      { id: 'skip', label: 'Skip web search', action: 'skip' },
      { id: 'custom', label: 'Enter custom search terms', action: 'custom' },
    ],
    allowFreeText: true,
  },

  chart_no_data: {
    context: 'Chart has no data to display',
    question: 'What should I do with the visualization?',
    options: [
      { id: 'table', label: 'Use text table instead', action: 'substitute' },
      { id: 'skip', label: 'Skip visualization', action: 'skip' },
      { id: 'placeholder', label: 'Show "No data available" placeholder', action: 'substitute' },
    ],
    allowFreeText: false,
  },

  section_missing: {
    context: 'Required section is missing',
    question: 'How should I handle the missing section?',
    options: [
      { id: 'add_partial', label: 'Add section with available data', action: 'retry_with' },
      { id: 'add_note', label: 'Add section with "Data unavailable" note', action: 'substitute' },
      { id: 'remove', label: 'Remove this requirement', action: 'skip' },
    ],
    allowFreeText: false,
  },

  doc_gen_failed: {
    context: 'Document generation failed',
    question: 'What should I do?',
    options: [
      { id: 'retry', label: 'Try generating again', action: 'retry_with' },
      { id: 'text', label: 'Provide content as text instead', action: 'substitute' },
      { id: 'skip', label: 'Skip document generation', action: 'skip' },
    ],
    allowFreeText: false,
  },

  image_gen_failed: {
    context: 'Image generation failed',
    question: 'What should I do?',
    options: [
      { id: 'retry', label: 'Try generating again', action: 'retry_with' },
      { id: 'describe', label: 'Provide text description instead', action: 'substitute' },
      { id: 'skip', label: 'Skip image generation', action: 'skip' },
    ],
    allowFreeText: false,
  },

  data_source_empty: {
    context: 'Data source query returned no results',
    question: 'How should I proceed?',
    options: [
      { id: 'adjust', label: 'Adjust query parameters', action: 'retry_with' },
      { id: 'skip', label: 'Skip this data source', action: 'skip' },
      { id: 'custom', label: 'Provide custom query', action: 'custom' },
    ],
    allowFreeText: true,
  },

  tool_error: {
    context: 'Tool execution encountered an error',
    question: 'How should I proceed?',
    options: [
      { id: 'retry', label: 'Try again', action: 'retry_with' },
      { id: 'skip', label: 'Skip this tool', action: 'skip' },
      { id: 'alternative', label: 'Try alternative approach', action: 'substitute' },
    ],
    allowFreeText: true,
  },
};

// ============ Provider-Specific Prompts ============

const CLARIFICATION_PROMPTS: Record<string, string> = {
  openai: `You are a compliance assistant. Return JSON only, no explanation.

FAILURES:
{{failures}}

ORIGINAL QUERY: "{{query}}"

{{customInstructions}}

Generate 1-3 clarifying questions as JSON:
{"questions": [{"id": "q1", "context": "...", "question": "...", "options": [{"id": "a", "label": "...", "action": "retry_with|skip|substitute|custom", "actionData": {...}}], "allowFreeText": true|false}]}`,

  gemini: `Output must be raw JSON, no markdown fencing.

Analyze these compliance failures and generate clarifying questions:

FAILURES:
{{failures}}

ORIGINAL QUERY: "{{query}}"

{{customInstructions}}

Return ONLY this JSON structure:
{"questions": [{"id": "q1", "context": "...", "question": "...", "options": [{"id": "a", "label": "...", "action": "retry_with|skip|substitute|custom"}], "allowFreeText": true}]}`,

  mistral: `Respond with JSON object only. No preamble or explanation.

Compliance failures:
{{failures}}

Original query: "{{query}}"

{{customInstructions}}

Output format:
{"questions": [{"id": "q1", "context": "...", "question": "...", "options": [{"id": "a", "label": "...", "action": "retry_with"}], "allowFreeText": true}]}`,
};

// ============ Main Functions ============

/**
 * Generate clarification questions for failed checks
 */
export async function generateClarifications(
  request: ClarificationRequest,
  config: ComplianceGlobalConfig
): Promise<ClarificationQuestion[]> {
  // If LLM clarifications disabled, use templates
  if (!config.useLlmClarifications) {
    return getTemplateClarifications(request.failures);
  }

  try {
    const result = await llmGenerateClarifications(request, config);
    return result;
  } catch (error) {
    console.warn('LLM clarification failed, using templates:', error);

    if (config.fallbackToTemplates) {
      return getTemplateClarifications(request.failures);
    }

    // Return generic clarifications as last resort
    return getGenericClarifications(request.failures);
  }
}

/**
 * Generate clarifications using LLM
 */
async function llmGenerateClarifications(
  request: ClarificationRequest,
  config: ComplianceGlobalConfig
): Promise<ClarificationQuestion[]> {
  const provider = config.clarificationProvider === 'auto'
    ? 'openai'
    : config.clarificationProvider;

  const promptTemplate = CLARIFICATION_PROMPTS[provider] || CLARIFICATION_PROMPTS.openai;

  // Build failures string
  const failuresText = request.failures
    .filter(f => !f.passed)
    .map(f => `- ${f.checkType} (${f.target}): ${f.detail}`)
    .join('\n');

  // Build prompt
  const prompt = promptTemplate
    .replace('{{failures}}', failuresText)
    .replace('{{query}}', request.originalQuery)
    .replace('{{customInstructions}}', request.customInstructions || '');

  // Call LLM (using the existing LLM infrastructure)
  const response = await callClarificationLLM(prompt, config);

  // Parse response
  return parseClarificationResponse(response);
}

/**
 * Call LLM for clarification generation
 * Uses the project's existing LLM infrastructure
 */
async function callClarificationLLM(
  prompt: string,
  config: ComplianceGlobalConfig
): Promise<string> {
  // Import dynamically to avoid circular dependencies
  const { callLLMForJson } = await import('../llm-utils');

  const response = await callLLMForJson(prompt, {
    model: config.clarificationModel,
    timeout: config.clarificationTimeout,
  });

  return response;
}

/**
 * Parse LLM response with defensive JSON handling
 */
export function parseClarificationResponse(raw: string): ClarificationQuestion[] {
  // Strip markdown fences (Gemini/Mistral sometimes add these)
  let cleaned = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  // Try to find JSON object if there's preamble text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(cleaned);

    // Validate structure
    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      console.warn('Invalid clarification response structure');
      return [];
    }

    // Validate each question
    return parsed.questions.filter((q: unknown) => {
      if (typeof q !== 'object' || q === null) return false;
      const question = q as Record<string, unknown>;
      return (
        typeof question.id === 'string' &&
        typeof question.context === 'string' &&
        typeof question.question === 'string' &&
        Array.isArray(question.options)
      );
    }).map((q: Record<string, unknown>) => ({
      id: q.id as string,
      context: q.context as string,
      question: q.question as string,
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((opt: unknown): opt is Record<string, unknown> =>
          typeof opt === 'object' && opt !== null &&
          typeof (opt as Record<string, unknown>).id === 'string' &&
          typeof (opt as Record<string, unknown>).label === 'string' &&
          typeof (opt as Record<string, unknown>).action === 'string'
        )
        .map((opt: Record<string, unknown>) => ({
          id: opt.id as string,
          label: opt.label as string,
          action: opt.action as ClarificationOption['action'],
          description: (opt.description as string) || undefined,
          ...(opt.actionData ? { actionData: opt.actionData as Record<string, unknown> } : {}),
        })),
      allowFreeText: (q.allowFreeText as boolean) ?? true,
    }));
  } catch (error) {
    console.warn('LLM clarification JSON parse failed:', error);
    return [];
  }
}

/**
 * Get template-based clarifications for failures
 */
export function getTemplateClarifications(
  failures: ComplianceCheckResult[]
): ClarificationQuestion[] {
  return failures
    .filter(failure => !failure.passed)
    .map((failure, index) => {
      const templateKey = getTemplateKey(failure);
      const template = TEMPLATE_CLARIFICATIONS[templateKey];

      if (template) {
        return {
          id: `q_${failure.checkType}_${index}`,
          context: template.context,
          question: template.question,
          options: template.options,
          allowFreeText: template.allowFreeText,
        };
      }

      // Generic fallback
      return {
        id: `q_generic_${index}`,
        context: failure.detail,
        question: 'How would you like to proceed?',
        options: [
          { id: 'retry', label: 'Try again', action: 'retry_with' as const },
          { id: 'skip', label: 'Skip this check', action: 'skip' as const },
          { id: 'accept', label: 'Accept as-is', action: 'skip' as const },
        ],
        allowFreeText: true,
      };
    });
}

/**
 * Get generic clarifications (last resort)
 */
export function getGenericClarifications(
  failures: ComplianceCheckResult[]
): ClarificationQuestion[] {
  if (failures.length === 0) return [];

  return [{
    id: 'q_generic',
    context: `${failures.length} check(s) did not pass`,
    question: 'How would you like to proceed?',
    options: [
      { id: 'retry', label: 'Try again with improvements', action: 'retry_with' },
      { id: 'accept', label: 'Accept current response', action: 'skip' },
    ],
    allowFreeText: true,
  }];
}

/**
 * Get template key for a failure
 */
function getTemplateKey(failure: ComplianceCheckResult): string {
  const { checkType, target } = failure;

  // Map to template keys
  if (checkType === 'data_returned' && target === 'web_search') {
    return 'web_search_empty';
  }
  if (checkType === 'artifact_valid' && target === 'chart_gen') {
    return 'chart_no_data';
  }
  if (checkType === 'sections_present') {
    return 'section_missing';
  }
  if (checkType === 'artifact_valid' && target === 'doc_gen') {
    return 'doc_gen_failed';
  }
  if (checkType === 'artifact_valid' && target === 'image_gen') {
    return 'image_gen_failed';
  }
  if (checkType === 'data_returned' && target === 'data_source') {
    return 'data_source_empty';
  }
  if (checkType === 'tool_success') {
    return 'tool_error';
  }

  return 'tool_error'; // Default fallback
}

// ============ Pre-flight Clarification ============

const PREFLIGHT_SYSTEM_PROMPT = `You assess whether a user query is ambiguous and needs clarification BEFORE generating a response.

IMPORTANT: Most queries are clear enough to answer directly. Only generate questions when the query is genuinely ambiguous and clarification would meaningfully improve the response.

Return JSON only. If the query is clear, return: {"questions": []}

If ambiguous, return 1-{{maxQuestions}} questions:
{"questions": [{"id": "q1", "context": "Why this needs clarification", "question": "Your question?", "options": [{"id": "a", "label": "Option A", "action": "retry_with"}, {"id": "b", "label": "Option B", "action": "retry_with"}], "allowFreeText": true}]}

Rules:
- Prefer FEWER questions. One good question > multiple marginal ones.
- Each question must have 2-4 options.
- Use action "retry_with" for all options (pre-flight context enrichment).
- Set allowFreeText: true when the user might have a specific answer not in the options.
- Do NOT ask about formatting, length, or style preferences.
- Do NOT ask questions the response can easily cover with a general answer.`;

/**
 * Generate pre-flight clarification questions for an ambiguous query.
 * Returns [] when the query is clear (the common case).
 * Never throws — returns [] on any error.
 */
export async function generatePreflightClarifications(
  userMessage: string,
  resolvedConfig: ResolvedPreflightConfig,
  globalConfig: ComplianceGlobalConfig,
): Promise<ClarificationQuestion[]> {
  try {
    const { callLLMForJson } = await import('../llm-utils');

    const systemPrompt = PREFLIGHT_SYSTEM_PROMPT
      .replace('{{maxQuestions}}', String(resolvedConfig.maxQuestions));

    const userPrompt = resolvedConfig.instructions
      ? `DOMAIN CONTEXT:\n${resolvedConfig.instructions}\n\nUSER QUERY: "${userMessage}"`
      : `USER QUERY: "${userMessage}"`;

    const response = await callLLMForJson(userPrompt, {
      model: globalConfig.clarificationModel || undefined,
      timeout: Math.min(globalConfig.clarificationTimeout, 10000), // Cap at 10s for preflight LLM call
      temperature: 0.2,
      maxTokens: 800,
      systemPrompt,
    });

    return parseClarificationResponse(response);
  } catch (error) {
    console.warn('[Preflight] LLM clarification generation failed:', error);
    return [];
  }
}
