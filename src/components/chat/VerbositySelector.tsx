'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { VERBOSITY_LEVELS, VERBOSITY_LABELS, type Verbosity } from '@/lib/response-style';

interface VerbositySelectorProps {
  selectedVerbosity: string;
  onVerbosityChange: (verbosity: Verbosity) => void;
  disabled?: boolean;
}

export default function VerbositySelector({
  selectedVerbosity,
  onVerbosityChange,
  disabled = false,
}: VerbositySelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  const active: Verbosity = (VERBOSITY_LEVELS as readonly string[]).includes(selectedVerbosity)
    ? (selectedVerbosity as Verbosity)
    : 'balanced';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
          active !== 'balanced'
            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200'
            : 'bg-gray-100 text-gray-600 border border-gray-300 hover:bg-gray-200'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        title={`Length: ${VERBOSITY_LABELS[active]}`}
        aria-label={`Length: ${VERBOSITY_LABELS[active]}`}
      >
        <span>{VERBOSITY_LABELS[active]}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[120px]">
          {VERBOSITY_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => {
                onVerbosityChange(level);
                setOpen(false);
              }}
              className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-gray-50 ${
                active === level ? 'text-emerald-700 bg-emerald-50' : 'text-gray-700'
              }`}
            >
              <span className="flex-1">{VERBOSITY_LABELS[level]}</span>
              {active === level && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
