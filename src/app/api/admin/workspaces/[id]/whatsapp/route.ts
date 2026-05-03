/**
 * Admin WhatsApp Channel API
 *
 * GET    /api/admin/workspaces/[id]/whatsapp - Get WhatsApp channel config
 * PUT    /api/admin/workspaces/[id]/whatsapp - Create or update WhatsApp channel
 * DELETE /api/admin/workspaces/[id]/whatsapp - Delete WhatsApp channel
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getWorkspaceById } from '@/lib/db/compat';
import {
  getWhatsAppChannelByWorkspace,
  createWhatsAppChannel,
  updateWhatsAppChannel,
  deleteWhatsAppChannel,
} from '@/lib/workspace/channels/whatsapp/db';
import type { CreateWhatsAppChannelInput, UpdateWhatsAppChannelInput } from '@/lib/workspace/channels/whatsapp/types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/workspaces/[id]/whatsapp
 *
 * Get WhatsApp channel configuration for a workspace.
 * Never returns secrets in the response.
 */
export async function GET(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { id } = await context.params;

    // Verify workspace exists and is standalone
    const workspace = await getWorkspaceById(id);
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    if (workspace.type !== 'standalone') {
      return NextResponse.json(
        { error: 'WhatsApp channels are only available for standalone workspaces' },
        { status: 400 }
      );
    }

    const channel = await getWhatsAppChannelByWorkspace(id);
    if (!channel) {
      return NextResponse.json({ channel: null });
    }

    // Return safe response (no secrets)
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const host = request.headers.get('host') || 'localhost:3000';
    const webhookUrl = `${protocol}://${host}/api/w/${workspace.slug}/channels/whatsapp/webhook`;

    return NextResponse.json({
      channel: {
        id: channel.id,
        workspace_id: channel.workspace_id,
        phone_number_id: channel.phone_number_id,
        business_account_id: channel.business_account_id,
        display_phone_number: channel.display_phone_number,
        is_enabled: channel.is_enabled,
        webhook_url: webhookUrl,
        created_at: channel.created_at,
        updated_at: channel.updated_at,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error fetching WhatsApp channel:', error);
    return NextResponse.json(
      { error: 'Failed to fetch WhatsApp channel' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/workspaces/[id]/whatsapp
 *
 * Create or update WhatsApp channel configuration.
 */
export async function PUT(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;

    // Verify workspace exists and is standalone
    const workspace = await getWorkspaceById(id);
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    if (workspace.type !== 'standalone') {
      return NextResponse.json(
        { error: 'WhatsApp channels are only available for standalone workspaces' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const {
      phone_number_id,
      business_account_id,
      display_phone_number,
      access_token,
      app_secret,
      webhook_verify_token,
      is_enabled,
    } = body;

    // Check if channel already exists
    const existingChannel = await getWhatsAppChannelByWorkspace(id);

    if (existingChannel) {
      // Update existing channel
      const updateInput: UpdateWhatsAppChannelInput = {};

      if (phone_number_id !== undefined) updateInput.phone_number_id = phone_number_id;
      if (business_account_id !== undefined) updateInput.business_account_id = business_account_id;
      if (display_phone_number !== undefined) updateInput.display_phone_number = display_phone_number;
      if (access_token !== undefined) updateInput.access_token = access_token;
      if (app_secret !== undefined) updateInput.app_secret = app_secret;
      if (webhook_verify_token !== undefined) updateInput.webhook_verify_token = webhook_verify_token;
      if (is_enabled !== undefined) updateInput.is_enabled = is_enabled;

      const updated = await updateWhatsAppChannel(existingChannel.id, updateInput);
      if (!updated) {
        return NextResponse.json(
          { error: 'Failed to update WhatsApp channel' },
          { status: 500 }
        );
      }

      return NextResponse.json({ channel: { id: updated.id } });
    } else {
      // Create new channel
      if (!phone_number_id || !access_token || !app_secret || !webhook_verify_token) {
        return NextResponse.json(
          { error: 'Missing required fields: phone_number_id, access_token, app_secret, webhook_verify_token' },
          { status: 400 }
        );
      }

      const createInput: CreateWhatsAppChannelInput = {
        phone_number_id,
        business_account_id,
        display_phone_number,
        access_token,
        app_secret,
        webhook_verify_token,
      };

      const created = await createWhatsAppChannel(id, createInput, admin.email);

      return NextResponse.json({ channel: { id: created.id } }, { status: 201 });
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error saving WhatsApp channel:', error);
    return NextResponse.json(
      { error: 'Failed to save WhatsApp channel' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/workspaces/[id]/whatsapp
 *
 * Delete WhatsApp channel configuration.
 */
export async function DELETE(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { id } = await context.params;

    const channel = await getWhatsAppChannelByWorkspace(id);
    if (!channel) {
      return NextResponse.json(
        { error: 'WhatsApp channel not found' },
        { status: 404 }
      );
    }

    const deleted = await deleteWhatsAppChannel(channel.id);
    if (!deleted) {
      return NextResponse.json(
        { error: 'Failed to delete WhatsApp channel' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Admin access required') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.error('Error deleting WhatsApp channel:', error);
    return NextResponse.json(
      { error: 'Failed to delete WhatsApp channel' },
      { status: 500 }
    );
  }
}