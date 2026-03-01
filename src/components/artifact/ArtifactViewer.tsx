'use client';

import { FileText, FileCode, File, X, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { ViewableArtifact } from '@/types';
import { useResizableSidebar } from '@/hooks/useResizableSidebar';
import ResizeHandle from '@/components/ui/ResizeHandle';
import ArtifactRenderer from './ArtifactRenderer';
import ArtifactMenuButton from './ArtifactMenuButton';

interface ArtifactViewerProps {
  artifact: ViewableArtifact;
  onClose: () => void;
  hidden?: boolean; // For mobile: hide when input is focused
}

/**
 * Get icon component based on artifact type
 */
function getArtifactIcon(type: ViewableArtifact['type']) {
  switch (type) {
    case 'markdown':
      return <FileText size={18} className="text-blue-500" />;
    case 'code':
      return <FileCode size={18} className="text-purple-500" />;
    case 'text':
      return <File size={18} className="text-gray-500" />;
    default:
      return <File size={18} className="text-gray-500" />;
  }
}

/**
 * Right-side panel for viewing artifact content.
 * Uses useResizableSidebar for consistent resizing behavior with ArtifactsPanel.
 */
export default function ArtifactViewer({ artifact, onClose, hidden = false }: ArtifactViewerProps) {
  // Resizable sidebar hook - handles width and collapsed state
  const {
    width,
    isCollapsed,
    isResizing,
    setIsCollapsed,
    handleMouseDown,
  } = useResizableSidebar({
    storageKeyPrefix: 'artifact-viewer',
    defaultWidth: 450,
    minWidth: 300,
    maxWidth: 700,
    collapseThreshold: 150,
    side: 'right',
  });

  // Hidden state (mobile input focused)
  if (hidden) {
    return null;
  }

  // Collapsed view - show expand button
  if (isCollapsed) {
    return (
      <div className="w-12 bg-white border-l flex flex-col items-center py-4 gap-3">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="Expand artifact viewer"
        >
          <PanelRightOpen size={20} />
        </button>
        <div className="flex flex-col items-center gap-1">
          {getArtifactIcon(artifact.type)}
        </div>
      </div>
    );
  }

  // Expanded view
  return (
    <div
      className="bg-white border-l flex flex-col h-full relative"
      style={{ width: `${width}px` }}
    >
      {/* Resize handle - desktop only */}
      <div className="hidden md:block">
        <ResizeHandle
          side="left"
          onMouseDown={handleMouseDown}
          isResizing={isResizing}
        />
      </div>

      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {getArtifactIcon(artifact.type)}
          <span className="font-medium text-gray-900 truncate" title={artifact.title || artifact.filename}>
            {artifact.title || artifact.filename}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ArtifactMenuButton artifact={artifact} />
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors hidden md:block"
            title="Collapse panel"
          >
            <PanelRightClose size={18} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Close viewer"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <ArtifactRenderer artifact={artifact} />
      </div>
    </div>
  );
}

/**
 * Full-screen modal version of ArtifactViewer for mobile devices.
 * Uses a fixed overlay instead of the resizable panel.
 */
export function ArtifactViewerModal({ artifact, onClose }: Omit<ArtifactViewerProps, 'hidden'>) {
  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {getArtifactIcon(artifact.type)}
          <span className="font-medium text-gray-900 truncate" title={artifact.title || artifact.filename}>
            {artifact.title || artifact.filename}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ArtifactMenuButton artifact={artifact} />
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
            title="Close viewer"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <ArtifactRenderer artifact={artifact} />
      </div>
    </div>
  );
}
