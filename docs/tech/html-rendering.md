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
