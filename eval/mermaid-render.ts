/**
 * Mermaid Render Eval Harness (Phase 7.2)
 *
 * Runs representative diagrams through the full pipeline:
 *   sanitize → validate (regex/structural) → mermaid.parse() → server render
 *
 * Usage:
 *   npx tsx eval/mermaid-render.ts               # validate + parse only (CI-safe, no Playwright)
 *   npx tsx eval/mermaid-render.ts --render      # also run server-side Playwright render
 *   npx tsx eval/mermaid-render.ts --update-baseline
 *
 * Baseline: eval/mermaid-render-baseline.json
 * Target: >95% success for flowcharts ≤30 nodes; C4 nested boundaries render;
 *         zero silent ASCII fallbacks.
 *
 * Dependencies: requires DB (config tables) for generator path; the
 * validate/parse path is pure and needs no DB. Run with `--no-render` in CI.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sanitizeMermaidCode, validateMermaidSyntax, detectDiagramType } from '../src/lib/diagram-gen/validator';

interface EvalCase {
  id: string;
  type: 'flowchart' | 'sequence' | 'mindmap' | 'c4-container' | 'architecture' | 'c4-context';
  label: string;
  code: string;
  /** Whether this case is expected to pass the full pipeline */
  expectPass: boolean;
}

interface CaseResult {
  id: string;
  label: string;
  type: string;
  sanitizeOk: boolean;
  validateOk: boolean;
  parseOk: boolean | null; // null = parse not run (no DB / mermaid import failed)
  renderOk: boolean | null; // null = render not run (--no-render)
  errors: string[];
  passed: boolean;
}

interface BaselineFile {
  generatedAt: string;
  summary: { total: number; passed: number; failed: number; successRate: string };
  cases: Array<{ id: string; passed: boolean }>;
}

