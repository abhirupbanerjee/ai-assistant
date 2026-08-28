'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  MessageSquare,
  Smile,
  Briefcase,
  Zap,
  UserRound,
  Check,
  type LucideIcon,
} from 'lucide-react';
import {
  PERSONA_TONES,
  PERSONA_TONE_LABELS,
  isPersonaTone,
  type PersonaTone,
} from '@/lib/response-style';

interface ToneSelectorProps {
  selectedTone: string;
  onToneChange: (tone: string) => void;
  customToneName?: string | null;
  customToneInstruction?: string | null;
  onCustomToneChange?: (custom: { name: string | null; instruction: string | null }) => void;
  disabled?: boolean;
}

const PERSONA_TONE_ICONS: Record<PersonaTone, LucideIcon> = {
  default: MessageSquare,
  friendly: Smile,
  formal: Briefcase,
  direct: Zap,
  professional: UserRound,
  custom: Sparkles,
};

export default function ToneSelector({
  selectedTone,
  onToneChange,
  customToneName = null,
  customToneInstruction = null,
  onCustomToneChange,
  disabled,
}: ToneSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [seed, setSeed] = useState<{ name: string | null; instruction: string | null }>({
    name: null,
    instruction: null,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Seed the transient custom persona from the saved profile (Personal Memory).
  // This is read-only: edits stay transient until the Phase 3 "Save to profile".
  useEffect(() => {
    let cancelled = false;
    fetch('/api/user/memory')
      .then((response) => (response.ok ? response.json() : null))
      .then((result) => {
        if (cancelled || !result?.profile) return;
        setSeed({
          name: result.profile.customToneName ?? null,
          instruction: result.profile.customToneInstruction ?? null,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeTone: PersonaTone = isPersonaTone(selectedTone) ? selectedTone : 'default';
  const isNonDefault = selectedTone !== 'default';
  const isCustom = activeTone === 'custom';
  const ButtonIcon = PERSONA_TONE_ICONS[activeTone];

  const handleSelectTone = (tone: PersonaTone) => {
    onToneChange(tone);
    if (tone === 'custom' && onCustomToneChange) {
      // Seed from the saved persona only when no transient custom fields exist yet.
      const name = (customToneName ?? '').trim();
      const instruction = (customToneInstruction ?? '').trim();
      if (!name && !instruction) {
        onCustomToneChange({ name: seed.name, instruction: seed.instruction });
      }
    }
    setShowDropdown(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={disabled}
        onMouseEnter={() => !showDropdown && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`p-2 rounded-lg transition-colors flex items-center gap-1 ${
          isNonDefault
            ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <ButtonIcon size={20} />
      </button>

      {/* Tooltip */}
      {showTooltip && !showDropdown && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap z-50 shadow-lg">
          <span className="font-medium">Response tone</span>
          <p className="text-gray-400 mt-0.5">
            {isNonDefault ? `${PERSONA_TONE_LABELS[activeTone]} style` : 'Click to change tone'}
          </p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute bottom-full left-0 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[220px] py-1">
          <div className="px-3 py-1.5 text-xs text-gray-500 font-medium border-b border-gray-100">
            Response Tone
          </div>
          {PERSONA_TONES.map((tone) => {
            const Icon = PERSONA_TONE_ICONS[tone];
            return (
              <button
                key={tone}
                type="button"
                onClick={() => handleSelectTone(tone)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 ${
                  selectedTone === tone ? 'text-amber-700 bg-amber-50' : 'text-gray-700'
                }`}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span className="flex-1">{PERSONA_TONE_LABELS[tone]}</span>
                {selectedTone === tone && <Check size={16} />}
              </button>
            );
          })}

          {isCustom && (
            <div className="border-t border-gray-100 px-3 py-2 space-y-2">
              <label className="block">
                <span className="text-xs text-gray-500">Persona name</span>
                <input
                  type="text"
                  value={customToneName ?? ''}
                  maxLength={60}
                  placeholder="e.g. Government Advisor"
                  onChange={(e) => onCustomToneChange?.({
                    name: e.target.value || null,
                    instruction: customToneInstruction ?? null,
                  })}
                  className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Persona instruction</span>
                <textarea
                  value={customToneInstruction ?? ''}
                  maxLength={500}
                  rows={3}
                  placeholder="Describe how you want the assistant to respond…"
                  onChange={(e) => onCustomToneChange?.({
                    name: customToneName ?? null,
                    instruction: e.target.value || null,
                  })}
                  className="mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-400">Required when using a custom persona.</span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
