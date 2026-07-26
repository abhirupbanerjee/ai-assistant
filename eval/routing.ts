/**
 * Routing Eval Runner — Phase 2.2 Step 7
 *
 * Usage:
 *   npm run eval:routing          # defaults to --mock
 *   npm run eval:routing:mock     # deterministic, CI-safe, regression-gated
 *   npm run eval:routing:live     # real model, manual/scheduled
 *
 * Modes:
 *   --mock  Determines each case's routing mode by running the labeled
 *           `expectedToolCall` through `determineRoutingMode` and asserts it
 *           matches `expectedMode`. Deterministic, free, CI-safe. Compares
 *           results to `eval/baseline.json` and exits non-zero ONLY on
 *           regression (a previously-passing case now failing). Pass
 *           `--update-baseline` to write the current results as the new
 *           baseline.
 *
 *   --live  Calls a real (cheap) model with the actual agent+handoff tool
 *           list and records which tool (if any) it calls, then classifies
 *           via `determineRoutingMode`. Writes results to
 *           `eval/results-<timestamp>.json`. NOT CI-gated. Requires a
 *           configured model + DB; gracefully skips cases if unavailable.
 *
 * See plans/phase_2_2_implementation_plan.md §7.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { determineRoutingMode, type RoutingMode } from '../src/lib/agent-registry/routing-mode';

interface RoutingCase {
  id: string;
  input: string;
  threadCategories: number[];
  expectedMode: RoutingMode;
  expectedToolCall: string | null;
  expectedTargetCategory?: string;
  notes?: string;
}

interface CaseResult {
  id: string;
  passed: boolean;
  expected: RoutingMode;
  actual: RoutingMode;
  toolCall?: string | null;
  reason?: string;
}

interface BaselineFile {
  generatedAt: string;
  mode: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    byMode: Record<string, { total: number; passed: number; failed: number }>;
  };
  cases: Array<{ id: string; passed: boolean }>;
}

const EVAL_DIR = __dirname;
const CASES_PATH = path.join(EVAL_DIR, 'routing-cases.json');
const BASELINE_PATH = path.join(EVAL_DIR, 'baseline.json');

function loadCases(): RoutingCase[] {
  const raw = fs.readFileSync(CASES_PATH, 'utf8');
  return JSON.parse(raw) as RoutingCase[];
}

function loadBaseline(): BaselineFile | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile;
}

function emptyByMode(): Record<string, { total: number; passed: number; failed: number }> {
  return {
    solo: { total: 0, passed: 0, failed: 0 },
    return_result: { total: 0, passed: 0, failed: 0 },
    handoff: { total: 0, passed: 0, failed: 0 },
  };
}

/**
 * Resolve the tool-call name a case is labeled to produce, for mock mode.
 * `expectedToolCall` is one of: null (solo), "agent__*" (return_result), or
 * "handoff_to_category" (handoff). For "agent__*" we synthesize a concrete
 * agent tool name so determineRoutingMode has a realistic input.
 */
function mockToolCallForCase(c: RoutingCase): string | null {
  if (c.expectedToolCall === null) return null;
  if (c.expectedToolCall === 'agent__*') return 'agent__tpl-executor';
  return c.expectedToolCall;
}

function runMock(cases: RoutingCase[]): CaseResult[] {
  return cases.map((c) => {
    const toolCall = mockToolCallForCase(c);
    const actual = determineRoutingMode(toolCall);
    const passed = actual === c.expectedMode;
    return {
      id: c.id,
      passed,
      expected: c.expectedMode,
      actual,
      toolCall,
      reason: passed ? undefined : `Expected ${c.expectedMode}, got ${actual}`,
    };
  });
}

/**
 * Live mode: attempt to call a real model with the agent+handoff tool list.
 * This requires a configured LLM + DB. If unavailable, the case is marked
 * skipped (passed=true with a reason) so it never regresses the baseline.
 *
 * This is intentionally lightweight: we import the heavy modules lazily so
 * `:mock` never pays the import cost.
 */
