#!/usr/bin/env npx tsx

/**
 * KB Ladder Debug Harness
 *
 * Validates the kb_search + confidence-graded kb_read + HITL changes:
 *
 *   Part A — detectReferencedDocument() pure-logic tests
 *            (exact / extension_stripped / token_overlap / substring,
 *             overlapRatio population, candidateDocuments runner-ups,
 *             min-2-token guard, tie-break stability)
 *   Part B — gradeConfidence() boundary tests (0.9 and 8-char thresholds)
 *   Part C — kb_search tool definition shape + executor resilience
 *            (validation error path; no-throw outside request context)
 *   Part D — AVAILABLE_TOOLS registration
 *   Part E — static source assertions for wiring changes that need a live
 *            LLM/DB to test end-to-end (openai.ts injection, rag-retrieval
 *            ladder block, routing-rule seeds, suggested-mode handling)
 *
 * Run with:
 *   npx tsx scripts/test-kb-ladder.ts
 *
 * Exit code 0 = all checks passed, 1 = at least one failure.
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config({ path: path.join(process.cwd(), '.env') });

import type { DbDocument } from '../src/lib/db/compat';
import type { DetectedDocument } from '../src/lib/document-detection';

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function mockDoc(filename: string): DbDocument {
  // detectReferencedDocument/gradeConfidence only read `filename`.
  return { filename } as unknown as DbDocument;
}

const EPS = 1e-9;

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('KB Ladder Debug Harness');
  console.log('='.repeat(60));

  // Dynamic imports AFTER env load (mirrors scripts/test-html-rendering.ts)
  const { detectReferencedDocument } = await import('../src/lib/document-detection');
  const { gradeConfidence } = await import('../src/lib/tools/kb-read');

  // -------------------------------------------------------------------------
  console.log('\n📄 Part A: detectReferencedDocument()');
  // -------------------------------------------------------------------------

  const FINAL_RFP = 'FINAL-1-CMS-RFP-September-2024.pdf'; // tokens: cms, rfp
  const DRAFT_RFP = 'CMS RFP Draft.docx';                 // tokens: cms, rfp
  const APPENDIX = 'CMS RFP Appendix.docx';               // tokens: cms, rfp, appendix
  const HANDBOOK = 'CMS Handbook.pdf';                    // tokens: cms, handbook
  const HR_MANUAL = 'HR Policy Manual.pdf';               // tokens: hr, policy, manual
  const Q3_REPORT = 'Q3_Report.pdf';                      // tokens: q3 (1 token)
  const JAN_2025 = 'Jan 2025.pdf';                        // tokens: [] (all stop tokens)
  const DATA_DOC = 'data.docx';                           // tokens: data (1 token)

  // A1 — exact match (full filename with extension in message)
  {
    const r = detectReferencedDocument(
      'please open FINAL-1-CMS-RFP-September-2024.pdf now',
      [mockDoc(FINAL_RFP), mockDoc(HR_MANUAL)]
    );
    check('A1 exact: strategy is exact', r?.matchStrategy === 'exact', JSON.stringify(r?.matchStrategy));
    check('A1 exact: correct document', r?.document.filename === FINAL_RFP);
    check('A1 exact: overlapRatio undefined', r?.overlapRatio === undefined);
  }

  // A2 — extension-stripped match
  {
    const r = detectReferencedDocument(
      'can you open final-1-cms-rfp-september-2024 for me',
      [mockDoc(FINAL_RFP), mockDoc(HR_MANUAL)]
    );
    check('A2 ext-strip: strategy is extension_stripped', r?.matchStrategy === 'extension_stripped', JSON.stringify(r?.matchStrategy));
    check('A2 ext-strip: correct document', r?.document.filename === FINAL_RFP);
  }

  // A3 — token_overlap HIGH with one runner-up candidate; sub-0.6 doc excluded
  {
    const docs = [mockDoc(FINAL_RFP), mockDoc(APPENDIX), mockDoc(HANDBOOK), mockDoc(HR_MANUAL)];
    const r = detectReferencedDocument('review and summarise the CMS RFP', docs);
    check('A3 overlap: strategy is token_overlap', r?.matchStrategy === 'token_overlap', JSON.stringify(r?.matchStrategy));
    check('A3 overlap: winner is highest ratio', r?.document.filename === FINAL_RFP, r?.document.filename);
    check('A3 overlap: winner ratio is 1.0', Math.abs((r?.overlapRatio ?? -1) - 1) < EPS, String(r?.overlapRatio));
    check('A3 overlap: exactly 1 candidate', r?.candidateDocuments?.length === 1, JSON.stringify(r?.candidateDocuments?.map(c => c.document.filename)));
    check('A3 overlap: candidate is Appendix', r?.candidateDocuments?.[0]?.document.filename === APPENDIX);
    check('A3 overlap: candidate ratio ≈ 0.667', Math.abs((r?.candidateDocuments?.[0]?.overlapRatio ?? -1) - 2 / 3) < EPS, String(r?.candidateDocuments?.[0]?.overlapRatio));
    check('A3 overlap: winner excluded from candidates', !r?.candidateDocuments?.some(c => c.document.filename === FINAL_RFP));
    check('A3 overlap: sub-0.6 doc (Handbook 0.5) excluded', !r?.candidateDocuments?.some(c => c.document.filename === HANDBOOK));
  }

  // A4 — tie-break stability: equal ratio + equal present count → first-listed wins
  {
    const docs = [mockDoc(DRAFT_RFP), mockDoc(FINAL_RFP)];
    const r = detectReferencedDocument('review and summarise the CMS RFP', docs);
    check('A4 tie: first-listed doc wins', r?.document.filename === DRAFT_RFP, r?.document.filename);
    check('A4 tie: other doc is candidate at 1.0',
      r?.candidateDocuments?.length === 1 && Math.abs((r.candidateDocuments[0].overlapRatio) - 1) < EPS);
  }

  // A5 — token_overlap AMBIGUOUS band (0.6–0.9), no runner-ups
  {
    const docs = [mockDoc(APPENDIX), mockDoc(FINAL_RFP)];
    const r = detectReferencedDocument('show me the cms appendix', docs);
    check('A5 ambiguous: strategy is token_overlap', r?.matchStrategy === 'token_overlap');
    check('A5 ambiguous: winner is Appendix', r?.document.filename === APPENDIX, r?.document.filename);
    check('A5 ambiguous: ratio in [0.6, 0.9)',
      (r?.overlapRatio ?? 0) >= 0.6 && (r?.overlapRatio ?? 1) < 0.9, String(r?.overlapRatio));
    check('A5 ambiguous: no candidates', r?.candidateDocuments?.length === 0);
  }

  // A6 — min-2-token guard: single-token doc cannot match via token_overlap
  {
    const r = detectReferencedDocument('q3', [mockDoc(Q3_REPORT)]);
    check('A6 guard: single-token doc yields null for bare token message', r === null, JSON.stringify(r?.matchStrategy));
  }

  // A7 — substring match, long (≥8 chars) → HIGH band
  {
    const r = detectReferencedDocument('what does q3report say', [mockDoc(Q3_REPORT)]);
    check('A7 substring: strategy is substring', r?.matchStrategy === 'substring', JSON.stringify(r?.matchStrategy));
    check('A7 substring: overlapRatio is stripped length 8', r?.overlapRatio === 8, String(r?.overlapRatio));
  }

  // A8 — substring match, short (<8 chars) → AMBIGUOUS band
  {
    const r = detectReferencedDocument('jan2025 numbers please', [mockDoc(JAN_2025)]);
    check('A8 substring: strategy is substring', r?.matchStrategy === 'substring', JSON.stringify(r?.matchStrategy));
    check('A8 substring: overlapRatio is stripped length 7', r?.overlapRatio === 7, String(r?.overlapRatio));
  }

  // A9 — no match
  {
    const docs = [mockDoc(FINAL_RFP), mockDoc(APPENDIX), mockDoc(HR_MANUAL), mockDoc(Q3_REPORT), mockDoc(JAN_2025), mockDoc(DATA_DOC)];
    const r = detectReferencedDocument('quarterly earnings forecast', docs);
    check('A9 none: unrelated message returns null', r === null, JSON.stringify(r?.document.filename));
  }

  // A10 — empty document list
  {
    const r = detectReferencedDocument('review the CMS RFP', []);
    check('A10 none: empty doc list returns null', r === null);
  }

  // -------------------------------------------------------------------------
  console.log('\n🎚️  Part B: gradeConfidence()');
  // -------------------------------------------------------------------------

  const det = (matchStrategy: DetectedDocument['matchStrategy'], overlapRatio?: number): DetectedDocument => ({
    document: mockDoc('x.pdf'),
    matchStrategy,
    ...(overlapRatio !== undefined ? { overlapRatio } : {}),
  });

  check('B1 exact → high', gradeConfidence(det('exact')) === 'high');
  check('B2 extension_stripped → high', gradeConfidence(det('extension_stripped')) === 'high');
  check('B3 token_overlap 1.0 → high', gradeConfidence(det('token_overlap', 1.0)) === 'high');
  check('B4 token_overlap 0.9 (boundary) → high', gradeConfidence(det('token_overlap', 0.9)) === 'high');
  check('B5 token_overlap 0.899 → ambiguous', gradeConfidence(det('token_overlap', 0.899)) === 'ambiguous');
  check('B6 token_overlap 0.6 (floor) → ambiguous', gradeConfidence(det('token_overlap', 0.6)) === 'ambiguous');
  check('B7 token_overlap undefined ratio → ambiguous', gradeConfidence(det('token_overlap')) === 'ambiguous');
  check('B8 substring 8 (boundary) → high', gradeConfidence(det('substring', 8)) === 'high');
  check('B9 substring 7 → ambiguous', gradeConfidence(det('substring', 7)) === 'ambiguous');
  check('B10 substring undefined → ambiguous', gradeConfidence(det('substring')) === 'ambiguous');

  // End-to-end consistency: detection feeds grading the way kb_read consumes it
  {
    const high = detectReferencedDocument('review and summarise the CMS RFP', [mockDoc(FINAL_RFP), mockDoc(APPENDIX)]);
    const amb = detectReferencedDocument('show me the cms appendix', [mockDoc(APPENDIX), mockDoc(FINAL_RFP)]);
    const subHigh = detectReferencedDocument('what does q3report say', [mockDoc(Q3_REPORT)]);
    const subAmb = detectReferencedDocument('jan2025 numbers please', [mockDoc(JAN_2025)]);
    check('B11 e2e: "CMS RFP" detection grades high', high !== null && gradeConfidence(high) === 'high', high ? String(high.overlapRatio) : 'null');
    check('B12 e2e: "cms appendix" detection grades ambiguous', amb !== null && gradeConfidence(amb) === 'ambiguous', amb ? String(amb.overlapRatio) : 'null');
    check('B13 e2e: "q3report" substring grades high', subHigh !== null && gradeConfidence(subHigh) === 'high');
    check('B14 e2e: "jan2025" substring grades ambiguous', subAmb !== null && gradeConfidence(subAmb) === 'ambiguous');
  }

  // -------------------------------------------------------------------------
  console.log('\n🔍 Part C: kb_search tool');
  // -------------------------------------------------------------------------

  const { kbSearchTool } = await import('../src/lib/tools/kb-search');

  check('C1 name is kb_search', kbSearchTool.name === 'kb_search', kbSearchTool.name);
  const fnDef = kbSearchTool.definition?.function;
  const params = fnDef?.parameters as { required?: string[]; properties?: Record<string, unknown> } | undefined;
  check('C2 definition name matches', fnDef?.name === 'kb_search');
  check('C3 query param required', params?.required?.includes('query') === true);
  check('C4 top_k param exists', params?.properties !== undefined && 'top_k' in params.properties);
  check('C5 category is autonomous', kbSearchTool.category === 'autonomous', kbSearchTool.category);
  check('C6 subagentSafe true', kbSearchTool.subagentSafe === true);
  check('C7 execute is a function', typeof kbSearchTool.execute === 'function');
  check('C8 validateConfig returns valid', kbSearchTool.validateConfig?.({}).valid === true);
  check('C9 description mentions hasMore iteration', fnDef?.description?.includes('hasMore') === true);

  // C10 — validation error path (no query): must return structured JSON before
  // touching request context / DB / vector store.
  {
    const raw = await kbSearchTool.execute({});
    let parsed: { success?: boolean; errorCode?: string } | null = null;
    try { parsed = JSON.parse(raw); } catch { /* leave null */ }
    check('C10 exec({}): returns parseable JSON', parsed !== null, raw.slice(0, 120));
    check('C10 exec({}): success false', parsed?.success === false);
    check('C10 exec({}): VALIDATION_ERROR', parsed?.errorCode === 'VALIDATION_ERROR', parsed?.errorCode);
  }

  // C11 — resilience: called outside any request context and (possibly) without
  // DB/vector-store infra. Must NOT throw; must return structured JSON.
  {
    let threw = false;
    let raw = '';
    try {
      raw = await kbSearchTool.execute({ query: 'debug harness ping' });
    } catch (err) {
      threw = true;
      console.log(`  ⚠️  C11 executor threw: ${String(err)}`);
    }
    check('C11 exec(query): does not throw outside request context', !threw);
    if (!threw) {
      let parsed: { success?: boolean; errorCode?: string } | null = null;
      try { parsed = JSON.parse(raw); } catch { /* leave null */ }
      check('C11 exec(query): returns parseable JSON', parsed !== null, raw.slice(0, 120));
      check('C11 exec(query): has boolean success field', typeof parsed?.success === 'boolean');
      console.log(`  ℹ️  C11 outcome (infra-dependent): success=${parsed?.success} errorCode=${parsed?.errorCode ?? 'none'}`);
    }
  }

  // -------------------------------------------------------------------------
  console.log('\n🧰 Part D: AVAILABLE_TOOLS registration');
  // -------------------------------------------------------------------------

  try {
    const { AVAILABLE_TOOLS } = await import('../src/lib/tools');
    const entry = AVAILABLE_TOOLS['kb_search'];
    check('D1 kb_search registered', entry !== undefined);
    check('D2 registered name', entry?.name === 'kb_search', entry?.name);
    check('D3 registered execute', typeof entry?.execute === 'function');
    check('D4 requiresToolCalling', entry?.modelRequirements?.requiresToolCalling === true);
    check('D5 prefersLargeContext', entry?.modelRequirements?.prefersLargeContext === true);
    check('D6 kb_summary and kb_read still registered',
      AVAILABLE_TOOLS['kb_summary'] !== undefined && AVAILABLE_TOOLS['kb_read'] !== undefined);
  } catch (err) {
    check('D1 tools.ts module imports cleanly', false, String(err));
  }

  // -------------------------------------------------------------------------
  console.log('\n🔗 Part E: static wiring assertions');
  // -------------------------------------------------------------------------

  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');

  const openaiSrc = read('src/lib/openai.ts');
  check("E1 openai.ts: hasKbTool via startsWith('kb_')", openaiSrc.includes("startsWith('kb_')") && openaiSrc.includes('hasKbTool'));
  check('E2 openai.ts: injection condition broadened', /\(enableClarification \|\| hasKbTool\)/.test(openaiSrc));

  const ragRetrievalSrc = read('src/lib/streaming/rag-retrieval.ts');
  check('E3 rag-retrieval.ts: ladder block marker present', ragRetrievalSrc.includes('# Knowledge Base Tools'));
  check("E4 rag-retrieval.ts: hasKbTool guard present", ragRetrievalSrc.includes("startsWith('kb_')"));

  const toolRoutingSrc = read('src/lib/tool-routing.ts');
  check("E5 tool-routing.ts: 'suggested' maps to auto path", toolRoutingSrc.includes('suggested: 2'));

  const kyselySrc = read('src/lib/db/kysely.ts');
  for (const id of ['seed-kb-search-rfp', 'seed-kb-search-review', 'seed-kb-summary-policy', 'seed-kb-summary-summ']) {
    check(`E6 kysely.ts: routing rule ${id} seeded`, kyselySrc.includes(id));
  }
  check('E7 kysely.ts: kb_search in researcher allowlist + migration', (kyselySrc.match(/kb_search/g) ?? []).length >= 2);

  const sqliteSrc = read('src/lib/db/index.ts');
  for (const id of ['seed-kb-search-rfp', 'seed-kb-search-review', 'seed-kb-summary-policy', 'seed-kb-summary-summ']) {
    check(`E8 index.ts: routing rule ${id} seeded`, sqliteSrc.includes(id));
  }
  check('E9 index.ts: kb_search present (allowlist + migration)', (sqliteSrc.match(/kb_search/g) ?? []).length >= 2);

  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n💥 Harness crashed (unexpected):', err);
  process.exit(2);
});
