/**
 * Response-Style Eval Runner — plans/user-tone-updates.md Phase 4.
 *
 * Usage:
 *   npm run eval:style                 # defaults to --mock
 *   npm run eval:style:mock            # deterministic, CI-safe, regression-gated
 *   npm run eval:style:live            # real model, manual/scheduled
 *
 * Modes:
 *   --mock  Assembles the `<response_style>` block for each case via
 *           `formatResponseStyleBlock` and asserts the injection contract:
 *           the expected `Tone:`/`Length:`/`Custom:` lines are present, the
 *           unexpected lines are absent, and the "current-turn instruction
 *           overrides" clause is always present. Deterministic, free, and
 *           CI-safe. Compares to `eval/style-baseline.json` and exits non-zero
 *           ONLY on regression. Pass `--update-baseline` to rewrite it.
 *
 *   --live  Calls a real (cheap) model with a minimal system prompt composed of
 *           the style block (appended after grounding) plus the user message
 *           (including any current-turn instruction), then applies lightweight
 *           tone/verbosity heuristics. NOT CI-gated. Requires a configured
 *           model + DB; gracefully skips cases if unavailable.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatResponseStyleBlock, type ResolvedResponseStyle } from '../src/lib/response-style';

type LiveAssertionKind = 'formal' | 'brief' | 'custom' | 'override';

interface StyleCase {
  id: string;
  input: string;
  style: ResolvedResponseStyle;
  turnInstruction: string | null;
  expectedBlockLines: string[];
  expectedNotBlockLines: string[];
  liveAssertions: {
    kind: LiveAssertionKind;
    maxWords?: number;
    contains?: string;
  };
  notes?: string;
}

interface CaseResult {
  id: string;
  passed: boolean;
  reason?: string;
}

interface BaselineFile {
  generatedAt: string;
  mode: string;
  summary: { total: number; passed: number; failed: number };
  cases: Array<{ id: string; passed: boolean }>;
}

const EVAL_DIR = __dirname;
const CASES_PATH = path.join(EVAL_DIR, 'style-cases.json');
const BASELINE_PATH = path.join(EVAL_DIR, 'style-baseline.json');

const OVERRIDE_CLAUSE = "Unless the user's current message explicitly overrides this, follow it.";

function loadCases(): StyleCase[] {
  const raw = fs.readFileSync(CASES_PATH, 'utf8');
  return JSON.parse(raw) as StyleCase[];
}

function loadBaseline(): BaselineFile | null {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile;
}

/**
 * Mock mode: verify the deterministic injection contract for each case without
 * a live model. This checks exactly what the server assembles into the system
 * prompt, so it gates the block that produces tone/verbosity/custom behavior.
 */