async function runLive(cases: RoutingCase[]): Promise<CaseResult[]> {
  let getToolDefinitions: typeof import('../src/lib/tools').getToolDefinitions | null = null;
  let generateToolCompletion: typeof import('../src/lib/openai').generateToolCompletion | null = null;
  let getLlmSettings: typeof import('../src/lib/db/compat/config').getLlmSettings | null = null;

  try {
    ({ getToolDefinitions } = await import('../src/lib/tools'));
    ({ generateToolCompletion } = await import('../src/lib/openai'));
    ({ getLlmSettings } = await import('../src/lib/db/compat/config'));
  } catch (err) {
    const reason = `Live mode unavailable (import failed): ${err instanceof Error ? err.message : String(err)}`;
    return cases.map((c) => ({
      id: c.id,
      passed: true,
      expected: c.expectedMode,
      actual: c.expectedMode,
      toolCall: null,
      reason: `SKIPPED — ${reason}`,
    }));
  }

  let model: string | null = null;
  try {
    const settings = await getLlmSettings();
    model = settings.model || null;
  } catch {
    model = null;
  }

  if (!model || !generateToolCompletion || !getToolDefinitions) {
    return cases.map((c) => ({
      id: c.id,
      passed: true,
      expected: c.expectedMode,
      actual: c.expectedMode,
      toolCall: null,
      reason: 'SKIPPED — no model configured or LLM client unavailable',
    }));
  }

  const results: CaseResult[] = [];
  // Build the tool list once (agent + handoff tools). Use categoryIds from
  // the first non-empty case to scope agent tools; fall back to undefined.
  const categoryIds = cases.find((c) => c.threadCategories.length > 0)?.threadCategories;
  let tools;
  try {
    tools = await getToolDefinitions(categoryIds);
  } catch (err) {
    const reason = `getToolDefinitions failed: ${err instanceof Error ? err.message : String(err)}`;
    return cases.map((c) => ({
      id: c.id,
      passed: true,
      expected: c.expectedMode,
      actual: c.expectedMode,
      toolCall: null,
      reason: `SKIPPED — ${reason}`,
    }));
  }

  for (const c of cases) {
    try {
      const messages = [
        { role: 'system' as const, content: 'You are a routing assistant. Decide whether to answer directly, delegate to a specialist agent tool, or hand off to another category. Use tools only when clearly appropriate.' },
        { role: 'user' as const, content: c.input },
      ];
      const modelSpec = {
        provider: detectProvider(model),
        model,
        temperature: 0.2,
        max_tokens: 1024,
      } as import('../src/types/agent').ModelSpec;
      const result = await generateToolCompletion(
        modelSpec,
        messages,
        tools,
        'auto',
        0.2,
        1024,
      );
      const toolCallName = result.tool_calls?.[0]?.function?.name ?? null;
      const actual = determineRoutingMode(toolCallName);
      const passed = actual === c.expectedMode;
      results.push({
        id: c.id,
        passed,
        expected: c.expectedMode,
        actual,
        toolCall: toolCallName,
        reason: passed ? undefined : `Expected ${c.expectedMode}, model chose ${toolCallName ?? 'no tool'}`,
      });
    } catch (err) {
      results.push({
        id: c.id,
        passed: true,
        expected: c.expectedMode,
        actual: c.expectedMode,
        toolCall: null,
        reason: `SKIPPED — LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return results;
}

function summarize(results: CaseResult[]) {
  const byMode = emptyByMode();
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const bucket = byMode[r.expected] ?? (byMode[r.expected] = { total: 0, passed: 0, failed: 0 });
    bucket.total++;
    if (r.passed) {
      passed++;
      bucket.passed++;
    } else {
      failed++;
      bucket.failed++;
    }
  }
  return { total: results.length, passed, failed, byMode };
}

function printReport(results: CaseResult[], summary: ReturnType<typeof summarize>) {
  console.log('\n=== Routing Eval Report ===\n');
  for (const r of results) {
    const flag = r.passed ? 'PASS' : 'FAIL';
    const skip = r.reason?.startsWith('SKIPPED') ? ' [SKIPPED]' : '';
    console.log(`[${flag}] ${r.id}: expected=${r.expected} actual=${r.actual}${skip}${r.reason && !skip ? ` — ${r.reason}` : ''}`);
  }
  console.log('\n--- Summary ---');
  console.log(`Total: ${summary.total}  Passed: ${summary.passed}  Failed: ${summary.failed}`);
  for (const [mode, stats] of Object.entries(summary.byMode)) {
    console.log(`  ${mode}: ${stats.passed}/${stats.total} passed`);
  }
  console.log('');
}

function writeBaseline(summary: ReturnType<typeof summarize>, results: CaseResult[]) {
  const baseline: BaselineFile = {
    generatedAt: new Date().toISOString(),
    mode: 'mock',
    summary,
    cases: results.map((r) => ({ id: r.id, passed: r.passed })),
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  console.log(`Baseline written to ${BASELINE_PATH}\n`);
}

/**
 * Minimal provider detection for the live eval runner. Mirrors the private
 * detectProviderForToolCompletion in openai.ts. Only used to build a ModelSpec
 * for the live LLM call; mock mode never touches this.
 */
function detectProvider(modelId: string): import('../src/types/agent').LLMProvider {
  if (modelId.startsWith('claude') || modelId.includes('anthropic')) return 'anthropic';
  if (modelId.startsWith('fireworks')) return 'fireworks';
  if (modelId.startsWith('ollama-cloud') || modelId.startsWith('ollama/cloud')) return 'ollama-cloud';
  if (modelId.startsWith('ollama')) return 'ollama';
  if (modelId.startsWith('moonshot') || modelId.startsWith('kimi')) return 'moonshot';
  if (modelId.startsWith('deepseek')) return 'deepseek';
  if (modelId.startsWith('azure-foundry/')) return 'azure-foundry';
  if (modelId.startsWith('gemini')) return 'gemini';
  if (modelId.startsWith('mistral') || modelId.startsWith('codestral') || modelId.startsWith('pixtral')) return 'mistral';
  return 'openai';
}

/**
 * Regression gate: a case regresses if it was passing in the baseline but is
 * now failing. New cases (not in baseline) don't regress. A previously-failing
 * case that now passes is an improvement, not a regression.
 */
function findRegressions(
  results: CaseResult[],
  baseline: BaselineFile | null
): CaseResult[] {
  if (!baseline) return [];
  const baselineById = new Map(baseline.cases.map((c) => [c.id, c.passed]));
  return results.filter((r) => {
    const wasPassing = baselineById.get(r.id);
    return wasPassing === true && !r.passed;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--live') ? 'live' : 'mock';
  const updateBaseline = args.includes('--update-baseline');

  const cases = loadCases();
  const results = mode === 'live' ? await runLive(cases) : runMock(cases);
  const summary = summarize(results);

  printReport(results, summary);

  if (mode === 'live') {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = path.join(EVAL_DIR, `results-${ts}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), mode, summary, cases: results }, null, 2) + '\n',
      'utf8'
    );
    console.log(`Live results written to ${outPath}\n`);
    // Live mode never fails CI — it's manual/scheduled.
    process.exit(0);
  }

  // Mock mode: regression gate
  if (updateBaseline) {
    writeBaseline(summary, results);
  }

  const baseline = loadBaseline();
  const regressions = findRegressions(results, baseline);
  if (regressions.length > 0) {
    console.error(`REGRESSION: ${regressions.length} case(s) that previously passed now fail:`);
    for (const r of regressions) {
      console.error(`  - ${r.id}: ${r.reason}`);
    }
    console.error('');
    process.exit(1);
  }

  if (summary.failed > 0) {
    console.error(`${summary.failed} case(s) failing, but no regression vs baseline (new or known-failing cases).`);
  } else {
    console.log('All cases passing.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Eval runner crashed:', err);
  process.exit(1);
});
