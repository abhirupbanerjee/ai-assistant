'use client';

import { FileText, FileSpreadsheet, FileCode, Globe, Download, ExternalLink, Clock } from 'lucide-react';
import type { GeneratedDocumentInfo } from '@/types';

interface DocumentResultCardProps {
  document: GeneratedDocumentInfo;
}

/**
 * Get icon component based on file type
 */
function getFileIcon(fileType: string) {
  switch (fileType) {
    case 'pdf':
      return <FileText size={20} className="text-red-500" />;
    case 'docx':
      return <FileSpreadsheet size={20} className="text-blue-500" />;
    case 'md':
      return <FileCode size={20} className="text-gray-600" />;
    case 'html':
      return <Globe size={20} className="text-emerald-500" />;
    default:
      return <FileText size={20} className="text-gray-500" />;
  }
}

/**
 * Get label for file type
 */
function getFileTypeLabel(fileType: string): string {
  switch (fileType) {
    case 'pdf':
      return 'PDF Document';
    case 'docx':
      return 'Word Document';
    case 'md':
      return 'Markdown';
    case 'html':
      return 'HTML Page';
    default:
      return 'Document';
  }
}

/**
 * Format expiration date for display
 */
function formatExpiration(expiresAt: string | null): string | null {
  if (!expiresAt) return null;

  const expDate = new Date(expiresAt);
  const now = new Date();
  const diffDays = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Expired';
  if (diffDays === 1) return 'Expires tomorrow';
  if (diffDays <= 7) return `Expires in ${diffDays} days`;

  return `Expires ${expDate.toLocaleDateString()}`;
}

export default function DocumentResultCard({ document }: DocumentResultCardProps) {
  const expiration = formatExpiration(document.expiresAt);
  const isHtml = document.fileType === 'html';

  const handleDownload = () => {
    // Open download URL in new tab
    window.open(document.downloadUrl, '_blank');
  };

  const handleOpen = () => {
    // Open HTML page inline in new tab
    window.open(document.downloadUrl, '_blank');
  };

  return (
    <div className="bg-green-50 rounded-lg border border-green-200 p-4 mt-3">
      <div className="flex items-start gap-3">
        {/* File icon */}
        <div className="flex-shrink-0 p-2 bg-white rounded-lg shadow-sm">
          {getFileIcon(document.fileType)}
        </div>

        {/* Document info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-green-900 truncate">
            {document.filename}
          </h4>
          <div className="flex items-center gap-2 text-sm text-green-700 mt-0.5">
            <span>{getFileTypeLabel(document.fileType)}</span>
            <span className="text-green-400">•</span>
            <span>{document.fileSizeFormatted}</span>
          </div>
          {expiration && (
            <div className="flex items-center gap-1 text-xs text-green-600 mt-1">
              <Clock size={12} />
              <span>{expiration}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {isHtml ? (
            <button
              onClick={handleOpen}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm font-medium"
            >
              <ExternalLink size={16} />
              Open
            </button>
          ) : (
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
            >
              <Download size={16} />
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
