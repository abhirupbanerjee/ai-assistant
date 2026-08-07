/**
 * Shared builders that convert domain types into {@link ArtifactCanvasItem}
 * objects for the Artifact Canvas.
 *
 * These were previously duplicated in `ArtifactsPanel.tsx` and
 * `MobileArtifactsMenu.tsx`. Centralising them here lets the chat feed
 * (`DocumentResultCard`) build the same item the sidebar produces, so opening
 * an artifact from the chat card lands on the exact same canvas entry used by
 * the sidebar navigation siblings list.
 */

import type {
  ArtifactCanvasItem,
  DiagramHint,
  GeneratedDocumentInfo,
  GeneratedImageInfo,
  MessageVisualization,
  PodcastHint,
} from '@/types';

/**
 * Determine the expiration variant for an artifact.
 *
 * Returns `'expired'` when the expiry date has passed, `'warning'` when it is
 * within 10 days, and `'none'` otherwise (including when no expiry is set).
 */
export function getExpirationVariant(expiresAt: string | null): 'expired' | 'warning' | 'none' {
  if (!expiresAt) return 'none';
  const now = new Date();
  const exp = new Date(expiresAt);
  const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 0) return 'expired';
  if (daysLeft <= 10) return 'warning';
  return 'none';
}

export function buildDocCanvasItem(doc: GeneratedDocumentInfo): ArtifactCanvasItem {
  return {
    artifactId: doc.id,
    artifactType: doc.fileType as ArtifactCanvasItem['artifactType'],
    title: doc.filename,
    downloadUrl: doc.downloadUrl,
  };
}

export function buildImageCanvasItem(img: GeneratedImageInfo): ArtifactCanvasItem {
  return {
    artifactId: img.id,
    artifactType: 'image',
    title: img.alt || 'Generated image',
    downloadUrl: img.url,
  };
}

export function buildPodcastCanvasItem(podcast: PodcastHint): ArtifactCanvasItem {
  return {
    artifactId: podcast.id,
    artifactType: 'podcast',
    title: podcast.filename,
    downloadUrl: podcast.downloadUrl,
  };
}

export function buildDiagramCanvasItem(diagram: DiagramHint, index: number): ArtifactCanvasItem {
  return {
    // Stable, index-based ID so the siblings list and the click handler
    // produce identical artifactIds (Date.now() would differ between calls
    // and break the currentIndex lookup in the canvas navigation).
    artifactId: `diagram-${index}-${diagram.title || 'diagram'}`,
    artifactType: 'diagram',
    title: diagram.title || 'Diagram',
    downloadUrl: '',
    mermaidCode: diagram.code,
  };
}

export function buildChartCanvasItem(
  viz: MessageVisualization,
  messageId: string,
  index: number
): ArtifactCanvasItem {
  return {
    artifactId: `chart-${messageId}-${index}`,
    artifactType: 'chart',
    title: viz.title || `Chart ${index + 1}`,
    downloadUrl: '',
    chartData: viz.data,
    chartType: viz.chartType,
  };
}
