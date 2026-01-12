'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  MessageSquare,
  Minimize2,
  FileText,
  HelpCircle,
  Briefcase,
  Check,
  type LucideIcon,
} from 'lucide-react';
import { TONE_PRESETS } from '@/types/stream';

interface ToneSelectorProps {
  selectedTone: string;
  onToneChange: (tone: string) => void;
  disabled?: boolean;
}

// Map icon names to actual components
const iconMap: Record<string, LucideIcon> = {
  MessageSquare,
  Minimize2,
  FileText,
  HelpCircle,
  Briefcase,
  Sparkles,
};

export default function ToneSelector({
  selectedTone,
  onToneChange,
  disabled,
}: ToneSelectorProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const selectedPreset = TONE_PRESETS[selectedTone] || TONE_PRESETS.default;
  const isNonDefault = selectedTone !== 'default';
  const ButtonIcon = iconMap[selectedPreset.icon] || Sparkles;

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
            {isNonDefault ? `${selectedPreset.label} style` : 'Click to change tone'}
          </p>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute bottom-full left-0 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[180px] py-1">
          <div className="px-3 py-1.5 text-xs text-gray-500 font-medium border-b border-gray-100">
            Response Tone
          </div>
          {Object.entries(TONE_PRESETS).map(([key, preset]) => {
            const Icon = iconMap[preset.icon] || Sparkles;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  onToneChange(key);
                  setShowDropdown(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 ${
                  selectedTone === key ? 'text-amber-700 bg-amber-50' : 'text-gray-700'
                }`}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span className="flex-1">{preset.label}</span>
                {selectedTone === key && <Check size={16} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
