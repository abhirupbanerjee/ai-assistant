'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, Check, Download, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import {
  toPersonalPreferencePatch,
  type EditablePersonalPreferenceProfile,
} from '@/lib/personal-memory-profile';
import { PERSONA_TONES, PERSONA_TONE_LABELS, type PersonaTone } from '@/lib/response-style';

interface Profile extends EditablePersonalPreferenceProfile {
  source: 'user_set' | 'inferred';
  learningEnabled: boolean;
}

interface Interest {
  id: number;
  topic: string;
  source: 'user_set' | 'inferred';
  confidence: number;
  isActive: boolean;
  hitCount: number;
  lastUsedAt: string | null;
}

interface MemoryData {
  profile: Profile;
  interests: Interest[];
  pendingPreferences: PendingPreference[];
  limits: { maxInterests: number };
}

type PreferenceField = 'preferredLanguage' | 'translationLanguage' | 'translationMode' | 'tone' | 'verbosity' | 'complexity' | 'preferredFormat' | 'preferredDiagramFormat' | 'preferredDocumentFormat' | 'includeExamples' | 'includeCitations';

interface PendingPreference {
  id: number;
  field: PreferenceField;
  value: string | boolean | null;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

const preferenceLabels: Record<PreferenceField, string> = {
  preferredLanguage: 'Preferred language', translationLanguage: 'Translation target',
  translationMode: 'Translation behavior', tone: 'Tone', verbosity: 'Answer length',
  complexity: 'Complexity', preferredFormat: 'Preferred format', includeExamples: 'Examples',
  preferredDiagramFormat: 'Diagram format', preferredDocumentFormat: 'Document format',
  includeCitations: 'Citations',
};

const selectClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500';

export default function PersonalMemorySection() {
  const [data, setData] = useState<MemoryData | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [topic, setTopic] = useState('');
  const [editingCandidate, setEditingCandidate] = useState<number | null>(null);
  const [candidateValue, setCandidateValue] = useState('');
  const [busy, setBusy] = useState<string | null>('load');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy('load');
    try {
      const response = await fetch('/api/user/memory');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to load Personal Memory');
      setData(result);
      setDraft(result.profile);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load Personal Memory');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function request(method: string, body?: object, query = '') {
    const response = await fetch(`/api/user/memory${query}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Memory update failed');
    return result;
  }

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try { await action(); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Memory update failed'); setBusy(null); }
  }

  async function exportMemory(format: 'text' | 'json') {
    setBusy(`export-${format}`);
    setError(null);
    try {
      const response = await fetch(`/api/user/memory?format=${format}`);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Personal Memory export failed');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `personal-memory-${new Date().toISOString().slice(0, 10)}.${format === 'json' ? 'json' : 'txt'}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Personal Memory export failed');
    } finally {
      setBusy(null);
    }
  }

  if (busy === 'load' && !data) return <div className="bg-white rounded-lg border p-12 flex justify-center"><Spinner size="lg" /></div>;
  if (!data || !draft) return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error || 'Personal Memory is unavailable.'}</div>;

  const update = <K extends keyof Profile>(key: K, value: Profile[K]) => setDraft({ ...draft, [key]: value });

  const personaDescriptions: Record<PersonaTone, string> = {
    default: 'No persona override — use the standard assistant voice.',
    friendly: 'Warm and approachable.',
    formal: 'Reserved and official.',
    direct: 'Concise and to the point.',
    professional: 'Polished and businesslike.',
    custom: 'Define your own persona with a name and instruction.',
  };

  const selectPersona = (tone: PersonaTone) => update('tone', tone);

  const savePreferences = () => {
    if (draft.tone === 'custom' && !draft.customToneInstruction?.trim()) {
      setError('A custom persona requires a non-empty instruction.');
      return;
    }
    void run('save', () => request('PATCH', { action: 'update_preferences', preferences: toPersonalPreferencePatch(draft) }));
  };

  function displayCandidateValue(value: PendingPreference['value']) {
    if (value === null) return 'Default / unset';
    if (typeof value === 'boolean') return value ? 'Include' : 'Avoid';
    return value.replaceAll('_', ' ');
  }

