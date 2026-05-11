'use client';

import { useState } from 'react';
import { GitCommit } from 'lucide-react';

interface CitationTrajectoryToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
}

export default function CitationTrajectoryToggle({
  enabled,
  onToggle,
  disabled,
}: CitationTrajectoryToggleProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  const handleToggle = () => {
    onToggle(!enabled);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        aria-pressed={enabled}
        aria-label={enabled ? 'Citation trajectory enabled. Click to hide retrieval path.' : 'Enable citation trajectory to show how sources were ranked.'}
        className={`p-2 rounded-lg transition-colors ${
          enabled
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-500'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <GitCommit size={20} />
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-50 shadow-lg">
          {enabled ? (
            <>
              <span className="font-medium text-blue-300">Citation trajectory</span>
              <span className="text-gray-300"> enabled</span>
              <p className="text-gray-400 mt-0.5">Click to hide retrieval path</p>
            </>
          ) : (
            <>
              <span className="font-medium">Citation trajectory</span>
              <span className="text-gray-300"> disabled</span>
              <p className="text-gray-400 mt-0.5">Click to show how sources were ranked</p>
            </>
          )}
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
}
