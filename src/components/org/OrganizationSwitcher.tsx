'use client';

/**
 * Organization switcher for multi-org representation.
 *
 * Lets the current user select which organization they are representing in
 * chats. Populated from GET /api/me/organizations and persisted through
 * PUT /api/me/organizations/active. Renders nothing for anonymous users or when
 * the user can represent at most one organization.
 */

import { useEffect, useState, useCallback } from 'react';

interface Organization {
  id: number;
  name: string;
  isDefault: boolean;
}

interface OrganizationSwitcherProps {
  /** Styling variant: 'default' (light surfaces) or 'on-dark' (colored headers). */
  variant?: 'default' | 'on-dark';
}

export default function OrganizationSwitcher({ variant = 'default' }: OrganizationSwitcherProps) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/organizations');
      if (!res.ok) return;
      const data = await res.json();
      setOrganizations(data.organizations || []);
      setActiveId(data.activeOrganizationId ?? null);
    } catch {
      // Switcher is best-effort; silence network errors.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextId = e.target.value ? Number(e.target.value) : null;
    const previous = activeId;
    setActiveId(nextId);
    try {
      const res = await fetch('/api/me/organizations/active', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: nextId }),
      });
      if (!res.ok) {
        setActiveId(previous);
        await load();
      }
    } catch {
      setActiveId(previous);
    }
  };

  if (organizations.length <= 1) return null;

  const className =
    variant === 'on-dark'
      ? 'bg-white/10 text-white border border-white/20 rounded-lg px-2 py-1 text-sm focus:outline-none'
      : 'border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <select
      value={activeId ?? ''}
      onChange={handleChange}
      className={className}
      aria-label="Representing organization"
      title="Select which organization you are representing"
    >
      {organizations.map((o) => (
        <option key={o.id} value={o.id} className="text-gray-900">
          {o.name}{o.isDefault ? ' (default)' : ''}
        </option>
      ))}
    </select>
  );
}
