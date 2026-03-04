/**
 * Standalone Workspace Layout
 *
 * Layout for standalone workspace mode.
 * Validates slug format to avoid conflicts with other routes.
 */

import { notFound } from 'next/navigation';
import { getWorkspaceBySlug } from '@/lib/db/compat';
import { isWorkspacesFeatureEnabled } from '@/lib/workspace/validator';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function WorkspaceLayout({ children, params }: LayoutProps) {
  const { slug } = await params;

  // Only handle 16-char alphanumeric slugs (workspace URLs)
  // This prevents conflicts with /admin, /profile, /auth, etc.
  if (!/^[a-z0-9]{16}$/.test(slug)) {
    notFound();
  }

  // Check if workspaces feature is enabled
  if (!isWorkspacesFeatureEnabled()) {
    notFound();
  }

  // Validate workspace exists and is standalone type
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) {
    notFound();
  }

  if (workspace.type !== 'standalone') {
    notFound();
  }

  if (!workspace.is_enabled) {
    notFound();
  }

  return <>{children}</>;
}
