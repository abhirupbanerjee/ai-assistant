'use client';

import { useEffect, useRef, useState } from 'react';
import hljs from 'highlight.js';
import type { ArtifactCanvasItem } from '@/types';

async function loadMermaid() {
  const m = await import('mermaid');
  m.default.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'default',
  });
  return m.default;
}

interface DiagramViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function DiagramViewer({ artifact }: DiagramViewerProps) {
  const code = artifact.mermaidCode || '';
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current) {
      hljs.highlightElement(codeRef.current);
    }
  }, [code]);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = await loadMermaid();
        const id = `mermaid-canvas-${artifact.artifactId.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const { svg: renderedSvg } = await mermaid.render(id, code);
        if (!cancelled) setSvg(renderedSvg);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to render diagram');
      }
    }

    if (code.trim()) {
      render();
    } else {
      setError('No Mermaid code available');
    }

    return () => { cancelled = true; };
  }, [code, artifact.artifactId]);

  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-white">
      <div className="w-full md:w-1/2 h-1/2 md:h-full border-b md:border-b-0 md:border-r flex flex-col">
        <div className="px-3 py-2 border-b bg-gray-50 text-xs font-medium text-gray-600">Mermaid code</div>
        <div className="flex-1 overflow-auto p-3">
          <pre className="m-0 h-full">
            <code ref={codeRef} className="language-mermaid text-xs">{code}</code>
          </pre>
        </div>
      </div>
      <div className="w-full md:w-1/2 h-1/2 md:h-full flex flex-col">
        <div className="px-3 py-2 border-b bg-gray-50 text-xs font-medium text-gray-600">Rendered diagram</div>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gray-50">
          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : svg ? (
            <div className="max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="animate-pulse text-gray-400 text-sm">Rendering diagram…</div>
          )}
        </div>
      </div>
    </div>
  );
}
