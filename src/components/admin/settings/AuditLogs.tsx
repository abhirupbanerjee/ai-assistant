'use client';

/**
 * Credential audit log (moved out of Settings → AI & API Setup into its own
 * Settings sub-menu). Super admins see the global audit; org admins see their
 * own organization's audit.
 */

import { useState, useEffect, useCallback } from 'react';
import Spinner from '@/components/ui/Spinner';

interface AuditEntry {
  id: number;
  providerId: string;
  credentialId: string | null;
  actorEmail: string | null;
  action: string;
  redactedDetail: string | null;
  createdAt: string;
}

export default function AuditLogs() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'global' | 'organization'>('global');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const globalRes = await fetch('/api/admin/ai-setup/audit');
      if (globalRes.ok) {
        const data = await globalRes.json();
        setEntries(data.entries || []);
        setScope('global');
        return;
      }

      // Fall back to the viewer's own organization audit.
      const overviewRes = await fetch('/api/admin/ai-setup');
      if (!overviewRes.ok) throw new Error('Failed to load audit');
      const overview = await overviewRes.json();
      const orgId = overview.selectedOrgId;
      if (!orgId) throw new Error('No organization scope available');

      const orgRes = await fetch(`/api/admin/ai-setup/organizations/${orgId}/audit`);
      if (!orgRes.ok) throw new Error('Failed to load audit');
      const data = await orgRes.json();
      setEntries(data.entries || []);
      setScope('organization');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="bg-white rounded-lg border shadow-sm">
      <div className="px-6 py-4 border-b">
        <h2 className="font-semibold text-gray-900">Credential Audit</h2>
        <p className="text-sm text-gray-500">
          {scope === 'global'
            ? 'All credential mutations across organizations.'
            : 'Credential mutations for your organization.'}
        </p>
      </div>

      {loading ? (
        <div className="px-6 py-12 flex justify-center">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="px-6 py-8 text-center text-red-600 text-sm">{error}</div>
      ) : entries.length === 0 ? (
        <div className="px-6 py-12 text-center text-gray-500 text-sm">No audit entries.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="px-6 py-2 font-medium">Provider</th>
                <th className="px-6 py-2 font-medium">Action</th>
                <th className="px-6 py-2 font-medium">Actor</th>
                <th className="px-6 py-2 font-medium">Detail</th>
                <th className="px-6 py-2 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((a) => (
                <tr key={a.id} className="border-t">
                  <td className="px-6 py-2">{a.providerId}</td>
                  <td className="px-6 py-2">{a.action}</td>
                  <td className="px-6 py-2">{a.actorEmail ?? '—'}</td>
                  <td className="px-6 py-2 text-gray-500">{a.redactedDetail ?? '—'}</td>
                  <td className="px-6 py-2">{new Date(a.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
