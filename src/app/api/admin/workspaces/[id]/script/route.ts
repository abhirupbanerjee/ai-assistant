/**
 * Admin Workspace Embed Script API
 *
 * GET /api/admin/workspaces/[id]/script - Get embed script for workspace
 */

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireAdmin } from '@/lib/auth';
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
    await requireAdmin();

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
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error generating workspace script:', error);
    return NextResponse.json(
      { error: 'Failed to generate script' },
      { status: 500 }
    );
  }
}
