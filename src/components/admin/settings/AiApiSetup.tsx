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
import { AlertTriangle, Info } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// Fetched from /api/models — enabled LLM models grouped by provider
interface EnabledModel {
  id: string;
  displayName: string;
  providerId: string;
}

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
  connectionMode: 'provider-key' | 'tool-config' | 'keyless';
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
  selectionMode: 'none' | 'model' | 'service';
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

  // Enabled LLM models from /api/models (for LLM capability dropdown)
  const [enabledModels, setEnabledModels] = useState<EnabledModel[]>([]);

  // Capability config local state: capabilityId -> { providerId, model, enabled }
  const [capConfig, setCapConfig] = useState<Record<string, { providerId: string; model: string; enabled: boolean }>>({});
  const [saving, setSaving] = useState(false);

  // Credential entry form state
  const [credProvider, setCredProvider] = useState('');
  const [credSecret, setCredSecret] = useState('');
  const [credBusy, setCredBusy] = useState(false);


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
        const supportedProviders = data.registry.providerCapabilities
          .filter((pc) =>
            pc.capabilityId === cap.id && pc.isSupported &&
            data.registry.providers.some((provider) => provider.id === pc.providerId && provider.enabled)
          )
          .map((pc) => pc.providerId);
        initial[cap.id] = {
          providerId: existing?.providerId ?? (supportedProviders.length === 1 ? supportedProviders[0] : ''),
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

  // Fetch enabled LLM models for the LLM capability dropdown
  useEffect(() => {
    fetch('/api/models')
      .then((res) => (res.ok ? res.json() : { models: [] }))
      .then((data) => setEnabledModels(data.models || []))
      .catch(() => setEnabledModels([]));
  }, []);

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
      return overview.registry.providers.filter((p) => p.enabled && ids.includes(p.id));
    },
    [overview]
  );

  /**
   * Returns the list of selectable model/service IDs for a given
   * capability + provider combination.
   *
   * For the `llm` capability we use the `enabled_models` table (fetched
   * from /api/models) filtered by provider — these are the models the
   * admin has explicitly enabled in the LLM management page.
   *
   * For all other capabilities (embeddings, reranking, speech-to-text,
   * text-to-speech, etc.) we use the `modelOrServiceIds` field from the
   * server-side registry (`provider_capabilities` table), which contains
   * the known service IDs for that provider/capability pair.
   *
   * If neither source yields options, an empty array is returned and the
   * dropdown will show only "— auto —".
   */
  const modelsForCapability = useCallback(
    (capabilityId: string, providerId: string): string[] => {
      if (!providerId) return [];

      if (capabilityId === 'llm') {
        // LLM models come from the enabled_models table via /api/models.
        // Model IDs in enabled_models are typically prefixed with the
        // provider id (e.g. "fireworks/minimax-m3", "deepseek-chat") but
        // some legacy ones lack a prefix. We match on the providerId field
        // returned by the API, falling back to prefix matching.
        return enabledModels
          .filter((m) => {
            if (m.providerId === providerId) return true;
            // Some models use provider-prefixed ids without a separate providerId
            return m.id.startsWith(`${providerId}/`) || m.id.startsWith(`${providerId}-`);
          })
          .map((m) => m.id);
      }

      // Non-LLM capabilities: use registry modelOrServiceIds
      if (!overview) return [];
      const pc = overview.registry.providerCapabilities.find(
        (pc) => pc.capabilityId === capabilityId && pc.providerId === providerId && pc.isSupported
      );
      if (!pc || !pc.modelOrServiceIds) return [];
      return Array.isArray(pc.modelOrServiceIds) ? pc.modelOrServiceIds as string[] : [];
    },
    [overview, enabledModels]
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
        body: JSON.stringify({ providerId: credProvider, secret: credSecret }),
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

  const credentialAction = async (credentialId: string, action: 'test' | 'replace' | 'disable' | 'enable' | 'rotate', secret?: string) => {
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
        Organization AI Setup &amp; BYOK is not enabled (feature flag <code>ai-api-setup-ui-enabled</code> is off).
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
              <h2 className="font-semibold text-gray-900">Organization AI Setup &amp; BYOK</h2>
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
              {overview.health.warnings.length > 0 && (
                <span className="text-sm text-yellow-700 flex items-center gap-1">
                  <AlertTriangle size={14} /> {overview.health.warnings.length} runtime notice{overview.health.warnings.length === 1 ? '' : 's'}
                </span>
              )}
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
                  {c.warnings.map((warning) => (
                    <div key={warning} className="mt-2 text-xs text-yellow-700">
                      {warning}
                    </div>
                  ))}
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
                const mapping = overview.registry.providerCapabilities.find(
                  (pc) => pc.capabilityId === cap.id && pc.providerId === cfg.providerId && pc.isSupported
                );
                const modelOptions = modelsForCapability(cap.id, cfg.providerId);
                const showModelSelection = mapping?.selectionMode !== 'none' && modelOptions.length > 0;
                const capHealth = overview.health?.capabilities.find((h) => h.capabilityId === cap.id);
                const keyMissing =
                  cap.importance === 'REQUIRED' &&
                  (capHealth?.state === 'NOT_CONFIGURED' || capHealth?.state === 'UNAVAILABLE');
                return (
                  <div key={cap.id} className="border rounded-md p-3 flex flex-wrap items-center gap-3">
                    <div className="w-48">
                      <div className="font-medium text-sm">{cap.name}</div>
                      <div className="text-xs text-gray-500">{cap.importance}</div>
                    </div>
                    {providers.length > 1 ? (
                      <select
                        value={cfg.providerId}
                        disabled={!canManage}
                        onChange={(e) => setCapConfig((prev) => ({
                          ...prev,
                          [cap.id]: { ...cfg, providerId: e.target.value, model: '' },
                        }))}
                        className="border rounded-md px-2 py-1 text-sm"
                      >
                        <option value="">— none —</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    ) : providers[0] ? (
                      <span className="text-sm text-gray-700">{providers[0].name}</span>
                    ) : null}
                    {showModelSelection && (
                      <select
                        value={cfg.model}
                        disabled={!canManage}
                        onChange={(e) => setCapConfig((prev) => ({ ...prev, [cap.id]: { ...cfg, model: e.target.value } }))}
                        className="border rounded-md px-2 py-1 text-sm w-64"
                      >
                        <option value="">— automatic default —</option>
                        {modelOptions.map((modelId) => (
                          <option key={modelId} value={modelId}>{modelId}</option>
                        ))}
                      </select>
                    )}
                    {keyMissing ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        Key required
                        {org?.credentialMode === 'ORGANIZATION_BYOK'
                          ? ' — add in Provider Connections'
                          : ' — configure platform key'}
                      </span>
                    ) : capHealth?.state ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${HEALTH_BADGE[capHealth.state]}`}>
                        {capHealth.state}
                      </span>
                    ) : null}
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
        <h2 className="font-semibold text-gray-900 mb-3">{org?.credentialMode === 'ORGANIZATION_BYOK' ? 'Org BYOK Credentials' : 'Credential Mode'}</h2>
        <p className="text-sm text-gray-500 mb-4">
          {org?.credentialMode === 'ORGANIZATION_BYOK'
            ? 'Organization-specific encrypted credentials. Capabilities reference providers without duplicate keys.'
            : 'This organization inherits shared platform credentials.'}
        </p>

        {/* Mode-aware guidance */}
        {org?.credentialMode === 'PLATFORM_MANAGED' && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2 mb-4">
            <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-800">
              This organization uses shared platform credentials. A super-admin manages the keys in
              Settings &rarr; Platform Credentials. Switch the organization to BYOK mode to manage
              organization-specific keys here.
            </p>
          </div>
        )}

        {canManage && org?.credentialMode === 'ORGANIZATION_BYOK' && (
          <div className="border rounded-md p-3 mb-4 flex flex-wrap items-end gap-2">
            <div>
              <div className="text-xs text-gray-500 mb-1">Provider</div>
              <select value={credProvider} onChange={(e) => setCredProvider(e.target.value)} className="border rounded-md px-2 py-1 text-sm">
                <option value="">Select provider…</option>
                {overview.registry.providers
                  .filter((p) => p.connectionMode === 'provider-key')
                  .filter((p) => Object.values(capConfig).some((c) => c.enabled && c.providerId === p.id))
                  .filter((p) => !overview.credentials.some((c) => c.providerId === p.id && c.status === 'active')).map((p) => (
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
            <Button onClick={saveCredential} disabled={credBusy || !credProvider || !credSecret}>
              {credBusy ? 'Saving…' : 'Add Key'}
            </Button>
          </div>
        )}

        {org?.credentialMode === 'ORGANIZATION_BYOK' && (
          <div className="space-y-2">
            {overview.registry.providers
              .filter((p) => p.connectionMode === 'provider-key')
              .filter((p) =>
                Object.values(capConfig).some((c) => c.enabled && c.providerId === p.id) ||
                overview.credentials.some((c) => c.providerId === p.id && c.status === 'active')
              )
              .map((p) => {
                const active = overview.credentials.find(
                  (c) => c.providerId === p.id && c.status === 'active'
                );
                return (
                  <details key={p.id} className="border rounded-md px-3 py-2">
                    <summary className="flex cursor-pointer items-center justify-between">
                      <span>
                        <span className="font-medium text-sm">{p.name}</span>
                        <span className="text-xs text-gray-500 ml-2">{p.id}</span>
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {active ? 'connected' : 'key required'}
                      </span>
                    </summary>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                      {active ? (
                        <>
                          <span className="text-gray-500">{active.credentialId.slice(0, 12)}…</span>
                          <button className="text-blue-600 underline" onClick={() => credentialAction(active.credentialId, 'test')}>
                            Test Connection
                          </button>
                          {canManage && (
                            <>
                              <button
                                className="text-blue-600 underline"
                                onClick={async () => {
                                  const secret = window.prompt('Enter the replacement key');
                                  if (secret) await credentialAction(active.credentialId, 'replace', secret);
                                }}
                              >
                                Replace Key
                              </button>
                              <button
                                className="text-red-600 underline"
                                onClick={() => credentialAction(active.credentialId, 'disable')}
                              >
                                Disable Connection
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-500">Add an organization key above to activate this provider.</span>
                      )}
                    </div>
                  </details>
                );
              })}
            {overview.credentials.some((c) => c.status !== 'active') && (
              <details className="border rounded-md px-3 py-2">
                <summary className="cursor-pointer text-sm text-gray-600">Credential history</summary>
                <ul className="mt-2 space-y-1 text-xs text-gray-500">
                  {overview.credentials.filter((c) => c.status !== 'active').map((c) => (
                    <li key={c.credentialId}>{c.providerId} · {c.credentialId.slice(0, 12)}… · {c.status}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
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
