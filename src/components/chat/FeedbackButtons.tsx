'use client';

/**
 * FeedbackButtons — thumbs-up/down on assistant messages.
 *
 * Renders below each settled assistant message (hidden during streaming).
 * Thumbs-down expands an optional correction textarea.
 * Sends POST /api/chat/feedback with the full answer and optional correction.
 */

import { useState, useCallback } from 'react';
import { ThumbsUp, ThumbsDown, Send, Check } from 'lucide-react';

interface FeedbackButtonsProps {
  /** The original user query that prompted this answer */
  query: string;
  /** The full assistant answer (accumulated from SSE chunks) */
  answer: string;
  /** The server-generated assistant message ID (from 'done' SSE event) */
  messageId: string;
  /** Thread ID for context */
  threadId?: string;
  /** Workspace ID for scoping */
  workspaceId?: string;
  /** Category slugs for scoping */
  categorySlugs?: string[];
  /** Whether the user has opted out of learning */
  allowLearning?: boolean;
}

type FeedbackState = 'idle' | 'rated-positive' | 'rated-negative' | 'submitting' | 'submitted';

export default function FeedbackButtons({
  query,
  answer,
  messageId,
  threadId,
  workspaceId,
  categorySlugs,
  allowLearning = true,
}: FeedbackButtonsProps) {
  const [state, setState] = useState<FeedbackState>('idle');
  const [correction, setCorrection] = useState('');
  const [showCorrectionInput, setShowCorrectionInput] = useState(false);

  const submitFeedback = useCallback(async (rating: 'positive' | 'negative', correctionText?: string) => {
    setState('submitting');
    try {
      const res = await fetch('/api/chat/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          answer,
          rating,
          correction: correctionText || undefined,
          threadId,
          messageId,
          workspaceId,
          categorySlugs,
        }),
      });
      if (res.ok) {
        setState('submitted');
      } else {
        // Revert on error — allow retry
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  }, [query, answer, messageId, threadId, workspaceId, categorySlugs]);

  const handleThumbsUp = useCallback(() => {
    if (state !== 'idle') return;
    submitFeedback('positive');
  }, [state, submitFeedback]);

  const handleThumbsDown = useCallback(() => {
    if (state !== 'idle') return;
    setShowCorrectionInput(true);
    setState('rated-negative');
  }, [state]);

  const handleSubmitCorrection = useCallback(() => {
    if (state !== 'rated-negative') return;
    submitFeedback('negative', correction || undefined);
    setShowCorrectionInput(false);
  }, [state, correction, submitFeedback]);

  const handleCancelCorrection = useCallback(() => {
    setShowCorrectionInput(false);
    setCorrection('');
    setState('idle');
  }, []);

  // Don't show during streaming (no messageId)
  if (!messageId) return null;

  // Submitted state — show checkmark
  if (state === 'submitted') {
    return (
      <div className="flex items-center gap-1 mt-2">
        <span className="inline-flex items-center gap-1 text-xs text-green-600">
          <Check size={14} />
          Thank you
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1">
        {/* Thumbs Up */}
        <button
          onClick={handleThumbsUp}
          disabled={state !== 'idle' || !allowLearning}
          className={`p-1.5 rounded-md transition-colors ${
            state === 'rated-positive'
              ? 'text-green-600 bg-green-50'
              : 'text-gray-400 hover:text-green-600 hover:bg-green-50 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
          title="Helpful"
          aria-label="Thumbs up — this answer was helpful"
        >
          <ThumbsUp size={15} />
        </button>

        {/* Thumbs Down */}
        <button
          onClick={handleThumbsDown}
          disabled={state !== 'idle' || !allowLearning}
          className={`p-1.5 rounded-md transition-colors ${
            state === 'rated-negative'
              ? 'text-red-600 bg-red-50'
              : 'text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
          title="Not helpful"
          aria-label="Thumbs down — this answer was not helpful"
        >
          <ThumbsDown size={15} />
        </button>

        {/* Submitting spinner */}
        {state === 'submitting' && (
          <span className="text-xs text-gray-400 ml-1">Sending...</span>
        )}
      </div>

      {/* Correction Input (thumbs-down) */}
      {showCorrectionInput && state === 'rated-negative' && (
        <div className="mt-2 flex gap-2">
          <textarea
            value={correction}
            onChange={(e) => setCorrection(e.target.value)}
            placeholder="What should the answer have said? (optional)"
            rows={2}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            autoFocus
          />
          <div className="flex flex-col gap-1">
            <button
              onClick={handleSubmitCorrection}
              className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              title="Submit feedback"
              aria-label="Submit correction feedback"
            >
              <Send size={14} />
            </button>
            <button
              onClick={handleCancelCorrection}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Cancel"
              aria-label="Cancel correction"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
