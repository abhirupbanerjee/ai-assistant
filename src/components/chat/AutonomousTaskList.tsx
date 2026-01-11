/**
 * Autonomous Task List Component
 *
 * Displays real-time progress of autonomous mode tasks with:
 * - Visual task list with status indicators
 * - Progress bar
 * - Expandable task details
 * - Tool execution tracking
 */

'use client';

import { useState } from 'react';
import {
  CheckCircle,
  Circle,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Search,
  FileText,
  Image,
  Sparkles,
  SkipForward,
  Eye,
} from 'lucide-react';
import type { AutonomousPlanState, AutonomousTaskState } from '@/hooks/useStreamingChat';
import type { ToolExecutionState } from '@/types';

interface AutonomousTaskListProps {
  plan: AutonomousPlanState;
  toolsExecuted?: ToolExecutionState[];
  isExpanded?: boolean;
  // Control state and callbacks
  isPaused?: boolean;
  isStopped?: boolean;
  onSkipTask?: (taskId: number) => void;
}

/**
 * Get icon for task type
 */
function getTaskTypeIcon(type: string) {
  switch (type.toLowerCase()) {
    case 'search':
      return <Search size={14} className="text-blue-500" />;
    case 'generate':
      return <Sparkles size={14} className="text-purple-500" />;
    case 'analyze':
      return <Eye size={14} className="text-amber-500" />;
    case 'summarize':
      return <FileText size={14} className="text-green-500" />;
    default:
      return <Circle size={14} className="text-gray-400" />;
  }
}

/**
 * Get status icon for task
 */
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

/**
 * Get status color class
 */
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

/**
 * Single task item component
 */
function TaskItem({
  task,
  isLast,
  onSkip,
}: {
  task: AutonomousTaskState;
  isLast: boolean;
  onSkip?: () => void;
}) {
  return (
    <div className="flex items-start gap-3">
      {/* Status line */}
      <div className="flex flex-col items-center">
        <div className="flex-shrink-0">{getStatusIcon(task.status)}</div>
        {!isLast && (
          <div
            className={`w-0.5 flex-1 min-h-[24px] mt-1 ${
              task.status === 'done' ? 'bg-green-300' : 'bg-gray-200'
            }`}
          />
        )}
      </div>

      {/* Task content */}
      <div
        className={`flex-1 p-2 rounded-lg border text-sm mb-2 ${getStatusColorClass(task.status)}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {getTaskTypeIcon(task.type)}
            <span className="font-medium text-gray-700">{task.description}</span>
          </div>
          {/* Skip button for pending tasks */}
          {task.status === 'pending' && onSkip && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSkip();
              }}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Skip this task"
            >
              <SkipForward size={14} />
            </button>
          )}
        </div>

        {/* Executor result text */}
        {task.result && (
          <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2 whitespace-pre-wrap">
            {task.result}
          </div>
        )}

        {/* Confidence score */}
        {task.confidence !== undefined && task.status === 'done' && (
          <div className="mt-1 text-xs text-gray-500">
            Confidence: {task.confidence}%
          </div>
        )}

        {/* Checker notes */}
        {task.checkerNotes && (
          <div className="mt-1 text-xs text-blue-600 italic">
            Checker: {task.checkerNotes}
          </div>
        )}

        {task.status === 'needs_review' && (
          <div className="mt-1 text-xs text-amber-600">
            Needs review (confidence: {task.confidence}%)
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Tool execution indicator
 */
function ToolIndicator({ tool }: { tool: ToolExecutionState }) {
  const getToolIcon = () => {
    switch (tool.name) {
      case 'doc_gen':
        return <FileText size={12} />;
      case 'image_gen':
        return <Image size={12} />;
      case 'web_search':
        return <Search size={12} />;
      default:
        return <Sparkles size={12} />;
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
        tool.status === 'running'
          ? 'bg-blue-100 text-blue-700'
          : tool.status === 'success'
            ? 'bg-green-100 text-green-700'
            : 'bg-red-100 text-red-700'
      }`}
    >
      {tool.status === 'running' ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        getToolIcon()
      )}
      <span>{tool.displayName}</span>
      {tool.duration && <span className="text-gray-500">({tool.duration}ms)</span>}
    </div>
  );
}

