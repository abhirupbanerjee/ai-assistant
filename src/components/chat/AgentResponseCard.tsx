/**
 * AgentResponseCard Component
 *
 * Collapsible card that surfaces a single agent's response surfaced via the
 * `artifact` SSE event with `subtype: 'agent'` (return-result routing mode).
 *
 * Collapsed by default: shows a compact "Answered by <agent>" header with the
 * role-family icon, confidence bar, and a chevron to expand. Expanded shows the
 * agent's artifact content (text/table/structured/file_ref/error) plus an
 * optional "suggested next" reason.
 *
 * Session-only component — agent responses are not persisted to the message
 * store; this card renders from `streamingState.agentResponses` and the
 * `Message.agentResponses` session-only field.
 */

'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Table2,
  FileCode2,
  FileWarning,
  AlertTriangle,
  Brain,
  Hammer,
  Search,
  CheckCircle2,
  Presentation,
  Sparkles,
} from 'lucide-react';
import type { AgentResponseInfo } from '@/types/stream';

export interface AgentResponseCardProps {
  response: AgentResponseInfo;
  /** Default collapsed state; expanded when false. */
  defaultCollapsed?: boolean;
}

const ROLE_FAMILY_META: Record<
  AgentResponseInfo['roleFamily'],
  { label: string; icon: typeof Brain; accent: string }
> = {
  planner: { label: 'Planner', icon: Brain, accent: 'text-purple-600 bg-purple-50' },
  executor: { label: 'Executor', icon: Hammer, accent: 'text-amber-600 bg-amber-50' },
  critic: { label: 'Critic', icon: CheckCircle2, accent: 'text-rose-600 bg-rose-50' },
  researcher: { label: 'Researcher', icon: Search, accent: 'text-blue-600 bg-blue-50' },
  presenter: { label: 'Presenter', icon: Presentation, accent: 'text-emerald-600 bg-emerald-50' },
};

function ArtifactIcon({ type }: { type: AgentResponseInfo['artifact']['type'] }) {
  switch (type) {
    case 'table':
      return <Table2 size={14} className="text-gray-500 shrink-0" />;
    case 'file_ref':
      return <FileCode2 size={14} className="text-gray-500 shrink-0" />;
    case 'structured':
      return <FileText size={14} className="text-gray-500 shrink-0" />;
    case 'error':
      return <FileWarning size={14} className="text-red-500 shrink-0" />;
    case 'text':
    default:
      return <FileText size={14} className="text-gray-500 shrink-0" />;
  }
}

function formatConfidence(value: number): string {
  if (Number.isNaN(value)) return '--';
  return `${Math.round(value * 100)}%`;
}

function confidenceColor(value: number): string {
  if (value >= 0.8) return 'bg-emerald-500';
  if (value >= 0.5) return 'bg-amber-500';
  return 'bg-rose-500';
}

export default function AgentResponseCard({
  response,
  defaultCollapsed = true,
}: AgentResponseCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const meta = ROLE_FAMILY_META[response.roleFamily] ?? ROLE_FAMILY_META.executor;
  const RoleIcon = meta.icon;
  const isError = response.artifact.type === 'error';

  return (
    <div
      className={`mt-3 rounded-lg border ${isError ? 'border-red-200' : 'border-gray-200'} bg-white overflow-hidden`}
    >
      {/* Header — always visible, click to toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        <span className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full ${meta.accent}`}>
          <RoleIcon size={14} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800 truncate">
            <Sparkles size={12} className="text-gray-400 shrink-0" />
            <span className="truncate">Answered by {response.agentName}</span>
          </span>
          <span className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
            <span>{meta.label}</span>
            <span aria-hidden="true">·</span>
            <ArtifactIcon type={response.artifact.type} />
            <span className="capitalize">{response.artifact.type.replace('_', ' ')}</span>
          </span>
        </span>
        {/* Confidence bar */}
        <span className="shrink-0 flex items-center gap-1.5">
          <span className="text-xs text-gray-400">{formatConfidence(response.confidence)}</span>
          <span className="w-12 h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <span
              className={`block h-full ${confidenceColor(response.confidence)}`}
              style={{ width: `${Math.max(0, Math.min(1, response.confidence)) * 100}%` }}
            />
          </span>
        </span>
        {collapsed ? (
          <ChevronRight size={16} className="shrink-0 text-gray-400" />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-gray-400" />
        )}
      </button>

      {/* Expanded body */}
      {!collapsed && (
        <div className="border-t border-gray-100 px-3 py-3">
          {isError ? (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-md px-2 py-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <pre className="whitespace-pre-wrap break-words font-sans m-0">
                {response.artifact.content || 'Agent returned an error.'}
              </pre>
            </div>
          ) : response.artifact.type === 'table' ? (
            <div className="text-sm text-gray-700">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs bg-gray-50 rounded-md p-2 overflow-x-auto">
                {response.artifact.content}
              </pre>
            </div>
          ) : (
            <div className="text-sm text-gray-700 whitespace-pre-wrap break-words">
              {response.artifact.content}
            </div>
          )}

          {response.suggestedNextReason && (
            <div className="mt-3 pt-2 border-t border-gray-100">
              <div className="text-xs uppercase tracking-wide text-gray-400 mb-0.5">
                Suggested next
              </div>
              <div className="text-sm text-gray-600">{response.suggestedNextReason}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
