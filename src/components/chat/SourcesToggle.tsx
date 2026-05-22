'use client';

import { useState } from 'react';
import { BookOpen, Lock } from 'lucide-react';

interface SourcesToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
  adminDisabled?: boolean;
}

export default function SourcesToggle({
  enabled,
  onToggle,
  disabled,
  adminDisabled,
}: SourcesToggleProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const handleToggle = () => {
    if (adminDisabled || disabled) return;
    onToggle(!enabled);
  };

  const isDisabled = disabled || adminDisabled;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isDisabled}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        aria-pressed={enabled}
        aria-label={
          adminDisabled
            ? 'Source documents disabled by admin'
            : enabled
              ? 'Sources enabled. Click to hide source documents.'
              : 'Enable sources to show retrieved source documents.'
        }
        className={`p-2 rounded-lg transition-colors ${
          enabled && !adminDisabled
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-500'
        } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <BookOpen size={20} />
        {adminDisabled && (
          <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-gray-500 rounded-full flex items-center justify-center">
            <Lock size={8} className="text-white" />
          </span>
        )}
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-50 shadow-lg">
          {adminDisabled ? (
            <>
              <span className="font-medium text-gray-300">Sources</span>
              <span className="text-gray-300"> disabled</span>
              <p className="text-gray-400 mt-0.5">Disabled by admin</p>
            </>
          ) : enabled ? (
            <>
              <span className="font-medium text-blue-300">Sources</span>
              <span className="text-gray-300"> enabled</span>
              <p className="text-gray-400 mt-0.5">Click to hide source documents</p>
            </>
          ) : (
            <>
              <span className="font-medium">Sources</span>
              <span className="text-gray-300"> disabled</span>
              <p className="text-gray-400 mt-0.5">Click to show source documents</p>
            </>
          )}
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
}
