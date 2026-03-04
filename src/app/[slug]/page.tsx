/**
 * Standalone Workspace Page
 *
 * Main entry point for standalone workspace mode.
 * URL: /{workspace-slug}
 */

import { notFound } from 'next/navigation';
import { getWorkspaceBySlug } from '@/lib/db/compat';
import { WorkspacePageClient } from './WorkspacePageClient';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function StandaloneWorkspacePage({ params }: PageProps) {
  const { slug } = await params;

  // Validate slug format
  if (!/^[a-z0-9]{16}$/.test(slug)) {
    notFound();
  }

  // Get workspace
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace || workspace.type !== 'standalone' || !workspace.is_enabled) {
    notFound();
  }

  return (
    <WorkspacePageClient
      workspaceSlug={slug}
      workspaceName={workspace.name}
      config={{
        primaryColor: workspace.primary_color,
        logoUrl: workspace.logo_url,
        chatTitle: workspace.chat_title,
        greetingMessage: workspace.greeting_message,
        suggestedPrompts: workspace.suggested_prompts,
        voiceEnabled: workspace.voice_enabled,
        fileUploadEnabled: workspace.file_upload_enabled,
        maxFileSizeMb: workspace.max_file_size_mb,
      }}
    />
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;

  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) {
    return { title: 'Not Found' };
  }

  return {
    title: workspace.chat_title || workspace.name,
    description: workspace.greeting_message,
    robots: 'noindex, nofollow',
  };
}
