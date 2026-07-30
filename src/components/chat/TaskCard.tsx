/**
 * TaskCard Component
 *
 * Shared task item visualization for autonomous mode.
 * Used by both ProcessingIndicator (compact) and SubagentPanel (full).
 */

'use client';

import {
  CheckCircle,
  Circle,
  Loader2,
  AlertCircle,
  SkipForward,
  Search,
  Sparkles,
  Eye,
  FileText,
  Image,
  BarChart3,
  Table,
  Presentation,
  Mic,
  GitBranch,
} from 'lucide-react';
import type { AutonomousTaskState } from '@/hooks/useStreamingChat';

export interface TaskCardProps {
  task: AutonomousTaskState;
  isLast?: boolean;
  onSkip?: () => void;
  /** Compact mode for ProcessingIndicator inline list */
  compact?: boolean;
  /** Show current action animation for running tasks */
  showCurrentAction?: boolean;
}

function getTaskTypeIcon(type: string) {
  switch ((type || 'unknown').toLowerCase()) {
    case 'search':
    case 'web_search':
      return <Search size={14} className="text-blue-500" />;
    case 'generate':
      return <Sparkles size={14} className="text-purple-500" />;
    case 'analyze':
    case 'extract':
    case 'compare':
    case 'validate':
      return <Eye size={14} className="text-amber-500" />;
    case 'summarize':
      return <FileText size={14} className="text-green-500" />;
    case 'document':
    case 'doc_gen':
      return <FileText size={14} className="text-blue-600" />;
    case 'image':
    case 'image_gen':
      return <Image size={14} className="text-pink-500" />;
    case 'chart':
    case 'chart_gen':
      return <BarChart3 size={14} className="text-indigo-500" />;
    case 'spreadsheet':
    case 'xlsx_gen':
      return <Table size={14} className="text-emerald-600" />;
    case 'presentation':
    case 'pptx_gen':
      return <Presentation size={14} className="text-orange-500" />;
    case 'podcast':
    case 'podcast_gen':
      return <Mic size={14} className="text-red-500" />;
    case 'diagram':
    case 'diagram_gen':
      return <GitBranch size={14} className="text-cyan-500" />;
    default:
      return <Circle size={14} className="text-gray-400" />;
  }
}

function getStatusIcon(status: AutonomousTaskState['status']) {
  switch (status) {
    case 'done':
      return <CheckCircle size={16} className="text-green-500" />;
    case 'running':
      return <Loader2 size={16} className="text-blue-500 animate-spin" />;
    case 'skipped':
      return <SkipForward size={16} className="text-gray-400" />;
    case 'needs_review':
      return <AlertCircle size={16} className="text-amber-500" />;
    case 'error':
      return <AlertCircle size={16} className="text-red-500" />;
    default:
      return <Circle size={16} className="text-gray-300" />;
  }
}

function getStatusColorClass(status: AutonomousTaskState['status']) {
  switch (status) {
    case 'done':
      return 'bg-green-50 border-green-200';
    case 'running':
      return 'bg-blue-50 border-blue-200';
    case 'skipped':
      return 'bg-gray-50 border-gray-200';
    case 'needs_review':
      return 'bg-amber-50 border-amber-200';
    case 'error':
      return 'bg-red-50 border-red-200';
    default:
      return 'bg-white border-gray-100';
  }
}

function formatExecutorProfile(profile?: AutonomousTaskState['executorProfile']): string {
  if (!profile) return '';
  return profile.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

export default function TaskCard({
  task,
  isLast = false,
  onSkip,
  compact = false,
  showCurrentAction = true,
}: TaskCardProps) {
  const padding = compact ? 'p-1.5 text-xs mb-1' : 'p-2 text-sm mb-2';
  const gap = compact ? 'gap-2' : 'gap-3';
  const iconGap = compact ? 'gap-1.5' : 'gap-2';
  const minLineHeight = compact ? 'min-h-[16px]' : 'min-h-[24px]';

  return (
    <div className={`flex items-start ${gap}`}>
      {/* Status line */}
      <div className="flex flex-col items-center">
        <div className="flex-shrink-0">{getStatusIcon(task.status)}</div>
        {!isLast && (
          <div
            className={`w-0.5 flex-1 ${minLineHeight} mt-0.5 ${
              task.status === 'done' ? 'bg-green-300' : 'bg-gray-200'
            }`}
          />
        )}
      </div>

      {/* Task content */}
      <div className={`flex-1 rounded border ${padding} ${getStatusColorClass(task.status)}`}>
        <div className="flex items-center justify-between gap-1">
          <div className={`flex items-center ${iconGap}`}>
            {getTaskTypeIcon(task.type)}
            <span className="font-medium text-gray-700">{task.description}</span>
            {task.executorProfile && (
              <span
                className={`rounded bg-indigo-100 text-indigo-700 font-medium ${
                  compact ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-[10px]'
                }`}
              >
                {formatExecutorProfile(task.executorProfile)}
              </span>
            )}
          </div>
          {task.status === 'pending' && onSkip && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSkip();
              }}
              className="rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Skip this task"
            >
              <SkipForward size={compact ? 12 : 14} />
            </button>
          )}
        </div>

        {/* Current action (live tool execution) */}
        {showCurrentAction && task.status === 'running' && task.currentAction && (
          <div className="mt-1 text-xs text-blue-600 animate-pulse truncate">
            {task.currentAction}
          </div>
        )}

        {/* Result text (non-compact only) */}
        {!compact && task.result && (
          <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2 whitespace-pre-wrap line-clamp-3">
            {task.result}
          </div>
        )}

        {/* Confidence */}
        {task.confidence !== undefined && task.status === 'done' && (
          <div className={`${compact ? 'mt-0.5' : 'mt-1'} text-xs text-gray-500`}>
            Confidence: {task.confidence}%
          </div>
        )}

        {/* Model used */}
        {task.executorModelUsed && (
          <div className={`${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-xs'} text-gray-500`}>
            Model: {task.executorModelUsed}
          </div>
        )}

        {/* Checker notes (non-compact only) */}
        {!compact && task.checkerNotes && (
          <div className="mt-1 text-xs text-blue-600 italic">Checker: {task.checkerNotes}</div>
        )}

        {/* Needs review */}
        {task.status === 'needs_review' && (
          <div className={`${compact ? 'mt-0.5' : 'mt-1'} text-xs text-amber-600`}>
            Needs review (confidence: {task.confidence}%)
          </div>
        )}

        {/* Per-task telemetry badges */}
        {(task.tokensUsed !== undefined ||
          task.llmCalls !== undefined ||
          task.webSearches !== undefined ||
          (task.toolsUsed && task.toolsUsed.length > 0)) && (
          <div className={`flex flex-wrap ${compact ? 'gap-1 mt-1' : 'gap-1.5 mt-1.5'}`}>
            {task.tokensUsed !== undefined && task.tokensUsed > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">
                {task.tokensUsed.toLocaleString()} tokens
              </span>
            )}
            {task.llmCalls !== undefined && task.llmCalls > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700">
                {task.llmCalls} LLM calls
              </span>
            )}
            {task.webSearches !== undefined && task.webSearches > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-100 text-cyan-700">
                {task.webSearches} searches
              </span>
            )}
            {task.toolsUsed && task.toolsUsed.length > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700">
                {task.toolsUsed.length} tools
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
