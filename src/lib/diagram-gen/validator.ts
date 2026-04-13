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

  // Fix 4: Normalize Unicode smart quotes and arrows to ASCII equivalents
  // Note: same logic exists in src/components/markdown/MermaidDiagram.tsx (client-side).
  // Any changes here should be mirrored there.
  sanitized = sanitized
    .replace(/[\u201C\u201D]/g, '"')  // " " → "
    .replace(/[\u2018\u2019]/g, "'")  // ' ' → '
    .replace(/\u2192/g, '-->')         // → → -->
    .replace(/\u2013|\u2014/g, '-');   // – — → -

  // Fix 3: Remove trailing semicolons (LLMs add these from programming habits — Mermaid doesn't use them)
  sanitized = sanitized.replace(/;[ \t]*$/gm, '');

  // Replace & with "and"
  sanitized = sanitized.replace(/\s&\s/g, ' and ');

  // Fix flowchart/graph node labels with URL paths (prevent parallelogram shape misparse).
  // e.g., A[/api/auth/*] → A["/api/auth/*"]
  // Note: same logic exists in src/components/markdown/MermaidDiagram.tsx (client-side).
  // Any changes here should be mirrored there.
  if (sanitized.trim().startsWith('flowchart') || sanitized.trim().startsWith('graph')) {
    // Fix 1: Strip invalid bare `title <text>` directive lines (valid only in YAML frontmatter)
    // Preserves valid node IDs like: title[My Node] or title{Decision}
    sanitized = sanitized
      .split('\n')
      .filter(line => !/^\s*title\s+(?![[\]{(|>])/.test(line))
      .join('\n');

    // Fix 2: Convert single -> to --> (single arrow is invalid in flowcharts)
    sanitized = sanitized.replace(/(^|[^-!<])->(?!>)/gm, '$1-->');

    // Fix 8: Escape < > inside node labels [...] and {...} to prevent parser confusion
    sanitized = sanitized
      .replace(/\[([^\]]*)\]/g, (_, c) => `[${c.replace(/</g, '&lt;').replace(/>/g, '&gt;')}]`)
      .replace(/\{([^}]*)\}/g, (_, c) => `{${c.replace(/</g, '&lt;').replace(/>/g, '&gt;')}}`);

    sanitized = sanitized.replace(/\[\/([^\]"]*)\]/g, '["/\$1"]');
  }

  // Fix common mindmap issues - nested parentheses in root
  sanitized = sanitized.replace(
    /root\(\(([^)]*)\(([^)]+)\)([^)]*)\)\)/g,
    (_, before, inside, after) => `root((${before}${inside}${after}))`
  );

  // Fix sequence diagram errors
  if (sanitized.trim().toLowerCase().startsWith('sequencediagram')) {
    // Fix 7: Expand comma-separated participant declarations to individual lines
    sanitized = sanitized.split('\n').map(line => {
      const m = line.match(/^(\s*)participant\s+(.+)$/);
      if (m && m[2].includes(',')) {
        return m[2].split(',').map(p => `${m[1]}participant ${p.trim()}`).join('\n');
      }
      return line;
    }).join('\n');

    // Fix 6: Convert single -> to ->> (sequence diagrams require ->> for solid messages)
    sanitized = sanitized.replace(/(^|[^-])->(?![->])/gm, '$1->>');

    // Fix activate/deactivate stack errors
    sanitized = sanitizeSequenceCode(sanitized);
  }

  // Fix C4 diagram function names: LLMs write camelCase; Mermaid requires underscore for _Ext and _Boundary variants
  // Note: same logic exists in src/components/markdown/MermaidDiagram.tsx (client-side).
  // Any changes here should be mirrored there.
  if (/^C4(Context|Container|Component|Dynamic|Deployment)/i.test(sanitized.trim())) {
    sanitized = sanitized
      .replace(/\bPersonExt\b/g, 'Person_Ext')
      .replace(/\bSystemExt\b/g, 'System_Ext')
      .replace(/\bSystemDbExt\b/g, 'SystemDb_Ext')
      .replace(/\bSystemQueueExt\b/g, 'SystemQueue_Ext')
      .replace(/\bContainerExt\b/g, 'Container_Ext')
      .replace(/\bContainerDbExt\b/g, 'ContainerDb_Ext')
      .replace(/\bContainerQueueExt\b/g, 'ContainerQueue_Ext')
      .replace(/\bContainerBoundary\b/g, 'Container_Boundary')
      .replace(/\bSystemBoundary\b/g, 'System_Boundary')
      .replace(/\bEnterpriseBoundary\b/g, 'Enterprise_Boundary')
      .replace(/\bComponentExt\b/g, 'Component_Ext')
      .replace(/\bComponentDbExt\b/g, 'ComponentDb_Ext')
      .replace(/\bComponentQueueExt\b/g, 'ComponentQueue_Ext')
      .replace(/\bComponentBoundary\b/g, 'Component_Boundary')
      .replace(/\bDeploymentNode\b/g, 'Deployment_Node');
  }

  // Fix gantt-specific issues
  if (sanitized.trim().startsWith('gantt')) {
    // "critical" is not a valid task modifier — the correct keyword is "crit"
    sanitized = sanitized.replace(/\bcritical\b/g, 'crit');
  }

  // Fix classDiagram-specific issues
  if (sanitized.trim().startsWith('classDiagram')) {
    // Strip inline <<annotation>> from class definition lines — causes parse errors in many versions.
    // The annotation must appear on its own line inside the class body: <<interface>>
    // e.g. "class Foo <<interface>> {" → "class Foo {"
    sanitized = sanitized.replace(/^(\s*class\s+\w+)\s+<<[^>]+>>/gm, '$1');
  }

  // Fix erDiagram-specific issues
  if (sanitized.trim().startsWith('erDiagram')) {
    // Dots in entity names → underscores (dots not supported in entity identifiers)
    sanitized = sanitized.replace(/\b([A-Z][A-Z0-9_]*)\.([A-Z][A-Z0-9_]*)\b/g, '$1_$2');

    // Spaces in entity names → underscores (entity names cannot contain spaces)
    // Matches UPPER_CASE words with spaces between them on relationship lines
    sanitized = sanitized.replace(
      /^(\s*)([A-Z][A-Z0-9_]*(?:\s+[A-Z][A-Z0-9_]+)+)(\s+\|)/gm,
      (_, indent, name, rest) => `${indent}${name.replace(/\s+/g, '_')}${rest}`
    );

    // Strip %% comment lines inside entity attribute blocks (not supported in erDiagram)
    sanitized = sanitized.replace(/^\s*%%.*$/gm, '');
  }

  // Fix journey-specific issues
  if (sanitized.trim().startsWith('journey')) {
    // Fix missing colon after score: "Task: 5 Actor" → "Task: 5: Actor"
    sanitized = sanitized.replace(/(:\s*[1-5])\s+([A-Za-z])/g, '$1: $2');

    // Fix "Section" (capitalised) or "section Name:" (trailing colon) → "section Name"
    sanitized = sanitized.replace(/^\s*[Ss]ection\s+([^\n:]+):?\s*$/gm, (_, name) => `section ${name.trim()}`);
  }

  // Auto-upgrade stateDiagram (v1) to stateDiagram-v2 (more features, better renderer)
  // Note: same logic exists in src/components/markdown/MermaidDiagram.tsx (client-side).
  // Any changes here should be mirrored there.
  if (sanitized.trim().toLowerCase().startsWith('statediagram') &&
      !sanitized.trim().toLowerCase().startsWith('statediagram-v2')) {
    sanitized = sanitized.replace(/^stateDiagram\b/i, 'stateDiagram-v2');
  }

  // Normalize and sanitize architecture-beta diagrams
  // architecture-beta has strict syntax rules (mermaid 11.12.2):
  // - Labels inside [...] may only contain [\w ] (letters, digits, underscores, spaces)
  // - IDs may only contain [\w-] (letters, digits, underscores, hyphens — no dots)
  // - Edges use -- (double dash) ONLY, never -->
  // Note: same logic exists in src/components/markdown/MermaidDiagram.tsx (client-side).
  // Any changes here should be mirrored there.
  if (sanitized.trim().startsWith('architecture')) {
    // Fix keyword: LLMs sometimes omit "-beta" suffix
    sanitized = sanitized.replace(/^architecture\b(?!-beta)/m, 'architecture-beta');

    // Fix edges: --> is invalid in architecture-beta; must be -- (double dash)
    sanitized = sanitized.replace(/->+/g, '--');

    // Fix labels: only [\w ] allowed inside [...] — strip dots, apostrophes, etc.
    sanitized = sanitized.replace(/\[([^\]]+)\]/g, (_, label) => {
      const clean = label.replace(/[^\w ]/g, '');
      return `[${clean}]`;
    });

    // Fix IDs: replace dots with underscores (dots break the parser)
    const archKeywords = ['service', 'gateway', 'database', 'public_network', 'group', 'disk', 'cloud', 'edge', 'firewall', 'junction'];
    sanitized = sanitized.split('\n').map(line => {
      const t = line.trim();
      // Definition lines: clean the ID portion
      const defMatch = line.match(/^(\s*)(service|gateway|database|public_network|group|disk|cloud|edge|firewall|junction)\s+([^\s[({]+)(.*)$/i);
      if (defMatch) {
        const [, indent, type, id, rest] = defMatch;
        return `${indent}${type} ${id.replace(/[^\w-]/g, '_')}${rest}`;
      }
      // Edge lines: clean IDs referenced in edges
      if (t.includes('--') && !t.startsWith('architecture')) {
        return line.replace(/([a-zA-Z0-9._-]+)(?=:|\s--|--\s|$)/g, (match) => {
          if (archKeywords.includes(match.toLowerCase())) return match;
          return match.replace(/[^\w-]/g, '_');
        });
      }
      return line;
    }).join('\n');
  }

  // Normalize quadrantChart keyword and clamp point coordinates to [0, 1]
  // Note: same logic exists in src/components/markdown/MermaidDiagram.tsx (client-side).
  // Any changes here should be mirrored there.
  if (sanitized.trim().toLowerCase().startsWith('quadrant')) {
    sanitized = sanitized.replace(/^quadrant\b(?!Chart)/im, 'quadrantChart');
    sanitized = sanitized.replace(/:\s*\[(\d*\.?\d+),\s*(\d*\.?\d+)\]/g, (_, x, y) => {
      const cx = Math.min(1, Math.max(0, parseFloat(x))).toFixed(2);
      const cy = Math.min(1, Math.max(0, parseFloat(y))).toFixed(2);
      return `: [${cx}, ${cy}]`;
    });
  }

  // Normalize block keyword: LLMs sometimes write "block" without "-beta" suffix
  // Note: same logic exists in src/components/markdown/MermaidDiagram.tsx (client-side).
  // Any changes here should be mirrored there.
  if (sanitized.trim().startsWith('block') && !sanitized.trim().startsWith('block-beta')) {
    sanitized = sanitized.replace(/^block\b(?!-beta)/m, 'block-beta');
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

  return null;
}
