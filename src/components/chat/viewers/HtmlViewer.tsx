'use client';

import { useEffect, useState } from 'react';
import type { ArtifactCanvasItem } from '@/types';

interface HtmlViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function HtmlViewer({ artifact }: HtmlViewerProps) {
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHtml() {
      try {
        const response = await fetch(artifact.downloadUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Failed to load HTML: ${response.status}`);
        const text = await response.text();
        if (!cancelled) setHtmlContent(text);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load HTML');
      }
    }

    loadHtml();
    return () => { cancelled = true; };
  }, [artifact.downloadUrl]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-red-600">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (htmlContent === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-gray-400 text-sm">Loading HTML…</div>
      </div>
    );
  }

  return (
    <iframe
      title={artifact.title}
      sandbox="allow-scripts"
      srcDoc={htmlContent}
      className="w-full h-full border-0 bg-white"
    />
  );
}
