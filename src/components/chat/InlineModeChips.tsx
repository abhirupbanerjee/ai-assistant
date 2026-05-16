'use client';

import ModeToggle, { ChatMode } from './ModeToggle';
import WebSearchToggle from './WebSearchToggle';

interface InlineModeChipsProps {
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
  webSearchEnabled: boolean;
  onWebSearchToggle: (enabled: boolean) => void;
  autonomousAdminDisabled?: boolean;
  swarmAdminDisabled?: boolean;
  disabled?: boolean;
  /** If true, render vertically (for bottom sheet); otherwise horizontal (for inline) */
  vertical?: boolean;
}

export default function InlineModeChips({
  mode,
  onModeChange,
  webSearchEnabled,
  onWebSearchToggle,
  autonomousAdminDisabled,
  swarmAdminDisabled,
  disabled,
  vertical = false,
}: InlineModeChipsProps) {
  const containerClass = vertical
    ? 'flex flex-col gap-2'
    : 'flex items-center gap-2';

  return (
    <div className={containerClass}>
      <ModeToggle
        mode={mode}
        onModeChange={onModeChange}
        disabled={disabled}
        adminDisabled={autonomousAdminDisabled}
        swarmAdminDisabled={swarmAdminDisabled}
      />
      <WebSearchToggle
        enabled={webSearchEnabled}
        onToggle={onWebSearchToggle}
        disabled={disabled}
      />
    </div>
  );
}
