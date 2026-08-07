'use client';

import { useEffect } from 'react';
import type { ArtifactCanvasItem } from '@/types';
import CanvasToolbar from './CanvasToolbar';
import HtmlViewer from './viewers/HtmlViewer';
import DocumentViewer from './viewers/DocumentViewer';
import DriveEmbedViewer from './viewers/DriveEmbedViewer';
import ImageViewer from './viewers/ImageViewer';
import DiagramViewer from './viewers/DiagramViewer';
import ChartViewer from './viewers/ChartViewer';
import PodcastViewer from './viewers/PodcastViewer';
import PdfViewer from './viewers/PdfViewer';
import ZipViewer from './viewers/ZipViewer';
import SkeletonArtifact from './SkeletonArtifact';
import { useDriveUpload } from '@/hooks/useDriveUpload';

interface ArtifactCanvasProps {
  artifact: ArtifactCanvasItem;
  onClose: () => void;
  threadId: string | null;
}

function ArtifactViewer({ artifact, threadId }: { artifact: ArtifactCanvasItem; threadId: string | null }) {
  // Drive-hosted artifacts (PPTX/XLSX/DOCX) may need upload+embed
  const { embedUrl, needsConsent, requestConsent, loading, error } = useDriveUpload({
    artifact,
    threadId,
  });

  // Inject resolved embed URL into the artifact for DriveEmbedViewer
  const driveArtifact: ArtifactCanvasItem = embedUrl ? { ...artifact, embedUrl } : artifact;

  switch (artifact.artifactType) {
    case 'html':
      return <HtmlViewer artifact={artifact} />;
    case 'docx':
    case 'md':
      return <DocumentViewer artifact={artifact} />;
    case 'pdf':
      return <PdfViewer artifact={artifact} />;
    case 'pptx':
    case 'xlsx':
      if (loading) {
        return (
          <div className="h-full">
            <SkeletonArtifact variant="document" />
          </div>
        );
      }
      if (needsConsent) {
        return (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-gray-50">
            <p className="text-sm text-gray-700 mb-4">
              View this file in Google Drive? The file will be uploaded so it can be previewed inline.
            </p>
            <div className="flex gap-3">
              <button
                onClick={requestConsent}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Upload & View
              </button>
              <a
                href={artifact.downloadUrl}
                download
                className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 transition-colors"
              >
                Download instead
              </a>
            </div>
          </div>
        );
      }
      if (error) {
        return (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-gray-50">
            <p className="text-sm text-red-600 mb-2">{error}</p>
            <a
              href={artifact.downloadUrl}
              download
              className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 transition-colors"
            >
              Download instead
            </a>
          </div>
        );
      }
      return <DriveEmbedViewer artifact={driveArtifact} />;
    case 'image':
      return <ImageViewer artifact={artifact} />;
    case 'diagram':
      return <DiagramViewer artifact={artifact} />;
    case 'chart':
      return <ChartViewer artifact={artifact} />;
    case 'podcast':
      return <PodcastViewer artifact={artifact} />;
    case 'zip':
      return <ZipViewer artifact={artifact} />;
    default:
      return (
        <div className="flex items-center justify-center h-full text-gray-500">
          <p className="text-sm">Unsupported artifact type</p>
        </div>
      );
  }
}

export default function ArtifactCanvas({ artifact, onClose, threadId }: ArtifactCanvasProps) {
  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="flex flex-col h-full bg-white">
      <CanvasToolbar
        title={artifact.title}
        downloadUrl={artifact.downloadUrl || undefined}
        onClose={onClose}
        artifact={artifact}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        <ArtifactViewer artifact={artifact} threadId={threadId} />
      </div>
    </div>
  );
}
