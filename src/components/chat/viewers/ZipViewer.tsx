'use client';

import { FileArchive, FileText } from 'lucide-react';
import type { ArtifactCanvasItem } from '@/types';

interface ZipViewerProps {
  artifact: ArtifactCanvasItem;
}

export default function ZipViewer({ artifact }: ZipViewerProps) {
  const entries = artifact.zipEntries || [];

  return (
    <div className="w-full h-full overflow-auto bg-white p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-amber-100 rounded-lg">
          <FileArchive size={24} className="text-amber-600" />
        </div>
        <div>
          <h4 className="text-sm font-medium text-gray-900">{artifact.title}</h4>
          <p className="text-xs text-gray-500">{entries.length} file{entries.length === 1 ? '' : 's'}</p>
        </div>
        <a
          href={artifact.downloadUrl}
          download
          className="ml-auto px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          Download ZIP
        </a>
      </div>

      {entries.length > 0 ? (
        <ul className="border rounded-lg divide-y">
          {entries.map((entry, idx) => (
            <li key={idx} className="flex items-center gap-2 px-3 py-2">
              <FileText size={14} className="text-gray-400" />
              <span className="text-sm text-gray-700 flex-1 truncate">{entry.name}</span>
              {typeof entry.size === 'number' ? (
                <span className="text-xs text-gray-500">{formatBytes(entry.size)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">Archive contents not available.</p>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}
