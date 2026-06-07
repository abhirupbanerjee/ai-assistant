'use client';

import { useMemo, useEffect } from 'react';
import type { Message, GeneratedDocumentInfo, GeneratedImageInfo, UrlSource, PodcastHint } from '@/types';
import type { StreamingState } from './useStreamingChat';

interface UseChatArtifactsOptions {
  threadId: string | null;
  messages: Message[];
  uploads: string[];
  urlSources: UrlSource[];
  streamingState: StreamingState;
  onArtifactsChange?: (data: {
    threadId: string | null;
    uploads: string[];
    generatedDocs: GeneratedDocumentInfo[];
    generatedImages: GeneratedImageInfo[];
    generatedPodcasts: PodcastHint[];
    urlSources: UrlSource[];
  }) => void;
}

interface ArtifactsData {
  generatedDocs: GeneratedDocumentInfo[];
  generatedImages: GeneratedImageInfo[];
  generatedPodcasts: PodcastHint[];
}

/**
 * Computes aggregated artifacts (docs, images, podcasts) from both persisted
 * messages and the live streaming state, and notifies the parent when they change.
 *
 * Extracted from ChatWindow to reduce orchestrator surface area before
 * the monolith split (Phase 2A.5).
 */
export function useChatArtifacts({
  threadId,
  messages,
  uploads,
  urlSources,
  streamingState,
  onArtifactsChange,
}: UseChatArtifactsOptions): ArtifactsData {
  const { generatedDocs, generatedImages, generatedPodcasts } = useMemo(() => {
    const docs: GeneratedDocumentInfo[] = [];
    const images: GeneratedImageInfo[] = [];
    const podcasts: PodcastHint[] = [];

    // Include artifacts from saved messages
    for (const msg of messages) {
      if (msg.generatedDocuments) docs.push(...msg.generatedDocuments);
      if (msg.generatedImages) images.push(...msg.generatedImages);
      if (msg.generatedPodcasts) podcasts.push(...msg.generatedPodcasts);
    }

    // Include real-time streaming artifacts (for sidebar updates during generation)
    if (streamingState.documents) {
      for (const doc of streamingState.documents) {
        if (!docs.some(d => d.id === doc.id)) {
          docs.push(doc);
        }
      }
    }
    if (streamingState.images) {
      for (const img of streamingState.images) {
        if (!images.some(i => i.id === img.id)) {
          images.push(img);
        }
      }
    }
    if (streamingState.podcasts) {
      for (const podcast of streamingState.podcasts) {
        if (!podcasts.some(p => p.id === podcast.id)) {
          podcasts.push(podcast);
        }
      }
    }

    return { generatedDocs: docs, generatedImages: images, generatedPodcasts: podcasts };
  }, [messages, streamingState.documents, streamingState.images, streamingState.podcasts]);

  // Notify parent of artifacts changes
  useEffect(() => {
    onArtifactsChange?.({
      threadId,
      uploads,
      generatedDocs,
      generatedImages,
      generatedPodcasts,
      urlSources,
    });
  }, [threadId, uploads, generatedDocs, generatedImages, generatedPodcasts, urlSources, onArtifactsChange]);

  return { generatedDocs, generatedImages, generatedPodcasts };
}