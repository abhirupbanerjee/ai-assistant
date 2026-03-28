'use client';

import { useState } from 'react';
import { Bot } from 'lucide-react';

export type ChatMode = 'normal' | 'autonomous';

interface ModeToggleProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  disabled?: boolean;
  adminDisabled?: boolean;
}

export default function ModeToggle({
  mode,
  onModeChange,
  disabled,
  adminDisabled,
}: ModeToggleProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const isAutonomous = mode === 'autonomous';
  const isDisabled = disabled || adminDisabled;

  const handleToggle = () => {
    if (adminDisabled) return;
    onModeChange(isAutonomous ? 'normal' : 'autonomous');
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isDisabled}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`p-2 rounded-lg transition-colors ${
          isAutonomous
            ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <Bot size={20} />
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-50 shadow-lg">
          {adminDisabled ? (
            <>
              <span className="font-medium text-amber-300">Autonomous mode disabled</span>
              <p className="text-gray-400 mt-0.5">Contact your administrator to enable it</p>
            </>
          ) : isAutonomous ? (
            <>
              <span className="font-medium text-purple-300">Autonomous mode</span>
              <span className="text-gray-300"> enabled</span>
              <p className="text-gray-400 mt-0.5">Click to disable</p>
            </>
          ) : (
            <>
              <span className="font-medium">Autonomous mode</span>
              <p className="text-gray-400 mt-0.5">AI plans and executes multi-step tasks</p>
            </>
          )}
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
}
