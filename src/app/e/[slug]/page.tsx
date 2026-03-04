/**
 * Hosted Embed Page
 *
 * A full-page embed experience that can be iframed or accessed directly.
 * URL: /e/{workspace-slug}
 */

import { notFound, redirect } from 'next/navigation';
import { getWorkspaceBySlug } from '@/lib/db/compat';
import { isWorkspacesFeatureEnabled } from '@/lib/workspace/validator';
import { getCurrentUser } from '@/lib/auth';
import { EmbedPageClient } from './EmbedPageClient';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function HostedEmbedPage({ params }: PageProps) {
  const { slug } = await params;

  // Check if workspaces feature is enabled
  if (!isWorkspacesFeatureEnabled()) {
    notFound();
  }

  // Validate slug format
  if (!/^[a-z0-9]{16}$/.test(slug)) {
    notFound();
  }

  // Get workspace
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) {
    notFound();
  }

  // Must be embed type
  if (workspace.type !== 'embed') {
    notFound();
  }

  // Check if workspace is enabled
  if (!workspace.is_enabled) {
    notFound();
  }

  // Check if authentication is required for this embed
  if (workspace.auth_required) {
    const user = await getCurrentUser();
    if (!user) {
      redirect(`/auth/signin?callbackUrl=/e/${slug}`);
    }
  }

  return (
    <EmbedPageClient
      workspaceSlug={slug}
      config={{
        primaryColor: workspace.primary_color,
        logoUrl: workspace.logo_url,
        chatTitle: workspace.chat_title,
        greetingMessage: workspace.greeting_message,
        suggestedPrompts: workspace.suggested_prompts,
        footerText: workspace.footer_text,
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
