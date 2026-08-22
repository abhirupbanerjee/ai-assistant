'use client';

/**
 * Consolidated AI & API Setup page (plan §11) — Phase E.
 *
 * One credential is entered once per provider; capabilities reference
 * providers/models without duplicate keys. Actions per credential are
 * `Test Connection`, `Replace Key`, `Disable Connection` (never "Show Key").
 * The page is registry-driven: providers/capabilities come from the server-side
 * registry, not a hardcoded frontend map.
 */

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// ============================================================================
// Types
// ============================================================================

type HealthState = 'READY' | 'DEGRADED' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

interface RegistryProvider {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  sortOrder: number;
}

interface RegistryCapability {
  id: string;
  name: string;
  description: string | null;
  importance: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
  sortOrder: number;
}

interface RegistryProviderCapability {
  providerId: string;
  capabilityId: string;
  isSupported: boolean;
  modelOrServiceIds: unknown;
}

interface Overview {
  flag: { aiApiSetupUiEnabled: boolean };
  viewer: {
    role: string;
    isSuperAdmin: boolean;
    userId: number | null;
    organizationId: number | null;
    membershipRole: string | null;
  };
  selectedOrgId: number | null;
  organizations: Array<{
    id: number;
    name: string;
    type: string;
    isDefault: boolean;
    credentialMode: string;
    status: string;
    activeCredentialCount: number;
    membershipRole: string | null;
  }>;
  registry: {
    providers: RegistryProvider[];
    capabilities: RegistryCapability[];
    providerCapabilities: RegistryProviderCapability[];
  };
  health: {
    readiness: HealthState;
    saveBlocking: boolean;
    warnings: string[];
    capabilities: Array<{
      capabilityId: string;
      importance: string;
      state: HealthState;
      providerId: string | null;
      warnings: string[];
    }>;
  } | null;
  credentials: Array<{
    credentialId: string;
    providerId: string;
    status: string;
    isDefault: boolean;
    credentialVersion: number;
    redactedDetail: string;
  }>;
  activeCredentialCount: number;
  capabilityConfig: Array<{
    capabilityId: string;
    providerId: string;
    credentialId: string | null;
    modelOrServiceId: string | null;
    enabled: boolean;
  }>;
}

interface Member {
  userId: number;
  email: string;
  name: string | null;
  role: string;
  status: string;
}

interface AuditEntry {
  id: number;
  providerId: string;
  credentialId: string | null;
  actorEmail: string | null;
  action: string;
  redactedDetail: string | null;
  createdAt: string;
}

const HEALTH_BADGE: Record<HealthState, string> = {
  READY: 'bg-green-100 text-green-800',
  DEGRADED: 'bg-yellow-100 text-yellow-800',
  UNAVAILABLE: 'bg-red-100 text-red-800',
  NOT_CONFIGURED: 'bg-gray-100 text-gray-600',
};

const GROUPS: Array<{ title: string; capabilities: string[] }> = [
  { title: 'Core AI', capabilities: ['llm', 'embeddings', 'reranking'] },
  { title: 'Knowledge & Search', capabilities: ['web-search', 'document-intelligence'] },
  { title: 'Media', capabilities: ['image-generation', 'podcast-audio', 'speech-to-text', 'text-to-speech'] },
  { title: 'Developer / Analysis Tools', capabilities: ['code-analysis', 'load-testing', 'website-analysis'] },
];