export default function AutonomousTaskList({
  plan,
  toolsExecuted = [],
  isExpanded: initialExpanded = true,
  isPaused = false,
  isStopped = false,
  onSkipTask,
}: AutonomousTaskListProps) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);

  // Calculate progress
  const completedCount = plan.tasks.filter(t =>
    ['done', 'skipped', 'needs_review'].includes(t.status)
  ).length;
  const progressPercent = plan.tasks.length > 0 ? (completedCount / plan.tasks.length) * 100 : 0;
  const currentTask = plan.tasks.find(t => t.status === 'running');

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {/* Paused/Stopped Status Banner */}
      {(isPaused || isStopped) && (
        <div
          className={`px-3 py-2 text-sm font-medium ${
            isPaused
              ? 'bg-yellow-50 text-yellow-700 border-b border-yellow-200'
              : 'bg-orange-50 text-orange-700 border-b border-orange-200'
          }`}
        >
          {isPaused
            ? `Paused at ${completedCount}/${plan.tasks.length} tasks`
            : `Stopped at ${completedCount}/${plan.tasks.length} tasks`}
        </div>
      )}

      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-500" />
          <span className="font-medium text-gray-900">{plan.title}</span>
          <span className="text-xs text-gray-500">
            ({completedCount}/{plan.tasks.length} tasks)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {currentTask && !isPaused && !isStopped && (
            <span className="text-xs text-blue-600 animate-pulse">
              {currentTask.description.substring(0, 30)}...
            </span>
          )}
          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Expandable content */}
      {isExpanded && (
        <div className="p-3 border-t border-gray-100">
          {/* Active tools */}
          {toolsExecuted.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3 pb-3 border-b border-gray-100">
              {toolsExecuted.map((tool, i) => (
                <ToolIndicator key={`${tool.name}-${i}`} tool={tool} />
              ))}
            </div>
          )}

          {/* Task list */}
          <div className="space-y-0">
            {plan.tasks.map((task, index) => (
              <TaskItem
                key={task.id}
                task={task}
                isLast={index === plan.tasks.length - 1}
                onSkip={onSkipTask ? () => onSkipTask(task.id) : undefined}
              />
            ))}
          </div>

          {/* Stats (when complete) */}
          {plan.stats && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="text-center p-2 bg-green-50 rounded">
                  <div className="font-medium text-green-700">{plan.stats.completed_tasks}</div>
                  <div className="text-green-600">Completed</div>
                </div>
                <div className="text-center p-2 bg-amber-50 rounded">
                  <div className="font-medium text-amber-700">{plan.stats.needs_review_tasks}</div>
                  <div className="text-amber-600">Review</div>
                </div>
                <div className="text-center p-2 bg-gray-50 rounded">
                  <div className="font-medium text-gray-700">{plan.stats.skipped_tasks}</div>
                  <div className="text-gray-600">Skipped</div>
                </div>
              </div>
              {plan.stats.average_confidence > 0 && (
                <div className="mt-2 text-center text-xs text-gray-500">
                  Average confidence: {Math.round(plan.stats.average_confidence)}%
                </div>
              )}
              {/* Token usage stats */}
              {(plan.stats.tokens_used || plan.stats.llm_calls) && (
                <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-3 gap-2 text-xs">
                  <div className="text-center p-1.5 bg-blue-50 rounded">
                    <div className="font-medium text-blue-700">
                      {plan.stats.tokens_used?.toLocaleString() || 0}
                    </div>
                    <div className="text-blue-600">Tokens</div>
                  </div>
                  <div className="text-center p-1.5 bg-purple-50 rounded">
                    <div className="font-medium text-purple-700">{plan.stats.llm_calls || 0}</div>
                    <div className="text-purple-600">LLM Calls</div>
                  </div>
                  <div className="text-center p-1.5 bg-cyan-50 rounded">
                    <div className="font-medium text-cyan-700">{plan.stats.web_searches || 0}</div>
                    <div className="text-cyan-600">Searches</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
