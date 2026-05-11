'use client';

import { X, FileText, Globe, Youtube } from 'lucide-react';
import type { UrlSource } from '@/types';

interface AttachmentChipsRowProps {
  uploads: string[];
  urlSources: UrlSource[];
  pendingUploads: string[];
  pendingUrlSources: UrlSource[];
  onRemoveUpload: (filename: string) => void;
  onRemoveUrlSource: (filename: string) => void;
}

export default function AttachmentChipsRow({
  uploads,
  urlSources,
  pendingUploads,
  pendingUrlSources,
  onRemoveUpload,
  onRemoveUrlSource,
}: AttachmentChipsRowProps) {
  // Combine all attachments, deduplicating by filename
  // (uploads and pendingUploads may overlap since handleUploadComplete adds to both)
  const allUploads = [...new Set([...uploads, ...pendingUploads])];
  // Deduplicate URL sources by filename (later entry wins for pending status)
  const allUrlSources = [...new Map(
    [...urlSources, ...pendingUrlSources].map(s => [s.filename, s])
  ).values()];
  const hasAttachments = allUploads.length > 0 || allUrlSources.length > 0;

  if (!hasAttachments) {
    return null;
  }

  const getSourceIcon = (sourceType: 'web' | 'youtube') => {
    if (sourceType === 'youtube') {
      return <Youtube size={14} className="shrink-0" />;
    }
    return <Globe size={14} className="shrink-0" />;
  };

  const getSourceLabel = (sourceType: 'web' | 'youtube') => {
    return sourceType === 'youtube' ? 'YouTube' : 'Web';
  };

  return (
    <div role="list" className="contents">
      {/* File uploads */}
      {allUploads.map((filename) => {
        const isPending = pendingUploads.includes(filename);
        return (
          <div
            key={filename}
            role="listitem"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              isPending
                ? 'bg-blue-100 text-blue-700 border border-blue-200'
                : 'bg-green-100 text-green-700 border border-green-200'
            }`}
          >
            <FileText size={12} className="shrink-0" aria-hidden="true" />
            <span className="truncate max-w-[120px]">{filename}</span>
            <button
              onClick={() => onRemoveUpload(filename)}
              className="ml-0.5 hover:opacity-70 transition-opacity"
              aria-label={`Remove file: ${filename}`}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}

      {/* URL sources */}
      {allUrlSources.map((source) => {
        const isPending = pendingUrlSources.some(s => s.filename === source.filename);
        return (
          <div
            key={source.filename}
            role="listitem"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              isPending
                ? 'bg-purple-100 text-purple-700 border border-purple-200'
                : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
            }`}
          >
            {getSourceIcon(source.sourceType)}
            <span className="truncate max-w-[120px]" title={source.title || source.originalUrl}>
              {source.title || getSourceLabel(source.sourceType)}
            </span>
            <button
              onClick={() => onRemoveUrlSource(source.filename)}
              className="ml-0.5 hover:opacity-70 transition-opacity"
              aria-label={`Remove source: ${source.title || source.originalUrl}`}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