export default function AiApiSetup() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Capability config local state: capabilityId -> { providerId, model, enabled }
  const [capConfig, setCapConfig] = useState<Record<string, { providerId: string; model: string; enabled: boolean }>>({});
  const [saving, setSaving] = useState(false);

  // Credential entry form state
  const [credProvider, setCredProvider] = useState('');
  const [credSecret, setCredSecret] = useState('');
  const [credDefault, setCredDefault] = useState(false);
  const [credBusy, setCredBusy] = useState(false);

  // Org creation form state
  const [orgName, setOrgName] = useState('');
  const [orgType, setOrgType] = useState<'ENTITY' | 'INDIVIDUAL'>('ENTITY');
  const [orgMode, setOrgMode] = useState<'PLATFORM_MANAGED' | 'ORGANIZATION_BYOK'>('PLATFORM_MANAGED');
  const [orgBusy, setOrgBusy] = useState(false);

  // Members + audit + usage
  const [members, setMembers] = useState<Member[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [usage, setUsage] = useState<{ totalTokens: number; totalCost: number; costCanView: boolean } | null>(null);
  const [showAudit, setShowAudit] = useState(false);

  const load = useCallback(async (orgId?: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const query = orgId != null ? `?orgId=${orgId}` : '';
      const res = await fetch(`/api/admin/ai-setup${query}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Failed to load');
      }
      const data: Overview = await res.json();
      setOverview(data);
      setSelectedOrgId(data.selectedOrgId);

      const initial: Record<string, { providerId: string; model: string; enabled: boolean }> = {};
      for (const cap of data.registry.capabilities) {
        const existing = data.capabilityConfig.find((c) => c.capabilityId === cap.id);
        initial[cap.id] = {
          providerId: existing?.providerId ?? '',
          model: existing?.modelOrServiceId ?? '',
          enabled: existing?.enabled ?? true,
        };
      }
      setCapConfig(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const org = overview?.organizations.find((o) => o.id === selectedOrgId);
  const canManage = !!overview && !!selectedOrgId && (
    overview.viewer.isSuperAdmin ||
    (selectedOrgId === overview.viewer.organizationId && overview.viewer.membershipRole === 'org_admin')
  );

  const providersForCapability = useCallback(
    (capabilityId: string): RegistryProvider[] => {
      if (!overview) return [];
      const ids = overview.registry.providerCapabilities
        .filter((pc) => pc.capabilityId === capabilityId && pc.isSupported)
        .map((pc) => pc.providerId);
      return overview.registry.providers.filter((p) => ids.includes(p.id));
    },
    [overview]
  );

  const saveConfig = async () => {
    if (!selectedOrgId) return;
    setSaving(true);
    setMessage(null);
    try {
      const capabilities = Object.entries(capConfig).map(([capabilityId, c]) => ({
        capabilityId,
        providerId: c.providerId,
        modelOrServiceId: c.model || null,
        enabled: c.enabled,
      }));
      const res = await fetch(`/api/admin/ai-setup/organizations/${selectedOrgId}/capabilities`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capabilities }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Save failed');
      setMessage('Configuration saved');
      await load(selectedOrgId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveCredential = async () => {
    if (!selectedOrgId || !credProvider || !credSecret) return;
    setCredBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/ai-setup/organizations/${selectedOrgId}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: credProvider, secret: credSecret, isDefault: credDefault }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Failed to save credential');
      setCredSecret('');
      setMessage('Credential saved');
      await load(selectedOrgId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save credential');
    } finally {
      setCredBusy(false);
    }
  };

  const credentialAction = async (credentialId: string, action: 'test' | 'disable' | 'enable' | 'rotate', secret?: string) => {
    if (!selectedOrgId) return;
    try {
      const res = await fetch(
        `/api/admin/ai-setup/organizations/${selectedOrgId}/credentials/${encodeURIComponent(credentialId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...(secret ? { secret } : {}) }),
        }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Action failed');
      setMessage(`Action "${action}" ${body.ok ? 'succeeded' : 'returned unavailable'}`);
      await load(selectedOrgId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const createOrg = async () => {
    setOrgBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/ai-setup/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName, type: orgType, credentialMode: orgMode }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Failed to create organization');
      setOrgName('');
      setMessage('Organization created');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setOrgBusy(false);
    }
  };

  const loadMembers = async () => {
    if (!selectedOrgId) return;
    const res = await fetch(`/api/admin/ai-setup/organizations/${selectedOrgId}/members`);
    if (res.ok) setMembers((await res.json()).members);
  };

  const loadAudit = async () => {
    if (!selectedOrgId) return;
    const res = await fetch(`/api/admin/ai-setup/organizations/${selectedOrgId}/audit`);
    if (res.ok) setAudit((await res.json()).entries);
  };

  const loadUsage = async () => {
    if (!selectedOrgId) return;
    const res = await fetch(`/api/admin/ai-setup/organizations/${selectedOrgId}/usage`);
    if (res.ok) {
      const data = await res.json();
      setUsage({ totalTokens: data.usage.totalTokens, totalCost: data.usage.totalCost, costCanView: data.cost.canView });
    }
  };

  useEffect(() => {
    if (selectedOrgId != null) {
      loadMembers();
      loadUsage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId, overview?.selectedOrgId]);

  if (loading && !overview) {
    return (
      <div className="p-6 flex justify-center">
        <Spinner />
      </div>
    );
  }

  if (error && !overview) {
    return <div className="p-6 text-red-600">{error}</div>;
  }

  if (!overview) return null;

  if (!overview.flag.aiApiSetupUiEnabled) {
    return (
      <div className="p-6 text-sm text-gray-600">
        AI & API Setup is not enabled (feature flag <code>ai-api-setup-ui-enabled</code> is off).
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-2 rounded-md text-sm">
          {message}
        </div>
      )}

      {/* Organization / Credential Mode */}
      <section className="bg-white rounded-lg border shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-semibold text-gray-900">Organization / Credential Mode</h2>
            <p className="text-sm text-gray-500">Select the organization to configure.</p>
          </div>
          {overview.viewer.isSuperAdmin && (
            <select
              value={selectedOrgId ?? ''}
              onChange={(e) => load(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="border rounded-md px-3 py-1.5 text-sm"
            >
              {overview.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.type}) — {o.credentialMode}
                </option>
              ))}
            </select>
          )}
        </div>

        {org && (
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="px-2 py-1 rounded bg-gray-100">Type: {org.type}</span>
            <span className="px-2 py-1 rounded bg-gray-100">Mode: {org.credentialMode}</span>
            <span className="px-2 py-1 rounded bg-gray-100">Status: {org.status}</span>
            <span className="px-2 py-1 rounded bg-gray-100">BYOK credentials: {org.activeCredentialCount}</span>
            {overview.viewer.membershipRole && org.id === overview.viewer.organizationId && (
              <span className="px-2 py-1 rounded bg-indigo-50 text-indigo-700">
                Your role: {overview.viewer.membershipRole}
              </span>
            )}
          </div>
        )}
      </section>

      {/* Configuration Health */}
      <section className="bg-white rounded-lg border shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 mb-3">Configuration Health</h2>
        {overview.health ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <span className={`px-2.5 py-1 rounded-full text-sm font-medium ${HEALTH_BADGE[overview.health.readiness]}`}>
                {overview.health.readiness}
              </span>
              {overview.health.warnings.map((w, i) => (
                <span key={i} className="text-sm text-yellow-700 flex items-center gap-1">
                  <AlertTriangle size={14} /> {w}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {overview.health.capabilities.map((c) => (
                <div key={c.capabilityId} className="border rounded-md p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{capName(c.capabilityId)}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${HEALTH_BADGE[c.state]}`}>
                      {c.state}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {c.providerId ? `Provider: ${c.providerId}` : 'Not configured'} · {c.importance}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-500">No health data available.</p>
        )}
      </section>

      {/* Capability groups */}
      {GROUPS.map((group) => {
        const caps = overview.registry.capabilities.filter((c) => group.capabilities.includes(c.id));
        if (caps.length === 0) return null;
        return (
          <section key={group.title} className="bg-white rounded-lg border shadow-sm p-6">
            <h2 className="font-semibold text-gray-900 mb-3">{group.title}</h2>
            <div className="space-y-3">
              {caps.map((cap) => {
                const cfg = capConfig[cap.id] ?? { providerId: '', model: '', enabled: true };
                const providers = providersForCapability(cap.id);
                return (
                  <div key={cap.id} className="border rounded-md p-3 flex flex-wrap items-center gap-3">
                    <div className="w-48">
                      <div className="font-medium text-sm">{cap.name}</div>
                      <div className="text-xs text-gray-500">{cap.importance}</div>
                    </div>
                    <select
                      value={cfg.providerId}
                      disabled={!canManage}
                      onChange={(e) => setCapConfig((prev) => ({ ...prev, [cap.id]: { ...cfg, providerId: e.target.value } }))}
                      className="border rounded-md px-2 py-1 text-sm"
                    >
                      <option value="">— none —</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <input
                      value={cfg.model}
                      disabled={!canManage}
                      onChange={(e) => setCapConfig((prev) => ({ ...prev, [cap.id]: { ...cfg, model: e.target.value } }))}
                      placeholder="Model / service id"
                      className="border rounded-md px-2 py-1 text-sm w-56"
                    />
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={cfg.enabled}
                        disabled={!canManage}
                        onChange={(e) => setCapConfig((prev) => ({ ...prev, [cap.id]: { ...cfg, enabled: e.target.checked } }))}
                      />
                      Enabled
                    </label>
                  </div>
                );
              })}
            </div>
            {canManage && (
              <div className="mt-4">
                <Button onClick={saveConfig} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Configuration'}
                </Button>
              </div>
            )}
          </section>
        );
      })}

      {/* Provider Connections */}
      <section className="bg-white rounded-lg border shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 mb-3">Provider Connections</h2>
        <p className="text-sm text-gray-500 mb-4">
          One credential per provider. Capabilities reference providers without duplicate keys.
        </p>

        {canManage && (
          <div className="border rounded-md p-3 mb-4 flex flex-wrap items-end gap-2">
            <div>
              <div className="text-xs text-gray-500 mb-1">Provider</div>
              <select value={credProvider} onChange={(e) => setCredProvider(e.target.value)} className="border rounded-md px-2 py-1 text-sm">
                <option value="">Select provider…</option>
                {overview.registry.providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">API key / secret</div>
              <input
                type="password"
                value={credSecret}
                onChange={(e) => setCredSecret(e.target.value)}
                placeholder="Enter key once"
                className="border rounded-md px-2 py-1 text-sm w-64"
              />
            </div>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={credDefault} onChange={(e) => setCredDefault(e.target.checked)} />
              Default
            </label>
            <Button onClick={saveCredential} disabled={credBusy || !credProvider || !credSecret}>
              {credBusy ? 'Saving…' : 'Add Key'}
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {overview.registry.providers.map((p) => {
            const creds = overview.credentials.filter((c) => c.providerId === p.id);
            return (
              <div key={p.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm">{p.name}</span>
                    <span className="text-xs text-gray-500 ml-2">{p.id}</span>
                  </div>
                  {creds.length === 0 ? (
                    <span className="text-xs text-gray-400">No organization key</span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {creds.map((c) => (
                        <div key={c.credentialId} className="flex items-center gap-2 text-xs">
                          <span className={`px-2 py-0.5 rounded-full ${c.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                            {c.status}
                          </span>
                          {c.isDefault && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">default</span>}
                          <span className="text-gray-400">{c.credentialId.slice(0, 12)}…</span>
                          <button className="text-blue-600 underline" onClick={() => credentialAction(c.credentialId, 'test')}>
                            Test Connection
                          </button>
                          {canManage && (
                            <>
                              <button
                                className="text-blue-600 underline"
                                onClick={async () => {
                                  const secret = window.prompt('Enter the replacement key');
                                  if (!secret) return;
                                  await fetch(`/api/admin/ai-setup/organizations/${selectedOrgId}/credentials`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ providerId: p.id, credentialId: c.credentialId, secret }),
                                  });
                                  await load(selectedOrgId);
                                }}
                              >
                                Replace Key
                              </button>
                              <button
                                className="text-red-600 underline"
                                onClick={() => credentialAction(c.credentialId, c.status === 'active' ? 'disable' : 'enable')}
                              >
                                {c.status === 'active' ? 'Disable Connection' : 'Enable'}
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Org creation (super_admin / admin) */}
      <section className="bg-white rounded-lg border shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 mb-3">Create Organization</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <div className="text-xs text-gray-500 mb-1">Name</div>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="border rounded-md px-2 py-1 text-sm w-56" />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Type</div>
            <select value={orgType} onChange={(e) => setOrgType(e.target.value as 'ENTITY' | 'INDIVIDUAL')} className="border rounded-md px-2 py-1 text-sm">
              <option value="ENTITY">ENTITY</option>
              <option value="INDIVIDUAL">INDIVIDUAL</option>
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Credential mode</div>
            <select value={orgMode} onChange={(e) => setOrgMode(e.target.value as 'PLATFORM_MANAGED' | 'ORGANIZATION_BYOK')} className="border rounded-md px-2 py-1 text-sm">
              <option value="PLATFORM_MANAGED">PLATFORM_MANAGED</option>
              <option value="ORGANIZATION_BYOK">ORGANIZATION_BYOK</option>
            </select>
          </div>
          <Button onClick={createOrg} disabled={orgBusy || !orgName.trim()}>
            {orgBusy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </section>

      {/* Members */}
      {org && (
        <section className="bg-white rounded-lg border shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-3">Members</h2>
          {members.length === 0 ? (
            <p className="text-sm text-gray-500">No members.</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between border rounded-md p-2 text-sm">
                  <span>{m.email} {m.name ? `(${m.name})` : ''}</span>
                  <span className={`px-2 py-0.5 rounded-full ${m.role === 'org_admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                    {m.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Cost / usage */}
      {usage && (
        <section className="bg-white rounded-lg border shadow-sm p-6">
          <h2 className="font-semibold text-gray-900 mb-3">Cost & Usage</h2>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="px-2 py-1 rounded bg-gray-100">Tokens: {usage.totalTokens.toLocaleString()}</span>
            <span className="px-2 py-1 rounded bg-gray-100">
              Cost: {usage.costCanView ? `$${usage.totalCost.toFixed(4)}` : 'UNAVAILABLE'}
            </span>
          </div>
        </section>
      )}

      {/* Audit */}
      <section className="bg-white rounded-lg border shadow-sm p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Credential Audit</h2>
          <Button onClick={async () => { setShowAudit(!showAudit); if (!showAudit) await loadAudit(); }}>
            {showAudit ? 'Hide' : 'Show'}
          </Button>
        </div>
        {showAudit && (
          audit.length === 0 ? (
            <p className="text-sm text-gray-500">No audit entries.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-1">Provider</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id} className="border-t">
                    <td className="py-1">{a.providerId}</td>
                    <td>{a.action}</td>
                    <td>{a.actorEmail ?? '—'}</td>
                    <td>{new Date(a.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </section>
    </div>
  );
}

function capName(id: string): string {
  const names: Record<string, string> = {
    llm: 'LLM',
    embeddings: 'Embeddings',
    reranking: 'Reranking',
    'web-search': 'Web Search',
    'document-intelligence': 'Document Intelligence / OCR',
    'speech-to-text': 'Speech-to-Text',
    'text-to-speech': 'Text-to-Speech',
    'image-generation': 'Image Generation',
    'podcast-audio': 'Podcast / Audio',
    'code-analysis': 'Code Analysis',
    'load-testing': 'Load Testing',
    'website-analysis': 'Website Analysis',
  };
  return names[id] ?? id;
}
