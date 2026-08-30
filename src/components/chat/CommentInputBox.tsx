'use client';

import { useState, useEffect, useRef } from 'react';
import { X, CornerDownLeft } from 'lucide-react';

interface CommentInputBoxProps {
  position?: { x: number; y: number };
  flipBelow?: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
  placeholder?: string;
  /** Mobile composition pins the composer above browser chrome and the keyboard. */
  mobile?: boolean;
}

export default function CommentInputBox({
  position,
  flipBelow = false,
  onSave,
  onCancel,
  placeholder = 'Add a comment…',
  mobile = false,
}: CommentInputBoxProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const trimmed = text.trim();
      if (trimmed) {
        onSave(trimmed);
      }
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  const containerClasses = mobile
    ? 'fixed z-50 left-3 right-3'
    : position
    ? 'absolute z-50 w-72'
    : 'absolute z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-80';

  return (
    <div
      className={containerClasses}
      style={
        mobile
          // Fixed controls are already anchored to the visual viewport by
          // mobile browsers when the software keyboard opens. Adding a manual
          // visualViewport inset moves the composer a second time.
          ? { bottom: 'max(0.75rem, env(safe-area-inset-bottom))' }
          : position
          ? {
              left: position.x,
              top: position.y,
              transform: flipBelow ? 'translate(-50%, 0%)' : 'translate(-50%, -100%)',
            }
          : undefined
      }
    >
      <div className="bg-white rounded-lg shadow-lg border border-gray-200 p-3">
        {position && (
          <div
            className={
              flipBelow
                ? 'absolute left-1/2 -translate-x-1/2 -top-2 w-3 h-3 bg-white border-t border-l border-gray-200 rotate-45'
                : 'absolute left-1/2 -translate-x-1/2 -bottom-2 w-3 h-3 bg-white border-b border-r border-gray-200 rotate-45'
            }
            aria-hidden="true"
          />
        )}
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <CornerDownLeft size={12} />
            Enter to save
          </span>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 p-0.5 rounded"
            aria-label="Cancel comment"
          >
            <X size={14} />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={3}
          className="w-full text-sm text-gray-900 placeholder-gray-400 bg-gray-50 rounded-md border border-gray-200 p-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <div className="flex justify-end mt-2 gap-2">
          <button
            onClick={onCancel}
            className="px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const trimmed = text.trim();
              if (trimmed) onSave(trimmed);
            }}
            disabled={!text.trim()}
            className="px-2.5 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-md transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
