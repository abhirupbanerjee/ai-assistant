'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { renderAsync } from 'docx-preview';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ArtifactCanvasItem } from '@/types';

const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false });
const DEBUG_ARTIFACT_RENDERING = process.env.NODE_ENV === 'development';

interface DocumentViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function DocumentViewer({ artifact }: DocumentViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docxLoading, setDocxLoading] = useState(artifact.artifactType === 'docx');
  const docxContainerRef = useRef<HTMLDivElement>(null);

  // ── DOCX: render natively via docx-preview (preserves headings, tables,
  //    page margins, headers/footers, and custom fonts — mammoth stripped all
  //    of these, which is why headings appeared as plain body text).
  useEffect(() => {
    if (artifact.artifactType !== 'docx') return;
    let cancelled = false;

    async function loadDocx() {
      try {
        setError(null);
        setDocxLoading(true);
        const response = await fetch(artifact.downloadUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Failed to load document: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled) return;
        const container = docxContainerRef.current;
        if (!container) return;
        // Clear any previous render
        container.innerHTML = '';
        await renderAsync(arrayBuffer, container, undefined, {
          className: 'docx-viewer',
          inWrapper: true, // render paper-page wrapper with shadows + margins
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          experimental: true,
        });
        if (cancelled) return;

        // docx-preview renders each page as a section with the configured
        // class name. Tag only those sections so text comments get reliable
        // page numbers without matching nested elements incidentally.
        const pages = container.querySelectorAll('section.docx-viewer');
        pages.forEach((page, index) => {
          page.setAttribute('data-page-number', String(index + 1));
        });
        if (DEBUG_ARTIFACT_RENDERING) {
          const details = {
            artifactId: artifact.artifactId,
            pageCount: pages.length,
            selectableTextLength: container.textContent?.trim().length ?? 0,
          };
          if (pages.length === 0) {
            console.warn('[ArtifactCanvas][DOCX] Render completed without page sections', details);
          } else {
            console.debug('[ArtifactCanvas][DOCX] Render completed', details);
          }
        }
        setDocxLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load document');
          setDocxLoading(false);
        }
      }
    }

    loadDocx();
    return () => { cancelled = true; };
  }, [artifact.downloadUrl, artifact.artifactType]);

  // ── Markdown: fetch text content
  useEffect(() => {
    if (artifact.artifactType !== 'md') return;
    let cancelled = false;

    async function loadMarkdown() {
      try {
        setContent(null);
        setError(null);
        const response = await fetch(artifact.downloadUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Failed to load document: ${response.status}`);
        const text = await response.text();
        if (!cancelled) {
          setContent(text);
          if (DEBUG_ARTIFACT_RENDERING) {
            console.debug('[ArtifactCanvas][Markdown] Content loaded', {
              artifactId: artifact.artifactId,
              characterCount: text.length,
            });
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load document');
      }
    }

    loadMarkdown();
    return () => { cancelled = true; };
  }, [artifact.downloadUrl, artifact.artifactType]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-red-600">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  // ── DOCX: native render container (docx-preview injects paper pages)
  if (artifact.artifactType === 'docx') {
    return (
      <div className="relative w-full h-full overflow-auto bg-gray-100 py-6">
        {docxLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-100">
            <div className="animate-pulse text-sm text-gray-400">Loading document…</div>
          </div>
        )}
        <div ref={docxContainerRef} className="docx-viewer-container min-w-full min-h-full" />
      </div>
    );
  }

  // ── Markdown loading state
  if (content === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-gray-400 text-sm">Loading document…</div>
      </div>
    );
  }

  // ── Markdown: rendered in a paper-card container with GFM tables,
  //    task lists, strikethrough, and syntax-highlighted code blocks.
  return (
    <div className="w-full h-full overflow-auto bg-gray-100 py-6 px-4">
      <div className="markdown-content mx-auto max-w-3xl bg-white shadow-sm border border-gray-200 rounded-lg p-8 md:p-12">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
