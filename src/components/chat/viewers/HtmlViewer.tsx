'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import { Columns2, Eye, Code2, Copy, Check } from 'lucide-react';
import type { ArtifactCanvasItem } from '@/types';

interface HtmlViewerProps {
  artifact: ArtifactCanvasItem;
  containerRef?: React.RefObject<HTMLElement | null>;
}

type ViewMode = 'preview' | 'source' | 'split';

// Minimal base stylesheet injected into the iframe when the HTML document
// has no embedded <style> or <link rel="stylesheet">. Prevents the raw
// browser user-agent fallback (Times New Roman, unstyled tables).
const BASE_CSS = `
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.6;
    color: #1f2937;
    margin: 24px;
    max-width: 900px;
  }
  h1 { font-size: 1.875rem; font-weight: 700; margin: 1.5rem 0 1rem; line-height: 1.25; }
  h2 { font-size: 1.5rem; font-weight: 700; margin: 1.25rem 0 0.75rem; line-height: 1.3; }
  h3 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; }
  h4, h5, h6 { font-weight: 600; margin: 0.75rem 0 0.5rem; }
  p { margin: 0.75rem 0; }
  ul, ol { margin: 0.75rem 0; padding-left: 1.5rem; }
  li { margin: 0.25rem 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #d1d5db; padding: 0.5rem 0.75rem; text-align: left; }
  th { background: #f9fafb; font-weight: 600; }
  tr:nth-child(even) { background: #f9fafb; }
  blockquote { border-left: 3px solid #d1d5db; margin: 1rem 0; padding: 0.25rem 0 0.25rem 1rem; color: #4b5563; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.875em; background: #f3f4f6; padding: 0.125rem 0.25rem; border-radius: 0.25rem; }
  pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1rem; overflow: auto; }
  pre code { background: transparent; padding: 0; }
  a { color: #2563eb; text-decoration: underline; }
  hr { border: 0; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }
  img { max-width: 100%; height: auto; }
`;

export default function HtmlViewer({ artifact, containerRef }: HtmlViewerProps) {
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const localContainerRef = useRef<HTMLDivElement>(null);
  // Prefer the parent-supplied ref (so useTextSelection in ArtifactCanvas can
  // detect selections inside this viewer), falling back to a local ref when
  // rendered standalone. Cast to HTMLDivElement for the wrapping <div> refs.
  const activeContainerRef = (containerRef ?? localContainerRef) as React.RefObject<HTMLDivElement | null>;

  useEffect(() => {
    let cancelled = false;

    async function loadHtml() {
      try {
        const response = await fetch(artifact.downloadUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Failed to load HTML: ${response.status}`);
        const text = await response.text();
        if (!cancelled) setRawHtml(text);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load HTML');
      }
    }

    loadHtml();
    return () => { cancelled = true; };
  }, [artifact.downloadUrl]);

  // Syntax-highlight the source view when visible
  useEffect(() => {
    if (codeRef.current && (viewMode === 'source' || viewMode === 'split')) {
      hljs.highlightElement(codeRef.current);
    }
  }, [rawHtml, viewMode]);

  // Inject base CSS only if the document has no internal styling
  const srcDoc = useMemo(() => {
    if (rawHtml === null) return '';
    const hasStyle = /<style[\s>]/i.test(rawHtml) || /<link[^>]+stylesheet/i.test(rawHtml);
    if (hasStyle) return rawHtml;
    // Inject a <style> block right after <head> (or prepend if no head)
    if (/<head[\s>]/i.test(rawHtml)) {
      return rawHtml.replace(/<head([^>]*)>/i, `<head$1><style>${BASE_CSS}</style>`);
    }
    if (/<html[\s>]/i.test(rawHtml)) {
      return rawHtml.replace(/<html([^>]*)>/i, `<html$1><head><style>${BASE_CSS}</style></head>`);
    }
    // No html/head tags — wrap entirely
    return `<!DOCTYPE html><html><head><style>${BASE_CSS}</style></head><body>${rawHtml}</body></html>`;
  }, [rawHtml]);

  const handleCopy = async () => {
    if (rawHtml === null) return;
    try {
      await navigator.clipboard.writeText(rawHtml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-red-600">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (rawHtml === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-gray-400 text-sm">Loading HTML…</div>
      </div>
    );
  }

  const tabs = [
    { id: 'preview' as const, label: 'Preview', icon: Eye },
    { id: 'source' as const, label: 'Source', icon: Code2 },
    { id: 'split' as const, label: 'Split', icon: Columns2 },
  ];

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
          title="Copy HTML source"
          aria-label="Copy HTML source"
        >
          {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Content */}
      {viewMode === 'split' ? (
        <div ref={activeContainerRef} className="flex-1 min-h-0 flex flex-col md:flex-row">
          <div className="w-full md:w-1/2 h-1/2 md:h-full border-b md:border-b-0 md:border-r min-h-0">
            <iframe
              title={`${artifact.title} — preview`}
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              className="w-full h-full border-0 bg-white"
            />
          </div>
          <div className="w-full md:w-1/2 h-1/2 md:h-full flex flex-col min-h-0">
            <div className="flex-1 overflow-auto p-3">
              <pre className="m-0 h-full">
                <code ref={codeRef} className="language-html text-xs">{rawHtml}</code>
              </pre>
            </div>
          </div>
        </div>
      ) : viewMode === 'source' ? (
        <div ref={activeContainerRef} className="flex-1 min-h-0 overflow-auto p-3">
          <pre className="m-0 h-full">
            <code ref={codeRef} className="language-html text-xs">{rawHtml}</code>
          </pre>
        </div>
      ) : (
        <div ref={activeContainerRef} className="flex-1 min-h-0 w-full">
          <iframe
            title={artifact.title}
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            className="w-full h-full border-0 bg-white"
          />
        </div>
      )}
    </div>
  );
}
