'use client';

import { useEffect, useState } from 'react';
import type { ArtifactCanvasItem } from '@/types';
import { useIsMobile } from '@/hooks/useMediaQuery';

interface ExtractedPage {
  pageNumber: number;
  text: string;
}

interface TextExtractionResponse {
  pages: ExtractedPage[];
  totalPages: number;
  provider: string;
}

interface PdfViewerProps {
  artifact: ArtifactCanvasItem;
  selectable?: boolean;
}

type ViewMode = 'text' | 'original';
const DEBUG_ARTIFACT_RENDERING = process.env.NODE_ENV === 'development';

export default function PdfViewer({ artifact, selectable = true }: PdfViewerProps) {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<ViewMode>(selectable ? 'text' : 'original');
  const [pages, setPages] = useState<ExtractedPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalPdfUrl, setOriginalPdfUrl] = useState<string | null>(null);
  const [originalLoading, setOriginalLoading] = useState(false);
  const [originalError, setOriginalError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectable) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);

    async function loadText() {
      try {
        const response = await fetch(`/api/artifacts/${artifact.artifactId}/text`, {
          credentials: 'same-origin',
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Failed to extract text (${response.status})`);
        }
        const data = (await response.json()) as TextExtractionResponse;
        if (!cancelled) {
          setPages(data.pages || []);
          if (DEBUG_ARTIFACT_RENDERING) {
            const extractedPages = data.pages || [];
            console.debug('[ArtifactCanvas][PDF] Text extraction completed', {
              artifactId: artifact.artifactId,
              provider: data.provider,
              reportedPageCount: data.totalPages,
              returnedPageCount: extractedPages.length,
              pagesWithText: extractedPages.filter((page) => page.text.trim().length > 0).length,
            });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load PDF text');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadText();
    return () => { cancelled = true; };
  }, [artifact.artifactId, selectable]);

  useEffect(() => {
    if (mode !== 'original') {
      setOriginalPdfUrl(null);
      setOriginalLoading(false);
      setOriginalError(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setOriginalLoading(true);
    setOriginalError(null);

    async function loadOriginalPdf() {
      try {
        const response = await fetch(artifact.downloadUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Failed to load original PDF (${response.status})`);

        const blob = await response.blob();
        if (cancelled) return;

        // A Blob URL has no Content-Disposition response header, so browsers
        // display it in the iframe even when the authenticated download route
        // serves the source file as an attachment.
        objectUrl = URL.createObjectURL(
          blob.type === 'application/pdf' ? blob : blob.slice(0, blob.size, 'application/pdf')
        );
        setOriginalPdfUrl(objectUrl);
      } catch (err) {
        if (!cancelled) {
          setOriginalError(err instanceof Error ? err.message : 'Failed to load original PDF');
        }
      } finally {
        if (!cancelled) setOriginalLoading(false);
      }
    }

    loadOriginalPdf();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact.downloadUrl, mode]);

  if (!selectable) {
    return (
      <iframe
        title={artifact.title}
        src={artifact.downloadUrl}
        className="w-full h-full border-0 bg-white"
      />
    );
  }

  const hasExtractedText = pages.some((page) => page.text.trim().length > 0);
  const originalPdfSrc = originalPdfUrl ? `${originalPdfUrl}#view=FitH` : null;

  return (
    <div className="w-full h-full flex flex-col bg-gray-100">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-white shrink-0">
        <span className="text-xs text-gray-500">
          {mode === 'original'
            ? 'Original PDF'
            : loading
              ? 'Extracting selectable text…'
              : hasExtractedText
                ? `${pages.length} page${pages.length !== 1 ? 's' : ''} · Extracted text`
                : error
                  ? 'Text extraction unavailable'
                  : 'No selectable text found'}
        </span>
        <div
          role="group"
          className="flex shrink-0 items-center rounded-md border border-gray-200 p-0.5"
          aria-label="PDF view mode"
        >
          <button
            type="button"
            onClick={() => setMode('text')}
            aria-pressed={mode === 'text'}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              mode === 'text'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            <span className="hidden min-[390px]:inline">Extracted </span>Text
          </button>
          <button
            type="button"
            onClick={() => setMode('original')}
            aria-pressed={mode === 'original'}
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              mode === 'original'
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Original
          </button>
        </div>
      </div>
      {mode === 'original' ? (
        originalLoading ? (
          <div className="flex flex-1 items-center justify-center bg-white">
            <div className="animate-pulse text-sm text-gray-400">Loading original PDF…</div>
          </div>
        ) : originalError ? (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <p className="mb-3 text-sm text-red-600">{originalError}</p>
            <a
              href={artifact.downloadUrl}
              download
              className="text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Download PDF instead
            </a>
          </div>
        ) : originalPdfUrl ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {isMobile && (
              <p className="shrink-0 border-b bg-white px-3 py-1.5 text-center text-[11px] text-gray-500">
                Original layout uses page-width fit where supported. Pinch to zoom for detail.
              </p>
            )}
            <iframe
              title={artifact.title}
              src={originalPdfSrc ?? undefined}
              className="min-h-0 flex-1 w-full border-0 bg-white"
            />
          </div>
        ) : null
      ) : loading ? (
        <div className="flex-1 overflow-auto p-3 sm:p-6">
          <div className="max-w-3xl mx-auto space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="h-3 bg-gray-200 rounded w-1/4 mb-4" />
                <div className="space-y-2">
                  <div className="h-2 bg-gray-200 rounded w-full" />
                  <div className="h-2 bg-gray-200 rounded w-5/6" />
                  <div className="h-2 bg-gray-200 rounded w-4/6" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <p className="mb-3 text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => setMode('original')}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            View Original PDF
          </button>
        </div>
      ) : !hasExtractedText ? (
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <p className="max-w-md text-sm text-gray-600">
            No selectable text was found. This PDF may be scanned, image-only, or protected.
          </p>
          <button
            type="button"
            onClick={() => setMode('original')}
            className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            View Original PDF
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3 sm:p-6">
          {pages.map((page) => (
            <div
              key={page.pageNumber}
              data-page-number={page.pageNumber}
              className="mx-auto mb-3 w-full max-w-3xl rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:mb-4 sm:p-6"
            >
              <div className="text-xs text-gray-400 mb-2 font-medium">
                Page {page.pageNumber}
              </div>
              <p className="break-words whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                {page.text}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
