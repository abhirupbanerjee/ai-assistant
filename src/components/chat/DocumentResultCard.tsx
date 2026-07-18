'use client';

import { FileText, FileSpreadsheet, FileCode, Globe, FileArchive, Download, ExternalLink, Clock, AlertTriangle } from 'lucide-react';
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
    case 'zip':
      return <FileArchive size={20} className="text-amber-600" />;
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
    case 'zip':
      return 'ZIP Archive';
    default:
      return 'Document';
  }
}

/**
 * Format expiration date for display.
 * Returns text and variant: 'none' (normal), 'warning' (≤10 days), or 'expired'.
 */
function formatExpiration(expiresAt: string | null): { text: string | null; variant: 'none' | 'warning' | 'expired' } {
  if (!expiresAt) return { text: null, variant: 'none' };

  const expDate = new Date(expiresAt);
  const now = new Date();
  const diffDays = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return { text: 'This artifact has been deleted', variant: 'expired' };
  if (diffDays === 1) return { text: 'Expires tomorrow', variant: 'warning' };
  if (diffDays <= 10) return { text: `Expires in ${diffDays} days`, variant: 'warning' };

  return { text: `Expires ${expDate.toLocaleDateString()}`, variant: 'none' };
}

export default function DocumentResultCard({ document }: DocumentResultCardProps) {
  const { text: expirationText, variant: expirationVariant } = formatExpiration(document.expiresAt);
  const isExpired = expirationVariant === 'expired';
  const isWarning = expirationVariant === 'warning';
  const isHtml = document.fileType === 'html';

  const handleDownload = () => {
    if (isExpired) return;
    window.open(document.downloadUrl, '_blank');
  };

  const handleOpen = () => {
    if (isExpired) return;
    window.open(document.downloadUrl, '_blank');
  };

  return (
    <div className={`rounded-lg border p-4 mt-3 ${isExpired ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-green-50 border-green-200'}`}>
      <div className="flex items-start gap-3">
        {/* File icon */}
        <div className="flex-shrink-0 p-2 bg-white rounded-lg shadow-sm">
          {getFileIcon(document.fileType)}
        </div>

        {/* Document info */}
        <div className="flex-1 min-w-0">
          <h4 className={`font-medium truncate ${isExpired ? 'text-gray-400 line-through' : 'text-green-900'}`}>
            {document.filename}
          </h4>
          <div className={`flex items-center gap-2 text-sm mt-0.5 ${isExpired ? 'text-gray-400' : 'text-green-700'}`}>
            <span>{getFileTypeLabel(document.fileType)}</span>
            <span className={isExpired ? 'text-gray-300' : 'text-green-400'}>•</span>
            <span>{document.fileSizeFormatted}</span>
          </div>
          {expirationText && (
            <div className={`flex items-center gap-1 text-xs mt-1 ${
              isExpired ? 'text-red-500' : isWarning ? 'text-amber-600' : 'text-green-600'
            }`}>
              {isExpired ? <AlertTriangle size={12} /> : isWarning ? <AlertTriangle size={12} /> : <Clock size={12} />}
              <span>{expirationText}</span>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {isExpired ? (
            <span className="text-xs text-gray-400 italic px-3 py-2">Deleted</span>
          ) : isHtml ? (
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
