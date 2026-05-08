/**
 * Shared constants for HTML builder
 */

// Same palette as DataVisualization.tsx
export const CHART_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
];

/** Supported Mermaid types for HTML output */
export const SUPPORTED_MERMAID_TYPES = new Set([
  'flowchart', 'graph', 'mindmap', 'sequencediagram',
  'c4context', 'c4container', 'c4component', 'c4dynamic', 'c4deployment',
  'classdiagram', 'statediagram', 'statediagram-v2',
  'erdiagram', 'userjourney', 'gantt', 'gitgraph',
  'pie', 'requirementdiagram', 'timeline', 'block-beta', 'block',
  'quadrantchart', 'quadrant', 'architecture-beta', 'architecture',
  'sankey', 'packet-beta', 'zenuml',
]);

/** Map of part-label prefixes to accent colours (can be extended per-country). */
export const PART_ACCENT_COLORS = [
  '#007A5E', // green
  '#00247D', // blue
  '#FCD116', // yellow
  '#C8102E', // red
  '#009B3A', // green
  '#4D8CC4', // blue
];

/** Regexes used to detect bare Mermaid start lines */
export const BARE_MERMAID_PATTERNS = [
  /^(flowchart|graph)\b/,
  /^sequencediagram\b/,
  /^mindmap\b/,
  /^statediagram(-v2)?\b/,
  /^erdiagram\b/,
  /^userjourney\b/,
  /^gantt\b/,
  /^gitgraph\b/,
  /^pie\b/,
  /^requirementdiagram\b/,
  /^c4(context|container|component|dynamic|deployment)\b/,
  /^classdiagram\b/,
  /^timeline\b/,
  /^block(-beta)?\b/,
  /^quadrant(chart)?\b/,
  /^architecture(-beta)?\b/,
  /^sankey\b/,
  /^packet-beta\b/,
  /^zenuml\b/,
];
