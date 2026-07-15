'use client';

import { FileText } from 'lucide-react';
import type { Source } from '@/types';

interface SourceCardProps {
  source: Source;
}

function getRelevanceColor(score: number): string {
  if (score >= 0.8) return 'bg-green-100 text-green-700';
  if (score >= 0.6) return 'bg-blue-100 text-blue-700';
  if (score >= 0.4) return 'bg-yellow-100 text-yellow-700';
  return 'bg-gray-100 text-gray-600';
}

function getRelevanceLabel(score: number): string {
  if (score >= 0.8) return 'High';
  if (score >= 0.6) return 'Good';
  if (score >= 0.4) return 'Fair';
  return 'Low';
}

export default function SourceCard({ source }: SourceCardProps) {
  const relevancePercent = Math.round(source.score * 100);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 text-sm">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 text-blue-600 min-w-0 flex-1">
          <FileText size={14} className="shrink-0" />
          <span className="font-medium truncate">{source.documentName}</span>
          {source.pageNumber > 0 && (
            <span className="text-gray-500 text-xs shrink-0">Page {source.pageNumber}</span>
          )}
        </div>
        <div className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${getRelevanceColor(source.score)}`}>
          {relevancePercent}% {getRelevanceLabel(source.score)}
        </div>
      </div>
      <p className="text-gray-600 text-xs line-clamp-2">
        {source.chunkText}
      </p>
    </div>
  );
}
