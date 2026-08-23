'use client';

/**
 * Top-level Organizations administration surface.
 *
 * Moved out of Settings → AI & API Setup into its own L1 menu (above
 * Categories). Creating an organization requires the credential mode
 * (PLATFORM_MANAGED | ORGANIZATION_BYOK) and the org type (ENTITY | INDIVIDUAL)
 * to be chosen explicitly. The first member is auto-promoted to `org_admin`
 * server-side (plan §4).
 */

import { useState, useEffect, useCallback } from 'react';
import { Building2, Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';

interface Organization {
  id: number;
  name: string;
  type: string;
  isDefault: boolean;
  credentialMode: string;
  status: string;
  activeCredentialCount: number;
  membershipRole: string | null;
}

export default function OrganizationsManagement() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [name, setName] = useState('');
  const [type, setType] = useState<'ENTITY' | 'INDIVIDUAL'>('ENTITY');
  const [credentialMode, setCredentialMode] = useState<'PLATFORM_MANAGED' | 'ORGANIZATION_BYOK'>('PLATFORM_MANAGED');
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/ai-setup/organizations');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Failed to load organizations');
      }
      const data = await res.json();
      setOrganizations(data.organizations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/ai-setup/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, credentialMode }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || 'Failed to create organization');
      setName('');
      setType('ENTITY');
      setCredentialMode('PLATFORM_MANAGED');
      setMessage(`Organization "${name.trim()}" created`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  };

  const modeBadge = (mode: string) =>
    mode === 'ORGANIZATION_BYOK'
      ? 'bg-indigo-100 text-indigo-700'
      : 'bg-gray-100 text-gray-600';

  return (
    <div className="space-y-6">
      {message && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-2 rounded-md text-sm">
          {message}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-md text-sm">
          {error}
        </div>
      )}

      {/* Create Organization */}
      <section className="bg-white rounded-lg border shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 mb-1">Create Organization</h2>
        <p className="text-sm text-gray-500 mb-4">
          Credential mode and type are required. The creator is automatically tagged as the
          organization admin.
        </p>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-gray-500 mb-1">Name *</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Organization name"
              className="border rounded-md px-2 py-1.5 text-sm w-64"
            />
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Type *</div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'ENTITY' | 'INDIVIDUAL')}
              className="border rounded-md px-2 py-1.5 text-sm"
            >
              <option value="ENTITY">ENTITY</option>
              <option value="INDIVIDUAL">INDIVIDUAL</option>
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">Credential Mode *</div>
            <select
              value={credentialMode}
              onChange={(e) => setCredentialMode(e.target.value as 'PLATFORM_MANAGED' | 'ORGANIZATION_BYOK')}
              className="border rounded-md px-2 py-1.5 text-sm"
            >
              <option value="PLATFORM_MANAGED">Platform Managed</option>
              <option value="ORGANIZATION_BYOK">BYOK (Org Owns Keys)</option>
            </select>
          </div>
          <Button type="submit" disabled={creating || !name.trim()}>
            <Plus size={18} className="mr-2" />
            {creating ? 'Creating…' : 'Create Organization'}
          </Button>
        </form>
      </section>

      {/* Organization list */}
      <section className="bg-white rounded-lg border shadow-sm">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-gray-600" />
            <div>
              <h2 className="font-semibold text-gray-900">Organizations</h2>
              <p className="text-sm text-gray-500">{organizations.length} organizations</p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 flex justify-center">
            <Spinner size="lg" />
          </div>
        ) : organizations.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No organizations yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 text-left text-sm text-gray-600">
                <tr>
                  <th className="px-6 py-3 font-medium">Organization</th>
                  <th className="px-6 py-3 font-medium">Type</th>
                  <th className="px-6 py-3 font-medium">Credential Mode</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">BYOK Keys</th>
                  <th className="px-6 py-3 font-medium">Your Role</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {organizations.map((org) => (
                  <tr key={org.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <span className="font-medium text-gray-900">{org.name}</span>
                      {org.isDefault && (
                        <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700">
                          default
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-sm">{org.type}</td>
                    <td className="px-6 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${modeBadge(org.credentialMode)}`}>
                        {org.credentialMode === 'ORGANIZATION_BYOK' ? 'BYOK' : 'Platform Managed'}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm">{org.status}</td>
                    <td className="px-6 py-3 text-sm">{org.activeCredentialCount}</td>
                    <td className="px-6 py-3 text-sm">{org.membershipRole ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
