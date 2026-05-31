'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Image,
  BarChart3,
  Workflow,
  FileText,
  Code,
  Presentation,
  Sheet,
  type LucideIcon,
} from 'lucide-react';
import type { SlashCommandPublic } from '@/types/slash-commands';

const ICON_MAP: Record<string, LucideIcon> = {
  Image,
  BarChart3,
  Workflow,
  FileText,
  Code,
  Presentation,
  Sheet,
};

interface SlashCommandMenuProps {
  query: string;
  onSelect: (commandKey: string) => void;
  onDismiss: () => void;
}

export default function SlashCommandMenu({ query, onSelect, onDismiss }: SlashCommandMenuProps) {
  const [commands, setCommands] = useState<SlashCommandPublic[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/chat/slash-commands')
      .then((r) => r.json())
      .then((data) => {
        setCommands(data.commands || []);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (c) =>
        c.commandKey.toLowerCase().startsWith(q) ||
        c.aliases.some((a) => a.toLowerCase().startsWith(q))
    );
  }, [commands, query]);

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
      if (e.key === 'Enter') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].commandKey);
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].commandKey);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filtered, selectedIndex, onSelect, onDismiss]);

  if (loading) {
    return (
      <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[280px] p-3">
        <div className="text-sm text-gray-500">Loading commands...</div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[280px] p-3">
        <div className="text-sm text-gray-500">No commands found</div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-full left-0 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 z-50 min-w-[280px] max-h-[300px] overflow-y-auto">
      {filtered.map((cmd, idx) => {
        const Icon = ICON_MAP[cmd.icon] || FileText;
        return (
          <button
            key={cmd.commandKey}
            type="button"
            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
              idx === selectedIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
            }`}
            onClick={() => onSelect(cmd.commandKey)}
            onMouseEnter={() => setSelectedIndex(idx)}
          >
            <Icon size={16} className="text-gray-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">
                /{cmd.commandKey}
                <span className="text-gray-400 font-normal ml-1 text-xs">
                  {cmd.aliases.filter((a) => a !== cmd.commandKey).join(', ')}
                </span>
              </div>
              <div className="text-xs text-gray-500">{cmd.description}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
