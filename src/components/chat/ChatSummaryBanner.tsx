'use client';

import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';

interface ThreadSummary {
  summary: string;
  messagesSummarized: number;
  createdAt: string;
}

interface ChatSummaryBannerProps {
  isSummarized: boolean;
  summaryData: ThreadSummary | null;
  showSummaryDetails: boolean;
  onToggleDetails: () => void;
}

/**
 * Summarization banner shown above the message list when a thread has been
 * compressed by the conversation summarizer.
 *
 * Extracted from ChatWindow (Phase 2A.1) — ~37 lines, 4 props, zero logic.
 */
export default function ChatSummaryBanner({
  isSummarized,
  summaryData,
  showSummaryDetails,
  onToggleDetails,
}: ChatSummaryBannerProps) {
  if (!isSummarized || !summaryData) return null;

  return (
    <div
      className="border-b px-6 py-3"
      style={{
        backgroundColor: 'var(--accent-lighter)',
        borderColor: 'var(--accent-border)',
      }}
    >
      <button
        onClick={onToggleDetails}
        className="w-full flex items-start justify-between gap-2 text-left"
      >
        <div className="flex items-start gap-2 min-w-0" style={{ color: 'var(--accent-text)' }}>
          <BookOpen size={18} className="shrink-0 mt-0.5" />
          <span className="text-sm font-medium min-w-0 break-words">
            This conversation has been summarized ({summaryData.messagesSummarized} messages compressed)
          </span>
        </div>
        {showSummaryDetails ? (
          <ChevronUp size={18} className="shrink-0" style={{ color: 'var(--accent-color)' }} />
        ) : (
          <ChevronDown size={18} className="shrink-0" style={{ color: 'var(--accent-color)' }} />
        )}
      </button>
      {showSummaryDetails && (
        <div
          className="mt-3 p-3 bg-white rounded-lg border"
          style={{ borderColor: 'var(--accent-border)' }}
        >
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{summaryData.summary}</p>
          <p className="text-xs text-gray-500 mt-2">
            Summarized on {new Date(summaryData.createdAt).toLocaleDateString()}
          </p>
        </div>
      )}
    </div>
  );
}
