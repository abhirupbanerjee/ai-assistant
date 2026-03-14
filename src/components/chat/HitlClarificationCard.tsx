'use client';

import { useState, useEffect, useCallback } from 'react';
import { MessageCircleQuestion, Clock, SkipForward, X } from 'lucide-react';
import type {
  PreflightClarificationEvent,
  HitlClarificationEvent,
  ClarificationQuestion,
  HitlAction,
} from '@/types/compliance';

type HitlMode = 'preflight' | 'post-response';

interface HitlClarificationCardProps {
  event: PreflightClarificationEvent | HitlClarificationEvent;
  mode: HitlMode;
  onSubmit: (responses: Record<string, string>, freeTextInputs: Record<string, string>) => void;
  onFallback: (action: HitlAction) => void;
  disabled?: boolean;
}

export default function HitlClarificationCard({
  event,
  mode,
  onSubmit,
  onFallback,
  disabled = false,
}: HitlClarificationCardProps) {
  const questions = event.questions;
  const timeoutMs = mode === 'preflight'
    ? (event as PreflightClarificationEvent).timeoutMs
    : 0;
  const skillName = mode === 'preflight'
    ? (event as PreflightClarificationEvent).skillName
    : undefined;

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [remainingMs, setRemainingMs] = useState(timeoutMs);
  const [submitted, setSubmitted] = useState(false);

  // Countdown timer
  useEffect(() => {
    if (!timeoutMs || timeoutMs <= 0 || submitted) return;

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
  }, [timeoutMs, submitted]);

  // Auto-skip on timeout
  useEffect(() => {
    if (remainingMs === 0 && timeoutMs > 0 && !submitted) {
      onFallback('continue');
      setSubmitted(true);
    }
  }, [remainingMs, timeoutMs, submitted, onFallback]);

  const handleSelect = useCallback((questionId: string, optionId: string) => {
    if (disabled || submitted) return;
    setSelections(prev => ({ ...prev, [questionId]: optionId }));
  }, [disabled, submitted]);

  const handleFreeText = useCallback((questionId: string, text: string) => {
    if (disabled || submitted) return;
    setFreeText(prev => ({ ...prev, [questionId]: text }));
  }, [disabled, submitted]);

  const handleSubmit = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    onSubmit(selections, freeText);
  }, [submitted, selections, freeText, onSubmit]);

  const handleSkip = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    onFallback('continue');
  }, [submitted, onFallback]);

  const handleCancel = useCallback(() => {
    if (submitted) return;
    setSubmitted(true);
    onFallback('cancel');
  }, [submitted, onFallback]);

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
  };

  const hasAnySelection = Object.keys(selections).length > 0 || Object.values(freeText).some(t => t.trim());

  if (submitted) {
    return (
      <div className="my-3 p-4 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-500">
        {hasAnySelection ? 'Clarification submitted — generating response...' : 'Skipped — generating response...'}
      </div>
    );
  }

  return (
    <div className="my-3 rounded-lg border border-blue-200 bg-blue-50/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-blue-100/60 border-b border-blue-200">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
          <MessageCircleQuestion className="w-4 h-4" />
          <span>
            {mode === 'preflight' ? 'Quick clarification' : 'Clarification needed'}
            {skillName && <span className="font-normal text-blue-600"> — {skillName}</span>}
          </span>
        </div>
        {timeoutMs > 0 && remainingMs > 0 && (
          <div className="flex items-center gap-1 text-xs text-blue-600">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatTime(remainingMs)}</span>
          </div>
        )}
      </div>

      {/* Questions */}
      <div className="p-4 space-y-4">
        {questions.map((q: ClarificationQuestion) => (
          <QuestionBlock
            key={q.id}
            question={q}
            selectedOption={selections[q.id]}
            freeTextValue={freeText[q.id] || ''}
            onSelect={(optionId) => handleSelect(q.id, optionId)}
            onFreeText={(text) => handleFreeText(q.id, text)}
            disabled={disabled}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-blue-200 bg-blue-50/30">
        <div className="flex gap-2">
          <button
            onClick={handleSkip}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Skip
          </button>
          <button
            onClick={handleCancel}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            Cancel
          </button>
        </div>
        <button
          onClick={handleSubmit}
          disabled={disabled || !hasAnySelection}
          className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

// ============ Question Block ============

interface QuestionBlockProps {
  question: ClarificationQuestion;
  selectedOption: string | undefined;
  freeTextValue: string;
  onSelect: (optionId: string) => void;
  onFreeText: (text: string) => void;
  disabled: boolean;
}

function QuestionBlock({
  question,
  selectedOption,
  freeTextValue,
  onSelect,
  onFreeText,
  disabled,
}: QuestionBlockProps) {
  return (
    <div>
      {question.context && (
        <p className="text-xs text-gray-500 mb-1">{question.context}</p>
      )}
      <p className="text-sm font-medium text-gray-800 mb-2">{question.question}</p>

      {/* Option chips */}
      <div className="flex flex-wrap gap-2">
        {question.options.map(option => (
          <button
            key={option.id}
            onClick={() => onSelect(option.id)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              selectedOption === option.id
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 hover:border-gray-300'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            title={option.description}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Free text input */}
      {question.allowFreeText && (
        <input
          type="text"
          value={freeTextValue}
          onChange={(e) => onFreeText(e.target.value)}
          placeholder="Or type your answer..."
          disabled={disabled}
          className="mt-2 w-full px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
        />
      )}
    </div>
  );
}
