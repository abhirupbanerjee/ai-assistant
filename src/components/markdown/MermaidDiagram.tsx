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

import { useEffect, useRef, useState, useId, useMemo } from 'react';
import { Download, ZoomIn, ZoomOut, RotateCcw, FileText } from 'lucide-react';
import { sanitizeMermaidCode } from '@/lib/diagram-gen/sanitize';

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
 * Convert Mermaid code to a structured text fallback when rendering fails.
 * Extracts nodes, labels, edges, and structure from the raw Mermaid source
 * and produces readable plain text — no LLM call needed.
 */
function mermaidToTextFallback(code: string): string {
  const lines = code.trim().split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  // Detect diagram type from the first line
  let diagramType = 'Diagram';
  if (/^flowchart|^graph\b/i.test(firstLine)) diagramType = 'Flowchart';
  else if (/^sequenceDiagram/i.test(firstLine)) diagramType = 'Sequence Diagram';
  else if (/^mindmap/i.test(firstLine)) diagramType = 'Mind Map';
  else if (/^gantt/i.test(firstLine)) diagramType = 'Gantt Chart';
  else if (/^classDiagram/i.test(firstLine)) diagramType = 'Class Diagram';
  else if (/^stateDiagram/i.test(firstLine)) diagramType = 'State Diagram';
  else if (/^erDiagram/i.test(firstLine)) diagramType = 'ER Diagram';
  else if (/^pie/i.test(firstLine)) diagramType = 'Pie Chart';
  else if (/^journey/i.test(firstLine)) diagramType = 'User Journey';
  else if (/^timeline/i.test(firstLine)) diagramType = 'Timeline';
  else if (/^block/i.test(firstLine)) diagramType = 'Block Diagram';
  else if (/^quadrantChart/i.test(firstLine)) diagramType = 'Quadrant Chart';
  else if (/^architecture/i.test(firstLine)) diagramType = 'Architecture Diagram';
  else if (/^C4Context/i.test(firstLine)) diagramType = 'C4 Context Diagram';
  else if (/^C4Container/i.test(firstLine)) diagramType = 'C4 Container Diagram';
  else if (/^C4Component/i.test(firstLine)) diagramType = 'C4 Component Diagram';
  else if (/^C4Dynamic/i.test(firstLine)) diagramType = 'C4 Dynamic Diagram';
  else if (/^C4Deployment/i.test(firstLine)) diagramType = 'C4 Deployment Diagram';

  // Extract title if present
  const titleMatch = code.match(/^\s*title\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim();

  const result: string[] = [];
  result.push(`=== ${title || diagramType} ===`);
  result.push('');

  // Build a label map: id → label (for resolving references in edges)
  const labelMap = new Map<string, string>();

  // --- Flowchart / Graph ---
  if (/^flowchart|^graph\b/i.test(firstLine)) {
    const nodes: string[] = [];
    const edges: string[] = [];

    for (const line of lines.slice(1)) {
      const t = line.trim();
      if (!t || t.startsWith('%%')) continue;

      // Extract node definitions: id[Label], id{Label}, id(Label), id([Label]), id((Label))
      const nodeDefs = t.matchAll(/(\w+)\s*(?:\[([^\]]+)\]|\{([^}]+)\}|\(\[([^\]]+)\]\)|\(\(([^)]+)\)\)|\(([^)]+)\))/g);
      for (const m of nodeDefs) {
        const id = m[1];
        const label = m[2] || m[3] || m[4] || m[5] || m[6];
        if (label && !labelMap.has(id)) {
          labelMap.set(id, label);
        }
      }

      // Extract edges: A -->|label| B or A --> B
      const edgeMatch = t.match(/(\w+)\s*(?:-->|--[-.]>?|==>|-.->)\s*(?:\|([^|]*)\|\s*)?(\w+)/);
      if (edgeMatch) {
        const from = labelMap.get(edgeMatch[1]) || edgeMatch[1];
        const edgeLabel = edgeMatch[2] ? ` [${edgeMatch[2]}]` : '';
        const to = labelMap.get(edgeMatch[3]) || edgeMatch[3];
        edges.push(`  ${from} -->${edgeLabel} ${to}`);
      }
    }

    // List unique nodes
    if (labelMap.size > 0) {
      result.push('Components:');
      for (const [id, label] of labelMap) {
        result.push(`  * ${label} (${id})`);
      }
      result.push('');
    }
    if (edges.length > 0) {
      result.push('Flow:');
      edges.forEach(e => result.push(e));
    }
  }

  // --- Sequence Diagram ---
  else if (/^sequenceDiagram/i.test(firstLine)) {
    const participants: string[] = [];
    const messages: string[] = [];

    for (const line of lines.slice(1)) {
      const t = line.trim();
      if (!t || t.startsWith('%%')) continue;

      const partMatch = t.match(/^participant\s+(\S+)(?:\s+as\s+(.+))?$/);
      if (partMatch) {
        participants.push(partMatch[2] || partMatch[1]);
        continue;
      }
      const msgMatch = t.match(/^(.+?)\s*(->>|-->>|->|-->)\s*(.+?):\s*(.+)$/);
      if (msgMatch) {
        messages.push(`  ${msgMatch[1]} -> ${msgMatch[3]}: ${msgMatch[4]}`);
      }
    }

    if (participants.length > 0) {
      result.push('Participants:');
      participants.forEach(p => result.push(`  * ${p}`));
      result.push('');
    }
    if (messages.length > 0) {
      result.push('Messages:');
      messages.forEach(m => result.push(m));
    }
  }

  // --- C4 Diagrams ---
  else if (/^C4/i.test(firstLine)) {
    const elements: string[] = [];
    const relationships: string[] = [];

    for (const line of lines.slice(1)) {
      const t = line.trim();
      if (!t || t.startsWith('%%')) continue;

      // Elements: Person(id, "Name", "Desc"), System(id, "Name", "Desc"), Container(...), etc.
      const elMatch = t.match(/^(Person|System|Container|Component|Deployment_Node|Person_Ext|System_Ext|Container_Ext|Component_Ext|SystemDb|ContainerDb|ContainerQueue|ComponentDb)\s*\(\s*(\w+)\s*,\s*"([^"]+)"(?:\s*,\s*"([^"]*)")?(?:\s*,\s*"([^"]*)")?\)/i);
      if (elMatch) {
        const type = elMatch[1];
        const label = elMatch[3];
        const tech = elMatch[4] ? ` [${elMatch[4]}]` : '';
        const desc = elMatch[5] ? ` - ${elMatch[5]}` : '';
        elements.push(`  * ${label}${tech}${desc} (${type})`);
        labelMap.set(elMatch[2], label);
        continue;
      }
      // Relationships: Rel(from, to, "label") or BiRel(...)
      const relMatch = t.match(/^(?:Rel|BiRel|RelIndex)\s*\(\s*(?:"[^"]*"\s*,\s*)?(\w+)\s*,\s*(\w+)\s*,\s*"([^"]+)"/i);
      if (relMatch) {
        const from = labelMap.get(relMatch[1]) || relMatch[1];
        const to = labelMap.get(relMatch[2]) || relMatch[2];
        relationships.push(`  ${from} -> ${to}: ${relMatch[3]}`);
        continue;
      }
      // Boundaries
      const boundMatch = t.match(/^(System_Boundary|Container_Boundary|Enterprise_Boundary)\s*\(\s*\w+\s*,\s*"([^"]+)"\)/i);
      if (boundMatch) {
        elements.push(`  [Boundary] ${boundMatch[2]}`);
      }
    }

    if (elements.length > 0) {
      result.push('Elements:');
      elements.forEach(e => result.push(e));
      result.push('');
    }
    if (relationships.length > 0) {
      result.push('Relationships:');
      relationships.forEach(r => result.push(r));
    }
  }

  // --- Architecture-beta ---
  else if (/^architecture/i.test(firstLine)) {
    const services: string[] = [];
    const groups: string[] = [];
    const connections: string[] = [];

    for (const line of lines.slice(1)) {
      const t = line.trim();
      if (!t || t.startsWith('%%')) continue;

      const svcMatch = t.match(/^service\s+(\S+)(?:\([^)]*\))?\s*(?:\[([^\]]+)\])?(?:\s+in\s+(\S+))?/);
      if (svcMatch) {
        const label = svcMatch[2] || svcMatch[1];
        const parent = svcMatch[3] ? ` (in ${svcMatch[3]})` : '';
        services.push(`  * ${label}${parent}`);
        labelMap.set(svcMatch[1], label);
        continue;
      }
      const grpMatch = t.match(/^group\s+(\S+)(?:\([^)]*\))?\s*(?:\[([^\]]+)\])?/);
      if (grpMatch) {
        const label = grpMatch[2] || grpMatch[1];
        groups.push(`  * ${label}`);
        labelMap.set(grpMatch[1], label);
        continue;
      }
      // Edges: id:Dir -- Dir:id or id:Dir -[Label]- Dir:id
      const edgeMatch = t.match(/^(\S+?)(?::.)?\s*(?:--|-\[([^\]]*)\]-)\s*(?:.:\s*)?(\S+)/);
      if (edgeMatch && t.includes('--')) {
        const fromId = edgeMatch[1].replace(/:.$/, '');
        const edgeLabel = edgeMatch[2] ? ` [${edgeMatch[2]}]` : '';
        const toId = edgeMatch[3].replace(/^.:/, '');
        const from = labelMap.get(fromId) || fromId;
        const to = labelMap.get(toId) || toId;
        connections.push(`  ${from} <-->${edgeLabel} ${to}`);
      }
    }

    if (groups.length > 0) {
      result.push('Groups:');
      groups.forEach(g => result.push(g));
      result.push('');
    }
    if (services.length > 0) {
      result.push('Services:');
      services.forEach(s => result.push(s));
      result.push('');
    }
    if (connections.length > 0) {
      result.push('Connections:');
      connections.forEach(c => result.push(c));
    }
  }

  // --- Generic fallback for all other types ---
  else {
    // Extract meaningful lines (skip the header, empty lines, and comment lines)
    const meaningful = lines.slice(1)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('%%'));

    if (meaningful.length > 0) {
      result.push('Content:');
      meaningful.forEach(l => result.push(`  ${l}`));
    }
  }

  // If we extracted nothing meaningful, just show the raw code as-is
  if (result.length <= 2) {
    return code;
  }

  return result.join('\n');
}


export default function MermaidDiagram({ code, className = '' }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uniqueId = useId().replace(/:/g, '-');
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [scale, setScale] = useState(1);

  // Pre-compute text fallback so it's ready immediately if rendering fails
  const textFallback = useMemo(() => mermaidToTextFallback(code), [code]);
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
      <div className={`bg-amber-50 rounded-lg border border-amber-200 my-4 overflow-hidden ${className}`}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-100 border-b border-amber-200">
          <FileText className="w-4 h-4 text-amber-700" />
          <span className="text-sm font-medium text-amber-800">
            Diagram (text view — interactive render unavailable)
          </span>
        </div>
        {/* Text fallback content */}
        <pre className="px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto">
          {textFallback}
        </pre>
        {/* Collapsed error details */}
        <div className="px-4 pb-3">
          <details className="text-xs text-amber-700">
            <summary className="cursor-pointer hover:text-amber-900">
              Render error details
            </summary>
            <p className="mt-1 text-red-600">{error}</p>
            <details className="mt-1">
              <summary className="cursor-pointer hover:text-amber-900">
                Raw Mermaid code
              </summary>
              <pre className="mt-1 p-2 bg-amber-100 rounded text-xs overflow-x-auto">
                {code}
              </pre>
            </details>
          </details>
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
