'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, ChevronDown, ChevronRight, Mic, Volume2, Info } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// ============ Types (mirror config.ts) ============

type SttProvider = 'openai' | 'fireworks' | 'mistral' | 'gemini';
type TtsProvider = 'openai' | 'gemini';

interface SttProviderConfig {
  enabled: boolean;
  model: string;
}

interface TtsProviderConfig {
  enabled: boolean;
}

interface SpeechSettings {
  stt: {
    default: SttProvider;
    fallback: SttProvider | 'none';
    providers: Record<SttProvider, SttProviderConfig>;
    recording: {
      minDurationSeconds: number;
      maxDurationSeconds: number;
    };
  };
  tts: {
    primaryProvider: TtsProvider;
    fallbackProvider: TtsProvider | 'none';
    providers: Record<TtsProvider, TtsProviderConfig>;
  };
}

// ============ Provider metadata ============

const STT_PROVIDER_INFO: Record<SttProvider, { label: string; models: { id: string; label: string }[]; cost: string }> = {
  openai: {
    label: 'OpenAI Whisper',
    models: [{ id: 'whisper-1', label: 'Whisper v2 Large' }],
    cost: '$0.006/min',
  },
  gemini: {
    label: 'Google Gemini',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
    cost: '~$0.06/min',
  },
  mistral: {
    label: 'Mistral Voxtral',
    models: [{ id: 'voxtral-mini-transcribe-v2', label: 'Voxtral Mini Transcribe v2' }],
    cost: '$0.003/min',
  },
  fireworks: {
    label: 'Fireworks AI',
    models: [
      { id: 'whisper-v3', label: 'Whisper v3' },
      { id: 'whisper-v3-turbo', label: 'Whisper v3 Turbo' },
      { id: 'whisper-v3-large', label: 'Whisper v3 Large' },
    ],
    cost: '$0.001/min',
  },
};

const TTS_PROVIDER_INFO: Record<TtsProvider, { label: string; description: string }> = {
  openai: { label: 'OpenAI TTS', description: 'gpt-4o-mini-tts — 13 voices, MP3 output' },
  gemini: { label: 'Google Gemini TTS', description: 'Flash/Pro preview — 30 voices, multi-speaker' },
};

// ============ Component ============

