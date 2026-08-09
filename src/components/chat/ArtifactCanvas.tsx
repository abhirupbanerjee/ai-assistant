'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import type { ArtifactCanvasItem, ArtifactComment } from '@/types';
import { useArtifactComments } from '@/hooks/useArtifactComments';
import { useTextSelection } from '@/hooks/useTextSelection';
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
import CommentSidebar from './CommentSidebar';
import CommentInputBox from './CommentInputBox';
import { useDriveUpload } from '@/hooks/useDriveUpload';

interface ArtifactCanvasProps {
  artifact: ArtifactCanvasItem;
  onClose: () => void;
  threadId: string | null;
  /** Ordered list of viewable artifacts for prev/next navigation. */
  siblings?: ArtifactCanvasItem[];
  /** Navigate to a sibling by absolute index. */
  onNavigate?: (index: number) => void;
  /** Called when the user clicks "Send All" so the parent can attach comments to the composer. */
  onSendComments?: (comments: ArtifactComment[]) => void;
}

const TEXT_SELECTABLE_TYPES: ArtifactCanvasItem['artifactType'][] = ['md', 'pdf', 'docx'];

function ArtifactViewer({
  artifact,
  threadId,
  containerRef,
  onAddImageComment,
}: {
  artifact: ArtifactCanvasItem;
  threadId: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onAddImageComment?: () => void;
}) {
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
      return (
        <div ref={containerRef} className="w-full h-full">
          <DocumentViewer artifact={artifact} />
        </div>
      );
    case 'pdf':
      return (
        <div ref={containerRef} className="w-full h-full">
          <PdfViewer artifact={artifact} selectable />
        </div>
      );
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
      return <ImageViewer artifact={artifact} onAddImageComment={onAddImageComment} />;
    case 'diagram':
      return (
        <div ref={containerRef} className="w-full h-full">
          <DiagramViewer artifact={artifact} />
        </div>
      );
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

export default function ArtifactCanvas({
  artifact,
  onClose,
  threadId,
  siblings,
  onNavigate,
  onSendComments,
}: ArtifactCanvasProps) {
  const hasNav = Boolean(siblings && siblings.length > 1 && onNavigate);
  const currentIndex = siblings && siblings.length > 0
    ? siblings.findIndex((s) => s.artifactId === artifact.artifactId)
    : -1;
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const indexText = hasNav && siblings ? `${safeIndex + 1} / ${siblings.length}` : undefined;
  const hasPrev = hasNav && safeIndex > 0;
  const hasNext = hasNav && siblings ? safeIndex < siblings.length - 1 : false;

  const { comments, addTextComment, addImageComment, removeComment, clearComments, commentCount } =
    useArtifactComments(artifact);

  const isMobile = useIsMobile();
  const [commentInputOpen, setCommentInputOpen] = useState(false);
  const [commentInputPosition, setCommentInputPosition] = useState<{ x: number; y: number } | undefined>(undefined);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isMobile);

  const containerRef = useRef<HTMLDivElement>(null);
  const isTextSelectable = TEXT_SELECTABLE_TYPES.includes(artifact.artifactType);
  const isDiagram = artifact.artifactType === 'diagram';
  const selectionContainerRef = isDiagram
    ? (containerRef as React.RefObject<HTMLElement>)
    : (containerRef as React.RefObject<HTMLElement>);
  const { selection, showButton, clearSelection } = useTextSelection(selectionContainerRef);

  const handlePrev = () => {
    if (hasPrev && onNavigate) onNavigate(safeIndex - 1);
  };
  const handleNext = () => {
    if (hasNext && onNavigate) onNavigate(safeIndex + 1);
  };

  // Close on Escape + arrow navigation (when focus is not in a text input).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      const target = e.target as HTMLElement | null;
      const isTypingTarget =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.tagName === 'SELECT');
      if (isTypingTarget) return;
      if (e.key === 'ArrowLeft' && hasPrev) {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight' && hasNext) {
        e.preventDefault();
        handleNext();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, hasPrev, hasNext, safeIndex, siblings, onNavigate]);

  const handleAddTextCommentClick = useCallback(() => {
    if (!selection) return;
    setCommentInputPosition(selection.position);
    setCommentInputOpen(true);
  }, [selection]);

  const handleSaveTextComment = useCallback(
    (commentText: string) => {
      if (!selection) return;
      addTextComment({
        selectedText: selection.selectedText,
        surroundingContext: selection.surroundingContext,
        commentText,
        pageNumber: selection.pageNumber,
      });
      clearSelection();
      setCommentInputOpen(false);
      setSidebarCollapsed(false);
    },
    [selection, addTextComment, clearSelection]
  );

  const handleAddImageComment = useCallback(() => {
    setCommentInputPosition(undefined);
    setCommentInputOpen(true);
  }, []);

  const handleSaveImageComment = useCallback(
    (commentText: string) => {
      addImageComment({ commentText });
      setCommentInputOpen(false);
      setSidebarCollapsed(false);
    },
    [addImageComment]
  );

  const handleCancelComment = useCallback(() => {
    setCommentInputOpen(false);
  }, []);

  const handleSendAll = useCallback(() => {
    if (comments.length === 0) return;
    onSendComments?.(comments);
    clearComments();
    onClose();
  }, [comments, onSendComments, clearComments, onClose]);

  return (
    <div className="flex flex-col h-full bg-white">
      <CanvasToolbar
        title={artifact.title}
        downloadUrl={artifact.downloadUrl || undefined}
        onClose={onClose}
        artifact={artifact}
        hasPrev={hasPrev}
        hasNext={hasNext}
        indexText={indexText}
        onPrev={handlePrev}
        onNext={handleNext}
        commentCount={commentCount}
        onAddImageComment={artifact.artifactType === 'image' ? handleAddImageComment : undefined}
        showImageCommentButton={artifact.artifactType === 'image'}
      />
      <div className="flex-1 min-h-0 overflow-hidden flex">
        <div ref={containerRef} className="flex-1 min-w-0 min-h-0 relative">
          <ArtifactViewer
            artifact={artifact}
            threadId={threadId}
            containerRef={containerRef}
            onAddImageComment={handleAddImageComment}
          />

          {showButton && selection && (isTextSelectable || isDiagram) && !commentInputOpen && (
            <button
              onClick={handleAddTextCommentClick}
              className="absolute z-40 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-full shadow-lg transition-colors"
              style={{
                left: selection.position.x,
                top: selection.position.y,
                transform: 'translate(-50%, -100%)',
              }}
            >
              Add comment
            </button>
          )}

          {commentInputOpen && (
            <CommentInputBox
              position={commentInputPosition}
              onSave={commentInputPosition ? handleSaveTextComment : handleSaveImageComment}
              onCancel={handleCancelComment}
              placeholder={commentInputPosition ? 'Comment on selected text…' : 'Comment on image…'}
            />
          )}
        </div>

        <CommentSidebar
          comments={comments}
          onRemove={removeComment}
          onSendAll={handleSendAll}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(v => !v)}
        />
      </div>
    </div>
  );
}
