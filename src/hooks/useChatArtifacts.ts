'use client';

import { useMemo, useEffect } from 'react';
import type { Message, GeneratedDocumentInfo, GeneratedImageInfo, UrlSource, PodcastHint, ThreadOutputItem, DiagramHint, ThreadUploadItem } from '@/types';
import type { StreamingState } from './useStreamingChat';

interface UseChatArtifactsOptions {
  threadId: string | null;
  messages: Message[];
  uploads: ThreadUploadItem[];
  urlSources: UrlSource[];
  streamingState: StreamingState;
  /** Thread outputs from durable storage (survives summarization) */
  threadOutputs?: ThreadOutputItem[];
  onArtifactsChange?: (data: {
    threadId: string | null;
    uploads: ThreadUploadItem[];
    generatedDocs: GeneratedDocumentInfo[];
    generatedImages: GeneratedImageInfo[];
    generatedPodcasts: PodcastHint[];
    generatedDiagrams: DiagramHint[];
    urlSources: UrlSource[];
  }) => void;
}

/**
 * Convert thread outputs to GeneratedDocumentInfo based on file type.
 * Document types: pdf, docx, xlsx, pptx, md, html
 */
function outputToDocument(output: ThreadOutputItem): GeneratedDocumentInfo {
  return {
    id: String(output.id),
    filename: output.filename,
    fileType: (output.fileType as 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'md' | 'html' | 'zip') || 'md',
    fileSize: output.fileSize,
    fileSizeFormatted: formatFileSize(output.fileSize),
    downloadUrl: output.downloadUrl,
    expiresAt: output.expiresAt,
  };
}

/**
 * Convert thread outputs to GeneratedImageInfo.
 */
function outputToImage(output: ThreadOutputItem): GeneratedImageInfo {
  return {
    id: String(output.id),
    url: output.downloadUrl,
    width: 0,
    height: 0,
    alt: output.filename,
    expiresAt: output.expiresAt,
  };
}

/**
 * Convert thread outputs to PodcastHint.
 */
function outputToPodcast(output: ThreadOutputItem): PodcastHint {
  return {
    id: String(output.id),
    filename: output.filename,
    duration: 0,
    format: (output.fileType === 'wav' ? 'wav' : 'mp3') as 'mp3' | 'wav',
    downloadUrl: output.downloadUrl,
    streamUrl: output.downloadUrl,
    expiresAt: output.expiresAt,
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ArtifactsData {
  generatedDocs: GeneratedDocumentInfo[];
  generatedImages: GeneratedImageInfo[];
  generatedPodcasts: PodcastHint[];
  generatedDiagrams: DiagramHint[];
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
  threadOutputs,
  onArtifactsChange,
}: UseChatArtifactsOptions): ArtifactsData {
  const { generatedDocs, generatedImages, generatedPodcasts, generatedDiagrams } = useMemo(() => {
    const docs: GeneratedDocumentInfo[] = [];
    const images: GeneratedImageInfo[] = [];
    const podcasts: PodcastHint[] = [];
    const diagrams: DiagramHint[] = [];

    // Track IDs to avoid duplicates
    const docIds = new Set<string>();
    const imageIds = new Set<string>();
    const podcastIds = new Set<string>();
    const diagramIds = new Set<string>();

    // 1. Include artifacts from thread_outputs (durable, survives summarization)
    // These take priority as the authoritative source with expiration data.
    if (threadOutputs) {
      for (const output of threadOutputs) {
        const docTypes = ['pdf', 'docx', 'xlsx', 'pptx', 'md', 'html', 'zip'];
        const imageTypes = ['image'];
        const podcastTypes = ['mp3', 'wav'];

        if (docTypes.includes(output.fileType)) {
          const doc = outputToDocument(output);
          docs.push(doc);
          docIds.add(doc.id);
        } else if (imageTypes.includes(output.fileType)) {
          const img = outputToImage(output);
          images.push(img);
          imageIds.add(img.id);
        } else if (podcastTypes.includes(output.fileType)) {
          const podcast = outputToPodcast(output);
          podcasts.push(podcast);
          podcastIds.add(podcast.id);
        } else if (output.fileType === 'diagram') {
          // Thread outputs don't currently store diagram code; skip until backend supports it.
        }
      }
    }

    // 2. Include artifacts from saved messages (supplements with richer metadata)
    for (const msg of messages) {
      if (msg.generatedDocuments) {
        for (const doc of msg.generatedDocuments) {
          if (!docIds.has(doc.id)) {
            docs.push(doc);
            docIds.add(doc.id);
          }
        }
      }
      if (msg.generatedImages) {
        for (const img of msg.generatedImages) {
          if (!imageIds.has(img.id)) {
            images.push(img);
            imageIds.add(img.id);
          }
        }
      }
      if (msg.generatedPodcasts) {
        for (const podcast of msg.generatedPodcasts) {
          if (!podcastIds.has(podcast.id)) {
            podcasts.push(podcast);
            podcastIds.add(podcast.id);
          }
        }
      }
      if (msg.generatedDiagrams) {
        for (const diagram of msg.generatedDiagrams) {
          if (!diagramIds.has(diagram.code)) {
            diagrams.push(diagram);
            diagramIds.add(diagram.code);
          }
        }
      }
    }

    // 3. Include real-time streaming artifacts (for sidebar updates during generation)
    if (streamingState.documents) {
      for (const doc of streamingState.documents) {
        if (!docIds.has(doc.id)) {
          docs.push(doc);
          docIds.add(doc.id);
        }
      }
    }
    if (streamingState.images) {
      for (const img of streamingState.images) {
        if (!imageIds.has(img.id)) {
          images.push(img);
          imageIds.add(img.id);
        }
      }
    }
    if (streamingState.podcasts) {
      for (const podcast of streamingState.podcasts) {
        if (!podcastIds.has(podcast.id)) {
          podcasts.push(podcast);
          podcastIds.add(podcast.id);
        }
      }
    }
    if (streamingState.diagrams) {
      for (const diagram of streamingState.diagrams) {
        if (!diagramIds.has(diagram.code)) {
          diagrams.push(diagram);
          diagramIds.add(diagram.code);
        }
      }
    }

    return { generatedDocs: docs, generatedImages: images, generatedPodcasts: podcasts, generatedDiagrams: diagrams };
  }, [messages, threadOutputs, streamingState.documents, streamingState.images, streamingState.podcasts, streamingState.diagrams]);

  // Notify parent of artifacts changes
  useEffect(() => {
    onArtifactsChange?.({
      threadId,
      uploads,
      generatedDocs,
      generatedImages,
      generatedPodcasts,
      generatedDiagrams,
      urlSources,
    });
  }, [threadId, uploads, generatedDocs, generatedImages, generatedPodcasts, generatedDiagrams, urlSources, onArtifactsChange]);

  return { generatedDocs, generatedImages, generatedPodcasts, generatedDiagrams };
}