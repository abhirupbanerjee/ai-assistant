'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import * as mammoth from 'mammoth';
import type { ArtifactCanvasItem } from '@/types';

const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false });

interface DocumentViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function DocumentViewer({ artifact }: DocumentViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDocument() {
      try {
        const response = await fetch(artifact.downloadUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Failed to load document: ${response.status}`);

        if (artifact.artifactType === 'docx') {
          const arrayBuffer = await response.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (!cancelled) setContent(result.value);
        } else if (artifact.artifactType === 'md') {
          const text = await response.text();
          if (!cancelled) setContent(text);
        } else {
          if (!cancelled) setError(`Unsupported document type: ${artifact.artifactType}`);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load document');
      }
    }

    loadDocument();
    return () => { cancelled = true; };
  }, [artifact.downloadUrl, artifact.artifactType]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4 text-red-600">
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-gray-400 text-sm">Loading document…</div>
      </div>
    );
  }

  if (artifact.artifactType === 'docx') {
    return (
      <div
        className="w-full h-full overflow-auto bg-white p-6 prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: content }}
      />
    );
  }

  return (
    <div className="w-full h-full overflow-auto bg-white p-6 prose prose-sm max-w-none">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
