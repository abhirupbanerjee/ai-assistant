'use client';

import { useState } from 'react';
import { Bot, Users } from 'lucide-react';

export type ChatMode = 'normal' | 'autonomous' | 'swarm';

interface ModeToggleProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  disabled?: boolean;
  adminDisabled?: boolean;
  swarmAdminDisabled?: boolean;
}

export default function ModeToggle({
  mode,
  onModeChange,
  disabled,
  adminDisabled,
  swarmAdminDisabled,
}: ModeToggleProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const isDisabled = disabled || (mode === 'autonomous' && adminDisabled) || (mode === 'swarm' && swarmAdminDisabled);

  const cycleMode = () => {
    if (disabled) return;
    // Cycle: normal → autonomous → swarm → normal
    // Skip modes that are admin-disabled
    if (mode === 'normal') {
      if (!adminDisabled) {
        onModeChange('autonomous');
      } else if (!swarmAdminDisabled) {
        onModeChange('swarm');
      }
    } else if (mode === 'autonomous') {
      if (!swarmAdminDisabled) {
        onModeChange('swarm');
      } else {
        onModeChange('normal');
      }
    } else {
      onModeChange('normal');
    }
  };

  const getTooltipContent = () => {
    if (mode === 'autonomous' && adminDisabled) {
      return (
        <>
          <span className="font-medium text-amber-300">Autonomous mode disabled</span>
          <p className="text-gray-400 mt-0.5">Contact your administrator to enable it</p>
        </>
      );
    }
    if (mode === 'swarm' && swarmAdminDisabled) {
      return (
        <>
          <span className="font-medium text-amber-300">Agent swarm disabled</span>
          <p className="text-gray-400 mt-0.5">Contact your administrator to enable it</p>
        </>
      );
    }
    if (mode === 'autonomous') {
      return (
        <>
          <span className="font-medium text-blue-300">Autonomous mode</span>
          <span className="text-gray-300"> enabled</span>
          <p className="text-gray-400 mt-0.5">Click to switch to agent swarm</p>
        </>
      );
    }
    if (mode === 'swarm') {
      return (
        <>
          <span className="font-medium text-purple-300">Agent swarm mode</span>
          <span className="text-gray-300"> enabled</span>
          <p className="text-gray-400 mt-0.5">Click to switch to normal chat</p>
        </>
      );
    }
    return (
      <>
        <span className="font-medium">Chat mode</span>
        <p className="text-gray-400 mt-0.5">Click to enable autonomous or swarm mode</p>
      </>
    );
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={cycleMode}
        disabled={isDisabled}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        aria-pressed={mode !== 'normal'}
        aria-label={
          mode === 'swarm'
            ? 'Agent swarm mode enabled. Click to disable.'
            : mode === 'autonomous'
            ? 'Autonomous mode enabled. Click to disable.'
            : 'Enable advanced mode. AI plans and executes multi-step tasks.'
        }
        className={`p-2 rounded-lg transition-colors ${
          mode === 'swarm'
            ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
            : mode === 'autonomous'
            ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {mode === 'swarm' ? <Users size={20} /> : <Bot size={20} />}
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-50 shadow-lg">
          {getTooltipContent()}
          {/* Tooltip arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
}
