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
    // Node count: catch over-complex diagrams before mermaid.js fails silently
    const nodeCount = (cleanCode.match(/\b\w+\s*[\[{(]/g) || []).length;
    if (nodeCount > 20) {
      errors.push(`Flowchart has ~${nodeCount} node definitions — maximum is 15. Remove less important steps`);
    }
  }

  // Sequence diagram validation
  if (expectedType === 'sequence') {
    if (!cleanCode.toLowerCase().includes('sequencediagram')) {
      errors.push('Sequence diagram must start with: sequenceDiagram');
    }
  }

  // Architecture-beta validation (strict parser — catch issues before client)
  if (expectedType === 'architecture') {
    // Labels must contain only [\w ] — flag dots, apostrophes, etc.
    const badLabels = cleanCode.match(/\[([^\]]*[^\w \]][^\]]*)\]/g);
    if (badLabels) {
      errors.push(`Architecture labels contain invalid characters: ${badLabels.slice(0, 3).join(', ')} — only letters, numbers, underscores, and spaces allowed`);
    }
    // Edges must use -- not -->
    if (/-->/.test(cleanCode)) {
      errors.push('Architecture edges must use -- (double dash), not --> (arrow)');
    }
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
    // Max services: mermaid.js becomes unreliable above 10
    const serviceCount = (cleanCode.match(/^\s*service\s+/gm) || []).length;
    if (serviceCount > 10) {
      errors.push(`Architecture diagram has ${serviceCount} services — maximum is 10. Reduce scope or use c4-container for complex architectures`);
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
