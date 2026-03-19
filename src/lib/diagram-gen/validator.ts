/**
 * Mermaid Syntax Validator
 *
 * Validates generated Mermaid code before returning to frontend
 */

import type { MermaidDiagramType, DiagramValidationResult } from '@/types/diagram-gen';
import { DIAGRAM_TEMPLATES } from './templates';

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
  }

  // Flowchart-specific validation
  if (expectedType === 'flowchart') {
    if (!cleanCode.match(/flowchart\s+(TD|TB|LR|RL|BT)/i)) {
      suggestions.push('Flowchart should specify direction: flowchart TD, LR, BT, or RL');
    }
  }

  // Sequence diagram validation
  if (expectedType === 'sequence') {
    if (!cleanCode.toLowerCase().includes('sequencediagram')) {
      errors.push('Sequence diagram must start with: sequenceDiagram');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    suggestions: suggestions.length > 0 ? suggestions : undefined,
  };
}

/**
 * Sanitize sequence diagram code to fix activate/deactivate stack errors.
 * Mermaid tracks activations as a stack internally — deactivating a participant
 * that is not currently active (e.g. duplicate deactivate in alt/else branches)
 * causes "Trying to inactivate an inactive participant".
 * This function drops any deactivate that would underflow the stack.
 *
 * Note: same logic exists in src/components/markdown/MermaidDiagram.tsx (client-side).
 * Any changes here should be mirrored there.
 */
function sanitizeSequenceCode(code: string): string {
  const activeCount = new Map<string, number>();
  return code.split('\n').filter(line => {
    const t = line.trim();
    const act = t.match(/^activate\s+(\S+)$/);
    const deact = t.match(/^deactivate\s+(\S+)$/);
    if (act) {
      const p = act[1];
      activeCount.set(p, (activeCount.get(p) ?? 0) + 1);
      return true;
    }
    if (deact) {
      const p = deact[1];
      const n = activeCount.get(p) ?? 0;
      if (n > 0) { activeCount.set(p, n - 1); return true; }
      return false; // drop: would underflow the activation stack
    }
    return true;
  }).join('\n');
}

/**
 * Sanitize Mermaid code to fix common issues
 */
export function sanitizeMermaidCode(code: string): string {
  let sanitized = code.trim();

  // Remove markdown fences
  sanitized = sanitized
    .replace(/^```mermaid\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  // Replace & with "and"
  sanitized = sanitized.replace(/\s&\s/g, ' and ');

  // Fix common mindmap issues - nested parentheses in root
  sanitized = sanitized.replace(
    /root\(\(([^)]*)\(([^)]+)\)([^)]*)\)\)/g,
    (_, before, inside, after) => `root((${before}${inside}${after}))`
  );

  // Fix sequence diagram activate/deactivate stack errors
  if (sanitized.trim().toLowerCase().startsWith('sequencediagram')) {
    sanitized = sanitizeSequenceCode(sanitized);
  }

  return sanitized.trim();
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

  return null;
}
