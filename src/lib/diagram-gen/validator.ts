/**
 * Mermaid Syntax Validator
 *
 * Validates generated Mermaid code before returning to frontend.
 * Sanitization is handled by the shared sanitize.ts module.
 */

import type { MermaidDiagramType, DiagramValidationResult } from '@/types/diagram-gen';
import { DIAGRAM_TEMPLATES } from './templates';

// Re-export from shared module so existing callers don't need to change
export { sanitizeMermaidCode } from './sanitize';

/**
 * Validate Mermaid syntax
 *
 * Performs basic structural validation without full parsing
 */
export function validateMermaidSyntax(
  code: string,
  expectedType: MermaidDiagramType
): DiagramValidationResult {
  const errors: string[] = [];
  const suggestions: string[] = [];

  const trimmed = code.trim();

  // Remove any markdown fences if present
  const cleanCode = trimmed
    .replace(/^```mermaid\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Check if code is empty
  if (!cleanCode) {
    errors.push('Generated code is empty');
    return { valid: false, errors, suggestions };
  }

  // Check for correct diagram type prefix
  const template = DIAGRAM_TEMPLATES[expectedType];
  const expectedPrefix = template.prefix.toLowerCase();
  const codeFirstLine = cleanCode.split('\n')[0].toLowerCase().trim();

  if (!codeFirstLine.startsWith(expectedPrefix.toLowerCase())) {
    errors.push(
      `Expected ${expectedType} diagram but code starts with: ${codeFirstLine.substring(0, 30)}`
    );
    suggestions.push(`Code should start with: ${template.prefix}`);
  }

  // Check for common syntax errors

  // Unbalanced brackets
  const openBrackets = (cleanCode.match(/\[/g) || []).length;
  const closeBrackets = (cleanCode.match(/\]/g) || []).length;
  if (openBrackets !== closeBrackets) {
    errors.push(`Unbalanced square brackets: ${openBrackets} open, ${closeBrackets} close`);
  }

  const openBraces = (cleanCode.match(/\{/g) || []).length;
  const closeBraces = (cleanCode.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    errors.push(`Unbalanced curly braces: ${openBraces} open, ${closeBraces} close`);
  }

  const openParens = (cleanCode.match(/\(/g) || []).length;
  const closeParens = (cleanCode.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    errors.push(`Unbalanced parentheses: ${openParens} open, ${closeParens} close`);
  }

  // Check for problematic characters
  if (cleanCode.includes(' & ')) {
    suggestions.push('Contains "&" which may cause parsing issues - consider using "and"');
  }

  // Mindmap-specific validation
  if (expectedType === 'mindmap') {
    if (!cleanCode.includes('root((') && !cleanCode.includes('root(')) {
      errors.push('Mindmap must have a root node: root((text)) or root(text)');
    }

    // Check for nested parentheses in root (common LLM error)
    const rootMatch = cleanCode.match(/root\(\(([^)]+)\)\)/);
    if (rootMatch && rootMatch[1].includes('(')) {
      errors.push('Root node contains nested parentheses which will cause parsing errors');
      suggestions.push('Remove parentheses from inside root((...)) text');
    }

    // Check for empty lines (break mindmap indentation parser)
    if (/^\s*$/m.test(cleanCode.replace(/^mindmap\s*\n/, ''))) {
      errors.push('Mindmap contains empty lines — remove all blank lines between nodes');
    }
  }

  // Flowchart-specific validation
  if (expectedType === 'flowchart') {
    if (!cleanCode.match(/flowchart\s+(TD|TB|LR|RL|BT)/i)) {
      suggestions.push('Flowchart should specify direction: flowchart TD, LR, BT, or RL');
    }
    // Node count: catch over-complex diagrams before mermaid.js fails silently.
    // Cap is 30 (kept in sync with templates.ts COMPLEXITY_LIMITS.flowchart.maxNodes).
    const nodeCount = (cleanCode.match(/\b\w+\s*[\[{(]/g) || []).length;
    if (nodeCount > 40) {
      errors.push(`Flowchart has ~${nodeCount} node definitions — maximum is 30. Remove less important steps`);
    }
    // Subgraph direction validation (Phase 5). Per official mermaid docs, the
    // subgraph direction is declared on a separate `direction <DIR>` line INSIDE
    // the subgraph body (NOT `subgraph X [DIR]`, which parses `[DIR]` as a
    // label). Only TB/TD/BT/RL/LR are valid. An invalid direction is a HARD
    // error — mermaid.js silently mis-renders or throws; auto-fix cannot guess
    // the intended layout, so the LLM must fix it.
    const VALID_SUBGRAPH_DIRS = ['tb', 'td', 'bt', 'rl', 'lr'];
    const directionMatches = [...cleanCode.matchAll(/^\s*direction\s+(\S+)\s*$/gim)];
    for (const m of directionMatches) {
      const dir = m[1].trim().toLowerCase();
      if (dir && !VALID_SUBGRAPH_DIRS.includes(dir)) {
        errors.push(`Invalid subgraph direction "${m[1]}" — use one of TB, TD, BT, RL, LR`);
      }
    }
    // Label quoting: unescaped double quotes inside [...] or {...} labels break
    // the parser. This is a HARD error (sanitize only escapes < > &, not quotes).
    const unescapedQuoteLabels = cleanCode.match(/[\[{][^\]}]*[^\\]"[^]}]*[\]}]/g);
    if (unescapedQuoteLabels) {
      errors.push(`Labels contain unescaped quotes: ${unescapedQuoteLabels.slice(0, 2).join(', ')} — use " or single quotes inside labels`);
    }
  }

  // Sequence diagram validation
  if (expectedType === 'sequence') {
    if (!cleanCode.toLowerCase().includes('sequencediagram')) {
      errors.push('Sequence diagram must start with: sequenceDiagram');
    }
  }

  // C4 diagram validation (Phase 5). sanitize.ts fixC4CamelCase auto-fixes the
  // known camelCase variants BEFORE this validator runs, so a surviving match
  // means an unknown/new variant — a HARD error the LLM must correct.
  const c4Types: MermaidDiagramType[] = [
    'c4-context', 'c4-container', 'c4-component', 'c4-dynamic', 'c4-deployment',
  ];
  if (c4Types.includes(expectedType)) {
    // Catch any remaining camelCase boundary/ext declarations not covered by fixC4CamelCase.
    const residualCamel = cleanCode.match(
      /\b(?:System|Container|Component|Person|Enterprise|Deployment)[A-Z][a-zA-Z]*(?:Ext|Boundary|Db|Queue)\b/g
    );
    if (residualCamel) {
      errors.push(`C4 uses camelCase keyword(s) not auto-corrected: ${[...new Set(residualCamel)].slice(0, 3).join(', ')} — use the underscore form (e.g. System_Ext, Container_Boundary)`);
    }
  }

  // Architecture-beta validation (strict parser — catch issues before client)
  if (expectedType === 'architecture') {
    // Labels must contain only [\w ] — flag dots, apostrophes, etc.
    const badLabels = cleanCode.match(/\[([^\]]*[^\w \]][^\]]*)\]/g);
    if (badLabels) {
      errors.push(`Architecture labels contain invalid characters: ${badLabels.slice(0, 3).join(', ')} — only letters, numbers, underscores, and spaces allowed`);
    }
    // Edges: `--` (undirected) is always valid for ungrouped nodes.
    // `-->` (arrow) is valid ONLY with ports (e.g. `db:R --> L:server`).
    // A bare `-->` without ports is invalid in architecture-beta.
    const bareArrowEdges = cleanCode.match(/^\s*\w+:\w+\s+-->\s+\w+:\w+\s*$/gm);
    // Match `-->` lines that do NOT contain a port (`:`) on both sides
    const noPortArrow = cleanCode.match(/^\s*\w+\s+-->\s+\w+\s*$/gm);
    if (noPortArrow && noPortArrow.length > 0) {
      errors.push(`Architecture bare --> edges without ports are invalid: ${noPortArrow.slice(0, 2).join(', ')} — use "--" (undirected) for ungrouped nodes, or "id:Dir --> Dir:id" with ports for grouped edges`);
    }
    void bareArrowEdges; // ported --> edges are valid; retained for future lint
    // Icon names: mermaid.js only accepts these five
    const VALID_ARCH_ICONS = ['cloud', 'database', 'disk', 'internet', 'server'];
    const iconMatches = [...cleanCode.matchAll(/\bservice\b[^\n]*\(([^)]+)\)/g)];
    const badIcons = iconMatches
      .map(m => m[1].trim().toLowerCase())
      .filter(icon => !VALID_ARCH_ICONS.includes(icon));
    if (badIcons.length > 0) {
      errors.push(
        `Architecture uses invalid icon(s): ${[...new Set(badIcons)].join(', ')} — only cloud, database, disk, internet, server are valid`
      );
    }
    // IDs with dots break the architecture-beta parser
    const dotIdMatch = cleanCode.match(/\b(?:service|group|junction)\s+([a-zA-Z0-9_-]*\.[a-zA-Z0-9._-]+)/);
    if (dotIdMatch) {
      errors.push(`Architecture ID "${dotIdMatch[1]}" contains a dot — use underscores instead (e.g. orchestrator_api)`);
    }
    // Max services: aligned with templates.ts COMPLEXITY_LIMITS.architecture.maxNodes (20).
    // architecture-beta is PREFERRED over C4 for nested boundaries (C4 is maintenance mode).
    const serviceCount = (cleanCode.match(/^\s*service\s+/gm) || []).length;
    if (serviceCount > 20) {
      errors.push(`Architecture diagram has ${serviceCount} services — maximum is 20. Split into multiple diagrams or simplify the group structure`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

/**
 * Extract diagram type from Mermaid code
 */
export function detectDiagramType(code: string): MermaidDiagramType | null {
  const firstLine = code.trim().split('\n')[0].toLowerCase();

  if (firstLine.startsWith('flowchart') || firstLine.startsWith('graph')) {
    return 'flowchart';
  }
  if (firstLine.startsWith('sequencediagram')) {
    return 'sequence';
  }
  if (firstLine.startsWith('mindmap')) {
    return 'mindmap';
  }
  if (firstLine.startsWith('c4context')) {
    return 'c4-context';
  }
  if (firstLine.startsWith('c4container')) {
    return 'c4-container';
  }
  if (firstLine.startsWith('gantt')) {
    return 'gantt';
  }
  if (firstLine.startsWith('classdiagram')) {
    return 'classDiagram';
  }
  if (firstLine.startsWith('statediagram')) {
    return 'stateDiagram';
  }
  if (firstLine.startsWith('erdiagram')) {
    return 'erDiagram';
  }
  if (firstLine.startsWith('pie')) {
    return 'pie';
  }
  if (firstLine.startsWith('journey')) {
    return 'journey';
  }
  if (firstLine.startsWith('timeline')) {
    return 'timeline';
  }
  if (firstLine.startsWith('block-beta') || firstLine.startsWith('block')) {
    return 'block';
  }
  if (firstLine.startsWith('quadrantchart') || firstLine.startsWith('quadrant')) {
    return 'quadrant';
  }
  if (firstLine.startsWith('architecture-beta') || firstLine.startsWith('architecture')) {
    return 'architecture';
  }
  if (firstLine.startsWith('c4component')) {
    return 'c4-component';
  }
  if (firstLine.startsWith('c4dynamic')) {
    return 'c4-dynamic';
  }
  if (firstLine.startsWith('c4deployment')) {
    return 'c4-deployment';
  }
  if (firstLine.startsWith('gitgraph')) {
    return 'gitGraph';
  }

  return null;
}
