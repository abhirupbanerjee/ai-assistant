'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Power,
  PowerOff,
  Shield,
  ShieldOff,
  RefreshCw,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

// ============ Types ============

type SwarmRole = 'super_admin' | 'admin' | 'superuser' | 'user';

interface KillSwitchState {
  id: string;
  categoryId: number | null;
  swarmEnabled: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

interface RoleAllowlistEntry {
  id: string;
  role: SwarmRole;
  allowed: boolean;
}

interface SwarmControlResponse {
  killSwitch: KillSwitchState;
  roleAllowlist: RoleAllowlistEntry[];
}

// Role display metadata — order matters for the matrix layout.
const ROLE_META: { role: SwarmRole; label: string; description: string }[] = [
  {
    role: 'super_admin',
    label: 'Super Admin',
    description: 'Highest privilege. Can always manage the kill switch itself.',
  },
  {
    role: 'admin',
    label: 'Admin',
    description: 'Instance administrator. Typically trusted with Force swarm.',
  },
  {
    role: 'superuser',
    label: 'Superuser',
    description: 'Category-scoped elevated user.',
  },
  {
    role: 'user',
    label: 'User',
    description: 'Standard end user. Allow only with deliberate intent.',
  },
];

function formatDate(date: Date | string): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SwarmControlTab() {
  const [killSwitch, setKillSwitch] = useState<KillSwitchState | null>(null);
  const [allowlist, setAllowlist] = useState<RoleAllowlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pendingKillSwitch, setPendingKillSwitch] = useState<boolean | null>(null);
  const [pendingAllowlist, setPendingAllowlist] = useState<Record<SwarmRole, boolean | null>>({
    super_admin: null,
    admin: null,
    superuser: null,
    user: null,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/swarm-control', { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as SwarmControlResponse;
      setKillSwitch(data.killSwitch);
      setAllowlist(data.roleAllowlist);
      setPendingKillSwitch(null);
      const reset: Record<SwarmRole, boolean | null> = {
        super_admin: null,
        admin: null,
        superuser: null,
        user: null,
      };
      setPendingAllowlist(reset);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load swarm control state');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(t);
    }
  }, [success]);

  const allowedFor = (role: SwarmRole): boolean => {
    const pending = pendingAllowlist[role];
    if (pending !== null) return pending;
    const row = allowlist.find((r) => r.role === role);
    return row?.allowed ?? false;
  };

  const effectiveKillSwitchOn =
    pendingKillSwitch !== null ? pendingKillSwitch : killSwitch?.swarmEnabled ?? true;

  const hasPendingChanges =
    pendingKillSwitch !== null ||
    ROLE_META.some((m) => pendingAllowlist[m.role] !== null);

  const handleToggleKillSwitch = () => {
    setPendingKillSwitch(!effectiveKillSwitchOn);
  };

  const handleToggleRole = (role: SwarmRole) => {
    setPendingAllowlist((prev) => ({
      ...prev,
      [role]: !allowedFor(role),
    }));
  };

  const handleSave = async () => {
    if (!hasPendingChanges) return;
    setSaving(true);
    setError(null);
    try {
      const payload: {
        swarmEnabled?: boolean;
        roleAllowlist?: { role: SwarmRole; allowed: boolean }[];
      } = {};
      if (pendingKillSwitch !== null) {
        payload.swarmEnabled = pendingKillSwitch;
      }
      const roleEntries = ROLE_META.filter((m) => pendingAllowlist[m.role] !== null).map(
        (m) => ({ role: m.role, allowed: pendingAllowlist[m.role] as boolean })
      );
      if (roleEntries.length > 0) {
        payload.roleAllowlist = roleEntries;
      }
      const res = await fetch('/api/admin/swarm-control', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as SwarmControlResponse;
      setKillSwitch(data.killSwitch);
      setAllowlist(data.roleAllowlist);
      setPendingKillSwitch(null);
      setPendingAllowlist({
        super_admin: null,
        admin: null,
        superuser: null,
        user: null,
      });
      setSuccess('Swarm control settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save swarm control state');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setPendingKillSwitch(null);
    setPendingAllowlist({
      super_admin: null,
      admin: null,
      superuser: null,
      user: null,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="w-6 h-6 text-gray-700" />
          Swarm Control
        </h1>
        <p className="text-gray-600 mt-1">
          Global kill switch and Force-swarm role permissions. These controls govern all
          multi-agent swarm execution across the instance.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">Error</p>
            <p className="text-sm">{error}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{success}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <>
          {/* Kill Switch */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  {effectiveKillSwitchOn ? (
                    <PowerOff className="w-5 h-5 text-gray-500" />
                  ) : (
                    <Power className="w-5 h-5 text-green-600" />
                  )}
                  Global Kill Switch
                </h2>
                <p className="text-sm text-gray-600 mt-1 max-w-2xl">
                  When the kill switch is ON (swarm <strong>enabled</strong>), swarm runs are
                  permitted subject to per-category overrides. When OFF, all swarm execution is
                  blocked instance-wide regardless of category settings.
                </p>
                {killSwitch && (
                  <p className="text-xs text-gray-500 mt-2">
                    Last updated {formatDate(killSwitch.updatedAt)}
                    {killSwitch.updatedBy ? ` by ${killSwitch.updatedBy}` : ''}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <button
                  type="button"
                  onClick={handleToggleKillSwitch}
                  className={`relative inline-flex h-8 w-16 items-center rounded-full transition-colors ${
                    effectiveKillSwitchOn ? 'bg-green-600' : 'bg-gray-300'
                  }`}
                  aria-pressed={effectiveKillSwitchOn}
                  aria-label="Toggle swarm kill switch"
                >
                  <span
                    className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${
                      effectiveKillSwitchOn ? 'translate-x-9' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span
                  className={`text-xs font-medium ${
                    effectiveKillSwitchOn ? 'text-green-700' : 'text-gray-500'
                  }`}
                >
                  {effectiveKillSwitchOn ? 'Swarm Enabled' : 'Swarm Disabled'}
                </span>
              </div>
            </div>
            {!effectiveKillSwitchOn && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-md p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  Swarm is currently disabled. No new swarm runs will start; in-flight runs drain
                  at the next checkpoint (Phase 4 enforcement).
                </p>
              </div>
            )}
          </div>

          {/* Force-Swarm Role Matrix */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-1">
              <Shield className="w-5 h-5 text-gray-700" />
              Force-Swarm Role Allowlist
            </h2>
            <p className="text-sm text-gray-600 mb-4 max-w-2xl">
              Controls which user roles see the per-message <strong>Force swarm</strong> action in
              the chat composer. This does not bypass the global kill switch — it only gates UI
              visibility of the action.
            </p>
            <div className="divide-y divide-gray-200">
              {ROLE_META.map((meta) => {
                const allowed = allowedFor(meta.role);
                const isPending = pendingAllowlist[meta.role] !== null;
                return (
                  <div
                    key={meta.role}
                    className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{meta.label}</p>
                      <p className="text-sm text-gray-600">{meta.description}</p>
                    </div>
                    <div className="flex items-center gap-3 ml-4">
                      {isPending && (
                        <span className="text-xs text-amber-600 font-medium">Pending</span>
                      )}
                      <span
                        className={`text-xs font-medium ${
                          allowed ? 'text-green-700' : 'text-gray-500'
                        }`}
                      >
                        {allowed ? 'Allowed' : 'Blocked'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleRole(meta.role)}
                        className={`relative inline-flex h-6 w-12 items-center rounded-full transition-colors ${
                          allowed ? 'bg-green-600' : 'bg-gray-300'
                        }`}
                        aria-pressed={allowed}
                        aria-label={`Toggle Force swarm for ${meta.label}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            allowed ? 'translate-x-7' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-4 flex items-center gap-1">
              <ShieldOff className="w-3.5 h-3.5" />
              Unknown roles are conservatively denied Force swarm access.
            </p>
          </div>

          {/* Action Bar */}
          <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-4 sticky bottom-4">
            <div className="text-sm text-gray-600">
              {hasPendingChanges ? (
                <span className="text-amber-700 font-medium">
                  Unsaved changes pending — click Save to apply.
                </span>
              ) : (
                <span>All changes saved.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={fetchData}
                disabled={saving || loading}
                title="Reload from server"
              >
                <RefreshCw className="w-4 h-4 mr-1" />
                Reload
              </Button>
              {hasPendingChanges && (
                <Button variant="secondary" onClick={handleDiscard} disabled={saving}>
                  Discard
                </Button>
              )}
              <Button onClick={handleSave} disabled={saving || !hasPendingChanges}>
                {saving ? (
                  <>
                    <Spinner /> Saving…
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
