'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ArtifactCanvasItem } from '@/types';

interface UseDriveUploadOptions {
  artifact: ArtifactCanvasItem;
  threadId: string | null;
}

interface UseDriveUploadResult {
  embedUrl: string | null;
  loading: boolean;
  error: string | null;
  needsConsent: boolean;
  requestConsent: () => void;
}

function webViewLinkToEmbed(webViewLink: string, fileType: string): string {
  const match = webViewLink.match(/\/d\/([^/]+)/);
  if (!match) return webViewLink;
  const fileId = match[1];
  const embedMap: Record<string, string> = {
    pptx: `https://docs.google.com/presentation/d/${fileId}/embed`,
    xlsx: `https://docs.google.com/spreadsheets/d/${fileId}/embed`,
    docx: `https://docs.google.com/document/d/${fileId}/embed`,
  };
  return embedMap[fileType] ?? `https://docs.google.com/viewer?url=${encodeURIComponent(webViewLink)}&embedded=true`;
}

function getConsentKey(): string {
  return 'drive-consent:google';
}

function getCacheKey(outputId: string): string {
  return `drive-embed:${outputId}`;
}

export function useDriveUpload({ artifact, threadId }: UseDriveUploadOptions): UseDriveUploadResult {
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [consentRequested, setConsentRequested] = useState(false);

  const artifactType = artifact.artifactType;
  const isDriveType = artifactType === 'pptx' || artifactType === 'xlsx' || artifactType === 'docx';

  // Check localStorage consent + cache on mount
  useEffect(() => {
    if (!isDriveType || !artifact.artifactId || !threadId) return;

    const cached = localStorage.getItem(getCacheKey(artifact.artifactId));
    if (cached) {
      setEmbedUrl(cached);
      return;
    }

    const consent = localStorage.getItem(getConsentKey());
    if (consent === 'true') {
      // Auto-upload if already consented
      uploadToDrive();
    } else {
      setNeedsConsent(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDriveType, artifact.artifactId, threadId]);

  const uploadToDrive = useCallback(async () => {
    if (!isDriveType || !artifact.artifactId || !threadId) return;

    setLoading(true);
    setError(null);
    setNeedsConsent(false);

    try {
      const response = await fetch('/api/drive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputId: Number(artifact.artifactId),
          context: 'thread',
          convertToGoogleFormat: true,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload to Drive');
      }

      const url = webViewLinkToEmbed(data.webViewLink, artifactType);
      setEmbedUrl(url);
      localStorage.setItem(getCacheKey(artifact.artifactId), url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload to Drive');
    } finally {
      setLoading(false);
    }
  }, [isDriveType, artifact.artifactId, artifactType, threadId]);

  const requestConsent = useCallback(() => {
    localStorage.setItem(getConsentKey(), 'true');
    setConsentRequested(true);
    uploadToDrive();
  }, [uploadToDrive]);

  // Re-run upload when explicit consent is requested
  useEffect(() => {
    if (consentRequested && isDriveType && !embedUrl && !loading && !error) {
      uploadToDrive();
    }
  }, [consentRequested, embedUrl, error, isDriveType, loading, uploadToDrive]);

  return {
    embedUrl,
    loading,
    error,
    needsConsent,
    requestConsent,
  };
}
