/**
 * Shared Mermaid Sanitization
 *
 * Centralised sanitization functions used by both server-side (validator.ts)
 * and client-side (MermaidDiagram.tsx). Any changes here apply everywhere.
 *
 * IMPORTANT: Do NOT duplicate these functions elsewhere. Import from here.
 */

// ===== Unicode Normalization =====

/**
 * Normalize Unicode smart quotes, arrows, and dashes to ASCII equivalents.
 * Must be applied first — before any regex-based structural fixes.
 */
export function normalizeUnicode(code: string): string {
  return code
    .replace(/[\u201C\u201D]/g, '"')  // " " → "
    .replace(/[\u2018\u2019]/g, "'")  // ' ' → '
    .replace(/\u2192/g, '-->')         // → → -->
    .replace(/\u2013|\u2014/g, '-');   // – — → -
}

// ===== General Fixes =====

/**
 * Remove trailing semicolons — LLMs add these from programming habits,
 * but Mermaid does not use semicolons.
 */
export function removeTrailingSemicolons(code: string): string {
  return code.replace(/;[ \t]*$/gm, '');
}

/**
 * Replace standalone & with "and" to avoid Mermaid parsing issues.
 */
export function replaceAmpersands(code: string): string {
  return code.replace(/\s&\s/g, ' and ');
}

/**
 * Strip markdown fences (```mermaid, ```) from code.
 */
