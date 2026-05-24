'use client';

/**
 * Workspace Page Client
 *
 * Client-side wrapper for the standalone workspace chat.
 */

import { WorkspaceChat } from '@/components/workspace';

interface WorkspaceConfig {
  primaryColor: string;
  logoUrl: string | null;
  chatTitle: string | null;
  greetingMessage: string;
  suggestedPrompts: string[] | null;
  voiceEnabled: boolean;
  fileUploadEnabled: boolean;
  maxFileSizeMb: number;
  sourcesEnabled: boolean;
}

interface WorkspacePageClientProps {
  workspaceSlug: string;
  workspaceName: string;
  config: WorkspaceConfig;
  initialThreadId?: string;
}

export function WorkspacePageClient({
  workspaceSlug,
  workspaceName,
  config,
  initialThreadId,
}: WorkspacePageClientProps) {
  return (
    <WorkspaceChat
      workspaceSlug={workspaceSlug}
      workspaceName={workspaceName}
      config={config}
      initialThreadId={initialThreadId}
    />
  );
}
