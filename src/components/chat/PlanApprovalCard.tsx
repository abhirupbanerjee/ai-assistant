'use client';

import { useState, useEffect, useCallback } from 'react';
import { ClipboardCheck, Clock, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import type { PlanApprovalEvent } from '@/types/stream';

interface PlanApprovalCardProps {
  event: PlanApprovalEvent;
  onApprove: (feedback?: string) => void;
  onReject: () => void;
  disabled?: boolean;
}

export default function PlanApprovalCard({
  event,
  onApprove,
  onReject,
  disabled = false,
}: PlanApprovalCardProps) {
  const [remainingMs, setRemainingMs] = useState(event.timeoutMs);
  const [submitted, setSubmitted] = useState(false);
  const [feedback, setFeedback] = useState('');

  // Countdown timer
  useEffect(() => {
    if (!event.timeoutMs || event.timeoutMs <= 0 || submitted) return;

    const interval = setInterval(() => {
      setRemainingMs(prev => {
        const next = prev - 1000;
        if (next <= 0) {
          clearInterval(interval);
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [event.timeoutMs, submitted]);

  // Auto-reject on timeout
  useEffect(() => {
    if (remainingMs === 0 && event.timeoutMs > 0 && !submitted) {
      setSubmitted(true);
      onReject();
    }
  }, [remainingMs, event.timeoutMs, submitted, onReject]);

  const handleApprove = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    onApprove(feedback || undefined);
  }, [submitted, feedback, onApprove]);

  const handleReject = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    onReject();
  }, [submitted, onReject]);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
  };

  // Task type badge colors
  const getTypeBadgeClass = (type: string): string => {
    const colorMap: Record<string, string> = {
      analyze: 'bg-blue-100 text-blue-700',
      search: 'bg-yellow-100 text-yellow-700',
      compare: 'bg-purple-100 text-purple-700',
      generate: 'bg-green-100 text-green-700',
      summarize: 'bg-gray-100 text-gray-700',
      extract: 'bg-orange-100 text-orange-700',
      validate: 'bg-red-100 text-red-700',
      synthesize: 'bg-indigo-100 text-indigo-700',
      document: 'bg-emerald-100 text-emerald-700',
      image: 'bg-pink-100 text-pink-700',
      chart: 'bg-cyan-100 text-cyan-700',
      spreadsheet: 'bg-lime-100 text-lime-700',
      presentation: 'bg-amber-100 text-amber-700',
      podcast: 'bg-violet-100 text-violet-700',
      diagram: 'bg-teal-100 text-teal-700',
    };
    return colorMap[type] || 'bg-gray-100 text-gray-600';
  };

  if (submitted) {
    return (
      <div className="my-3 p-4 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-500">
        Plan {submitted ? 'approved' : 'rejected'} — proceeding...
      </div>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-emerald-200 bg-emerald-50/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-100/60 border-b border-emerald-200">
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
          <ClipboardCheck className="w-4 h-4" />
          <span>Review plan — {event.tasks.length} tasks</span>
        </div>
        {event.timeoutMs > 0 && remainingMs > 0 && (
          <div className="flex items-center gap-1 text-xs text-emerald-600">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatTime(remainingMs)} (auto-reject)</span>
          </div>
        )}
      </div>

      {/* Title */}
      <div className="px-4 pt-3 pb-1">
        <p className="text-sm font-medium text-gray-800">{event.title}</p>
      </div>

      {/* Task List */}
      <div className="px-4 py-2 space-y-1.5 max-h-64 overflow-y-auto">
        {event.tasks.map((task, idx) => (
          <div key={task.id} className="flex items-start gap-2 text-sm">
            <span className="text-gray-400 text-xs mt-0.5 w-4 shrink-0">{idx + 1}.</span>
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${getTypeBadgeClass(task.type)}`}>
              {task.type}
            </span>
            <span className="text-gray-700 leading-snug">{task.description}</span>
            {task.tool_name && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500 shrink-0">
                <Wrench className="w-3 h-3" />
                {task.tool_name}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Feedback input */}
      <div className="px-4 py-2">
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Add instructions to revise this plan..."
          disabled={disabled}
          rows={2}
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50 resize-none"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-emerald-200 bg-emerald-50/30">
        <button
          onClick={handleReject}
          disabled={disabled}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
        >
          <XCircle className="w-3.5 h-3.5" />
          Reject
        </button>
        <button
          onClick={handleApprove}
          disabled={disabled}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {feedback.trim() ? 'Revise Plan' : 'Approve & Execute'}
        </button>
      </div>
    </div>
  );
}
