'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Download, GitCommit, TrendingUp, TrendingDown, Minus, Globe } from 'lucide-react';
import type { CitationTrajectoryEntry, TrajectorySummary } from '@/lib/db/citation-trajectory';

interface CitationTrajectoryCardProps {
  messageId: string;
  threadId: string;
}

/**
 * Visual card showing the retrieval trajectory for a message's sources.
 * Displays how each chunk moved through the pipeline: raw vector score → reranker → selection.
 */
export default function CitationTrajectoryCard({ messageId, threadId }: CitationTrajectoryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState<TrajectorySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expanded || summary) return;

    const fetchTrajectory = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/chat/${threadId}/messages/${messageId}/trajectory`);
        if (!res.ok) throw new Error('Failed to load trajectory');
        const data = await res.json();
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchTrajectory();
  }, [expanded, messageId, threadId, summary]);

  const handleExportJSON = async () => {
    if (!summary) return;
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trajectory-${messageId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Check if entry is a web source
  const isWebSource = (entry: CitationTrajectoryEntry): boolean => {
    return entry.sourceType === 'web';
  };

  // Score bar color based on value
  const scoreColor = (score: number | null): string => {
    if (score === null) return 'bg-gray-200';
    if (score >= 0.8) return 'bg-green-500';
    if (score >= 0.6) return 'bg-blue-500';
    if (score >= 0.4) return 'bg-yellow-500';
    return 'bg-gray-400';
  };

  // Rank change indicator
  const RankChange = ({ before, after }: { before: number | null; after: number | null }) => {
    if (before === null || after === null) return <Minus size={14} className="text-gray-400" />;
    if (after < before) return <TrendingUp size={14} className="text-green-500" />;
    if (after > before) return <TrendingDown size={14} className="text-red-500" />;
    return <Minus size={14} className="text-gray-400" />;
  };

  // Strip [WEB] prefix from document name for display
  const formatDocumentName = (entry: CitationTrajectoryEntry): string => {
    if (isWebSource(entry)) {
      return entry.documentName.replace(/^\[WEB\]\s*/i, '');
    }
    return entry.documentName;
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors w-full text-left"
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <GitCommit size={14} />
        <span>Citation Trajectory</span>
        {summary && (
          <span className="text-xs text-gray-400 font-normal ml-1">
            ({summary.totalChunksRetrieved} chunks · {summary.documentCount} docs)
          </span>
        )}
        {loading && (
          <span className="text-xs text-gray-400 font-normal ml-1 animate-pulse">
            Loading...
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Loading state */}
          {loading && !summary && (
            <div className="text-xs text-gray-400 text-center py-2">
              Loading trajectory data...
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="text-xs text-red-500 text-center py-2">
              {error}
            </div>
          )}

          {/* Summary stats */}
          {summary && (
            <div className="flex items-center gap-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              <span>
                Retrieved: <strong>{summary.totalChunksRetrieved}</strong>
              </span>
              <span className="text-gray-300">|</span>
              <span>
                Passed threshold: <strong>{summary.chunksPassedThreshold}</strong>
              </span>
              <span className="text-gray-300">|</span>
              <span>
                In context: <strong>{summary.chunksInFinalContext}</strong>
              </span>
              <span className="text-gray-300">|</span>
              <span>
                Documents: <strong>{summary.documentCount}</strong>
              </span>
            </div>
          )}

          {/* Trajectory entries */}
          {summary && summary.entries.length > 0 && (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {summary.entries.map((entry, i) => {
                const isWeb = isWebSource(entry);
                return (
                <div
                  key={i}
                  className={`rounded-lg px-3 py-2 text-xs ${
                    isWeb
                      ? 'bg-purple-50 border border-purple-100'
                      : entry.wasSelected
                        ? 'bg-blue-50 border border-blue-100'
                        : 'bg-gray-50 border border-gray-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {isWeb && <Globe size={12} className="text-purple-500 flex-shrink-0" />}
                        <span className="font-medium text-gray-700 truncate block">
                          {formatDocumentName(entry)}
                        </span>
                      </div>
                      {isWeb ? (
                        <span className="text-purple-400">Web Search Result</span>
                      ) : entry.pageNumber > 0 ? (
                        <span className="text-gray-400">Page {entry.pageNumber}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Source type badge */}
                      {isWeb ? (
                        <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 font-medium text-[10px] flex items-center gap-1">
                          <Globe size={10} />
                          Web
                        </span>
                      ) : entry.wasSelected ? (
                        <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-medium text-[10px]">
                          Selected
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium text-[10px]">
                          Filtered
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Score bars - show Vector/Reranker for vector sources, Relevance for web sources */}
                  {isWeb ? (
                    /* Web source: show Tavily relevance score */
                    <div className="mt-1.5 flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] text-purple-400">Relevance</span>
                          <span className="text-[10px] text-purple-600">
                            {entry.rawScore !== null ? entry.rawScore.toFixed(3) : '—'}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${scoreColor(entry.rawScore)}`}
                            style={{ width: `${Math.min((entry.rawScore ?? 0) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Vector source: show Vector and Reranker scores */
                    <div className="mt-1.5 flex items-center gap-3">
                      {/* Raw score */}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] text-gray-400">Vector</span>
                          <span className="text-[10px] text-gray-500">
                            {entry.rawScore !== null ? entry.rawScore.toFixed(3) : '—'}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${scoreColor(entry.rawScore)}`}
                            style={{ width: `${Math.min((entry.rawScore ?? 0) * 100, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Reranker score */}
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] text-gray-400">Reranker</span>
                          <span className="text-[10px] text-gray-500">
                            {entry.rerankedScore !== null ? entry.rerankedScore.toFixed(3) : '—'}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${scoreColor(entry.rerankedScore)}`}
                            style={{ width: `${Math.min((entry.rerankedScore ?? 0) * 100, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Rank change */}
                      <div className="flex items-center gap-1 text-[10px] text-gray-400 flex-shrink-0">
                        <RankChange before={entry.rankBefore} after={entry.rankAfter} />
                        <span>
                          {entry.rankBefore !== null ? `#${entry.rankBefore}` : '—'}
                          {' → '}
                          {entry.rankAfter !== null ? `#${entry.rankAfter}` : '—'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Web source info line */}
                  {isWeb && (
                    <div className="mt-1.5 text-[10px] text-purple-400 flex items-center gap-1">
                      <span>Retrieved via web search</span>
                      <span className="text-gray-300">·</span>
                      <span>Always included in context</span>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {summary && summary.entries.length === 0 && (
            <div className="text-xs text-gray-400 text-center py-2">
              No trajectory data available for this message.
            </div>
          )}

          {/* Export button */}
          {summary && summary.entries.length > 0 && (
            <button
              onClick={handleExportJSON}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
            >
              <Download size={12} />
              Export JSON
            </button>
          )}
        </div>
      )}
    </div>
  );
}
