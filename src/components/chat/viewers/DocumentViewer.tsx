'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { renderAsync } from 'docx-preview';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ArtifactCanvasItem } from '@/types';

const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false });

interface DocumentViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function DocumentViewer({ artifact }: DocumentViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docxContainerRef = useRef<HTMLDivElement>(null);

  // Tag docx-preview page wrappers with data-page-number after async render.
  useEffect(() => {
    if (artifact.artifactType !== 'docx') return;
    const container = docxContainerRef.current;
    if (!container) return;

    // docx-preview may render in a microtask; use a short timeout + MutationObserver
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;

    const tagPages = () => {
      // Heuristic: look for elements whose class contains "page" or that are direct
      // children of the wrapper and look like paper pages.
      const pages = container.querySelectorAll('[class*="page"], [class*="document"] > div');
      if (pages.length === 0) return false;
      pages.forEach((page, idx) => {
        if (!page.hasAttribute('data-page-number')) {
          page.setAttribute('data-page-number', String(idx + 1));
        }
      });
      return true;
    };

    const tryTag = () => {
      if (tagPages()) {
        observer?.disconnect();
        return true;
      }
      return false;
    };

    if (!tryTag()) {
      observer = new MutationObserver(() => {
        if (tryTag()) {
          if (timeoutId) clearTimeout(timeoutId);
          observer?.disconnect();
        }
      });
      observer.observe(container, { childList: true, subtree: true });
      timeoutId = setTimeout(() => {
        tryTag();
        observer?.disconnect();
      }, 2000);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [artifact.artifactType]);

  // ── DOCX: render natively via docx-preview (preserves headings, tables,
  //    page margins, headers/footers, and custom fonts — mammoth stripped all
  //    of these, which is why headings appeared as plain body text).
  useEffect(() => {
    if (artifact.artifactType !== 'docx') return;
    let cancelled = false;

    async function loadDocx() {
      try {
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
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load document');
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
        const response = await fetch(artifact.downloadUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Failed to load document: ${response.status}`);
        const text = await response.text();
        if (!cancelled) setContent(text);
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
      <div className="w-full h-full overflow-auto bg-gray-100">
        <div ref={docxContainerRef} className="docx-viewer-container w-full h-full" />
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
      <div className="mx-auto max-w-3xl bg-white shadow-sm border border-gray-200 rounded-lg p-8 md:p-12 prose prose-sm md:prose-base max-w-none prose-headings:scroll-mt-4 prose-table:border prose-table:border-gray-300 prose-th:border prose-th:border-gray-300 prose-td:border prose-td:border-gray-300">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
