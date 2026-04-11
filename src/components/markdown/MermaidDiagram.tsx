'use client';

/**
 * MermaidDiagram Component
 *
 * Renders Mermaid diagrams (mindmaps, flowcharts, sequence diagrams, etc.)
 * Uses dynamic import to avoid loading Mermaid.js until needed.
 *
 * Supports:
 * - mindmap
 * - flowchart / graph
 * - sequenceDiagram
 * - classDiagram
 * - stateDiagram
 * - erDiagram
 * - gantt
 * - pie
 * - and more...
 */

import { useEffect, useRef, useState, useId } from 'react';
import { AlertCircle, Download, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface MermaidDiagramProps {
  /** The Mermaid diagram code */
  code: string;
  /** Optional className for the container */
  className?: string;
}

// Mermaid is loaded dynamically to reduce initial bundle size
let mermaidPromise: Promise<typeof import('mermaid')> | null = null;

async function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      // Initialize mermaid with custom config
      m.default.initialize({
        startOnLoad: false,
        theme: 'default',
        securityLevel: 'loose',
        suppressErrorRendering: true, // Prevent error divs from being injected into DOM
        fontFamily: 'system-ui, -apple-system, sans-serif',
        mindmap: {
          useMaxWidth: true,
          padding: 16,
        },
        flowchart: {
          useMaxWidth: true,
          htmlLabels: true,
          curve: 'basis',
        },
      });
      return m;
    });
  }
  return mermaidPromise;
}

/**
 * Sanitize mindmap code to fix common LLM-generated syntax issues
 * - Removes nested parentheses inside root((...))
 * - Escapes special characters like & in node text
 * - Fixes indentation issues
 */
function sanitizeMindmapCode(code: string): string {
  const lines = code.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    let sanitized = line;

    // Fix root((...)) with nested parentheses - extract inner text and remove nested parens
    // e.g., root((Grenada Enterprise Architecture (GEA))) -> root((Grenada Enterprise Architecture - GEA))
    const rootMatch = sanitized.match(/^(\s*)root\(\((.+)\)\)\s*$/);
    if (rootMatch) {
      const indent = rootMatch[1];
      let innerText = rootMatch[2];
      // Replace nested parentheses with dashes or remove them
      innerText = innerText.replace(/\(([^)]+)\)/g, '- $1');
      sanitized = `${indent}root((${innerText}))`;
    }

    // For non-root lines, escape problematic characters in node text
    // Replace & with 'and' to avoid parsing issues
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

/**
 * Sanitize sequence diagram code to fix activate/deactivate stack errors.
 * Mermaid tracks activations as a stack internally — deactivating a participant
 * that is not currently active (e.g. duplicate deactivate in alt/else branches)
 * causes "Trying to inactivate an inactive participant".
 * This function drops any deactivate that would underflow the stack.
 *
 * Note: same logic exists in src/lib/diagram-gen/validator.ts (server-side).
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
 * Sanitize Mermaid code based on diagram type
 */
