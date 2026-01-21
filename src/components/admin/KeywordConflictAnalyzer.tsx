'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  RefreshCw,
  Download,
  ChevronDown,
  ChevronUp,
  Zap,
  Layers,
  Route,
  Copy,
  Check,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import type {
  ConflictReport,
  ConflictItem,
  ConflictSeverity,
  AnalysisScope,
} from '@/types/keyword-conflicts';

// Severity configuration
const SEVERITY_CONFIG: Record<
  ConflictSeverity,
  {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    bgColor: string;
    textColor: string;
    borderColor: string;
    label: string;
  }
> = {
  high: {
    icon: AlertTriangle,
    bgColor: 'bg-red-50',
    textColor: 'text-red-700',
    borderColor: 'border-red-200',
    label: 'High',
  },
  medium: {
    icon: AlertCircle,
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-200',
    label: 'Medium',
  },
  low: {
    icon: Info,
    bgColor: 'bg-blue-50',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-200',
    label: 'Low',
  },
};

/**
 * Conflict Card Component
 */
function ConflictCard({ conflict }: { conflict: ConflictItem }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const config = SEVERITY_CONFIG[conflict.severity];
  const Icon = config.icon;

  const handleCopySuggestion = () => {
    navigator.clipboard.writeText(conflict.suggestion);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`border rounded-lg ${config.borderColor} ${config.bgColor}`}>
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <Icon size={20} className={config.textColor} />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-medium ${config.textColor}`}>
                {conflict.keyword}
              </span>
              <span
                className={`px-2 py-0.5 text-xs rounded-full ${config.bgColor} ${config.textColor} border ${config.borderColor}`}
              >
                {config.label}
              </span>
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">
                {conflict.conflictType.replace('_', ' ')}
              </span>
            </div>
            <p className="text-sm text-gray-600 mt-0.5">{conflict.description}</p>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="px-4 py-3 border-t bg-white/50">
          {/* Sources */}
          <div className="mb-3">
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Affected Sources:
            </h4>
            <div className="flex flex-wrap gap-2">
              {conflict.sources.map((source) => (
                <span
                  key={`${source.type}-${source.id}`}
                  className={`px-2 py-1 text-sm rounded flex items-center gap-1 ${
                    source.type === 'skill'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {source.type === 'skill' ? (
                    <Layers size={12} />
                  ) : (
                    <Route size={12} />
                  )}
                  {source.name}
                  <span className="text-xs opacity-70">(P:{source.priority})</span>
                </span>
              ))}
            </div>
          </div>

          {/* Suggestion */}
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Zap size={16} className="text-green-600 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-sm font-medium text-green-700">
                    Suggestion:
                  </span>
                  <p className="text-sm text-green-800 mt-1">
                    {conflict.suggestion}
                  </p>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopySuggestion();
                }}
                className="p-1 hover:bg-green-100 rounded"
                title="Copy suggestion"
              >
                {copied ? (
                  <Check size={14} className="text-green-600" />
                ) : (
                  <Copy size={14} className="text-green-600" />
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main Keyword Conflict Analyzer Component
 */
export default function KeywordConflictAnalyzer() {
  const [report, setReport] = useState<ConflictReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>('keywords');

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/keyword-conflicts/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeInactive, analysisScope }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      setReport(data.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (!report) return;

    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keyword-conflict-report-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-amber-500" size={24} />
            <div>
              <h2 className="font-semibold text-gray-900">
                Keyword Conflict Analyzer
              </h2>
              <p className="text-sm text-gray-500">
                Detect conflicts between skills and tool routing keywords
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {/* Analysis Scope */}
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm text-gray-600">Analyze:</span>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="analysisScope"
                  value="keywords"
                  checked={analysisScope === 'keywords'}
                  onChange={() => setAnalysisScope('keywords')}
                  className="text-blue-600"
                />
                Keywords
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="analysisScope"
                  value="prompts"
                  checked={analysisScope === 'prompts'}
                  onChange={() => setAnalysisScope('prompts')}
                  className="text-blue-600"
                />
                Prompts
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="analysisScope"
                  value="both"
                  checked={analysisScope === 'both'}
                  onChange={() => setAnalysisScope('both')}
                  className="text-blue-600"
                />
                Both
              </label>
            </div>
            {/* Token usage warning */}
            {analysisScope !== 'keywords' && (
              <p className="text-xs text-amber-600">
                Note: Prompt analysis uses more tokens and may take longer.
              </p>
            )}
            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(e) => setIncludeInactive(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Include inactive
              </label>
              {report && (
                <Button variant="secondary" onClick={handleExport}>
                  <Download size={16} className="mr-2" />
                Export
              </Button>
            )}
            <Button onClick={handleAnalyze} loading={loading}>
              <RefreshCw size={16} className="mr-2" />
              {loading ? 'Analyzing...' : 'Analyze Now'}
            </Button>
          </div>
        </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="px-6 py-4 bg-red-50 border-b flex items-center gap-3">
            <AlertCircle size={20} className="text-red-600" />
            <span className="text-red-700">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-600"
            >
              ×
            </button>
          </div>
        )}

        {/* Stats */}
        {report && (
          <div className="px-6 py-4 border-b bg-gray-50">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-gray-500">Skills Analyzed</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {report.stats.activeSkills}
                  <span className="text-sm text-gray-400 font-normal">
                    /{report.stats.totalSkills}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Routing Rules</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {report.stats.activeRoutingRules}
                  <span className="text-sm text-gray-400 font-normal">
                    /{report.stats.totalRoutingRules}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Unique Keywords</p>
                <p className="text-2xl font-semibold text-gray-900">
                  {report.stats.uniqueSkillKeywords +
                    report.stats.uniqueRoutingKeywords}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Conflicts Found</p>
                <p className="text-2xl font-semibold flex items-center gap-2">
                  <span className="text-red-600">{report.conflictCounts.high}</span>
                  <span className="text-amber-600">
                    {report.conflictCounts.medium}
                  </span>
                  <span className="text-blue-600">{report.conflictCounts.low}</span>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Report Content */}
      {report && (
        <>
          {/* Summary */}
          <div className="bg-white rounded-lg border shadow-sm p-6">
            <h3 className="font-medium text-gray-900 mb-2">Summary</h3>
            <p className="text-gray-600">{report.summary}</p>

            {report.recommendations.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">
                  Recommendations:
                </h4>
                <ul className="list-disc list-inside space-y-1">
                  {report.recommendations.map((rec, i) => (
                    <li key={i} className="text-sm text-gray-600">
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Conflicts List */}
          {report.conflicts.length > 0 ? (
            <div className="space-y-3">
              <h3 className="font-medium text-gray-900">
                Conflicts ({report.conflicts.length})
              </h3>
              {report.conflicts.map((conflict) => (
                <ConflictCard key={conflict.id} conflict={conflict} />
              ))}
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
              <CheckCircle size={32} className="text-green-600 mx-auto mb-2" />
              <h3 className="font-medium text-green-700">No Conflicts Found</h3>
              <p className="text-sm text-green-600">
                Your keyword configurations appear to be well-organized.
              </p>
            </div>
          )}

          {/* Analysis Metadata */}
          <p className="text-xs text-gray-400 text-right">
            Analyzed at {new Date(report.generatedAt).toLocaleString()} using{' '}
            {report.analysisModel}
          </p>
        </>
      )}

      {/* Initial State */}
      {!report && !loading && !error && (
        <div className="bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg p-8 text-center">
          <AlertTriangle size={32} className="text-gray-400 mx-auto mb-3" />
          <h3 className="font-medium text-gray-700 mb-1">No Analysis Run Yet</h3>
          <p className="text-sm text-gray-500 mb-4">
            Click &quot;Analyze Now&quot; to detect keyword conflicts between
            skills and tool routing rules.
          </p>
          <Button onClick={handleAnalyze}>
            <RefreshCw size={16} className="mr-2" />
            Start Analysis
          </Button>
        </div>
      )}
    </div>
  );
}
