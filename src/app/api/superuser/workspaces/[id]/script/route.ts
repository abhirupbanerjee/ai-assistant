/**
 * SuperUser Workspace Embed Script API
 *
 * GET /api/superuser/workspaces/[id]/script - Get embed script for workspace (only if created by superuser)
 */

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole } from '@/lib/users';
import { getWorkspaceById } from '@/lib/db/compat';
import {
  generateEmbedScriptWithOptions,
  generateIframeEmbed,
  getHostedEmbedUrl,
  getStandaloneUrl,
} from '@/lib/workspace/script-generator';
import { isWorkspacesFeatureEnabled } from '@/lib/workspace/validator';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = await getUserRole(user.email);
    if (role !== 'superuser') {
      return NextResponse.json({ error: 'Super user access required' }, { status: 403 });
    }

    const { id } = await params;

    if (!(await isWorkspacesFeatureEnabled())) {
      return NextResponse.json(
        { error: 'Workspaces feature is disabled' },
        { status: 403 }
      );
    }

    const workspace = await getWorkspaceById(id);
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    // Verify superuser created this workspace
    if (workspace.created_by !== user.email || workspace.created_by_role !== 'superuser') {
      return NextResponse.json(
        { error: 'You can only access embed code for workspaces you created' },
        { status: 403 }
      );
    }

    // Get base URL from request headers
    const headersList = await headers();
    const host = headersList.get('host') || 'localhost:3000';
    const protocol = headersList.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;

    if (workspace.type === 'embed') {
      // Generate embed scripts
      const scripts = generateEmbedScriptWithOptions(workspace, baseUrl);
      const iframeEmbed = generateIframeEmbed(workspace, baseUrl);
      const hostedUrl = getHostedEmbedUrl(workspace, baseUrl);

      return NextResponse.json({
        type: 'embed',
        scripts,
        iframeEmbed,
        hostedUrl,
      });
    } else {
      // Generate standalone URL
      const standaloneUrl = getStandaloneUrl(workspace, baseUrl);

      return NextResponse.json({
        type: 'standalone',
        standaloneUrl,
      });
    }
  } catch (error) {
    console.error('Error generating workspace script:', error);
    return NextResponse.json(
      { error: 'Failed to generate script' },
      { status: 500 }
    );
  }
}
