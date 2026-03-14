/**
 * Processing Indicator Component
 *
 * Progressive disclosure UI for streaming chat:
 * - Collapsed bar showing current phase (default)
 * - Expandable panel with skills and tool execution status
 * - Real-time updates during tool execution
 */

'use client';

import { useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Search,
  Wrench,
  Sparkles,
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
} from 'lucide-react';
import type { ProcessingDetails, StreamPhase, ToolExecutionState, UploadExtractionState, ContextTruncationWarning } from '@/types';

interface ProcessingIndicatorProps {
  details: ProcessingDetails;
  onToggleExpand: () => void;
  onAbort?: () => void;
  // Autonomous mode control
  isAutonomous?: boolean;
  isPaused?: boolean;
  isStopped?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
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
}: ProcessingIndicatorProps) {
  const phaseInfo = getPhaseInfo(details.phase);

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

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden mb-4 relative">
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
            {/* Priority: 1. Pause pending, 2. Tool running, 3. Status message, 4. Phase label */}
            {isPaused && details.phase !== 'complete'
              ? 'Pausing after current task...'
              : details.phase === 'tools' && runningTool
              ? `Running ${runningTool.displayName}...`
              : details.statusMessage || phaseInfo.label}
          </span>
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

      {/* Control Buttons */}
      {details.phase !== 'complete' && !isStopped && (
        <div className="absolute right-12 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {/* Autonomous mode controls */}
          {isAutonomous && (
            <>
              {isPaused ? (
                // Resume button when paused
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onResume?.();
                  }}
                  className="p-1.5 rounded-lg text-green-500 hover:bg-green-50 hover:text-green-600 transition-colors"
                  title="Resume execution"
                >
                  <Play size={18} />
                </button>
              ) : (
                // Pause button when running
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPause?.();
                  }}
                  className="p-1.5 rounded-lg text-yellow-500 hover:bg-yellow-50 hover:text-yellow-600 transition-colors"
                  title="Pause after current task"
                >
                  <Pause size={18} />
                </button>
              )}
              {/* Graceful stop button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStop?.();
                }}
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
              onClick={(e) => {
                e.stopPropagation();
                onAbort();
              }}
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

          {/* Tools Available Section */}
          {details.toolsAvailable.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Tools Available
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {details.toolsAvailable.map((tool, i) => (
                  <span
                    key={i}
                    className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
                  >
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tools Executed Section */}
          {details.toolsExecuted.length > 0 && (
            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Tool Execution
              </h4>
              <div className="space-y-1.5">
                {details.toolsExecuted.map((tool, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      {getToolStatusIcon(tool.status)}
                      <span className={tool.status === 'error' ? 'text-red-600' : 'text-gray-700'}>
                        {tool.displayName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {tool.duration && (
                        <span className="text-xs text-gray-400">
                          {formatDuration(tool.duration)}
                        </span>
                      )}
                      {tool.error && (
                        <span className="text-xs text-red-500 max-w-[200px] truncate" title={tool.error}>
                          {tool.error}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
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
                    {/* Content Preview */}
                    {upload.contentPreview && upload.status === 'success' && (
                      <div className="mt-1.5 text-xs text-gray-500 bg-white rounded p-1.5 border border-gray-100">
                        <span className="line-clamp-2">{upload.contentPreview}</span>
                      </div>
                    )}
                    {/* Error message */}
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
          {details.skills.length === 0 && details.toolsAvailable.length === 0 && details.toolsExecuted.length === 0 && (!details.userUploads || details.userUploads.length === 0) && (!details.truncationWarnings || details.truncationWarnings.length === 0) && (
            <p className="text-sm text-gray-500 text-center py-2">
              No additional processing details
            </p>
          )}
        </div>
      )}
    </div>
  );
}