function sanitizeMermaidCode(code: string): string {
  let sanitized = code.trim();

  // Fix 4: Normalize Unicode smart quotes and arrows to ASCII equivalents
  // Note: same logic exists in src/lib/diagram-gen/validator.ts (server-side).
  // Any changes here should be mirrored there.
  sanitized = sanitized
    .replace(/[\u201C\u201D]/g, '"')  // " " → "
    .replace(/[\u2018\u2019]/g, "'")  // ' ' → '
    .replace(/\u2192/g, '-->')         // → → -->
    .replace(/\u2013|\u2014/g, '-');   // – — → -

  // Fix 3: Remove trailing semicolons (LLMs add these from programming habits — Mermaid doesn't use them)
  sanitized = sanitized.replace(/;[ \t]*$/gm, '');

  // Apply mindmap-specific sanitization
  if (sanitized.startsWith('mindmap')) {
    return sanitizeMindmapCode(sanitized);
  }

  // For flowcharts, escape special characters in labels
  if (sanitized.startsWith('flowchart') || sanitized.startsWith('graph')) {
    // Fix 1: Strip invalid bare `title <text>` directive lines (valid only in YAML frontmatter)
    // Preserves valid node IDs like: title[My Node] or title{Decision}
    sanitized = sanitized
      .split('\n')
      .filter(line => !/^\s*title\s+(?![[\]{(|>])/.test(line))
      .join('\n');

    return sanitized
      .replace(/<br\s*\/?>/gi, ' ')                        // Remove <br/> and <br> tags
      .replace(/\[([^\]]*?)&([^\]]*?)\]/g, '[$1 and $2]')  // [text & more] -> [text and more]
      .replace(/\{([^}]*?)&([^}]*?)\}/g, '{$1 and $2}')    // {text & more} -> {text and more}
      .replace(/\[\/([^\]"]*)\]/g, '["/\$1"]')              // [/api/path] -> ["/api/path"] (prevent parallelogram misparse)
      .replace(/(^|[^-!<])->(?!>)/gm, '$1-->')             // Fix 2: single -> → --> (invalid in flowcharts)
      .replace(/\[([^\]]*)\]/g, (_, c) => `[${c.replace(/</g, '&lt;').replace(/>/g, '&gt;')}]`)  // Fix 8: < > in labels
      .replace(/\{([^}]*)\}/g, (_, c) => `{${c.replace(/</g, '&lt;').replace(/>/g, '&gt;')}}`);  // Fix 8: < > in labels
  }

  // Fix sequence diagram errors
  if (sanitized.startsWith('sequenceDiagram') || sanitized.toLowerCase().startsWith('sequencediagram')) {
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

    return sanitizeSequenceCode(sanitized);
  }

  // Fix gantt-specific issues
  // Note: same logic exists in src/lib/diagram-gen/validator.ts (server-side).
  // Any changes here should be mirrored there.
  if (sanitized.startsWith('gantt')) {
    // "critical" is not a valid task modifier — the correct keyword is "crit"
    return sanitized.replace(/\bcritical\b/g, 'crit');
  }

  // Fix classDiagram-specific issues
  if (sanitized.startsWith('classDiagram')) {
    // Strip inline <<annotation>> from class definition lines — causes parse errors in many versions.
    // The annotation must appear on its own line inside the class body: <<interface>>
    // e.g. "class Foo <<interface>> {" → "class Foo {"
    return sanitized.replace(/^(\s*class\s+\w+)\s+<<[^>]+>>/gm, '$1');
  }

  // Fix erDiagram-specific issues
  if (sanitized.startsWith('erDiagram')) {
    // Dots in entity names → underscores (dots not supported in entity identifiers)
    sanitized = sanitized.replace(/\b([A-Z][A-Z0-9_]*)\.([A-Z][A-Z0-9_]*)\b/g, '$1_$2');

    // Spaces in entity names → underscores on relationship lines
    sanitized = sanitized.replace(
      /^(\s*)([A-Z][A-Z0-9_]*(?:\s+[A-Z][A-Z0-9_]+)+)(\s+\|)/gm,
      (_, indent, name, rest) => `${indent}${name.replace(/\s+/g, '_')}${rest}`
    );

    // Strip %% comment lines (not supported inside erDiagram attribute blocks)
    return sanitized.replace(/^\s*%%.*$/gm, '');
  }

  // Fix journey-specific issues
  if (sanitized.startsWith('journey')) {
    // Fix missing colon after score: "Task: 5 Actor" → "Task: 5: Actor"
    sanitized = sanitized.replace(/(:\s*[1-5])\s+([A-Za-z])/g, '$1: $2');

    // Fix "Section" (capitalised) or "section Name:" (trailing colon) → "section Name"
    return sanitized.replace(/^\s*[Ss]ection\s+([^\n:]+):?\s*$/gm, (_, name) => `section ${name.trim()}`);
  }

  return sanitized;
}