function runMock(cases: StyleCase[]): CaseResult[] {
  return cases.map((c) => {
    const block = formatResponseStyleBlock(c.style);
    const failures: string[] = [];

    for (const line of c.expectedBlockLines) {
      if (!block.includes(line)) failures.push(`missing "${line}"`);
    }
    for (const line of c.expectedNotBlockLines) {
      if (block.includes(line)) failures.push(`unexpected "${line}"`);
    }
    if (!block.includes(OVERRIDE_CLAUSE)) failures.push('missing override clause');

    const passed = failures.length === 0;
    return { id: c.id, passed, reason: passed ? undefined : failures.join('; ') };
  });
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Lightweight, best-effort heuristics for live mode. These are intentionally
 * loose because single-shot tone classification is inherently noisy; live mode
 * is a manual smoke test, never a CI gate.
 */
function evaluateLiveResponse(kind: LiveAssertionKind, content: string, maxWords?: number, contains?: string): { passed: boolean; reason?: string } {
  const words = wordCount(content);

  if (kind === 'brief' || kind === 'override') {
    const limit = maxWords ?? 80;
    return words <= limit
      ? { passed: true }
      : { passed: false, reason: `expected <= ${limit} words, got ${words}` };
  }

  if (kind === 'formal') {
    const informal = /\b(gonna|wanna|gotta|dunno|yeah|nah|cool|awesome|stuff|okay|ok)\b/i;
    const contractions = /\b(don't|can't|won't|it's|i'm|you're|we're|they're|isn't|aren't|doesn't|didn't|wouldn't|couldn't|shouldn't)\b/i;
    if (informal.test(content) || contractions.test(content)) {
      return { passed: false, reason: 'response contains informal or contracted language' };
    }
    return { passed: true };
  }

  if (kind === 'custom') {
    if (contains && !content.toLowerCase().includes(contains.toLowerCase())) {
      return { passed: false, reason: `expected response to honor custom instruction (missing "${contains}")` };
    }
    return { passed: true };
  }

  return { passed: true };
}

/**
 * Live mode: call a real model with the style block appended after a grounding
 * line. Requires a configured LLM + DB; unavailable cases are marked SKIPPED
 * (passed=true) so they never regress the baseline.
 */
async function runLive(cases: StyleCase[]): Promise<CaseResult[]> {
  let createInternalCompletion: typeof import('../src/lib/llm-client').createInternalCompletion | null = null;
  let getLlmSettings: typeof import('../src/lib/db/compat/config').getLlmSettings | null = null;

  try {
    ({ createInternalCompletion } = await import('../src/lib/llm-client'));
    ({ getLlmSettings } = await import('../src/lib/db/compat/config'));
  } catch (err) {
    const reason = `Live mode unavailable (import failed): ${err instanceof Error ? err.message : String(err)}`;
    return cases.map((c) => ({ id: c.id, passed: true, reason: `SKIPPED — ${reason}` }));
  }

  let model: string | null = null;
  try {
    model = (await getLlmSettings()).model || null;
  } catch {
    model = null;
  }

  if (!model || !createInternalCompletion) {
    return cases.map((c) => ({ id: c.id, passed: true, reason: 'SKIPPED — no model configured or LLM client unavailable' }));
  }

  const results: CaseResult[] = [];
  for (const c of cases) {
    try {
      // The style block is appended after a grounding section, mirroring the
      // main-chat injection contract (§6.3): grounding first, style last.
      const system = `You are a helpful assistant.\n\n${formatResponseStyleBlock(c.style)}`;
      const user = c.turnInstruction ? `${c.input}\n\n${c.turnInstruction}` : c.input;
      const content = await createInternalCompletion({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        maxTokens: 300,
      });
      const evalResult = evaluateLiveResponse(
        c.liveAssertions.kind,
        content,
        c.liveAssertions.maxWords,
        c.liveAssertions.contains,
      );
      results.push({
        id: c.id,
        passed: evalResult.passed,
        reason: evalResult.passed ? undefined : evalResult.reason,
      });
    } catch (err) {
      results.push({
        id: c.id,
        passed: true,
        reason: `SKIPPED — LLM call failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return results;
}

function summarize(results: CaseResult[]) {
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.passed) passed++;
    else failed++;
  }
  return { total: results.length, passed, failed };
}

function printReport(results: CaseResult[], summary: ReturnType<typeof summarize>) {
  console.log('\n=== Response-Style Eval Report ===\n');
  for (const r of results) {
    const flag = r.passed ? 'PASS' : 'FAIL';
    const skip = r.reason?.startsWith('SKIPPED') ? ' [SKIPPED]' : '';
    console.log(`[${flag}] ${r.id}${skip}${r.reason && !skip ? ` — ${r.reason}` : ''}`);
  }
  console.log('\n--- Summary ---');
  console.log(`Total: ${summary.total}  Passed: ${summary.passed}  Failed: ${summary.failed}\n`);
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

function findRegressions(results: CaseResult[], baseline: BaselineFile | null): CaseResult[] {
  if (!baseline) return [];
  const baselineById = new Map(baseline.cases.map((c) => [c.id, c.passed]));
  return results.filter((r) => baselineById.get(r.id) === true && !r.passed);
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
    const outPath = path.join(EVAL_DIR, `style-results-${ts}.json`);
    fs.writeFileSync(
      outPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), mode, summary, cases: results }, null, 2) + '\n',
      'utf8',
    );
    console.log(`Live results written to ${outPath}\n`);
    // Live mode never fails CI — it's manual/scheduled.
    process.exit(0);
  }

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
