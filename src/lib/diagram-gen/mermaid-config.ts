/**
 * Centralized Mermaid initialization configuration.
 *
 * SINGLE SOURCE OF TRUTH for mermaid.initialize() across all three render sites:
 *   1. src/components/markdown/MermaidDiagram.tsx        (client chat)
 *   2. src/lib/docgen/html/server-renderer.ts            (Playwright server-side, PDF/DOCX export)
 *   3. src/lib/docgen/html/client/index.ts               (docgen HTML client script)
 *
 * Any change here applies everywhere. Keeping these in sync prevents config drift
 * between chat diagrams and exported documents.
 *
 * Verified against mermaid.js.org config schema docs (v11.16.0, 2026-07-27).
 */

/**
 * The shared mermaid.initialize() config object.
 *
 * Notes:
 * - `maxTextSize` and `maxEdges` are NEW additions (none existed before v11.16 work).
 *   They raise the hard limits on diagram source size and edge count so larger
 *   flowcharts (up to 30 nodes per the reconciled cap) are not silently rejected.
 * - `suppressErrorRendering: true` prevents mermaid from injecting error <div>s
 *   into the DOM; our components handle errors explicitly.
 * - `securityLevel: 'loose'` is required so node labels with HTML/special chars render.
 */
export const MERMAID_INIT_CONFIG = {
  startOnLoad: false,
  theme: 'default' as const,
  securityLevel: 'loose' as const,
  suppressErrorRendering: true,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  // Raise hard limits so larger diagrams (≤30 nodes) are not silently rejected.
  maxTextSize: 100000,
  maxEdges: 1000,
  mindmap: {
    useMaxWidth: true,
    padding: 16,
  },
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis' as const,
  },
};

/**
 * Serialize the config to JSON for embedding in string-injected browser scripts
 * (e.g. the docgen HTML client at src/lib/docgen/html/client/index.ts, where the
 * config must be a literal string, not an imported object).
 *
 * Returns a JSON string safe to embed inside `mermaid.initialize(<HERE>)`.
 */
export function mermaidInitConfigJson(): string {
  return JSON.stringify(MERMAID_INIT_CONFIG);
}
