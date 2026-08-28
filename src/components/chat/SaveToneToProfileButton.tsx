'use client';

import { useCallback, useRef, useState } from 'react';
import { Save, Check, Loader2, AlertCircle } from 'lucide-react';
import {
  isPersonaTone,
  isVerbosity,
  mapLegacyResponseTone,
  trimToNull,
  type PersonaTone,
  type Verbosity,
} from '@/lib/response-style';

interface SaveTonePatch {
  tone: PersonaTone;
  customToneName?: string | null;
  customToneInstruction?: string | null;
  verbosity?: Verbosity;
}

interface SaveToneToProfileButtonProps {
  /** Chat-selected tone (canonical enum or a legacy selector value). */
  tone: string;
  /** Chat-selected verbosity. */
  verbosity?: string;
  /** Transient custom persona name. */
  customToneName?: string | null;
  /** Transient custom persona instruction. */
  customToneInstruction?: string | null;
  disabled?: boolean;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Explicit, opt-in "Save to profile" affordance. Persists the currently
 * selected chat style to Personal Memory via the existing `update_preferences`
 * PATCH action — never automatically on selection change.
 */
export default function SaveToneToProfileButton({
  tone,
  verbosity = 'balanced',
  customToneName = null,
  customToneInstruction = null,
  disabled = false,
}: SaveToneToProfileButtonProps) {
  const [state, setState] = useState<SaveState>('idle');
  const [message, setMessage] = useState('');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSave = useCallback(async () => {
    const legacy = mapLegacyResponseTone(tone);
    const canonicalTone: PersonaTone = isPersonaTone(tone) ? tone : (legacy?.tone ?? 'default');

    const patch: SaveTonePatch = { tone: canonicalTone };

    if (canonicalTone === 'custom') {
      const name = trimToNull(customToneName) ?? legacy?.customName ?? null;
      const instruction = trimToNull(customToneInstruction) ?? legacy?.customInstruction ?? null;
      if (!instruction) {
        setState('error');
        setMessage('Custom persona requires a non-empty instruction.');
        return;
      }
      patch.customToneName = name;
      patch.customToneInstruction = instruction;
    }

    const effectiveVerbosity: Verbosity | undefined = isVerbosity(verbosity) && verbosity !== 'balanced'
      ? verbosity
      : (legacy?.verbosity && legacy.verbosity !== 'balanced' ? legacy.verbosity : undefined);
    if (effectiveVerbosity) patch.verbosity = effectiveVerbosity;

    setState('saving');
    setMessage('');
    try {
      const response = await fetch('/api/user/memory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_preferences', preferences: patch }),
      });
      if (response.ok) {
        setState('saved');
        setMessage('Saved to profile');
        if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
        resetTimerRef.current = setTimeout(() => {
          setState('idle');
          setMessage('');
        }, 2500);
      } else {
        const data = await response.json().catch(() => null);
        setState('error');
        setMessage(data?.error || 'Failed to save to profile');
      }
    } catch {
      setState('error');
      setMessage('Failed to save to profile');
    }
  }, [tone, verbosity, customToneName, customToneInstruction]);

  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <button
        type="button"
        onClick={handleSave}
        disabled={disabled || state === 'saving'}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
          state === 'saved'
            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
            : state === 'error'
              ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
              : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'
        } ${disabled || state === 'saving' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
        aria-label="Save current response style to profile"
      >
        {state === 'saving' ? (
          <Loader2 size={12} className="animate-spin" />
        ) : state === 'saved' ? (
          <Check size={12} />
        ) : (
          <Save size={12} />
        )}
        <span>{state === 'saved' ? 'Saved' : 'Save to profile'}</span>
      </button>
      {message && state === 'error' && (
        <span className="inline-flex items-center gap-1 text-xs text-red-600">
          <AlertCircle size={12} className="flex-shrink-0" />
          {message}
        </span>
      )}
    </div>
  );
}
