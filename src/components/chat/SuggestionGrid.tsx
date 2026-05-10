'use client';

import { FileText, Image, GitBranch, Globe, Mic, Code } from 'lucide-react';
import type { StarterPrompt } from '@/types';

interface SuggestionGridProps {
  starters: StarterPrompt[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}

// Default icons for fallback prompts
const DEFAULT_ICONS = [
  { icon: FileText, color: 'text-blue-500', bgColor: 'bg-blue-50' },
  { icon: Image, color: 'text-purple-500', bgColor: 'bg-purple-50' },
  { icon: GitBranch, color: 'text-green-500', bgColor: 'bg-green-50' },
  { icon: Globe, color: 'text-cyan-500', bgColor: 'bg-cyan-50' },
  { icon: Mic, color: 'text-orange-500', bgColor: 'bg-orange-50' },
  { icon: Code, color: 'text-pink-500', bgColor: 'bg-pink-50' },
];

// Default prompts as fallback
const DEFAULT_PROMPTS: StarterPrompt[] = [
  { label: 'Generate Report', prompt: 'Create a docx report on the Global AI growth, insights and predictions for 2030' },
  { label: 'Create Image', prompt: 'Create an image to demonstrate the changing nature of jobs because of AI' },
  { label: 'Create Diagram', prompt: 'Create a process flow diagram for creating an agentic workflow using Claude' },
  { label: 'Search Web', prompt: 'Search web and compare the growth of OpenAI and DeepSeek models' },
  { label: 'Create Podcast', prompt: 'Create a podcast for an interview with AI expert explaining the risks around AI' },
  { label: 'Create HTML', prompt: 'Create an HTML playbook covering key insights on different AI use cases' },
];

export default function SuggestionGrid({ starters, onSelect, disabled = false }: SuggestionGridProps) {
  // Use provided starters or fallback to defaults
  const prompts = starters.length > 0 ? starters : DEFAULT_PROMPTS;

  return (
    <div className="w-full max-w-2xl mx-auto px-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {prompts.map((starter, index) => {
          const { icon: Icon, color, bgColor } = DEFAULT_ICONS[index % DEFAULT_ICONS.length];

          return (
            <button
              key={index}
              onClick={() => onSelect(starter.prompt)}
              disabled={disabled}
              className={`
                group text-left p-4 rounded-xl border-2 border-gray-200
                hover:border-blue-400 hover:shadow-md
                active:scale-[0.98]
                transition-all duration-200
                disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200
                bg-white
              `}
            >
              <div className="flex items-start gap-3">
                <div className={`
                  flex-shrink-0 w-10 h-10 rounded-lg ${bgColor}
                  flex items-center justify-center
                  group-hover:scale-110 transition-transform duration-200
                `}>
                  <Icon size={20} className={color} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 text-sm mb-1">
                    {starter.label}
                  </h3>
                  <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                    {starter.prompt}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
