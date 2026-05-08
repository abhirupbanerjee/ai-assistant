# HTML Report Rendering — Server-Side Charts & Diagrams

## Problem Statement

The `html_gen-report` output had two rendering failures:

1. **Charts rendered without data labels** — `chartjs-plugin-datalabels` was not loaded in the client-side bundle, so bar/line/pie charts showed no value annotations.
2. **Mermaid diagrams not rendering** — Only raw mermaid source text was visible. Root cause: Next.js standalone build trace drops `mermaid.min.js` because it is only read via `fs.readFileSync` at runtime, not statically imported. At runtime `typeof mermaid === "undefined"` so the client-side renderer silently failed.

## Solution: Server-Side Rendering via Playwright

Rather than patching the client-side bundle loading, we chose **Option A: server-side rendering** using Playwright/Chromium. This approach:

- Renders Chart.js charts (with datalabels) to **PNG data-URLs** baked into `<img>` tags
- Renders Mermaid diagrams to **inline SVG** embedded directly in the HTML
- Makes the generated HTML **fully self-contained** — no client-side JS required for charts or diagrams
- Gracefully falls back to client-side rendering if Playwright is unavailable

### Architecture

```
generateHtml()
  ├── parseContent()          → ContentSegment[]
  ├── serverRenderAll()       → ServerRenderResult { charts: Map, diagrams: Map }
  │     ├── getBrowser()      → singleton Playwright Chromium instance
  │     ├── render charts     → PNG via canvas.screenshot()
  │     └── render diagrams   → SVG via mermaid.run() + el.querySelector('svg')
  ├── renderSegments()        → uses ServerRenderResult for <img> / inline SVG
  ├── buildDashboardTemplate()→ passes ServerRenderResult to dashboard panels
  └── buildPlaybookTemplate() → passes ServerRenderResult to parsePlaybookParts()
```

### Key Files

| File | Role |
|------|------|
| `src/lib/docgen/html/server-renderer.ts` | Playwright singleton, chart PNG renderer, mermaid SVG renderer |
| `src/lib/docgen/html/generate.ts` | Orchestrator — calls `serverRenderAll`, threads result to all templates |
| `src/lib/docgen/html/renderers/segment-renderers.ts` | Emits `<img>` (server) or `<canvas>` (fallback) for charts; inline SVG or mermaid div for diagrams |
| `src/lib/docgen/html/renderers/render-segments.ts` | Loops segments, looks up server results by index |
| `src/lib/docgen/html/renderers/dashboard-renderers.ts` | Same server-render support for dashboard panels |
| `src/lib/docgen/html/templates/dashboard.ts` | Passes `serverResult` to dashboard panel renderers |
| `src/lib/docgen/html/templates/playbook.ts` | Passes `serverResult` to `parsePlaybookParts` |
| `src/lib/docgen/html/playbook/playbook-parser.ts` | Accepts `serverResult?`, uses it when rendering chart/diagram segments |
| `src/lib/docgen/html/vendor-bundles.ts` | Loads `chartjs-plugin-datalabels` alongside Chart.js for client-side fallback |
| `next.config.ts` | `outputFileTracingIncludes` ensures vendor bundles are included in standalone build |
| `Dockerfile` | Installs Playwright Chromium + copies vendor bundles to `public/vendor/` |

### Dependencies Added

```bash
npm install playwright chartjs-plugin-datalabels
```

Playwright Chromium is installed in the Docker image via:
```dockerfile
RUN npx playwright install chromium --with-deps
```

### next.config.ts — File Tracing

Because vendor bundles are read via `fs.readFileSync` (not statically imported), they must be explicitly included in the Next.js standalone output file trace:

```typescript
outputFileTracingIncludes: {
  '/api/**': [
    './node_modules/chart.js/dist/chart.umd.min.js',
    './node_modules/chartjs-plugin-datalabels/dist/chartjs-plugin-datalabels.min.js',
    './node_modules/mermaid/dist/mermaid.min.js',
  ],
},
```

## Mermaid Injection — Safe textContent Pattern

**Critical**: Mermaid reads the `textContent` of the `.mermaid` div, not its `innerHTML`. If you use `escapeHtml()` to inject the source into the HTML template, mermaid receives literal `&lt;` etc. and fails to parse the diagram.

**Correct pattern** (used in `server-renderer.ts`):

```typescript
// 1. Render page with empty div, startOnLoad: false
const html = `...
<div class="mermaid" id="mermaid-target"></div>
<script>
  mermaid.initialize({ startOnLoad: false, ... });
</script>`;

await page.setContent(html, { waitUntil: 'load' });

// 2. Inject raw source via textContent (bypasses HTML parsing)
await page.evaluate((src) => {
  const el = document.getElementById('mermaid-target');
  if (el) el.textContent = src;
}, code);

// 3. Trigger render explicitly
await page.evaluate(async () => {
  const mmd = (globalThis as any).mermaid;
  if (mmd?.run) await mmd.run({ nodes: [document.getElementById('mermaid-target')!] });
  else if (mmd?.init) await mmd.init(undefined, '#mermaid-target');
});
```

## Playwright Browser Singleton

The browser instance is reused across requests to avoid the ~2s startup cost per report:

```typescript
let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser | null> {
  if (_browser?.isConnected()) return _browser;
  // ... launch once, register 'disconnected' handler once
  if (!(_browser as any).listenerCount('disconnected')) {
    _browser.on('disconnected', () => { _browser = null; });
  }
  return _browser;
}
```

The `listenerCount` guard prevents listener leaks when `getBrowser()` is called concurrently.

## Fallback Behaviour