export function stripMarkdownFences(code: string): string {
  return code
    .replace(/^```mermaid\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

// ===== Flowchart / Graph Fixes =====

/**
 * Strip invalid bare `title <text>` directive lines.
 * Preserves valid node IDs like: title[My Node] or title{Decision}
 */
export function stripInvalidTitleDirectives(code: string): string {
  return code
    .split('\n')
    .filter(line => !/^\s*title\s+(?![[\]{(|>])/.test(line))
    .join('\n');
}

/**
 * Convert single -> to --> in flowcharts (single arrow is invalid).
 */
export function fixSingleArrow(code: string): string {
  return code.replace(/(^|[^-!<])->(?!>)/gm, '$1-->');
}

/**
 * Escape < > inside node labels [...] and {...} to prevent parser confusion.
 */
export function escapeAngleBracketsInLabels(code: string): string {
  return code
    .replace(/\[([^\]]*)\]/g, (_, c) => `[${c.replace(/</g, '&lt;').replace(/>/g, '&gt;')}]`)
    .replace(/\{([^}]*)\}/g, (_, c) => `{${c.replace(/</g, '&lt;').replace(/>/g, '&gt;')}}`);
}

/**
 * Fix URL-path labels in flowcharts: [/api/users] → ["/api/users"]
 * Prevents parallelogram shape misparse.
 */
export function fixUrlPathLabels(code: string): string {
  return code.replace(/\[\/([^\]"]*)\]/g, '["/\$1"]');
}

/**
 * Remove <br> and <br/> tags from flowchart labels.
 */
export function removeBrTags(code: string): string {
  return code.replace(/<br\s*\/?>/gi, ' ');
}

/**
 * Replace & with "and" inside flowchart [...] and {...} labels.
 */
export function fixAmpersandInFlowchartLabels(code: string): string {
  return code
    .replace(/\[([^\]]*?)&([^\]]*?)\]/g, '[$1 and $2]')
    .replace(/\{([^}]*?)&([^}]*?)\}/g, '{$1 and $2}');
}

// ===== Mindmap Fixes =====

/**
 * Fix nested parentheses inside root((...)) node.
 * e.g., root((Grenada Enterprise Architecture (GEA))) → root((Grenada Enterprise Architecture - GEA))
 */
export function fixMindmapRootNestedParens(code: string): string {
  return code.replace(
    /root\(\(([^)]*)\(([^)]+)\)([^)]*)\)\)/g,
    (_, before, inside, after) => `root((${before}${inside}${after}))`
  );
}

/**
 * Full line-by-line mindmap sanitization.
 * Handles nested parens in root, & escaping, and trailing content after )).
 */
export function sanitizeMindmapCode(code: string): string {
  const lines = code.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    let sanitized = line;

    // Fix root((...)) with nested parentheses
    const rootMatch = sanitized.match(/^(\s*)root\(\((.+)\)\)\s*$/);
    if (rootMatch) {
      const indent = rootMatch[1];
      let innerText = rootMatch[2];
      innerText = innerText.replace(/\(([^)]+)\)/g, '- $1');
      sanitized = `${indent}root((${innerText}))`;
    }

    // For non-root lines, escape problematic characters
    if (!sanitized.includes('root((')) {
      sanitized = sanitized.replace(/\s&\s/g, ' and ');
      sanitized = sanitized.replace(/&/g, ' and ');
    }

    // Remove any trailing content after )) on root line
    if (sanitized.includes('root((') && sanitized.includes('))')) {
      const closeIndex = sanitized.indexOf('))') + 2;
      sanitized = sanitized.substring(0, closeIndex);
    }

    result.push(sanitized);
  }

  return result.join('\n');
}

// ===== Sequence Diagram Fixes =====

/**
 * Expand comma-separated participant declarations to individual lines.
 * e.g., "participant A, B, C" → "participant A\nparticipant B\nparticipant C"
 */
export function expandCommaParticipants(code: string): string {
  return code.split('\n').map(line => {
    const m = line.match(/^(\s*)participant\s+(.+)$/);
    if (m && m[2].includes(',')) {
      return m[2].split(',').map(p => `${m[1]}participant ${p.trim()}`).join('\n');
    }
    return line;
  }).join('\n');
}

/**
 * Convert single -> to ->> in sequence diagrams (requires ->> for solid messages).
 */
export function fixSequenceArrow(code: string): string {
  return code.replace(/(^|[^-])->(?![->])/gm, '$1->>');
}

/**
 * Sanitize sequence diagram code to fix activate/deactivate stack errors.
 * Mermaid tracks activations as a stack internally — deactivating a participant
 * that is not currently active (e.g. duplicate deactivate in alt/else branches)
 * causes "Trying to inactivate an inactive participant".
 * This function drops any deactivate that would underflow the stack.
 */
export function sanitizeSequenceCode(code: string): string {
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

// ===== C4 Diagram Fixes =====

/**
 * Fix C4 diagram function names: LLMs write camelCase; Mermaid requires
 * underscore for _Ext and _Boundary variants.
 */
export function fixC4CamelCase(code: string): string {
  return code
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

// ===== Gantt Fixes =====

/**
 * Fix gantt-specific issues: "critical" → "crit" (valid modifier keyword).
 */
export function fixGanttKeywords(code: string): string {
  return code.replace(/\bcritical\b/g, 'crit');
}

// ===== Class Diagram Fixes =====

/**
 * Strip inline <<annotation>> from class definition lines.
 * The annotation must appear on its own line inside the class body.
 * e.g. "class Foo <<interface>> {" → "class Foo {"
 */
export function fixClassDiagramAnnotations(code: string): string {
  return code.replace(/^(\s*class\s+\w+)\s+<<[^>]+>>/gm, '$1');
}

// ===== ER Diagram Fixes =====

/**
 * Fix erDiagram-specific issues:
 * - Dots in entity names → underscores
 * - Spaces in entity names → underscores on relationship lines
 * - Strip %% comment lines
 */
export function fixErDiagram(code: string): string {
  let sanitized = code;

  // Dots in entity names → underscores
  sanitized = sanitized.replace(/\b([A-Z][A-Z0-9_]*)\.([A-Z][A-Z0-9_]*)\b/g, '$1_$2');

  // Spaces in entity names → underscores on relationship lines
  sanitized = sanitized.replace(
    /^(\s*)([A-Z][A-Z0-9_]*(?:\s+[A-Z][A-Z0-9_]+)+)(\s+\|)/gm,
    (_, indent, name, rest) => `${indent}${name.replace(/\s+/g, '_')}${rest}`
  );

  // Strip %% comment lines
  sanitized = sanitized.replace(/^\s*%%.*$/gm, '');

  return sanitized;
}

// ===== Journey Fixes =====

/**
 * Fix journey-specific issues:
 * - Missing colon after score: "Task: 5 Actor" → "Task: 5: Actor"
 * - "Section" (capitalised) or "section Name:" → "section Name"
 */
export function fixJourneySyntax(code: string): string {
  let sanitized = code;

  // Fix missing colon after score
  sanitized = sanitized.replace(/(:\s*[1-5])\s+([A-Za-z])/g, '$1: $2');

  // Fix "Section" (capitalised) or "section Name:" (trailing colon) → "section Name"
  sanitized = sanitized.replace(/^\s*[Ss]ection\s+([^\n:]+):?\s*$/gm, (_, name) => `section ${name.trim()}`);

  return sanitized;
}

// ===== State Diagram Fixes =====

/**
 * Auto-upgrade stateDiagram (v1) to stateDiagram-v2 (more features, better renderer).
 */
export function upgradeStateDiagram(code: string): string {
  if (code.trim().toLowerCase().startsWith('statediagram') &&
      !code.trim().toLowerCase().startsWith('statediagram-v2')) {
    return code.replace(/^stateDiagram\b/i, 'stateDiagram-v2');
  }
  return code;
}

// ===== Architecture-beta Fixes =====

/**
 * Fix architecture-beta diagrams.
 * architecture-beta has strict syntax rules (mermaid 11.12.2):
 * - Labels inside [...] may only contain [\w ] (letters, digits, underscores, spaces)
 * - IDs may only contain [\w-] (letters, digits, underscores, hyphens — no dots)
 * - Edges use -- (double dash) ONLY, never -->
 */
export function sanitizeArchitectureCode(code: string): string {
  let sanitized = code.replace(/^architecture\b(?!-beta)/m, 'architecture-beta');

  // Convert common arrow types to architecture-beta compatible edges (-- only)
  sanitized = sanitized.replace(/->+/g, '--');

  // Clean labels: strip any chars that aren't [\w ] from inside [...]
  sanitized = sanitized.replace(/\[([^\]]+)\]/g, (_, label) => {
    const clean = label.replace(/[^\w ]/g, '');
    return `[${clean}]`;
  });

  const archKeywords = ['service', 'gateway', 'database', 'public_network', 'group', 'disk', 'cloud', 'edge', 'firewall', 'junction'];

  sanitized = sanitized.split('\n').map(line => {
    const t = line.trim();
    if (!t || t === 'architecture-beta') return line;

    // Definition lines: clean the ID portion
    const defMatch = line.match(/^(\s*)(service|gateway|database|public_network|group|disk|cloud|edge|firewall|junction)\s+([^\s[({]+)(.*)$/i);
    if (defMatch) {
      const [, indent, type, id, rest] = defMatch;
      const safeId = id.replace(/[^\w-]/g, '_');
      // If the rest doesn't contain a label [], use original id as label
      if (!rest.includes('[') && !rest.includes('(')) {
        return `${indent}${type} ${safeId}[${id.replace(/[^\w ]/g, '')}]`;
      }
      return `${indent}${type} ${safeId}${rest}`;
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

  return sanitized;
}

// ===== Quadrant Chart Fixes =====

/**
 * Normalize quadrantChart keyword and clamp point coordinates to [0, 1].
 */
export function fixQuadrantChart(code: string): string {
  let sanitized = code;

  // Normalize keyword
  sanitized = sanitized.replace(/^quadrant\b(?!Chart)/im, 'quadrantChart');

  // Clamp coordinates to [0, 1]
  sanitized = sanitized.replace(/:\s*\[(\d*\.?\d+),\s*(\d*\.?\d+)\]/g, (_, x, y) => {
    const cx = Math.min(1, Math.max(0, parseFloat(x))).toFixed(2);
    const cy = Math.min(1, Math.max(0, parseFloat(y))).toFixed(2);
    return `: [${cx}, ${cy}]`;
  });

  return sanitized;
}

// ===== Block Diagram Fixes =====

/**
 * Normalize block keyword: LLMs sometimes write "block" without "-beta" suffix.
 */
export function fixBlockKeyword(code: string): string {
  if (code.trim().startsWith('block') && !code.trim().startsWith('block-beta')) {
    return code.replace(/^block\b(?!-beta)/m, 'block-beta');
  }
  return code;
}

// ===== Main Sanitize Entry Point =====

/**
 * Sanitize Mermaid code to fix common LLM-generated issues.
 * Applies all type-specific fixes based on the detected diagram type.
 *
 * This is the single entry point used by both server and client.
 */
export function sanitizeMermaidCode(code: string): string {
  let sanitized = code.trim();

  // 1. Strip markdown fences
  sanitized = stripMarkdownFences(sanitized);

  // 2. Normalize Unicode (must be early — affects all regex)
  sanitized = normalizeUnicode(sanitized);

  // 3. Remove trailing semicolons
  sanitized = removeTrailingSemicolons(sanitized);

  // 4. Replace standalone ampersands
  sanitized = replaceAmpersands(sanitized);

  // 5. Auto-upgrade stateDiagram (v1) → stateDiagram-v2
  sanitized = upgradeStateDiagram(sanitized);

  // 6. Type-specific fixes
  const firstLine = sanitized.trim().toLowerCase();

  // --- Flowchart / Graph ---
  if (firstLine.startsWith('flowchart') || firstLine.startsWith('graph')) {
    sanitized = stripInvalidTitleDirectives(sanitized);
    sanitized = removeBrTags(sanitized);
    sanitized = fixAmpersandInFlowchartLabels(sanitized);
    sanitized = fixUrlPathLabels(sanitized);
    sanitized = fixSingleArrow(sanitized);
    sanitized = escapeAngleBracketsInLabels(sanitized);
  }

  // --- Mindmap ---
  else if (firstLine.startsWith('mindmap')) {
    sanitized = sanitizeMindmapCode(sanitized);
  }

  // --- Sequence Diagram ---
  else if (firstLine.startsWith('sequencediagram')) {
    sanitized = expandCommaParticipants(sanitized);
    sanitized = fixSequenceArrow(sanitized);
    sanitized = sanitizeSequenceCode(sanitized);
  }

  // --- C4 Diagrams ---
  else if (/^C4(Context|Container|Component|Dynamic|Deployment)/i.test(sanitized.trim())) {
    sanitized = fixC4CamelCase(sanitized);
  }

  // --- Gantt ---
  else if (sanitized.trim().startsWith('gantt')) {
    sanitized = fixGanttKeywords(sanitized);
  }

  // --- Class Diagram ---
  else if (sanitized.trim().startsWith('classDiagram')) {
    sanitized = fixClassDiagramAnnotations(sanitized);
  }

  // --- ER Diagram ---
  else if (sanitized.trim().startsWith('erDiagram')) {
    sanitized = fixErDiagram(sanitized);
  }

  // --- Journey ---
  else if (sanitized.trim().startsWith('journey')) {
    sanitized = fixJourneySyntax(sanitized);
  }

  // --- Architecture-beta ---
  else if (sanitized.trim().toLowerCase().startsWith('architecture')) {
    sanitized = sanitizeArchitectureCode(sanitized);
  }

  // --- Quadrant Chart ---
  else if (sanitized.trim().toLowerCase().startsWith('quadrant')) {
    sanitized = fixQuadrantChart(sanitized);
  }

  // --- Block Diagram ---
  else if (sanitized.trim().startsWith('block')) {
    sanitized = fixBlockKeyword(sanitized);
  }

  return sanitized.trim();
}
