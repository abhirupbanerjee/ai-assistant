'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle, Zap, Brain, Code, Eye } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';

interface LeaderboardEntry {
  dimension: string;
  label: string;
  description: string;
  samplePrompt: string;
  winner: {
    modelId: string;
    displayName: string;
    dominantFactor: string;
  } | null;
  runnerUp: {
    modelId: string;
    displayName: string;
    score: number;
  } | null;
  totalCandidates: number;
  error?: string;
}

const DIMENSION_ICONS: Record<string, React.ReactNode> = {
  function_calling: <Zap size={18} className="text-amber-500" />,
  reasoning: <Brain size={18} className="text-purple-500" />,
  code_quality: <Code size={18} className="text-blue-500" />,
  visual_reasoning: <Eye size={18} className="text-green-500" />,
};

export default function AutoModelLeaderboard() {
  const [data, setData] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/auto-model-leaderboard');
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to load (${res.status})`);
      }
      const json = await res.json();
      setData(json.leaderboard || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner size="md" />
        <span className="ml-3 text-sm text-gray-500">Running auto-selection for each category…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 py-8">
        <AlertCircle size={24} className="text-red-400" />
        <p className="text-sm text-red-600">{error}</p>
        <button onClick={fetchLeaderboard} className="text-sm text-blue-600 hover:underline flex items-center gap-1 mt-1">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-500">
        No leaderboard data available. Enable at least one model on an active route.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <Zap size={16} className="text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          <span className="font-medium">How it works:</span> The auto-selector picks the best available model for each
          task type based on capability scores, context fit, cost, speed, and user satisfaction ratings.
          Admins can influence results by adjusting model attributes (capabilities, costs, enable/disable).{' '}
          <a href="/docs/features/auto-llm" className="text-blue-600 underline hover:text-blue-800">
            Learn more
          </a>
        </div>
      </div>

      {/* Leaderboard grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.map(entry => (
          <div
            key={entry.dimension}
            className={`bg-white rounded-lg border shadow-sm ${entry.error ? 'border-red-200 bg-red-50' : ''}`}
          >
            {/* Header */}
            <div className="px-4 py-3 border-b bg-gray-50 rounded-t-lg flex items-center gap-2">
              {DIMENSION_ICONS[entry.dimension] || <Zap size={18} className="text-gray-400" />}
              <div>
                <h4 className="font-medium text-gray-900 text-sm">{entry.label}</h4>
                <p className="text-xs text-gray-500">{entry.description}</p>
              </div>
            </div>

            {/* Content */}
            <div className="px-4 py-3">
              {entry.error ? (
                <p className="text-sm text-red-600">{entry.error}</p>
              ) : entry.winner ? (
                <div className="space-y-2">
                  {/* Winner */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-lg">🥇</span>
                        <span className="font-semibold text-gray-900 text-sm">{entry.winner.displayName}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 font-mono">{entry.winner.modelId}</p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                      {entry.winner.dominantFactor}
                    </span>
                  </div>

                  {/* Sub-details */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>Sample: "{entry.samplePrompt.slice(0, 60)}…"</span>
                  </div>

                  {entry.runnerUp && (
                    <div className="pt-1.5 border-t flex items-center gap-1.5">
                      <span className="text-sm">🥈</span>
                      <span className="text-xs text-gray-600">{entry.runnerUp.displayName}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No models available</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Refresh */}
      <div className="flex justify-end">
        <button
          onClick={fetchLeaderboard}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
    </div>
  );
}