export default function MermaidDiagram({ code, className = '' }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uniqueId = useId().replace(/:/g, '-');
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const [disclaimerConfig, setDisclaimerConfig] = useState<{
    enabled: boolean;
    fullText: string;
    fontSize: number;
    color: string;
  } | null>(null);

  // Fetch disclaimer config for export watermarking
  useEffect(() => {
    fetch('/api/config/disclaimer')
      .then((res) => res.json())
      .then((data) => {
        if (data.enabled && data.config) {
          setDisclaimerConfig({
            enabled: true,
            fullText: data.config.fullText,
            fontSize: data.config.fontSize,
            color: data.config.color,
          });
        }
      })
      .catch(() => {
        // Silently fail - disclaimer is optional
      });
  }, []);

  useEffect(() => {
    let mounted = true;

    async function renderDiagram() {
      setIsLoading(true);
      setError(null);

      try {
        const mermaid = await loadMermaid();

        if (!mounted) return;

        // Clean and sanitize the code to fix common LLM-generated syntax issues
        const cleanCode = sanitizeMermaidCode(code);

        // Generate unique ID for this render
        const diagramId = `mermaid-${uniqueId}-${Date.now()}`;

        // Render the diagram
        const { svg } = await mermaid.default.render(diagramId, cleanCode);

        if (!mounted) return;

        setSvgContent(svg);
      } catch (err) {
        if (!mounted) return;

        console.error('Mermaid rendering error:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    renderDiagram();

    return () => {
      mounted = false;
    };
  }, [code, uniqueId]);

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));
  const handleResetZoom = () => setScale(1);

  const handleDownloadSvg = () => {
    if (!svgContent) return;

    let finalSvg = svgContent;

    // Add AI disclaimer to SVG if enabled
    if (disclaimerConfig?.enabled) {
      const disclaimerElement = `
        <text x="50%" y="98%" text-anchor="middle"
              style="font-size:${disclaimerConfig.fontSize}px;fill:${disclaimerConfig.color};font-style:italic;font-family:Arial,sans-serif;">
          ${disclaimerConfig.fullText}
        </text>
      `;
      finalSvg = svgContent.replace('</svg>', `${disclaimerElement}</svg>`);
    }

    const blob = new Blob([finalSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'diagram.svg';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPng = async () => {
    if (!svgContent || !containerRef.current) return;

    try {
      const svgElement = containerRef.current.querySelector('svg');
      if (!svgElement) return;

      // Clone the SVG to avoid modifying the original
      const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;

      // Get dimensions from the SVG element
      const bbox = svgElement.getBBox();
      const svgWidth = Math.max(bbox.width + bbox.x + 20, svgElement.clientWidth || 800);
      const svgHeight = Math.max(bbox.height + bbox.y + 20, svgElement.clientHeight || 600);

      // Set explicit dimensions on the cloned SVG
      clonedSvg.setAttribute('width', String(svgWidth));
      clonedSvg.setAttribute('height', String(svgHeight));

      // Add white background rect as first child
      const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bgRect.setAttribute('width', '100%');
      bgRect.setAttribute('height', '100%');
      bgRect.setAttribute('fill', 'white');
      clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

      // Inline all styles to ensure they're included in the export
      const styleElement = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleElement.textContent = `
        * { font-family: system-ui, -apple-system, sans-serif; }
        text { font-family: system-ui, -apple-system, sans-serif; }
      `;
      clonedSvg.insertBefore(styleElement, clonedSvg.firstChild);

      // Serialize the SVG
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clonedSvg);

      // Create a data URL instead of blob URL for better compatibility
      const svgBase64 = btoa(unescape(encodeURIComponent(svgString)));
      const dataUrl = `data:image/svg+xml;base64,${svgBase64}`;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const scaleFactor = 2; // Higher resolution
      canvas.width = svgWidth * scaleFactor;
      canvas.height = svgHeight * scaleFactor;

      const img = new Image();

      img.onload = () => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Add AI disclaimer if enabled
        if (disclaimerConfig?.enabled) {
          const fontSize = disclaimerConfig.fontSize * scaleFactor;
          ctx.font = `italic ${fontSize}px Arial, sans-serif`;
          ctx.fillStyle = disclaimerConfig.color;
          ctx.textAlign = 'center';
          ctx.fillText(
            disclaimerConfig.fullText,
            canvas.width / 2,
            canvas.height - fontSize
          );
        }

        // Download PNG
        const pngUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = 'diagram.png';
        link.click();
      };

      img.onerror = (err) => {
        console.error('Failed to load SVG for PNG export:', err);
      };

      img.src = dataUrl;
    } catch (err) {
      console.error('Failed to export PNG:', err);
    }
  };

  if (isLoading) {
    return (
      <div className={`bg-gray-50 rounded-lg border border-gray-200 p-8 my-4 ${className}`}>
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
          <span>Rendering diagram...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-50 rounded-lg border border-red-200 p-4 my-4 ${className}`}>
        <div className="flex items-start gap-2 text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Failed to render diagram</p>
            <p className="text-sm mt-1 text-red-600">{error}</p>
            <details className="mt-2">
              <summary className="text-sm cursor-pointer hover:text-red-800">
                Show diagram code
              </summary>
              <pre className="mt-2 p-2 bg-red-100 rounded text-xs overflow-x-auto">
                {code}
              </pre>
            </details>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-lg border border-gray-200 my-4 overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-xs text-gray-500 min-w-[3rem] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={handleResetZoom}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors ml-1"
            title="Reset zoom"
          >
            <RotateCcw size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDownloadSvg}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded transition-colors"
            title="Download SVG"
          >
            <Download size={14} />
            SVG
          </button>
          <button
            onClick={handleDownloadPng}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded transition-colors"
            title="Download PNG"
          >
            <Download size={14} />
            PNG
          </button>
        </div>
      </div>

      {/* Diagram container */}
      <div
        ref={containerRef}
        className="p-4 overflow-auto"
        style={{ maxHeight: '500px' }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            transition: 'transform 0.2s ease-out',
          }}
          dangerouslySetInnerHTML={{ __html: svgContent || '' }}
        />
      </div>
    </div>
  );
}

/**
 * Check if a code block contains Mermaid diagram syntax
 */
export function isMermaidCode(code: string): boolean {
  const trimmed = code.trim();
  const mermaidKeywords = [
    'mindmap',
    'flowchart',
    'graph ',
    'graph\n',
    'sequenceDiagram',
    'classDiagram',
    'stateDiagram',
    'erDiagram',
    'gantt',
    'pie',
    'journey',
    'gitGraph',
    'C4Context',
    'C4Container',
    'C4Component',
    'C4Dynamic',
    'C4Deployment',
    'sankey',
    'timeline',
    'zenuml',
    'block-beta',
    'packet-beta',
    'architecture-beta',
  ];

  return mermaidKeywords.some(keyword =>
    trimmed.startsWith(keyword) || trimmed.startsWith(`%%{`) // Mermaid directives
  );
}
