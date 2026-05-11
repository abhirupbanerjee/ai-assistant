'use client';

import { MessageSquare } from 'lucide-react';
import type { StarterPrompt } from '@/types';
import StarterButtons from './StarterButtons';
import SuggestionGrid from './SuggestionGrid';

interface ChatWelcomeProps {
  title: string;
  message: string;
  starterPrompts: StarterPrompt[];
  globalStarterPrompts: StarterPrompt[];
  loadingStarters: boolean;
  loading: boolean;
  onStarterSelect: (prompt: string) => void;
}

export default function ChatWelcome({
  title,
  message,
  starterPrompts,
  globalStarterPrompts,
  loadingStarters,
  loading,
  onStarterSelect,
}: ChatWelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <MessageSquare className="w-12 h-12 text-gray-300 mb-4" />
      <h2 className="text-lg font-medium text-gray-900 mb-2">
        {title}
      </h2>
      <p className="text-gray-500 max-w-md mb-6">
        {/* Show different message based on whether we have prompts */}
        {(starterPrompts.length > 0 || (globalStarterPrompts && globalStarterPrompts.length > 0))
          ? 'Click a quick start button below or type your own question.'
          : `${message} or upload a document to check for compliance. Start by typing a question below.`
        }
      </p>

      {/* Category-specific Starter Prompts (from category data) */}
      {starterPrompts.length > 0 && (
        <div className="max-w-2xl w-full">
          <StarterButtons
            starters={starterPrompts}
            onSelect={onStarterSelect}
            disabled={loading || loadingStarters}
          />
        </div>
      )}

      {/* Global Starter Prompts (from branding) - show when no category */}
      {/* SuggestionGrid handles empty arrays with internal DEFAULT_PROMPTS fallback */}
      {!starterPrompts.length && (
        <div className="w-full">
          <SuggestionGrid
            starters={globalStarterPrompts || []}
            onSelect={onStarterSelect}
            disabled={loading}
          />
        </div>
      )}
    </div>
  );
}