  function replacementValue(candidate: PendingPreference): string | boolean | null {
    if (candidate.field === 'includeExamples' || candidate.field === 'includeCitations') {
      return candidateValue === 'null' ? null : candidateValue === 'true';
    }
    if ((candidate.field === 'preferredLanguage' || candidate.field === 'translationLanguage') && !candidateValue.trim()) return null;
    return candidateValue.trim();
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <section className="bg-white rounded-lg border shadow-sm">
        <header className="px-6 py-4 border-b flex flex-wrap items-center gap-3">
          <Brain className="text-blue-600" size={24} />
          <div className="flex-1"><h2 className="font-semibold text-gray-900">Personal Memory</h2><p className="text-sm text-gray-500">Global communication and artifact preferences used in main chat, inside and outside categories.</p></div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void exportMemory('text')} disabled={busy !== null}><Download size={15} className="mr-1" />Text</Button>
            <Button variant="secondary" onClick={() => void exportMemory('json')} disabled={busy !== null}><Download size={15} className="mr-1" />JSON</Button>
          </div>
        </header>
        <div className="p-6 space-y-5">
          <h3 className="font-medium text-gray-900">Response preferences</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-sm">Preferred language<input className={selectClass} value={draft.preferredLanguage ?? ''} onChange={(e) => update('preferredLanguage', e.target.value || null)} placeholder="English or en" /><span className="text-xs text-gray-500">Use a supported language name or code.</span></label>
            <label className="text-sm">Translation target<input className={selectClass} value={draft.translationLanguage ?? ''} onChange={(e) => update('translationLanguage', e.target.value || null)} placeholder="French or fr" /><span className="text-xs text-gray-500">Used when translation behavior is Always.</span></label>
            <label className="text-sm">Translation behavior<select className={selectClass} value={draft.translationMode} onChange={(e) => update('translationMode', e.target.value as Profile['translationMode'])}><option value="never">Never</option><option value="when_requested">When requested</option><option value="always">Always</option></select></label>
            <div className="sm:col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
              <div>
                <span className="text-sm font-medium text-gray-900">Persona</span>
                <p className="text-xs text-gray-500">Choose the default response style. A custom persona is authored by you and is never learned automatically.</p>
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                {PERSONA_TONES.map((tone) => (
                  <label key={tone} className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${draft.tone === tone ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                    <input type="radio" name="persona" className="mt-0.5" checked={draft.tone === tone} onChange={() => selectPersona(tone)} />
                    <span>
                      <span className="block text-sm font-medium text-gray-900">{tone === 'custom' ? 'Custom persona' : PERSONA_TONE_LABELS[tone]}</span>
                      <span className="block text-xs text-gray-500">{personaDescriptions[tone]}</span>
                    </span>
                  </label>
                ))}
              </div>
              {draft.tone === 'custom' && (
                <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <label className="block text-sm">
                    Persona name
                    <input className={selectClass} maxLength={60} value={draft.customToneName ?? ''} onChange={(e) => update('customToneName', e.target.value || null)} placeholder="e.g. Government Advisor" />
                    <span className="text-xs text-gray-500">A short display label (60 characters max).</span>
                  </label>
                  <label className="block text-sm">
                    Persona instruction
                    <textarea className={`${selectClass} min-h-[90px]`} maxLength={500} value={draft.customToneInstruction ?? ''} onChange={(e) => update('customToneInstruction', e.target.value || null)} placeholder="Describe how you want the assistant to respond…" />
                    <span className="text-xs text-gray-500">Required when using a custom persona. {draft.customToneInstruction?.length ?? 0}/500</span>
                  </label>
                </div>
              )}
              <label className="text-sm">Answer length<select className={selectClass} value={draft.verbosity} onChange={(e) => update('verbosity', e.target.value as Profile['verbosity'])}><option value="brief">Brief</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label>
            </div>
            <label className="text-sm">Complexity<select className={selectClass} value={draft.complexity} onChange={(e) => update('complexity', e.target.value as Profile['complexity'])}><option value="simple">Simple</option><option value="standard">Standard</option><option value="technical">Technical</option><option value="executive">Executive</option></select></label>
            <label className="text-sm">Preferred format<select className={selectClass} value={draft.preferredFormat} onChange={(e) => update('preferredFormat', e.target.value as Profile['preferredFormat'])}><option value="auto">Automatic</option><option value="bullets">Bullets</option><option value="steps">Steps</option><option value="prose">Prose</option><option value="table">Table</option></select></label>
            <label className="text-sm">Diagram format<select className={selectClass} value={draft.preferredDiagramFormat} onChange={(e) => update('preferredDiagramFormat', e.target.value as Profile['preferredDiagramFormat'])}><option value="auto">Automatic</option><option value="mermaid">Mermaid</option><option value="ascii">ASCII</option><option value="infographic">Infographic</option></select><span className="text-xs text-gray-500">Used when a diagram or visual explanation is appropriate.</span></label>
            <label className="text-sm">Document format<select className={selectClass} value={draft.preferredDocumentFormat} onChange={(e) => update('preferredDocumentFormat', e.target.value as Profile['preferredDocumentFormat'])}><option value="auto">Automatic</option><option value="markdown">Markdown</option><option value="docx">DOCX</option><option value="pdf">PDF</option></select><span className="text-xs text-gray-500">Used when generating a downloadable document artifact.</span></label>
            <label className="text-sm">Examples<select className={selectClass} value={String(draft.includeExamples)} onChange={(e) => update('includeExamples', e.target.value === 'null' ? null : e.target.value === 'true')}><option value="null">Default</option><option value="true">Include</option><option value="false">Avoid</option></select></label>
            <label className="text-sm">Citations<select className={selectClass} value={String(draft.includeCitations)} onChange={(e) => update('includeCitations', e.target.value === 'null' ? null : e.target.value === 'true')}><option value="null">Default</option><option value="true">Include when available</option><option value="false">Avoid optional citations</option></select></label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <span className="text-xs text-gray-500">Stored as <strong>{data.profile.source === 'user_set' ? 'configured by you' : 'learned'}</strong>. Explicit instructions in your current message always win for that turn.</span>
            <Button onClick={savePreferences} disabled={busy !== null}>{busy === 'save' ? <Loader2 className="mr-2 animate-spin" size={16} /> : <Save className="mr-2" size={16} />}Save preferences</Button>
          </div>
        </div>
      </section>

      {data.pendingPreferences.length > 0 && <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 shadow-sm space-y-4">
        <div><h3 className="font-medium text-gray-900">Pending learned preferences</h3><p className="text-sm text-gray-600">These suggestions do not affect responses until you accept them.</p></div>
        <div className="space-y-2">
          {data.pendingPreferences.map((candidate) => {
            const editing = editingCandidate === candidate.id;
            const booleanField = candidate.field === 'includeExamples' || candidate.field === 'includeCitations';
            return <div key={candidate.id} className="rounded-lg border border-amber-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-sm font-medium text-gray-900">{preferenceLabels[candidate.field]}: <span className="font-normal capitalize">{displayCandidateValue(candidate.value)}</span></p><p className="text-xs text-gray-500">Learned · {Math.round(candidate.confidence * 100)}% confidence</p></div>
                {!editing && <div className="flex items-center gap-2"><button title="Accept learned preference" className="inline-flex items-center gap-1 text-xs text-green-700" disabled={busy !== null} onClick={() => run(`accept-${candidate.id}`, () => request('PATCH', { action: 'accept_pending_preference', candidateId: candidate.id }))}><Check size={14} />Accept</button><button title="Edit then accept" className="inline-flex items-center gap-1 text-xs text-blue-700" disabled={busy !== null} onClick={() => { setEditingCandidate(candidate.id); setCandidateValue(candidate.value === null ? '' : String(candidate.value)); }}><Pencil size={14} />Edit</button><button title="Reject learned preference" className="inline-flex items-center gap-1 text-xs text-red-700" disabled={busy !== null} onClick={() => run(`reject-${candidate.id}`, () => request('PATCH', { action: 'reject_pending_preference', candidateId: candidate.id }))}><X size={14} />Reject</button></div>}
              </div>
              {editing && <div className="mt-3 flex flex-wrap items-center gap-2">{booleanField ? <select className={selectClass} value={candidateValue || 'null'} onChange={(e) => setCandidateValue(e.target.value)}><option value="null">Default</option><option value="true">Include</option><option value="false">Avoid</option></select> : <input className={selectClass} maxLength={80} value={candidateValue} onChange={(e) => setCandidateValue(e.target.value)} />}<Button disabled={busy !== null} onClick={() => run(`replace-${candidate.id}`, async () => { await request('PATCH', { action: 'accept_pending_preference', candidateId: candidate.id, replacement: { [candidate.field]: replacementValue(candidate) } }); setEditingCandidate(null); })}>Save and accept</Button><Button variant="secondary" disabled={busy !== null} onClick={() => setEditingCandidate(null)}>Cancel</Button></div>}
            </div>;
          })}
        </div>
      </section>}

      <section className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
        <div><h3 className="font-medium text-gray-900">Topics of interest</h3><p className="text-sm text-gray-500">Only matching topics are supplied to a response. Learned and configured topics are visibly distinguished.</p></div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (topic.trim()) void run('add', async () => { await request('POST', { action: 'add_interest', topic }); setTopic(''); }); }}>
          <input className={selectClass} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={160} placeholder="Add a topic" />
          <Button type="submit" disabled={!topic.trim() || busy !== null}><Plus size={16} /></Button>
        </form>
        <p className="text-xs text-gray-500">{data.interests.length} of {data.limits.maxInterests} topics stored</p>
        <div className="space-y-2">
          {data.interests.length === 0 && <p className="rounded-lg bg-gray-50 p-4 text-sm text-gray-500">No interests saved.</p>}
          {data.interests.map((interest) => <div key={interest.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div><p className={interest.isActive ? 'text-sm font-medium text-gray-900' : 'text-sm text-gray-400 line-through'}>{interest.topic}</p><p className="text-xs text-gray-500">{interest.source === 'user_set' ? 'Configured' : `Learned · ${Math.round(interest.confidence * 100)}% confidence`} · used {interest.hitCount} times</p></div>
            <div className="flex items-center gap-2"><button className="text-xs text-blue-600" disabled={busy !== null} onClick={() => run(`toggle-${interest.id}`, () => request('PATCH', { action: 'set_interest_active', interestId: interest.id, active: !interest.isActive }))}>{interest.isActive ? 'Disable' : 'Enable'}</button><button title="Remove interest" className="p-1 text-gray-400 hover:text-red-600" disabled={busy !== null} onClick={() => run(`delete-${interest.id}`, () => request('DELETE', undefined, `?scope=interest&id=${interest.id}`))}><Trash2 size={15} /></button></div>
          </div>)}
        </div>
      </section>

      <section className="bg-white rounded-lg border shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between gap-4"><div><h3 className="font-medium text-gray-900">Learning and privacy</h3><p className="text-sm text-gray-500">Learning only examines main-chat conversations for durable preferences and interests. Workspaces and Agent Bots are excluded.</p></div><input aria-label="Enable Personal Memory learning" type="checkbox" checked={draft.learningEnabled} disabled={busy !== null} onChange={(e) => run('learning', () => request('PATCH', { action: 'set_learning', learningEnabled: e.target.checked }))} className="h-5 w-5 rounded" /></div>
        <div className="flex flex-wrap gap-2 border-t pt-4"><Button variant="secondary" onClick={() => run('clear-inferred', () => request('DELETE', undefined, '?scope=inferred'))} disabled={busy !== null}>Clear learned memory</Button><Button variant="secondary" onClick={() => run('clear-preferences', () => request('DELETE', undefined, '?scope=preferences'))} disabled={busy !== null}>Reset preferences</Button><Button variant="secondary" className="text-red-600" onClick={() => run('clear-all', () => request('DELETE', undefined, '?scope=all'))} disabled={busy !== null}><Trash2 size={16} className="mr-2" />Clear all Personal Memory</Button></div>
      </section>
    </div>
  );
}
