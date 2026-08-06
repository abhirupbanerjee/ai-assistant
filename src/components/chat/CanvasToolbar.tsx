'use client';

import { ArrowLeft, Download } from 'lucide-react';

interface CanvasToolbarProps {
  title: string;
  downloadUrl?: string;
  onClose: () => void;
}

export default function CanvasToolbar({ title, downloadUrl, onClose }: CanvasToolbarProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b bg-white shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onClose}
          className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
          title="Back to artifacts"
          aria-label="Back to artifacts"
        >
          <ArrowLeft size={18} />
        </button>
        <h3 className="text-sm font-medium text-gray-900 truncate" title={title}>
          {title}
        </h3>
      </div>

      {downloadUrl ? (
        <a
          href={downloadUrl}
          download
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors shrink-0"
          title="Download artifact"
        >
          <Download size={16} />
          <span className="hidden sm:inline">Download</span>
        </a>
      ) : null}
    </div>
  );
}