export default function SpeechSettingsTab({ readOnly = false }: { readOnly?: boolean }) {
  const [settings, setSettings] = useState<SpeechSettings | null>(null);
  const [edited, setEdited] = useState<SpeechSettings | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sttOpen, setSttOpen] = useState(true);
  const [ttsOpen, setTtsOpen] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/admin/settings/speech');
      if (!res.ok) throw new Error('Failed to fetch speech settings');
      const data = await res.json();
      setSettings(data.settings);
      setEdited(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  useEffect(() => {
    if (settings && edited) {
      setIsModified(JSON.stringify(settings) !== JSON.stringify(edited));
    }
  }, [settings, edited]);

  const handleSave = async () => {
    if (!edited) return;
    try {
      setIsSaving(true);
      setError(null);
      const res = await fetch('/api/admin/settings/speech', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edited),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      const data = await res.json();
      setSettings(data.settings);
      setEdited(data.settings);
      setSuccess('Speech settings saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  // ---- STT update helpers ----

  const updateStt = (patch: Partial<SpeechSettings['stt']>) => {
    if (!edited) return;
    setEdited({ ...edited, stt: { ...edited.stt, ...patch } });
  };

  const updateSttProvider = (id: SttProvider, patch: Partial<SttProviderConfig>) => {
    if (!edited) return;
    setEdited({
      ...edited,
      stt: {
        ...edited.stt,
        providers: {
          ...edited.stt.providers,
          [id]: { ...edited.stt.providers[id], ...patch },
        },
      },
    });
  };

  const updateRecording = (patch: Partial<SpeechSettings['stt']['recording']>) => {
    if (!edited) return;
    setEdited({
      ...edited,
      stt: { ...edited.stt, recording: { ...edited.stt.recording, ...patch } },
    });
  };

  // ---- TTS update helpers ----

  const updateTts = (patch: Partial<SpeechSettings['tts']>) => {
    if (!edited) return;
    setEdited({ ...edited, tts: { ...edited.tts, ...patch } });
  };

  const updateTtsProvider = (id: TtsProvider, patch: Partial<TtsProviderConfig>) => {
    if (!edited) return;
    setEdited({
      ...edited,
      tts: {
        ...edited.tts,
        providers: {
          ...edited.tts.providers,
          [id]: { ...edited.tts.providers[id], ...patch },
        },
      },
    });
  };

  // ============ Render ============

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!edited) {
    return (
      <div className="p-4 text-red-600">
        Failed to load speech settings. <button onClick={fetchSettings} className="underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Speech Settings</h2>
          <p className="text-sm text-gray-500">Configure Speech-to-Text and Text-to-Speech providers</p>
        </div>
        {!readOnly && (
          <Button
            onClick={handleSave}
            disabled={!isModified || isSaving}
            variant="primary"
            size="sm"
          >
            {isSaving ? <Spinner size="sm" /> : <Save size={16} />}
            <span className="ml-1">Save</span>
          </Button>
        )}
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
      {success && <div className="p-3 bg-green-50 text-green-700 rounded-lg text-sm">{success}</div>}

      {/* ==================== STT Section ==================== */}
      <div className="border rounded-lg">
        <button
          onClick={() => setSttOpen(!sttOpen)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Mic size={18} />
            <span className="font-medium">Speech-to-Text (STT)</span>
          </div>
          {sttOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>

        {sttOpen && (
          <div className="px-4 pb-4 space-y-5 border-t">

            {/* Default / Fallback Provider */}
            <div className="pt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Default Provider
                </label>
                <select
                  value={edited.stt.default}
                  onChange={e => updateStt({ default: e.target.value as SttProvider })}
                  disabled={readOnly}
                  className="w-full px-2 py-1.5 text-sm border rounded-md"
                >
                  {(Object.keys(STT_PROVIDER_INFO) as SttProvider[])
                    .filter(p => edited.stt.providers[p].enabled)
                    .map(p => (
                      <option key={p} value={p}>
                        {STT_PROVIDER_INFO[p].label}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fallback Provider
                </label>
                <select
                  value={edited.stt.fallback}
                  onChange={e => updateStt({ fallback: e.target.value as SttProvider | 'none' })}
                  disabled={readOnly}
                  className="w-full px-2 py-1.5 text-sm border rounded-md"
                >
                  <option value="none">None</option>
                  {(Object.keys(STT_PROVIDER_INFO) as SttProvider[])
                    .filter(p => p !== edited.stt.default && edited.stt.providers[p].enabled)
                    .map(p => (
                      <option key={p} value={p}>
                        {STT_PROVIDER_INFO[p].label}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-400 -mt-3">
              All providers connect directly via native APIs. No proxy or route intermediary.
            </p>

            {/* STT Providers */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-gray-700">Providers</h4>
              {(Object.keys(STT_PROVIDER_INFO) as SttProvider[]).map(id => {
                const info = STT_PROVIDER_INFO[id];
                const config = edited.stt.providers[id];
                return (
                  <div key={id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium">{info.label}</span>
                        <span className="ml-2 text-xs text-gray-400">{info.cost}</span>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={e => updateSttProvider(id, { enabled: e.target.checked })}
                          disabled={readOnly}
                        />
                        <span className="text-xs text-gray-500">Enabled</span>
                      </label>
                    </div>
                    {config.enabled && (
                      <div className="mt-2">
                        <label className="block text-xs text-gray-500 mb-1">Model</label>
                        <select
                          value={config.model}
                          onChange={e => updateSttProvider(id, { model: e.target.value })}
                          disabled={readOnly}
                          className="w-full px-2 py-1.5 text-sm border rounded-md"
                        >
                          {info.models.map(m => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Recording Limits */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-gray-700">Recording Limits</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Minimum Duration (seconds)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={edited.stt.recording.minDurationSeconds}
                    onChange={e => updateRecording({ minDurationSeconds: parseInt(e.target.value) || 3 })}
                    disabled={readOnly}
                    className="w-full px-2 py-1.5 text-sm border rounded-md"
                  />
                  <span className="text-xs text-gray-400">1 – 60s</span>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    Maximum Duration (seconds)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={600}
                    value={edited.stt.recording.maxDurationSeconds}
                    onChange={e => updateRecording({ maxDurationSeconds: parseInt(e.target.value) || 120 })}
                    disabled={readOnly}
                    className="w-full px-2 py-1.5 text-sm border rounded-md"
                  />
                  <span className="text-xs text-gray-400">10 – 600s (10 min)</span>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* ==================== TTS Section ==================== */}
      <div className="border rounded-lg">
        <button
          onClick={() => setTtsOpen(!ttsOpen)}
          className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Volume2 size={18} />
            <span className="font-medium">Text-to-Speech (TTS)</span>
          </div>
          {ttsOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>

        {ttsOpen && (
          <div className="px-4 pb-4 space-y-5 border-t">

            {/* Primary / Fallback */}
            <div className="pt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Primary Provider</label>
                <select
                  value={edited.tts.primaryProvider}
                  onChange={e => updateTts({ primaryProvider: e.target.value as TtsProvider })}
                  disabled={readOnly}
                  className="w-full px-2 py-1.5 text-sm border rounded-md"
                >
                  {(Object.keys(TTS_PROVIDER_INFO) as TtsProvider[])
                    .filter(p => edited.tts.providers[p].enabled)
                    .map(p => (
                      <option key={p} value={p}>{TTS_PROVIDER_INFO[p].label}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fallback Provider</label>
                <select
                  value={edited.tts.fallbackProvider}
                  onChange={e => updateTts({ fallbackProvider: e.target.value as TtsProvider | 'none' })}
                  disabled={readOnly}
                  className="w-full px-2 py-1.5 text-sm border rounded-md"
                >
                  <option value="none">None</option>
                  {(Object.keys(TTS_PROVIDER_INFO) as TtsProvider[])
                    .filter(p => p !== edited.tts.primaryProvider && edited.tts.providers[p].enabled)
                    .map(p => (
                      <option key={p} value={p}>{TTS_PROVIDER_INFO[p].label}</option>
                    ))}
                </select>
              </div>
            </div>

            {/* TTS Providers */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-gray-700">Providers</h4>
              {(Object.keys(TTS_PROVIDER_INFO) as TtsProvider[]).map(id => {
                const info = TTS_PROVIDER_INFO[id];
                const config = edited.tts.providers[id];
                return (
                  <div key={id} className="border rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">{info.label}</span>
                      <p className="text-xs text-gray-400">{info.description}</p>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={config.enabled}
                        onChange={e => updateTtsProvider(id, { enabled: e.target.checked })}
                        disabled={readOnly}
                      />
                      <span className="text-xs text-gray-500">Enabled</span>
                    </label>
                  </div>
                );
              })}
            </div>

            {/* Info note */}
            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
              <Info size={16} className="text-blue-500 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-700">
                Voice selection, style, and podcast-specific settings are configured in{' '}
                <strong>Tools &gt; Podcast Generator</strong>. This section only controls which TTS providers
                are available and the primary/fallback order.
              </p>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
