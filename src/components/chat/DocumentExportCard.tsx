'use client';

import { useState } from 'react';
import { FileText, FileDown, Loader2, Check, AlertCircle } from 'lucide-react';
import Button from '@/components/ui/Button';

interface DocumentExportCardProps {
  content: string;
  title?: string;
  threadId?: string;
  messageId?: string;
  categoryId?: number;
  onExportComplete?: (document: ExportedDocument) => void;
}

interface ExportedDocument {
  id: number;
  filename: string;
  fileType: 'pdf' | 'docx' | 'md';
  fileSize: number;
  fileSizeFormatted: string;
  downloadUrl: string;
  expiresAt: string | null;
}

type ExportFormat = 'pdf' | 'docx' | 'md';
type ExportStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * DocumentExportCard - Card for exporting chat content as PDF or Word documents
 */
export default function DocumentExportCard({
  content,
  title = 'Chat Export',
  threadId,
  messageId,
  categoryId,
  onExportComplete,
}: DocumentExportCardProps) {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [exportedDoc, setExportedDoc] = useState<ExportedDocument | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('pdf');

  const handleExport = async (format: ExportFormat) => {
    setStatus('loading');
    setError(null);
    setSelectedFormat(format);

    try {
      const response = await fetch('/api/chat/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          title,
          format,
          threadId,
          messageId,
          categoryId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Export failed');
      }

      if (data.success && data.document) {
        setExportedDoc(data.document);
        setStatus('success');
        onExportComplete?.(data.document);
      } else {
        throw new Error(data.error || 'Export failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      setStatus('error');
    }
  };

  const handleDownload = () => {
    if (exportedDoc?.downloadUrl) {
      window.open(exportedDoc.downloadUrl, '_blank');
    }
  };

  // Success state - show download button
  if (status === 'success' && exportedDoc) {
    return (
      <div className="bg-green-50 rounded-lg border border-green-200 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-green-100 rounded-lg">
            <Check size={20} className="text-green-600" />
          </div>
          <div>
            <h4 className="font-medium text-green-900">Document Ready</h4>
            <p className="text-sm text-green-600">
              {exportedDoc.filename} ({exportedDoc.fileSizeFormatted})
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleDownload} size="sm">
            <FileDown size={16} className="mr-2" />
            Download {exportedDoc.fileType?.toUpperCase() ?? 'FILE'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setStatus('idle');
              setExportedDoc(null);
            }}
          >
            Export Another
          </Button>
        </div>
        {exportedDoc.expiresAt && (
          <p className="text-xs text-green-600 mt-2">
            Download link expires: {new Date(exportedDoc.expiresAt).toLocaleDateString()}
          </p>
        )}
      </div>
    );
  }

  // Error state
  if (status === 'error') {
    return (
      <div className="bg-red-50 rounded-lg border border-red-200 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-red-100 rounded-lg">
            <AlertCircle size={20} className="text-red-600" />
          </div>
          <div>
            <h4 className="font-medium text-red-900">Export Failed</h4>
            <p className="text-sm text-red-600">{error}</p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setStatus('idle');
            setError(null);
          }}
        >
          Try Again
        </Button>
      </div>
    );
  }

  // Loading state
  if (status === 'loading') {
    return (
      <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Loader2 size={20} className="text-blue-600 animate-spin" />
          </div>
          <div>
            <h4 className="font-medium text-blue-900">Generating Document</h4>
            <p className="text-sm text-blue-600">
              Creating {selectedFormat.toUpperCase()} document...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Default idle state - show export options
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-gray-100 rounded-lg">
          <FileText size={20} className="text-gray-600" />
        </div>
        <div>
          <h4 className="font-medium text-gray-900">Export as Document</h4>
          <p className="text-sm text-gray-500">
            Download this response as a branded document
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleExport('pdf')}
        >
          <FileDown size={16} className="mr-2" />
          PDF
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleExport('docx')}
        >
          <FileDown size={16} className="mr-2" />
          Word
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => handleExport('md')}
        >
          <FileText size={16} className="mr-2" />
          Markdown
        </Button>
      </div>
    </div>
  );
}

/**
 * Compact export button for inline use in message bubbles
 */
export function DocumentExportButton({
  content,
  title,
  threadId,
  messageId,
  categoryId,
}: Omit<DocumentExportCardProps, 'onExportComplete'>) {
  const [showOptions, setShowOptions] = useState(false);
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('pdf');

  const handleExport = async (format: ExportFormat) => {
    setStatus('loading');
    setSelectedFormat(format);

    try {
      const response = await fetch('/api/chat/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          title,
          format,
          threadId,
          messageId,
          categoryId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Export failed');
      }

      // Auto-download
      if (data.document?.downloadUrl) {
        window.open(data.document.downloadUrl, '_blank');
      }
      setStatus('success');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }

    setShowOptions(false);
  };

  if (status === 'loading') {
    return (
      <button
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-blue-600 bg-blue-50 rounded"
        disabled
      >
        <Loader2 size={12} className="animate-spin" />
        Exporting {selectedFormat.toUpperCase()}...
      </button>
    );
  }

  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs text-green-600 bg-green-50 rounded">
        <Check size={12} />
        Downloaded
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 bg-red-50 rounded">
        <AlertCircle size={12} />
        Export failed
      </span>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setShowOptions(!showOptions)}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
        title="Export as document"
      >
        <FileDown size={12} />
        Export
      </button>

      {showOptions && (
        <div className="absolute bottom-full left-0 mb-1 bg-white rounded-lg shadow-lg border p-1 z-10">
          <button
            onClick={() => handleExport('pdf')}
            className="block w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 rounded"
          >
            PDF
          </button>
          <button
            onClick={() => handleExport('docx')}
            className="block w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 rounded"
          >
            Word
          </button>
          <button
            onClick={() => handleExport('md')}
            className="block w-full px-3 py-1.5 text-xs text-left hover:bg-gray-50 rounded"
          >
            Markdown
          </button>
        </div>
      )}
    </div>
  );
}
