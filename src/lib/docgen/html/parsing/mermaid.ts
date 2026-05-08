/**
 * Mermaid diagram detection helpers.
 */
import { BARE_MERMAID_PATTERNS, SUPPORTED_MERMAID_TYPES } from '../constants';

/**
 * Detect if a bare line starts a Mermaid diagram block (not inside fences).
 * Matches common diagram type declarations.
 */
export function isBareMermaidStartLine(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  return BARE_MERMAID_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Collect a bare Mermaid block starting at index `start`.
 * Collects until:
 * - a blank line followed by non-indented prose/heading
 * - a markdown heading line
 * - another fenced block start
 * - EOF
 */
export function collectBareMermaidBlock(lines: string[], start: number): { block: string[]; endIndex: number } {
  const block: string[] = [lines[start]];
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    // Stop at a markdown heading
    if (/^#{1,6}\s+/.test(line)) break;
    // Stop at a fenced block start
    if (/^```/.test(line)) break;
    // If blank line and next line is not indented, stop
    if (line.trim() === '') {
      if (i + 1 < lines.length && !/^\s/.test(lines[i + 1])) break;
      block.push(line);
      i++;
      continue;
    }
    block.push(line);
    i++;
  }
  return { block, endIndex: i };
}

/**
 * Detect Mermaid diagram type from code.
 */
export function detectMermaidType(code: string): string {
  const first = code.trim().split('\n')[0].toLowerCase();
  if (first.startsWith('flowchart') || first.startsWith('graph')) return 'flowchart';
  if (first.startsWith('sequencediagram')) return 'sequence';
  if (first.startsWith('mindmap')) return 'mindmap';
  if (first.startsWith('statediagram-v2') || first.startsWith('statediagram')) return 'stateDiagram';
  if (first.startsWith('erdiagram')) return 'erDiagram';
  if (first.startsWith('userjourney')) return 'userJourney';
  if (first.startsWith('gantt')) return 'gantt';
  if (first.startsWith('gitgraph')) return 'gitGraph';
  if (first.startsWith('pie')) return 'pie';
  if (first.startsWith('requirementdiagram')) return 'requirementDiagram';
  if (first.startsWith('c4context')) return 'c4-context';
  if (first.startsWith('c4container')) return 'c4-container';
  if (first.startsWith('c4component')) return 'c4-component';
  if (first.startsWith('classdiagram')) return 'classDiagram';
  return 'unknown';
}

/**
 * Determine whether a Mermaid code block is of a supported diagram type.
 */
export function isSupportedMermaidType(code: string): boolean {
  const firstLine = code.trim().split('\n')[0].toLowerCase().replace(/\s+/g, '');
  return Array.from(SUPPORTED_MERMAID_TYPES).some((t) => firstLine.startsWith(t));
}

