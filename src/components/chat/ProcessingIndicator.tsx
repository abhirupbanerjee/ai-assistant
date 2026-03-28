/**
 * Processing Indicator Component
 *
 * Unified progressive disclosure UI for streaming chat:
 * - Collapsed bar showing current phase (default)
 * - Expandable panel with skills, tool execution status, and agent task progress
 * - Real-time updates during tool execution
 * - Handles both normal mode (RAG/LLM/TOOL) and agent mode (Plan/Execute/Check/Summarize)
 */

'use client';

import { useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Search,
  Wrench,
  Sparkles,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  StopCircle,
  Pause,
  Play,
  Square,
  FileText,
  Globe,
  Youtube,
  AlertCircle,
  AlertTriangle,
  Brain,
  ClipboardCheck,
  Circle,
  SkipForward,
  Eye,
  Image,
  BarChart3,
  Table,
  Presentation,
  Mic,
  GitBranch,
} from 'lucide-react';
import type { ProcessingDetails, StreamPhase, ToolExecutionState, OperationLogEntry, UploadExtractionState, ContextTruncationWarning } from '@/types';
import type { AutonomousPlanState, AutonomousTaskState } from '@/hooks/useStreamingChat';

interface ProcessingIndicatorProps {
  details: ProcessingDetails;
  onToggleExpand: () => void;
  onAbort?: () => void;
  // Agent mode control
  isAutonomous?: boolean;
  isPaused?: boolean;
  isStopped?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  // Agent task list (unified — replaces separate AutonomousTaskList)
  autonomousPlan?: AutonomousPlanState | null;
  onSkipTask?: (taskId: number) => void;
}

/**
 * Get phase display info
 */
function getPhaseInfo(phase: StreamPhase): { icon: React.ReactNode; label: string; color: string } {
  switch (phase) {
    case 'init':
      return {
        icon: <Loader2 size={16} className="animate-spin" />,
        label: 'Starting...',
        color: 'text-gray-600',
      };
    case 'rag':
      return {
        icon: <Search size={16} />,
        label: 'Searching knowledge base...',
        color: 'text-blue-600',
      };
    case 'clarifying_question':
      return {
        icon: <Pause size={16} />,
        label: 'Waiting for your input...',
        color: 'text-amber-600',
      };
    case 'tools':
      return {
        icon: <Wrench size={16} />,
        label: 'Executing tools...',
        color: 'text-purple-600',
      };
    case 'generating':
      return {
        icon: <Sparkles size={16} />,
        label: 'Generating response...',
        color: 'text-green-600',
      };
    case 'agent_planning':
      return {
        icon: <Brain size={16} className="animate-pulse" />,
        label: 'Planning tasks...',
        color: 'text-indigo-600',
      };
    case 'agent_executing':
      return {
        icon: <Wrench size={16} className="animate-spin" />,
        label: 'Executing tasks...',
        color: 'text-purple-600',
      };
    case 'agent_checking':
      return {
        icon: <ClipboardCheck size={16} />,
        label: 'Checking quality...',
        color: 'text-cyan-600',
      };
    case 'agent_summarizing':
      return {
        icon: <FileText size={16} className="animate-pulse" />,
        label: 'Summarizing results...',
        color: 'text-teal-600',
      };
    case 'complete':
      return {
        icon: <CheckCircle2 size={16} />,
        label: 'Complete',
        color: 'text-gray-600',
      };
    default:
      return {
        icon: <Loader2 size={16} className="animate-spin" />,
        label: 'Processing...',
        color: 'text-gray-600',
      };
  }
}

/**
 * Get tool status icon
 */
function getToolStatusIcon(status: ToolExecutionState['status']): React.ReactNode {
  switch (status) {
    case 'pending':
      return <div className="w-3 h-3 rounded-full bg-gray-300" />;
    case 'running':
      return <Loader2 size={12} className="animate-spin text-blue-500" />;
    case 'success':
      return <CheckCircle2 size={12} className="text-green-500" />;
    case 'error':
      return <XCircle size={12} className="text-red-500" />;
  }
}

/**
 * Format duration in ms to human readable
 */
function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Get upload source type icon
 */
function getUploadTypeIcon(sourceType: UploadExtractionState['sourceType']): React.ReactNode {
  switch (sourceType) {
    case 'file':
      return <FileText size={12} className="text-blue-500" />;
    case 'web':
      return <Globe size={12} className="text-green-500" />;
    case 'youtube':
      return <Youtube size={12} className="text-red-500" />;
  }
}

