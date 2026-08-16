'use client';

import { useEffect, useState } from 'react';
import { Archive, Bell, Check, ChevronRight, Clock3, Download, FolderOpen, History, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import Button from '@/components/ui/Button';

type MemoryType = 'fact' | 'terminology' | 'decision' | 'process' | 'faq' | 'caveat';
type Status = 'draft' | 'suggested' | 'approved' | 'archived' | 'rejected';
interface Category { id: number; name: string; description: string | null; canManage: boolean; memoryEnabled: boolean }
interface Flag { kind: 'near_duplicate' | 'possible_contradiction'; itemId: number; title: string; score: number; reason: string }
interface Item { id: number; memoryType: MemoryType; title: string; content: string; status: Status; sourceReference: string | null; expiresAt: string | null; updatedAt: string; moderationFlags?: Flag[] }
interface Event { id: number; revisionNumber: number; action: string; actorId: number | null; previousValue: unknown; newValue: unknown; createdAt: string }
interface LearningMetrics { candidateCount: number; pendingCount: number; approvedCount: number; rejectedCount: number; approvalRate: number; rejectionRate: number; duplicateSkips: number; redactionCount: number; sourceMainChatCount: number }

const EMPTY_FORM = { memoryType: 'fact' as MemoryType, title: '', content: '', sourceReference: '', expiresAt: '' };

export default function CategoryMemorySection() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [canConfigure, setCanConfigure] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [selected, setSelected] = useState<Category | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [learningMetrics, setLearningMetrics] = useState<LearningMetrics | null>(null);

  useEffect(() => {
    fetch('/api/user/categories').then((r) => r.json()).then((data) => {
      setCategories(data.categories || []);
      setCanConfigure(Boolean(data.canConfigure));
      setCanExport(Boolean(data.canExportCategoryMemory));
      setSuggestionsEnabled(Boolean(data.suggestionsEnabled));
      if (data.categories?.length) setSelected(data.categories[0]);
    }).catch(() => setError('Failed to load categories')).finally(() => setLoading(false));
    fetch('/api/user/notifications').then((r) => r.ok ? r.json() : null).then((data) => setUnreadNotifications(data?.unreadCount || 0)).catch(() => undefined);
    fetch('/api/user/category-memory/review').then((r) => r.ok ? r.json() : null).then((data) => setLearningMetrics(data?.metrics || null)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    fetch(`/api/user/categories/${selected.id}/memory`).then((r) => r.json()).then((data) => {
      if (data.error) throw new Error(data.error);
      setItems([...(data.items || []), ...(data.ownSuggestions || [])].filter((item, index, all) => all.findIndex((entry) => entry.id === item.id) === index));
      setSuggestionsEnabled(Boolean(data.suggestionsEnabled));
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [selected]);

  const save = async () => {
    if (!selected) return;
    setSaving(true); setError('');
    const response = await fetch(`/api/user/categories/${selected.id}/memory${editing ? `/${editing}` : ''}`, {
      method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, suggestion: !selected.canManage, sourceReference: form.sourceReference || null, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.error || 'Unable to save memory');
    else {
      setItems((current) => editing ? current.map((item) => item.id === editing ? data.item : item) : [data.item, ...current]);
      setForm(EMPTY_FORM); setEditing(null);
    }
    setSaving(false);
  };

  const approveEdited = async () => {
    if (!selected || !editing) return;
    setSaving(true); setError('');
    const response = await fetch(`/api/user/categories/${selected.id}/memory/${editing}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, action: 'approve', sourceReference: form.sourceReference || null, expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null }),
    });
    const data = await response.json();
    if (!response.ok) setError(data.error || 'Unable to approve suggestion');
    else { setItems((current) => current.map((item) => item.id === editing ? data.item : item)); setEditing(null); setForm(EMPTY_FORM); }
    setSaving(false);
  };

  const showHistory = async (item: Item) => {
    if (!selected) return;
    const response = await fetch(`/api/user/categories/${selected.id}/memory/${item.id}`);
    const data = await response.json();
    if (!response.ok) return setError(data.error || 'Unable to load revision history');
    setHistoryItem(item); setEvents(data.events || []);
  };

  const act = async (item: Item, action: 'approve' | 'reject' | 'archive' | 'restore' | 'delete') => {
    if (!selected) return;
    const response = await fetch(`/api/user/categories/${selected.id}/memory/${item.id}`, {
      method: action === 'delete' ? 'DELETE' : 'PUT', headers: { 'Content-Type': 'application/json' },
      body: action === 'delete' ? undefined : JSON.stringify({ action }),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || 'Operation failed');
    setItems((current) => action === 'delete' ? current.filter((entry) => entry.id !== item.id) : current.map((entry) => entry.id === item.id ? data.item : entry));
  };

  const toggleCategory = async () => {
    if (!selected) return;
    const enabled = !selected.memoryEnabled;
    const response = await fetch(`/api/user/categories/${selected.id}/memory`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    if (!response.ok) return setError((await response.json()).error || 'Unable to update category setting');
    const updated = { ...selected, memoryEnabled: enabled };
    setSelected(updated);
    setCategories((current) => current.map((category) => category.id === updated.id ? updated : category));
  };

  const clearCategory = async () => {
    if (!selected || !window.confirm(`Delete all memory items for ${selected.name}? This cannot be undone.`)) return;
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/user/categories/${selected.id}/memory`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to clear category memory');
      setItems([]);
      setHistoryItem(null);
      setEvents([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to clear category memory');
    } finally {
      setSaving(false);
    }
  };

  const exportCategoryMemory = async (format: 'text' | 'json') => {
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/user/category-memory/export?format=${format}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Unable to export Category Memory');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `category-memory-${new Date().toISOString().slice(0, 10)}.${format === 'json' ? 'json' : 'txt'}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to export Category Memory');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !categories.length) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;
  return <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
    <div className="px-6 py-4 border-b flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-gray-900">Categories</h2><p className="text-sm text-gray-500">Approved context shared with main-chat category subscribers.</p></div><div className="flex flex-wrap items-center gap-2">{canExport && <><Button variant="secondary" disabled={saving} onClick={() => void exportCategoryMemory('text')}><Download size={14} className="mr-1"/>Text</Button><Button variant="secondary" disabled={saving} onClick={() => void exportCategoryMemory('json')}><Download size={14} className="mr-1"/>JSON</Button></>}<div className="flex items-center gap-1 text-xs text-gray-600" title="Unread in-app notifications"><Bell size={16}/>{unreadNotifications}</div></div></div>
    {error && <div className="m-4 p-3 rounded bg-red-50 text-red-700 text-sm">{error}</div>}
    <div className="space-y-3 p-4 min-h-[420px]">
      <details open className="rounded-lg border bg-gray-50"><summary className="cursor-pointer px-4 py-3 font-medium text-gray-900">Category list</summary><aside className="border-t p-2">
        {categories.map((category) => <button key={category.id} onClick={() => setSelected(category)} className={`w-full flex items-center gap-2 p-3 rounded text-left text-sm ${selected?.id === category.id ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100'}`}><FolderOpen size={16}/><span className="flex-1 truncate">{category.name}</span><ChevronRight size={14}/></button>)}
        {!categories.length && <p className="p-3 text-sm text-gray-500">No active category access.</p>}
      </aside></details>
      <details open className="rounded-lg border bg-white"><summary className="cursor-pointer px-4 py-3 font-medium text-gray-900">{selected ? `${selected.name} · Memory` : 'Category Memory'}</summary><section className="border-t p-5 space-y-4">
        {selected && <><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{selected.name} · Memory</h3><p className="text-xs text-gray-500">{selected.canManage ? 'Owner controls enabled' : 'Read-only subscriber view'}</p></div><div className="flex flex-wrap items-center gap-2">{canConfigure && <><label className="flex items-center gap-2 text-xs text-gray-600"><input type="checkbox" checked={selected.memoryEnabled} onChange={toggleCategory}/>Enabled for category</label><Button variant="secondary" className="text-red-600" disabled={saving || items.length === 0} onClick={() => void clearCategory()}><Trash2 size={14} className="mr-1"/>Clear category</Button></>}</div></div>
          {!selected.memoryEnabled && <div className="p-3 bg-amber-50 text-amber-800 text-sm rounded">Category Memory is disabled for this category.</div>}
          {selected.canManage && learningMetrics && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label="Assisted learning review metrics"><div className="rounded border p-2"><p className="text-xs text-gray-500">Main-chat candidates</p><p className="font-semibold">{learningMetrics.sourceMainChatCount}</p></div><div className="rounded border p-2"><p className="text-xs text-gray-500">Approved / rejected</p><p className="font-semibold">{learningMetrics.approvedCount} / {learningMetrics.rejectedCount}</p><p className="text-[11px] text-gray-500">{Math.round(learningMetrics.approvalRate * 100)}% / {Math.round(learningMetrics.rejectionRate * 100)}%</p></div><div className="rounded border p-2"><p className="text-xs text-gray-500">Pending / duplicate skips</p><p className="font-semibold">{learningMetrics.pendingCount} / {learningMetrics.duplicateSkips}</p></div><div className="rounded border p-2"><p className="text-xs text-gray-500">Deterministic redactions</p><p className="font-semibold">{learningMetrics.redactionCount}</p></div></div>}
          {selected.memoryEnabled && (selected.canManage || suggestionsEnabled) && <div className="border rounded p-4 space-y-3">
            <p className="text-xs font-medium text-gray-700">{selected.canManage ? (editing ? 'Edit or sanitize item' : 'Create a curated draft') : 'Suggest reusable category context for owner review'}</p>
            <div className="grid sm:grid-cols-[160px_1fr] gap-2"><select className="border rounded px-2 py-2 text-sm" value={form.memoryType} onChange={(e) => setForm({...form, memoryType: e.target.value as MemoryType})}>{['fact','terminology','decision','process','faq','caveat'].map((t) => <option key={t}>{t}</option>)}</select><input className="border rounded px-3 py-2 text-sm" placeholder="Short unique title" value={form.title} onChange={(e) => setForm({...form, title: e.target.value})}/></div>
            <textarea className="w-full border rounded px-3 py-2 text-sm" rows={3} placeholder="Contextual fact (not a system instruction)" value={form.content} onChange={(e) => setForm({...form, content: e.target.value})}/>
            <div className="grid sm:grid-cols-2 gap-2"><input className="border rounded px-3 py-2 text-sm" placeholder="Source / provenance" value={form.sourceReference} onChange={(e) => setForm({...form, sourceReference: e.target.value})}/><input type="datetime-local" className="border rounded px-3 py-2 text-sm" value={form.expiresAt} onChange={(e) => setForm({...form, expiresAt: e.target.value})}/></div>
            <div className="flex gap-2"><Button onClick={save} disabled={saving || !form.title.trim() || !form.content.trim()}>{saving ? <Loader2 className="animate-spin" size={16}/> : editing ? 'Save changes' : <><Plus size={16} className="mr-1"/>{selected.canManage ? 'Create draft' : 'Submit suggestion'}</>}</Button>{editing && selected.canManage && items.find((item) => item.id === editing)?.status === 'suggested' && <Button onClick={approveEdited} disabled={saving || !form.title.trim() || !form.content.trim()}><Check size={16} className="mr-1"/>Save & approve</Button>}{editing && <Button variant="secondary" onClick={() => { setEditing(null); setForm(EMPTY_FORM); }}>Cancel</Button>}</div>
          </div>}
          <div className="space-y-3">{items.map((item) => <article key={item.id} className={`border rounded p-4 ${item.status === 'suggested' ? 'border-amber-300 bg-amber-50/30' : ''}`}><div className="flex flex-wrap items-start gap-2"><div className="flex-1"><div className="flex flex-wrap gap-2 items-center"><h4 className="font-medium">{item.title}</h4><span className="text-[11px] uppercase rounded bg-gray-100 px-2 py-0.5">{item.memoryType}</span><span className="text-[11px] uppercase rounded bg-blue-50 text-blue-700 px-2 py-0.5">{item.status}</span>{item.status === 'suggested' && <Clock3 size={14} className="text-amber-700"/>}</div><p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{item.content}</p>{item.moderationFlags?.map((flag) => <p key={`${flag.kind}-${flag.itemId}`} className={`mt-2 text-xs rounded px-2 py-1 ${flag.kind === 'possible_contradiction' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{flag.kind === 'possible_contradiction' ? 'Possible contradiction' : 'Near duplicate'}: {flag.title} ({Math.round(flag.score * 100)}%) — {flag.reason}</p>)}<p className="text-xs text-gray-500 mt-2">{item.sourceReference ? `Source: ${item.sourceReference} · ` : ''}Updated {new Date(item.updatedAt).toLocaleDateString()}{item.expiresAt ? ` · Expires ${new Date(item.expiresAt).toLocaleDateString()}` : ''}</p></div>
            {selected.canManage && <div className="flex gap-1">{(['draft','suggested'] as Status[]).includes(item.status) && <><button title="Edit / sanitize" className="p-2 hover:bg-gray-100 rounded" onClick={() => { setEditing(item.id); setForm({ memoryType: item.memoryType, title: item.title, content: item.content, sourceReference: item.sourceReference || '', expiresAt: item.expiresAt ? item.expiresAt.slice(0,16) : '' }); }}><Plus size={15}/></button><button title="Approve" className="p-2 hover:bg-green-50 text-green-700 rounded" onClick={() => act(item,'approve')}><Check size={15}/></button><button title="Reject" className="p-2 hover:bg-red-50 text-red-700 rounded" onClick={() => act(item,'reject')}><X size={15}/></button></>}{(['draft','suggested','approved','rejected'] as Status[]).includes(item.status) && <button title="Archive" className="p-2 hover:bg-gray-100 rounded" onClick={() => act(item,'archive')}><Archive size={15}/></button>}{item.status === 'archived' && <button title="Restore to draft" className="p-2 hover:bg-gray-100 rounded" onClick={() => act(item,'restore')}><RotateCcw size={15}/></button>}<button title="Revision history" className="p-2 hover:bg-gray-100 rounded" onClick={() => showHistory(item)}><History size={15}/></button><button title="Delete" className="p-2 hover:bg-red-50 text-red-700 rounded" onClick={() => act(item,'delete')}><Trash2 size={15}/></button></div>}
          </div></article>)}{!items.length && <p className="text-sm text-gray-500 py-8 text-center">No category memory items available.</p>}</div>
          {historyItem && <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setHistoryItem(null)}><div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto p-5" onClick={(event) => event.stopPropagation()}><div className="flex justify-between"><div><h3 className="font-semibold">Revision history</h3><p className="text-sm text-gray-500">{historyItem.title} · append-only full previous/new values</p></div><button onClick={() => setHistoryItem(null)}><X size={18}/></button></div><div className="mt-4 space-y-3">{events.map((event) => <article key={event.id} className="border rounded p-3"><p className="text-sm font-medium">Revision {event.revisionNumber}: {event.action}</p><p className="text-xs text-gray-500">{new Date(event.createdAt).toLocaleString()} · actor #{event.actorId ?? 'deleted'}</p><details className="mt-2 text-xs"><summary className="cursor-pointer">Previous / new values</summary><pre className="mt-2 whitespace-pre-wrap overflow-auto bg-gray-50 p-2 rounded">{JSON.stringify({ previous: event.previousValue, next: event.newValue }, null, 2)}</pre></details></article>)}</div></div></div>}
        </>}
      </section></details>
    </div>
  </div>;
}