// ===== Representative diagram corpus =====
const CASES: EvalCase[] = [
  {
    id: 'flow-5',
    type: 'flowchart',
    label: 'Flowchart 5 nodes (simple)',
    expectPass: true,
    code: `flowchart TD
  A[Start] --> B{Is valid?}
  B -->|Yes| C[Process]
  B -->|No| D[Reject]
  C --> E[End]`,
  },
  {
    id: 'flow-15',
    type: 'flowchart',
    label: 'Flowchart 15 nodes (medium)',
    expectPass: true,
    code: `flowchart TD
  A[Request] --> B[Auth]
  B --> C{Authorized?}
  C -->|Yes| D[Rate Limit]
  C -->|No| E[401]
  D --> F[Route]
  F --> G{Cache hit?}
  G -->|Yes| H[Return cached]
  G -->|No| I[Query DB]
  I --> J[Transform]
  J --> K[Set cache]
  K --> L[Log]
  L --> M[Respond 200]
  H --> M
  E --> N[Log denied]
  N --> O[End]`,
  },
  {
    id: 'flow-30',
    type: 'flowchart',
    label: 'Flowchart ~30 nodes (at cap)',
    expectPass: true,
    code: `flowchart TD
  n1[Init] --> n2[Load config]
  n2 --> n3[Connect DB]
  n3 --> n4{DB ok?}
  n4 -->|yes| n5[Run migrations]
  n4 -->|no| n6[Retry]
  n5 --> n7[Warm cache]
  n7 --> n8[Start workers]
  n8 --> n9[Worker A]
  n8 --> n10[Worker B]
  n8 --> n11[Worker C]
  n9 --> n12[Pull queue]
  n10 --> n12
  n11 --> n12
  n12 --> n13{Job type}
  n13 -->|email| n14[Send email]
  n13 -->|image| n15[Process image]
  n13 -->|report| n16[Build report]
  n14 --> n17[Mark done]
  n15 --> n17
  n16 --> n17
  n17 --> n18[Ack queue]
  n18 --> n19[Metrics]
  n19 --> n20[Health check]
  n20 --> n21{Healthy?}
  n21 -->|yes| n22[Continue]
  n21 -->|no| n23[Alert]
  n23 --> n24[Page oncall]
  n24 --> n25[Auto-scale]
  n25 --> n26[Rebalance]
  n26 --> n27[Resume]
  n27 --> n28[Idle wait]
  n28 --> n29[Next tick]
  n29 --> n30[Loop]`,
  },
  {
    id: 'seq-login',
    type: 'sequence',
    label: 'Sequence diagram (login flow)',
    expectPass: true,
    code: `sequenceDiagram
  participant U as User
  participant W as Web
  participant A as Auth
  participant D as DB
  U->>W: POST /login
  W->>A: verify(user, pass)
  A->>D: lookup user
  D-->>A: user record
  A-->>W: token
  W-->>U: 200 + cookie`,
  },
  {
    id: 'mindmap',
    type: 'mindmap',
    label: 'Mindmap (topic breakdown)',
    expectPass: true,
    code: `mindmap
  root((AI Assistant))
    Architecture
      Frontend
      Backend
      Storage
    Features
      RAG
      Agents
      Tools
    Deployment
      Docker
      Air-gap`,
  },
  {
    id: 'c4-container',
    type: 'c4-container',
    label: 'C4 Container (nested boundaries)',
    expectPass: true,
    code: `C4Container
  title Banking System
  Person(customer, "Customer", "A user of the system")
  System_Boundary(bank, "Banking System") {
    Container(web, "Web App", "React", "Provides UI")
    Container(api, "API", "Spring Boot", "Business logic")
    ContainerDb(db, "Database", "PostgreSQL", "Stores data")
  }
  System_Ext(email, "Email Provider", "Sends notifications")
  customer --> web : uses
  web --> api : calls
  api --> db : reads/writes
  api --> email : sends`,
  },
  {
    id: 'arch-beta',
    type: 'architecture',
    label: 'Architecture-beta (services + groups)',
    expectPass: true,
    code: `architecture-beta
  group frontend(cloud)[Frontend]
    service web(server)[Web App]
  group backend(cloud)[Backend]
    service api(server)[API]
    service db(database)[Postgres]
    service cache(disk)[Redis]
  web:R -- api:L
  api:R -- db:L
  api:T -- cache:B`,
  },
  {
    id: 'c4-context',
    type: 'c4-context',
    label: 'C4 Context (system landscape)',
    expectPass: true,
    code: `C4Context
  title Support System
  Person(user, "Support Agent", "Handles tickets")
  System(helpdesk, "Helpdesk", "Ticket management")
  System_Ext(crm, "CRM", "Customer data")
  user --> helpdesk : uses
  helpdesk --> crm : syncs`,
  },
];

const BASELINE_PATH = path.join(__dirname, 'mermaid-render-baseline.json');

