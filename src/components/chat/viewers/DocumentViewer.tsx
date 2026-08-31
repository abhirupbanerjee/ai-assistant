'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { renderAsync } from 'docx-preview';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { ArtifactCanvasItem } from '@/types';
import { useIsMobile } from '@/hooks/useMediaQuery';

const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false });
const DEBUG_ARTIFACT_RENDERING = process.env.NODE_ENV === 'development';

interface DocumentViewerProps {
  artifact: ArtifactCanvasItem;
}

function MarkdownTable({ children }: React.PropsWithChildren) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const measure = () => {
      const nextOverflows = wrapper.scrollWidth > wrapper.clientWidth + 1;
      setOverflows(nextOverflows);
      if (DEBUG_ARTIFACT_RENDERING && nextOverflows) {
        console.debug('[ArtifactCanvas][Markdown] Wide table detected', {
          viewportWidth: wrapper.clientWidth,
          tableWidth: wrapper.scrollWidth,
        });
      }
    };
    measure();
    // ReactMarkdown mounts table descendants after this wrapper. Observe both
    // dimensions and child-list changes so the first completed table is also
    // measured rather than only the initially empty wrapper.
    const resizeObserver = new ResizeObserver(measure);
    const mutationObserver = new MutationObserver(measure);
    resizeObserver.observe(wrapper);
    mutationObserver.observe(wrapper, { childList: true, subtree: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="my-4 max-w-full overflow-x-auto overscroll-contain rounded-md border border-gray-200">
      {overflows && <p className="sticky left-0 w-fit bg-gray-50 px-2 py-1 text-[11px] text-gray-500">Swipe table horizontally</p>}
      <table>{children}</table>
    </div>
  );
}

export default function DocumentViewer({ artifact }: DocumentViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docxLoading, setDocxLoading] = useState(artifact.artifactType === 'docx');
  const [docxLayout, setDocxLayout] = useState<{ width: number; height: number; scale: number } | null>(null);
  const isMobile = useIsMobile();
  const docxViewportRef = useRef<HTMLDivElement>(null);
  const docxContainerRef = useRef<HTMLDivElement>(null);

  // ── DOCX: render natively via docx-preview (preserves headings, tables,
  //    page margins, headers/footers, and custom fonts — mammoth stripped all
  //    of these, which is why headings appeared as plain body text).
  useEffect(() => {
    if (artifact.artifactType !== 'docx') return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    async function loadDocx() {
      try {
        setError(null);
        setDocxLoading(true);
        setDocxLayout(null);
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

        const measureLayout = () => {
          const viewport = docxViewportRef.current;
          if (!viewport || cancelled) return;

          // docx-preview keeps the original Word page dimensions on the
          // section elements. Measure their layout width (not the transformed
          // painted width) so mobile can scale the complete paper page without
          // reflowing tables, columns, or page breaks.
          const pageWidth = Math.ceil(Math.max(
            ...Array.from(pages, (page) => (page as HTMLElement).offsetWidth),
            container.scrollWidth
          ));
          const pageHeight = Math.ceil(container.scrollHeight);
          const availableWidth = Math.max(1, viewport.clientWidth - 16);
          const scale = isMobile && pageWidth > availableWidth
            ? availableWidth / pageWidth
            : 1;

          setDocxLayout((current) => {
            if (
              current &&
              current.width === pageWidth &&
              current.height === pageHeight &&
              Math.abs(current.scale - scale) < 0.001
            ) {
              return current;
            }
            if (DEBUG_ARTIFACT_RENDERING) {
              console.debug('[ArtifactCanvas][DOCX] Mobile fit-to-width', {
                artifactId: artifact.artifactId,
                viewportWidth: viewport.clientWidth,
                pageWidth,
                availableWidth,
                scale,
              });
            }
            return { width: pageWidth, height: pageHeight, scale };
          });
        };

        // Wait for docx-preview's injected page styles to participate in
        // layout before measuring them, then recalculate on rotation/resizing.
        requestAnimationFrame(measureLayout);
        resizeObserver = new ResizeObserver(measureLayout);
        if (docxViewportRef.current) resizeObserver.observe(docxViewportRef.current);
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
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
    };
  }, [artifact.downloadUrl, artifact.artifactType, artifact.artifactId, isMobile]);

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
    const mobileScale = isMobile ? docxLayout?.scale ?? 1 : 1;
    const mobileFrameStyle = isMobile && docxLayout
      ? {
          width: `${Math.ceil(docxLayout.width * mobileScale)}px`,
          minHeight: `${Math.ceil(docxLayout.height * mobileScale)}px`,
        }
      : undefined;
    const mobileDocumentStyle = isMobile && docxLayout
      ? {
          width: `${docxLayout.width}px`,
          transform: `scale(${mobileScale})`,
          transformOrigin: 'top left',
        }
      : undefined;

    return (
      <div ref={docxViewportRef} className="relative h-full w-full overflow-x-hidden overflow-y-auto bg-gray-100 py-3">
        {docxLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-100">
            <div className="animate-pulse text-sm text-gray-400">Loading document…</div>
          </div>
        )}
        <div className="mx-auto min-w-full" style={mobileFrameStyle}>
          <div
            ref={docxContainerRef}
            className="docx-viewer-container min-h-full"
            style={mobileDocumentStyle}
          />
        </div>
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
    <div className="h-full w-full overflow-auto bg-gray-100 px-3 py-3 sm:px-4 sm:py-6">
      <div className="markdown-content mx-auto w-full bg-white p-4 shadow-sm sm:max-w-3xl sm:rounded-lg sm:border sm:border-gray-200 sm:p-8 md:p-12">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{ table: MarkdownTable }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
