'use client';

import { useRef, useEffect } from 'react';

interface SuggestedFollowupsProps {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  disabled?: boolean;
}

/**
 * Horizontal scrollable chips showing suggested follow-up questions.
 * Appears after AI responses on mobile to help users continue conversation.
 */
export default function SuggestedFollowups({
  suggestions,
  onSelect,
  disabled,
}: SuggestedFollowupsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset scroll position when suggestions change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
    }
  }, [suggestions]);

  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className="py-2">
      <div
        ref={containerRef}
        className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {suggestions.map((suggestion, index) => (
          <button
            key={index}
            onClick={() => !disabled && onSelect(suggestion)}
            disabled={disabled}
            className={`flex-shrink-0 px-3 py-2 rounded-full text-sm border transition-colors ${
              disabled
                ? 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300 active:bg-gray-100'
            }`}
            style={{
              maxWidth: '200px',
            }}
          >
            <span className="truncate block">{suggestion}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Helper function to extract suggested follow-ups from AI response.
 * Looks for common patterns like "You might also ask:" or numbered questions.
 */
export function extractSuggestedFollowups(content: string): string[] {
  const suggestions: string[] = [];

  // Pattern 1: Look for "You might also ask:" or similar headers
  const headerPatterns = [
    /(?:you (?:might|could|can) (?:also )?ask|follow-up questions?|suggested questions?|try asking)[:\s]*\n?((?:[-•*]\s*.+\n?)+)/gi,
    /(?:related questions?|more questions?)[:\s]*\n?((?:[-•*]\s*.+\n?)+)/gi,
  ];

  for (const pattern of headerPatterns) {
    const match = pattern.exec(content);
    if (match && match[1]) {
      const lines = match[1].split('\n');
      for (const line of lines) {
        const cleaned = line.replace(/^[-•*]\s*/, '').trim();
        if (cleaned.length > 10 && cleaned.length < 100 && cleaned.endsWith('?')) {
          suggestions.push(cleaned);
        }
      }
    }
  }

  // If we found suggestions from headers, return them (max 4)
  if (suggestions.length > 0) {
    return suggestions.slice(0, 4);
  }

  // Pattern 2: Look for questions at the end of response
  const sentences = content.split(/[.!]\s+/);
  const lastFewSentences = sentences.slice(-5);

  for (const sentence of lastFewSentences) {
    const cleaned = sentence.trim();
    if (cleaned.endsWith('?') && cleaned.length > 15 && cleaned.length < 100) {
      // Skip questions that are part of explanations
      if (!cleaned.toLowerCase().startsWith('what if') &&
          !cleaned.toLowerCase().startsWith('why would') &&
          !cleaned.toLowerCase().includes('would you like')) {
        suggestions.push(cleaned);
      }
    }
  }

  return suggestions.slice(0, 3);
}