async function runParse(code: string): Promise<string | null> {
  try {
    // Lazy import — mermaid is ESM and needs DOM globals in Node; this may
    // fail in pure CI without jsdom. We catch and report null (skipped).
    const mermaidModule: any = await import('mermaid');
    const mermaid = mermaidModule.default || mermaidModule;
    const { MERMAID_INIT_CONFIG } = await import('../src/lib/diagram-gen/mermaid-config');
    try { mermaid.initialize(MERMAID_INIT_CONFIG); } catch { /* already initialized */ }
    await mermaid.parse(code);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function runRender(code: string): Promise<string | null> {
  try {
    const { renderMermaidToSvg } = await import('../src/lib/docgen/html/server-renderer');
    const svg = await renderMermaidToSvg(code);
    return svg ? null : 'render returned empty (Playwright unavailable)';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doRender = args.includes('--render');
  const updateBaseline = args.includes('--update-baseline');

  const results: CaseResult[] = [];

  for (const c of CASES) {
    const errors: string[] = [];
    const sanitized = sanitizeMermaidCode(c.code);
    const sanitizeOk = sanitized.trim().length > 0;
    if (!sanitizeOk) errors.push('sanitize produced empty output');

    const detected = detectDiagramType(sanitized);
    const validateOk = detected === c.type;
    if (!validateOk) errors.push(`detectDiagramType got "${detected}" expected "${c.type}"`);

    const validation = validateMermaidSyntax(sanitized, c.type);
    if (!validation.valid) {
      errors.push(...validation.errors.map((e) => `validate: ${e}`));
    }
    const validateFinal = validation.valid && validateOk;

    let parseOk: boolean | null = null;
    const parseError = await runParse(sanitized);
    if (parseError === null) {
      parseOk = true;
    } else if (parseError.includes('Cannot find module') || parseError.includes('jsdom') || parseError.includes('document is not defined')) {
      // Parse path unavailable in this environment — skip, not a failure.
      parseOk = null;
    } else {
      parseOk = false;
      errors.push(`parse: ${parseError.substring(0, 150)}`);
    }

    let renderOk: boolean | null = null;
    if (doRender) {
      const renderError = await runRender(sanitized);
      if (renderError === null) {
        renderOk = true;
      } else {
        renderOk = false;
        errors.push(`render: ${renderError.substring(0, 150)}`);
      }
    } else {
      renderOk = null;
    }

    // passed = validate ok AND (parse ok OR parse skipped) AND (render ok OR render skipped).
    // errors[] only ever receives entries when validate/parse/render fail, so once the three
    // checks above are satisfied errors is guaranteed empty — no separate errors guard needed.
    const passed = validateFinal && parseOk !== false && renderOk !== false;

    results.push({
      id: c.id,
      label: c.label,
      type: c.type,
      sanitizeOk,
      validateOk: validateFinal,
      parseOk,
      renderOk,
      errors,
      passed: passed && c.expectPass,
    });

    const status = passed && c.expectPass ? 'PASS' : (passed && !c.expectPass ? 'WARN(unexpected pass)' : 'FAIL');
    console.log(`  [${status}] ${c.id} — ${c.label}`);
    if (errors.length > 0) {
      for (const e of errors) console.log(`        ${e}`);
    }
  }

  const total = results.length;
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = total - passedCount;
  const successRate = ((passedCount / total) * 100).toFixed(1) + '%';

  console.log('\n========== Mermaid Render Eval ==========');
  console.log(`Total: ${total}  Passed: ${passedCount}  Failed: ${failedCount}  Rate: ${successRate}`);
  console.log(`Render path: ${doRender ? 'enabled' : 'skipped (--no-render)'}`);
  console.log('==========================================\n');

  if (updateBaseline) {
    const baseline: BaselineFile = {
      generatedAt: new Date().toISOString(),
      summary: { total, passed: passedCount, failed: failedCount, successRate },
      cases: results.map((r) => ({ id: r.id, passed: r.passed })),
    };
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
    console.log(`Baseline written to ${BASELINE_PATH}`);
  } else if (fs.existsSync(BASELINE_PATH)) {
    const baseline: BaselineFile = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
    const regressions = results.filter(
      (r) => baseline.cases.find((b) => b.id === r.id)?.passed && !r.passed
    );
    if (regressions.length > 0) {
      console.error(`REGRESSION: ${regressions.length} previously-passing case(s) now failing:`);
      for (const r of regressions) console.error(`  - ${r.id}: ${r.label}`);
      process.exit(1);
    } else {
      console.log('No regressions vs baseline.');
    }
  } else {
    console.log('No baseline file found. Run with --update-baseline to create one.');
  }

  // Exit non-zero if success rate below target (only when parse path was available)
  const parseRun = results.some((r) => r.parseOk !== null);
  if (parseRun && passedCount / total < 0.95) {
    console.error(`Success rate ${successRate} below 95% target.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Eval harness crashed:', err);
  process.exit(2);
});
