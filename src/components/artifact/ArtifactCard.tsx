'use client';

import { FileText, FileCode, File, Eye } from 'lucide-react';
import type { ViewableArtifact } from '@/types';
import { MAX_VIEWABLE_SIZE } from '@/types';

interface ArtifactCardProps {
  artifact: ViewableArtifact;
  onOpen: (artifact: ViewableArtifact) => void;
}

/**
 * Get icon component based on artifact type
 */
function getArtifactIcon(type: ViewableArtifact['type'], language?: string) {
  switch (type) {
    case 'markdown':
      return <FileText size={20} className="text-blue-500" />;
    case 'code':
      return <FileCode size={20} className="text-purple-500" />;
    case 'text':
      return <File size={20} className="text-gray-500" />;
    default:
      return <File size={20} className="text-gray-500" />;
  }
}

/**
 * Get label for artifact type
 */
function getTypeLabel(type: ViewableArtifact['type'], language?: string): string {
  switch (type) {
    case 'markdown':
      return 'Markdown';
    case 'code':
      return language ? language.charAt(0).toUpperCase() + language.slice(1) : 'Code';
    case 'text':
      return 'Text';
    default:
      return 'Document';
  }
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Clickable card for viewable artifacts in chat messages.
 * Opens the artifact in the ArtifactViewer panel when clicked.
 */
export default function ArtifactCard({ artifact, onOpen }: ArtifactCardProps) {
  const isViewable = artifact.fileSize <= MAX_VIEWABLE_SIZE;

  const handleClick = () => {
    if (isViewable) {
      onOpen(artifact);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={!isViewable}
      className={`
        w-full text-left bg-blue-50 rounded-lg border border-blue-200 p-4 mt-3
        transition-all duration-200
        ${isViewable
          ? 'hover:bg-blue-100 hover:border-blue-300 hover:shadow-sm cursor-pointer'
          : 'opacity-60 cursor-not-allowed'
        }
      `}
    >
      <div className="flex items-start gap-3">
        {/* File icon */}
        <div className="flex-shrink-0 p-2 bg-white rounded-lg shadow-sm">
          {getArtifactIcon(artifact.type, artifact.language)}
        </div>

        {/* Artifact info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-blue-900 truncate">
            {artifact.title || artifact.filename}
          </h4>
          <div className="flex items-center gap-2 text-sm text-blue-700 mt-0.5">
            <span>{getTypeLabel(artifact.type, artifact.language)}</span>
            <span className="text-blue-400">•</span>
            <span>{formatFileSize(artifact.fileSize)}</span>
          </div>
          {!isViewable && (
            <div className="text-xs text-blue-600 mt-1">
              File too large to preview (max {formatFileSize(MAX_VIEWABLE_SIZE)})
            </div>
          )}
        </div>

        {/* View indicator */}
        {isViewable && (
          <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium">
            <Eye size={14} />
            <span>View</span>
          </div>
        )}
      </div>
    </button>
  );
}
