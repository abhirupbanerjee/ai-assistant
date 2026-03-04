/**
 * Thread View Page
 *
 * Direct link to a specific thread in a standalone workspace.
 * URL: /{workspace-slug}/thread/{thread-id}
 */

import { notFound } from 'next/navigation';
import { getWorkspaceBySlug, getWorkspaceThread as getThread } from '@/lib/db/compat';
import { WorkspacePageClient } from '../../WorkspacePageClient';

interface PageProps {
  params: Promise<{ slug: string; threadId: string }>;
}

export default async function ThreadViewPage({ params }: PageProps) {
  const { slug, threadId } = await params;

  // Validate slug format
  if (!/^[a-z0-9]{16}$/.test(slug)) {
    notFound();
  }

  // Get workspace
  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace || workspace.type !== 'standalone' || !workspace.is_enabled) {
    notFound();
  }

  // Validate thread exists and belongs to this workspace
  const thread = await getThread(threadId);
  if (!thread || thread.workspace_id !== workspace.id) {
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
      initialThreadId={threadId}
    />
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { slug, threadId } = await params;

  const workspace = await getWorkspaceBySlug(slug);
  if (!workspace) {
    return { title: 'Not Found' };
  }

  const thread = await getThread(threadId);
  const title = thread?.title || 'Chat';

  return {
    title: `${title} | ${workspace.chat_title || workspace.name}`,
    robots: 'noindex, nofollow',
  };
}
