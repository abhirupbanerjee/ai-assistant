'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import { Columns2, Eye, Code2, Copy, Check } from 'lucide-react';
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

type ViewMode = 'preview' | 'source' | 'split';

interface DiagramViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function DiagramViewer({ artifact }: DiagramViewerProps) {
  const code = artifact.mermaidCode || '';
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (codeRef.current && (viewMode === 'source' || viewMode === 'split')) {
      hljs.highlightElement(codeRef.current);
    }
  }, [code, viewMode]);

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

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const tabs = useMemo(
    () => [
      { id: 'preview' as const, label: 'Preview', icon: Eye },
      { id: 'source' as const, label: 'Source', icon: Code2 },
      { id: 'split' as const, label: 'Split', icon: Columns2 },
    ],
    [],
  );

  return (
    <div className="w-full h-full flex flex-col bg-white">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b bg-gray-50 shrink-0">
        <div className="flex items-center gap-0.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setViewMode(tab.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                }`}
                aria-pressed={active}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          title="Copy Mermaid source"
          aria-label="Copy Mermaid source"
        >
          {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Content */}
      {viewMode === 'split' ? (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <div className="w-full md:w-1/2 h-1/2 md:h-full border-b md:border-b-0 md:border-r flex flex-col min-h-0">
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
          <div className="w-full md:w-1/2 h-1/2 md:h-full flex flex-col min-h-0">
            <div className="flex-1 overflow-auto p-3">
              <pre className="m-0 h-full">
                <code ref={codeRef} className="language-mermaid text-xs">{code}</code>
              </pre>
            </div>
          </div>
        </div>
      ) : viewMode === 'source' ? (
        <div className="flex-1 min-h-0 overflow-auto p-3">
          <pre className="m-0 h-full">
            <code ref={codeRef} className="language-mermaid text-xs">{code}</code>
          </pre>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto p-4 flex items-center justify-center bg-gray-50">
          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : svg ? (
            <div className="max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="animate-pulse text-gray-400 text-sm">Rendering diagram…</div>
          )}
        </div>
      )}
    </div>
  );
}
