'use client';

/**
 * Phase F (plan §12.3): legacy fragmented settings sections are not deleted —
 * they render this read-only redirect card pointing admins at the consolidated
 * AI & API Setup page.
 */

import { useRouter } from 'next/navigation';
import { Lock, ArrowRight } from 'lucide-react';
import Button from '@/components/ui/Button';

interface LegacySettingsRedirectProps {
  /** Human-readable name of the legacy section (e.g. "API Keys & Credentials"). */
  title: string;
  /** Short description of what used to live here. */
  description?: string;
}

export default function LegacySettingsRedirect({
  title,
  description,
}: LegacySettingsRedirectProps) {
  const router = useRouter();

  return (
    <div className="bg-white border rounded-xl p-8 max-w-2xl">
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
          <Lock size={18} className="text-blue-600" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500 mt-1">
            This section is now read-only. {description ?? 'Its settings have moved to the consolidated AI & API Setup page.'}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            Configure provider keys, models, and AI/API capabilities from a single place.
          </p>
          <div className="mt-4">
            <Button
              onClick={() => router.push('/admin?tab=settings&section=ai-setup')}
              variant="primary"
              size="sm"
            >
              <span>Open AI & API Setup</span>
              <ArrowRight size={16} className="ml-1.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