/**
 * Get upload status icon
 */
function getUploadStatusIcon(status: UploadExtractionState['status']): React.ReactNode {
  switch (status) {
    case 'pending':
      return <div className="w-3 h-3 rounded-full bg-gray-300" />;
    case 'extracting':
      return <Loader2 size={12} className="animate-spin text-blue-500" />;
    case 'success':
      return <CheckCircle2 size={12} className="text-green-500" />;
    case 'error':
      return <AlertCircle size={12} className="text-red-500" />;
  }
}

/**
 * Format content length to human readable
 */
function formatContentLength(length?: number): string {
  if (!length) return '';
  if (length < 1000) return `${length} chars`;
  return `${(length / 1000).toFixed(1)}k chars`;
}

// ============ Agent Task Components ============

function getTaskTypeIcon(type: string) {
  switch (type.toLowerCase()) {
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

function getTaskStatusIcon(status: AutonomousTaskState['status']) {
  switch (status) {
    case 'done':
      return <CheckCircle size={14} className="text-green-500" />;
    case 'running':
      return <Loader2 size={14} className="text-blue-500 animate-spin" />;
    case 'skipped':
      return <SkipForward size={14} className="text-gray-400" />;
    case 'needs_review':
      return <AlertCircle size={14} className="text-amber-500" />;
    case 'error':
      return <AlertCircle size={14} className="text-red-500" />;
    default:
      return <Circle size={14} className="text-gray-300" />;
  }
}

function getTaskStatusColor(status: AutonomousTaskState['status']) {
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

function AgentTaskItem({ task, isLast, onSkip }: {
  task: AutonomousTaskState;
  isLast: boolean;
  onSkip?: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-col items-center">
        <div className="flex-shrink-0">{getTaskStatusIcon(task.status)}</div>
        {!isLast && (
          <div className={`w-0.5 flex-1 min-h-[16px] mt-0.5 ${task.status === 'done' ? 'bg-green-300' : 'bg-gray-200'}`} />
        )}
      </div>
      <div className={`flex-1 p-1.5 rounded border text-xs mb-1 ${getTaskStatusColor(task.status)}`}>
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5">
            {getTaskTypeIcon(task.type)}
            <span className="font-medium text-gray-700">{task.description}</span>
          </div>
          {task.status === 'pending' && onSkip && (
            <button
              onClick={(e) => { e.stopPropagation(); onSkip(); }}
              className="p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Skip this task"
            >
              <SkipForward size={12} />
            </button>
          )}
        </div>
        {task.confidence !== undefined && task.status === 'done' && (
          <div className="mt-0.5 text-gray-500">Confidence: {task.confidence}%</div>
        )}
        {task.status === 'needs_review' && (
          <div className="mt-0.5 text-amber-600">Needs review (confidence: {task.confidence}%)</div>
        )}
      </div>
    </div>
  );
}

// ============ Main Component ============

export default function ProcessingIndicator({
  details,
  onToggleExpand,
  onAbort,
  isAutonomous = false,
  isPaused = false,
  isStopped = false,
  onPause,
  onResume,
  onStop,
  autonomousPlan,
  onSkipTask,
}: ProcessingIndicatorProps) {
  const phaseInfo = getPhaseInfo(details.phase);
  const isAgentPhase = details.phase.startsWith('agent_');

  // Find currently running tool for collapsed view
  const runningTool = useMemo(() => {
    return details.toolsExecuted.find(t => t.status === 'running');
  }, [details.toolsExecuted]);

  // Count completed and total tools
  const toolStats = useMemo(() => {
    const completed = details.toolsExecuted.filter(t => t.status === 'success' || t.status === 'error').length;
    const total = details.toolsExecuted.length;
    return { completed, total };
  }, [details.toolsExecuted]);

  // Agent task progress
  const agentProgress = useMemo(() => {
    if (!autonomousPlan) return null;
    const completed = autonomousPlan.tasks.filter(t => ['done', 'skipped', 'needs_review'].includes(t.status)).length;
    const total = autonomousPlan.tasks.length;
    const current = autonomousPlan.tasks.find(t => t.status === 'running');
    return { completed, total, current, percent: total > 0 ? (completed / total) * 100 : 0 };
  }, [autonomousPlan]);

  // Build collapsed label
  const collapsedLabel = useMemo(() => {
    if (isPaused && details.phase !== 'complete') return 'Pausing after current task...';
    if (isAgentPhase && agentProgress) {
      if (details.phase === 'agent_executing' && agentProgress.current) {
        return `Task ${agentProgress.completed + 1}/${agentProgress.total}: ${agentProgress.current.description.substring(0, 40)}${agentProgress.current.description.length > 40 ? '...' : ''}`;
      }
    }
    if (details.phase === 'tools' && runningTool) return `Running ${runningTool.displayName}...`;
    return details.statusMessage || phaseInfo.label;
  }, [isPaused, isAgentPhase, agentProgress, details.phase, details.statusMessage, runningTool, phaseInfo.label]);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden mb-4 relative">
      {/* Paused/Stopped Banner */}
      {(isPaused || isStopped) && isAutonomous && (
        <div className={`px-4 py-1.5 text-xs font-medium ${
          isPaused
            ? 'bg-yellow-50 text-yellow-700 border-b border-yellow-200'
            : 'bg-orange-50 text-orange-700 border-b border-orange-200'
        }`}>
          {isPaused
            ? `Paused at ${agentProgress?.completed ?? 0}/${agentProgress?.total ?? 0} tasks`
            : `Stopped at ${agentProgress?.completed ?? 0}/${agentProgress?.total ?? 0} tasks`}
        </div>
      )}

      {/* Collapsed Bar */}
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`${phaseInfo.color}`}>
            {phaseInfo.icon}
          </div>
          <span className={`text-sm font-medium ${phaseInfo.color}`}>
            {collapsedLabel}
          </span>
          {/* Phase badge */}
          {isAgentPhase && agentProgress && (
            <span className="text-xs text-gray-500">
              ({agentProgress.completed}/{agentProgress.total})
            </span>
          )}
          {details.phase === 'tools' && toolStats.total > 0 && (
            <span className="text-xs text-gray-500">
              ({toolStats.completed}/{toolStats.total})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {details.skills.length > 0 && (
            <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
              {details.skills.length} skill{details.skills.length !== 1 ? 's' : ''}
            </span>
          )}
          {details.isExpanded ? (
            <ChevronUp size={16} className="text-gray-400" />
          ) : (
            <ChevronDown size={16} className="text-gray-400" />
          )}
        </div>
      </button>

      {/* Agent Progress Bar */}
      {agentProgress && agentProgress.total > 0 && (
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
            style={{ width: `${agentProgress.percent}%` }}
          />
        </div>
      )}

      {/* Control Buttons */}
      {details.phase !== 'complete' && !isStopped && (
        <div className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-1" style={isPaused || isStopped ? { top: 'calc(50% + 12px)' } : undefined}>
          {/* Agent mode controls */}
          {isAutonomous && (
            <>
              {isPaused ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onResume?.(); }}
                  className="p-1.5 rounded-lg text-green-500 hover:bg-green-50 hover:text-green-600 transition-colors"
                  title="Resume execution"
                >
                  <Play size={18} />
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onPause?.(); }}
                  className="p-1.5 rounded-lg text-yellow-500 hover:bg-yellow-50 hover:text-yellow-600 transition-colors"
                  title="Pause after current task"
                >
                  <Pause size={18} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onStop?.(); }}
                className="p-1.5 rounded-lg text-orange-500 hover:bg-orange-50 hover:text-orange-600 transition-colors"
                title="Stop gracefully (keep completed work)"
              >
                <Square size={16} />
              </button>
            </>
          )}
          {/* Hard abort button (all modes) */}
          {onAbort && (
            <button
              onClick={(e) => { e.stopPropagation(); onAbort(); }}
              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors"
              title="Abort immediately"
            >
              <StopCircle size={18} />
            </button>
          )}
        </div>
      )}

      {/* Expanded Details */}
      {details.isExpanded && (
        <div className="border-t border-gray-200 px-4 py-3 bg-white">
          {/* Skills Section */}
          {details.skills.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Active Skills
              </h4>
              <div className="flex flex-wrap gap-2">
                {details.skills.map((skill, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-full"
                  >
                    <Zap size={10} />
                    <span>{skill.name}</span>
                    {skill.triggerReason && (
                      <span className="text-purple-400">
                        ({skill.triggerReason})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Operations — unified chronological log (RAG, MEMORY, LLM, TOOL) */}
          {((details.operationLog?.length ?? 0) > 0 || details.toolsExecuted.length > 0) && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Operations
              </h4>
              <div className="space-y-1.5">
                {[
                  ...(details.operationLog ?? []).map(e => ({ ...e, _kind: 'log' as const })),
                  ...details.toolsExecuted.map(t => ({
                    ...t,
                    _kind: 'tool' as const,
                    category: 'tool' as const,
                    timestamp: t.startTime ?? 0,
                  })),
                ]
                  .sort((a, b) => a.timestamp - b.timestamp)
                  .map((item, i) => {
                    const badgeColor =
                      item.category === 'rag' ? 'bg-blue-100 text-blue-700' :
                      item.category === 'llm' ? 'bg-amber-100 text-amber-700' :
                      item.category === 'memory' ? 'bg-purple-100 text-purple-700' :
                      'bg-green-100 text-green-700';

                    return (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${badgeColor}`}>
                            {item.category.toUpperCase()}
                          </span>
                          {item._kind === 'tool' && getToolStatusIcon((item as ToolExecutionState & { _kind: 'tool'; category: 'tool'; timestamp: number }).status)}
                          <span className={item._kind === 'tool' && (item as ToolExecutionState & { _kind: 'tool'; category: 'tool'; timestamp: number }).status === 'error' ? 'text-red-600' : 'text-gray-700'}>
                            {item._kind === 'tool'
                              ? (item as ToolExecutionState & { _kind: 'tool'; category: 'tool'; timestamp: number }).displayName
                              : (item as OperationLogEntry & { _kind: 'log' }).message}
                          </span>
                        </div>
                        {item._kind === 'tool' && (() => {
                          const t = item as ToolExecutionState & { _kind: 'tool'; category: 'tool'; timestamp: number };
                          return (t.duration || t.error) ? (
                            <div className="flex items-center gap-2">
                              {t.duration && <span className="text-gray-400">{formatDuration(t.duration)}</span>}
                              {t.error && <span className="text-red-500 max-w-[200px] truncate" title={t.error}>{t.error}</span>}
                            </div>
                          ) : null;
                        })()}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* User Uploads Section */}
          {details.userUploads && details.userUploads.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                User Uploads ({details.userUploads.length})
              </h4>
              <div className="space-y-2">
                {details.userUploads.map((upload, i) => (
                  <div
                    key={i}
                    className="bg-gray-50 rounded-lg p-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getUploadStatusIcon(upload.status)}
                        {getUploadTypeIcon(upload.sourceType)}
                        <span className={`text-sm ${upload.status === 'error' ? 'text-red-600' : 'text-gray-700'} truncate max-w-[200px]`} title={upload.filename}>
                          {upload.filename}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {upload.contentLength && upload.status === 'success' && (
                          <span className="text-xs text-gray-400">
                            {formatContentLength(upload.contentLength)}
                          </span>
                        )}
                        {upload.status === 'extracting' && (
                          <span className="text-xs text-blue-500">
                            Extracting...
                          </span>
                        )}
                      </div>
                    </div>
                    {upload.contentPreview && upload.status === 'success' && (
                      <div className="mt-1.5 text-xs text-gray-500 bg-white rounded p-1.5 border border-gray-100">
                        <span className="line-clamp-2">{upload.contentPreview}</span>
                      </div>
                    )}
                    {upload.error && (
                      <div className="mt-1.5 text-xs text-red-500">
                        {upload.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Truncation Warnings Section */}
          {details.truncationWarnings && details.truncationWarnings.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                <AlertTriangle size={12} />
                Content Truncated
              </h4>
              <div className="space-y-1.5">
                {details.truncationWarnings.map((warning, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-sm bg-amber-50 text-amber-700 rounded-lg p-2"
                  >
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="font-medium">{warning.filename}</span>
                      <p className="text-xs text-amber-600">{warning.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!autonomousPlan && details.skills.length === 0 && details.toolsAvailable.length === 0 && details.toolsExecuted.length === 0 && (!details.userUploads || details.userUploads.length === 0) && (!details.truncationWarnings || details.truncationWarnings.length === 0) && (
            <p className="text-sm text-gray-500 text-center py-2">
              No additional processing details
            </p>
          )}
        </div>
      )}
    </div>
  );
}
