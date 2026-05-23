/**
 * SubagentPanel Component
 *
 * Card-based subagent visualization for autonomous mode.
 * Displays task cards with live telemetry, cost tracking, and expandable details.
 */

'use client';

import { useState } from 'react';
import {
  CheckCircle,
  Circle,
  Loader2,
  AlertCircle,
  SkipForward,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Wrench,
  DollarSign,
  BarChart3,
} from 'lucide-react';
import type { AutonomousPlanState, AutonomousTaskState } from '@/hooks/useStreamingChat';
import TaskCard from './TaskCard';

export interface SubagentPanelProps {
  plan: AutonomousPlanState;
  totalCost?: number;
  isPaused?: boolean;
  isStopped?: boolean;
  onSkipTask?: (taskId: number) => void;
}

function formatCost(cost?: number): string {
  if (cost === undefined || cost === null || Number.isNaN(cost)) return '$--.--';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function getCardStatus(task: AutonomousTaskState): 'pending' | 'active' | 'completed' | 'failed' | 'waiting_approval' {
  switch (task.status) {
    case 'done':
      return 'completed';
    case 'running':
      return 'active';
    case 'error':
      return 'failed';
    case 'needs_review':
      return 'waiting_approval';
    case 'skipped':
    case 'pending':
    default:
      return 'pending';
  }
}

function getCardBorderClass(status: ReturnType<typeof getCardStatus>) {
  switch (status) {
    case 'completed':
      return 'border-green-200';
    case 'active':
      return 'border-blue-300 ring-1 ring-blue-200';
    case 'failed':
      return 'border-red-200';
    case 'waiting_approval':
      return 'border-amber-200';
    default:
      return 'border-gray-200';
  }
}

function getCardBgClass(status: ReturnType<typeof getCardStatus>) {
  switch (status) {
    case 'completed':
      return 'bg-green-50/50';
    case 'active':
      return 'bg-blue-50/50';
    case 'failed':
      return 'bg-red-50/50';
    case 'waiting_approval':
      return 'bg-amber-50/50';
    default:
      return 'bg-white';
  }
}

function StatusBadge({ status }: { status: ReturnType<typeof getCardStatus> }) {
  switch (status) {
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
          <CheckCircle size={10} /> Done
        </span>
      );
    case 'active':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
          <Loader2 size={10} className="animate-spin" /> Running
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-700">
          <AlertCircle size={10} /> Failed
        </span>
      );
    case 'waiting_approval':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-700">
          <AlertCircle size={10} /> Needs Review
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
          <Circle size={10} /> Pending
        </span>
      );
  }
}

function TaskDetailCard({
  task,
  isLast,
  onSkip,
}: {
  task: AutonomousTaskState;
  isLast: boolean;
  onSkip?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cardStatus = getCardStatus(task);

  return (
    <div
      className={`rounded-lg border transition-all duration-300 ${getCardBorderClass(cardStatus)} ${getCardBgClass(cardStatus)} ${
        cardStatus === 'active' ? 'animate-pulse' : ''
      }`}
    >
      {/* Card Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-black/5 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={cardStatus} />
          <span className="text-sm font-medium text-gray-800 truncate">
            {task.description}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {task.status === 'pending' && onSkip && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSkip();
              }}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Skip this task"
            >
              <SkipForward size={12} />
            </button>
          )}
          {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </button>

      {/* Summary Line */}
      <div className="px-3 pb-2 flex items-center gap-3 text-[11px] text-gray-500">
        {task.toolsUsed && task.toolsUsed.length > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <Wrench size={10} />
            {task.toolsUsed.length} tool{task.toolsUsed.length !== 1 ? 's' : ''}
          </span>
        )}
        {task.tokensUsed !== undefined && task.tokensUsed > 0 && (
          <span className="inline-flex items-center gap-0.5">
            <BarChart3 size={10} />
            {task.tokensUsed.toLocaleString()} tokens
          </span>
        )}
        {task.status === 'running' && task.currentAction && (
          <span className="text-blue-600 truncate animate-pulse">{task.currentAction}</span>
        )}
      </div>

      {/* Expanded Detail */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-100 pt-2">
          <TaskCard task={task} isLast={isLast} onSkip={onSkip} compact={false} showCurrentAction />
        </div>
      )}
    </div>
  );
}

export default function SubagentPanel({
  plan,
  totalCost,
  isPaused = false,
  isStopped = false,
  onSkipTask,
}: SubagentPanelProps) {
  const completedCount = plan.tasks.filter((t) =>
    ['done', 'skipped', 'needs_review'].includes(t.status)
  ).length;
  const progressPercent = plan.tasks.length > 0 ? (completedCount / plan.tasks.length) * 100 : 0;
  const totalTokens = plan.stats?.tokens_used || 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Paused/Stopped Banner */}
      {(isPaused || isStopped) && (
        <div
          className={`px-4 py-2 text-sm font-medium ${
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
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-500" />
          <span className="font-semibold text-gray-900 text-sm">{plan.title}</span>
          <span className="text-xs text-gray-500">
            {completedCount}/{plan.tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {totalCost !== undefined && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100">
              <DollarSign size={10} />
              {formatCost(totalCost)}
            </span>
          )}
          {totalTokens > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100">
              <BarChart3 size={10} />
              {totalTokens.toLocaleString()} tokens
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-100">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Task Cards */}
      <div className="p-3 space-y-2">
        {plan.tasks.map((task, index) => (
          <TaskDetailCard
            key={task.id}
            task={task}
            isLast={index === plan.tasks.length - 1}
            onSkip={onSkipTask ? () => onSkipTask(task.id) : undefined}
          />
        ))}
      </div>

      {/* Stats Footer */}
      {plan.stats && (
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
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
        </div>
      )}
    </div>
  );
}
