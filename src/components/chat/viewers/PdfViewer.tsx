'use client';

import { useEffect, useState } from 'react';
import type { ArtifactCanvasItem } from '@/types';

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

export default function PdfViewer({ artifact, selectable = true }: PdfViewerProps) {
  const [mode, setMode] = useState<ViewMode>(selectable ? 'text' : 'original');
  const [pages, setPages] = useState<ExtractedPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectable || mode !== 'text') return;

    let cancelled = false;
    setLoading(true);
    setError(null);

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
  }, [artifact.artifactId, mode, selectable]);

  if (!selectable || mode === 'original') {
    return (
      <iframe
        title={artifact.title}
        src={artifact.downloadUrl}
        className="w-full h-full border-0 bg-white"
      />
    );
  }

  if (loading) {
    return (
      <div className="w-full h-full overflow-auto bg-gray-100 p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 animate-pulse">
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
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-white shrink-0">
          <span className="text-sm text-red-600">{error}</span>
          <button
            onClick={() => setMode('original')}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            View Original PDF
          </button>
        </div>
        <iframe
          title={artifact.title}
          src={artifact.downloadUrl}
          className="flex-1 w-full border-0 bg-white"
        />
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-gray-100">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-white shrink-0">
        <span className="text-xs text-gray-500">
          {pages.length > 0 ? `${pages.length} page${pages.length !== 1 ? 's' : ''}` : 'No text extracted'}
        </span>
        <button
          onClick={() => setMode('original')}
          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          View Original PDF
        </button>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {pages.map((page) => (
          <div
            key={page.pageNumber}
            data-page-number={page.pageNumber}
            className="max-w-3xl mx-auto p-6 mb-4 bg-white shadow-sm border border-gray-200 rounded-lg"
          >
            <div className="text-xs text-gray-400 mb-2 font-medium">
              Page {page.pageNumber}
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-800">
              {page.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
