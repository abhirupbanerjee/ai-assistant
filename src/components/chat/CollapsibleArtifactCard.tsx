'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, FileText, Image as ImageIcon, Mic, GitBranch, BarChart3 } from 'lucide-react';

/**
 * Reusable collapsible wrapper for terminal-tool artifact cards.
 *
 * Replaces the old post-loop LLM summary call: instead of streaming a
 * generated paragraph naming the last artifact, the tool loop now streams a
 * one-line status marker ("Tool run completed — N artifacts generated below.")
 * and each artifact is rendered inside this card. When 2+ artifacts share a
 * turn the cards start collapsed so the user sees a compact list; a single
 * artifact expands immediately. Expanding reveals the full artifact (image,
 * document, podcast player, diagram, chart) plus its metadata — no LLM call
 * required.
 */

export type ArtifactKind = 'document' | 'image' | 'podcast' | 'diagram' | 'visualization';

const KIND_META: Record<ArtifactKind, { label: string; icon: typeof FileText; accent: string }> = {
  document: { label: 'Document', icon: FileText, accent: 'text-blue-600 bg-blue-50' },
  image: { label: 'Image', icon: ImageIcon, accent: 'text-emerald-600 bg-emerald-50' },
  podcast: { label: 'Podcast', icon: Mic, accent: 'text-purple-600 bg-purple-50' },
  diagram: { label: 'Diagram', icon: GitBranch, accent: 'text-amber-600 bg-amber-50' },
  visualization: { label: 'Chart', icon: BarChart3, accent: 'text-rose-600 bg-rose-50' },
};

export interface CollapsibleArtifactCardProps {
  /** Artifact category — drives the header icon + label. */
  kind: ArtifactKind;
  /** Primary title shown in the header (filename, image alt, podcast filename, diagram/chart title). */
  title: string;
  /** Optional secondary subtitle (file type, dimensions, duration, diagram type). */
  subtitle?: string;
  /** Start collapsed? Default true. Pass false when only one artifact in the turn. */
  defaultCollapsed?: boolean;
  /** Index within the group (0-based) — used for the "N of M" badge. */
  index?: number;
  /** Total count of artifacts in the group — shown when > 1. */
  total?: number;
  /** The full artifact body rendered when expanded. */
  children: ReactNode;
}

export default function CollapsibleArtifactCard({
  kind,
  title,
  subtitle,
  defaultCollapsed = true,
  index,
  total,
  children,
}: CollapsibleArtifactCardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const meta = KIND_META[kind] ?? KIND_META.document;
  const Icon = meta.icon;
  const showPosition = typeof index === 'number' && typeof total === 'number' && total > 1;

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        <span className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full ${meta.accent}`}>
          <Icon size={14} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800 truncate">
            <span className="truncate">{title || `${meta.label} artifact`}</span>
          </span>
          <span className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
            <span>{meta.label}</span>
            {subtitle && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{subtitle}</span>
              </>
            )}
          </span>
        </span>
        {showPosition && (
          <span className="shrink-0 text-xs text-gray-400">
            {index! + 1} / {total}
          </span>
        )}
        {collapsed ? (
          <ChevronRight size={16} className="shrink-0 text-gray-400" />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-gray-400" />
        )}
      </button>
      {!collapsed && (
        <div className="border-t border-gray-100 px-3 py-3">
          {children}
        </div>
      )}
    </div>
  );
}