If Playwright is unavailable (e.g. Chromium not installed, or running in a restricted environment):

- `serverRenderAll()` returns `{ fallbackToClient: true, charts: Map(0), diagrams: Map(0) }`
- Charts fall back to client-side `<canvas>` + Chart.js
- Diagrams fall back to `<div class="mermaid" data-mermaid-source="...">` + client-side mermaid bundle

The client-side fallback bundles are still included via `vendor-bundles.ts` for this reason.

## Diagram Types Supported

All mermaid diagram types work via the server-side path:
- Flowchart (`graph TD`, `flowchart LR`)
- Sequence diagram
- Mindmap
- C4 diagram
- Gantt
- Class diagram
- State diagram
- ER diagram
- Pie chart (mermaid)

Sanitization of mermaid source (smart quotes, fences, `&`, `<>` in labels) is handled upstream by `src/lib/diagram-gen/validator.ts` → `sanitizeMermaidCode()`.

---

## Gantt & Project Plan Page Types

The `gantt` and `project_plan` page types are fully client-side rendered (no Playwright required). They use a custom interactive Gantt chart built with vanilla HTML/CSS/JS, not Mermaid.

### Architecture

```
generateHtml()
  ├── parseContent()          → finds GanttSegment (```gantt JSON block)
  ├── detectPageType()        → 'gantt' or 'project_plan'
  └── buildGanttTemplate()   → self-contained HTML with inline JS
       or buildProjectPlanTemplate() → calls buildGanttTemplate(projectPlanMode=true)
                                       + injects KPI strip + roll-up table
```

### Key Files

| File | Role |
|------|------|
| `src/lib/docgen/html/types.ts` | `GanttSegment`, `GanttBlockConfig`, `GanttTask`, `GanttCategory` types |
| `src/lib/docgen/html/parsing/content-parser.ts` | Parses ` ```gantt ` fenced JSON blocks into `GanttSegment` |
| `src/lib/docgen/html/parsing/page-type.ts` | Detects `gantt` / `project_plan` from segment presence or title keywords |
| `src/lib/docgen/html/templates/gantt.ts` | Full Gantt template builder |
| `src/lib/docgen/html/templates/project-plan.ts` | Project plan template (wraps gantt + adds KPI strip + roll-up table) |
| `src/lib/docgen/html/generate.ts` | Routes `gantt` / `project_plan` page types to the correct builder |
| `src/lib/tools/html-gen.ts` | LLM-facing tool definition — `page_type` enum, authoring contract in `DEFAULT_HTML_PROMPT_LINES` |

### GanttBlockConfig Schema

```typescript
interface GanttBlockConfig {
  title?: string;
  subtitle?: string;
  start_date?: string;          // ISO date (YYYY-MM-DD)
  end_date?: string;            // ISO date
  axis?: 'weeks' | 'months' | 'dates';
  flag_colors?: [string, string, string];  // 3-color flag strip
  categories?: GanttCategory[];
  tasks: GanttTask[];
}

interface GanttCategory {
  id: string;
  label: string;
  color?: string;               // Optional hex color
}

interface GanttTask {
  group: string;                // Section heading
  name: string;                 // Task label
  sub?: string;                 // Subtitle
  category: string;             // Must match a category id
  start: string;                // ISO date, "W1"–"Wn", or "M1"–"Mn"
  end?: string;                 // Same format; omit for diamonds
  type?: 'bar' | 'diamond';    // Default: 'bar'
  hatched?: boolean;            // Striped bar
  detail?: string;              // Hover tooltip
}
```

### Time Axis Normalization

The `parsePosition(token, startDate, axis)` function converts any time token to a 0-based week column index:

| Token format | Conversion |
|---|---|
| `"W1"` – `"Wn"` | `n - 1` (0-based week index) |
| `"M1"` – `"Mn"` | `(n - 1) * 4` (approximate weeks) |
| ISO date `"YYYY-MM-DD"` | `Math.floor((date - startDate) / 7 days)` |

### Color Resolution

Category colors are resolved in priority order:

1. `category.color` (LLM-specified hex)
2. `branding.primaryColor` (for index 0 only)
3. `DEFAULT_PALETTE` — `['#1f4e79', '#2C5F7A', '#5B2D8E', '#8B6914', '#7a3535', '#3a6b3a', '#4a4a7a', '#6b4a2a']`

### Flag Strip

If `cfg.flag_colors` contains exactly 3 colors, a decorative 3-stripe flag strip is rendered at the top of the page (e.g. national flag colors). If fewer than 3 colors are provided, the strip is omitted.

### project_plan Extras

When `projectPlanMode = true`, `buildGanttTemplate()` adds:

- **KPI strip** (above the Gantt grid): total tasks, milestone count, work stream count, category count, timeline span in weeks
- **Roll-up table** (below the Gantt grid): one row per work stream (`group`) with task count, milestone count, and a comma-separated activity list with colored category dots

### Auto-Detection Keywords

`detectPageType()` in `parsing/page-type.ts` auto-detects these page types:

| Condition | Detected type |
|---|---|
| Content has a `GanttSegment` AND title matches `project.?plan\|work.?plan\|schedule\|wbs` | `project_plan` |
| Content has a `GanttSegment` (any title) | `gantt` |
| No segment but title matches `gantt\|deployment.?roadmap\|delivery.?timeline` | `gantt` |
| No segment but title matches `project.?plan\|work.?plan\|wbs` | `project_plan` |

### Testing

```bash
npx tsx scripts/test-html-rendering.ts
# Gantt output:        /tmp/html-gantt-test.html
# Project plan output: /tmp/html-project-plan-test.html
```
