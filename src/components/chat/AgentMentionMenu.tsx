'use client';

import { useState, useEffect, useMemo } from 'react';
import { User, Brain, Search, Edit3, Presentation, CheckCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface AgentMenuEntry {
  id: string;
  name: string;
  roleFamily: string;
  categoryId: number | null;
}

const ROLE_ICONS: Record<string, LucideIcon> = {
  planner: Brain,
  executor: Edit3,
  critic: CheckCircle,
  researcher: Search,
  presenter: Presentation,
};

const ROLE_COLORS: Record<string, string> = {
  planner: 'bg-purple-100 text-purple-700',
  executor: 'bg-blue-100 text-blue-700',
  critic: 'bg-amber-100 text-amber-700',
  researcher: 'bg-green-100 text-green-700',
  presenter: 'bg-pink-100 text-pink-700',
};

interface AgentMentionMenuProps {
  query: string;
  activeCategoryId?: number;
  onSelect: (agentId: string) => void;
  onDismiss: () => void;
}

export default function AgentMentionMenu({
  query,
  activeCategoryId,
  onSelect,
  onDismiss,
}: AgentMentionMenuProps) {
  const [agents, setAgents] = useState<AgentMenuEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = activeCategoryId ? `?categoryId=${activeCategoryId}` : '';
    fetch(`/api/chat/agents${params}`)
      .then((r) => r.json())
      .then((data) => {
        setAgents(data.agents || []);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [activeCategoryId]);

  const filtered = useMemo(() => {
    if (!query) return agents;
    const q = query.toLowerCase();
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().startsWith(q)
    );
  }, [agents, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].id);
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filtered, selectedIndex, onSelect, onDismiss]);

  if (loading) {
    return (
      <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[320px] p-3 dark:bg-gray-800 dark:border-gray-700">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading agents...</div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[320px] p-3 dark:bg-gray-800 dark:border-gray-700">
        <div className="text-sm text-gray-500 dark:text-gray-400">No agents found</div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[320px] max-h-[300px] overflow-y-auto dark:bg-gray-800 dark:border-gray-700">
      {filtered.map((agent, idx) => {
        const Icon = ROLE_ICONS[agent.roleFamily] || User;
        const roleColor = ROLE_COLORS[agent.roleFamily] || 'bg-gray-100 text-gray-700';
        return (
          <button
            key={agent.id}
            type="button"
            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
              idx === selectedIndex
                ? 'bg-blue-50 dark:bg-blue-900/20'
                : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
            }`}
            onClick={() => onSelect(agent.id)}
            onMouseEnter={() => setSelectedIndex(idx)}
          >
            <Icon size={16} className="text-gray-500 dark:text-gray-400 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                @{agent.name}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {agent.id}
              </div>
            </div>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium capitalize flex-shrink-0 ${roleColor}`}
            >
              {agent.roleFamily}
            </span>
          </button>
        );
      })}
    </div>
  );
}
