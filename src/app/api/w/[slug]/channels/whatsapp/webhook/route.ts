/**
 * WhatsApp Webhook Endpoint
 *
 * Handles webhook requests from Meta's WhatsApp Cloud API.
 *
 * GET  - Webhook verification challenge from Meta
 * POST - Incoming messages and status updates from Meta
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWorkspaceBySlug } from '@/lib/db/compat';
import { getWhatsAppChannelByWorkspace } from '@/lib/workspace/channels/whatsapp/db';
import {
  processWhatsAppWebhook,
  verifyWebhookChallenge,
} from '@/lib/workspace/channels/whatsapp/processor';
import type { MetaWebhookEntry } from '@/lib/workspace/channels/whatsapp/types';

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/w/[slug]/channels/whatsapp/webhook
 *
 * Webhook verification challenge from Meta.
 * Meta sends: hub.mode, hub.verify_token, hub.challenge
 * We must respond with the challenge if the verify token matches.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { slug } = await context.params;
    const { searchParams } = new URL(request.url);

    const mode = searchParams.get('hub.mode');
    const verifyToken = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    // Validate required parameters
    if (mode !== 'subscribe' || !verifyToken || !challenge) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Get workspace
    const workspace = await getWorkspaceBySlug(slug);
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    // Get WhatsApp channel
    const channel = await getWhatsAppChannelByWorkspace(workspace.id);
    if (!channel) {
      return NextResponse.json(
        { error: 'WhatsApp channel not found' },
        { status: 404 }
      );
    }

    // Verify the token
    const result = await verifyWebhookChallenge(channel.phone_number_id, verifyToken);

    if (!result.verified) {
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 403 }
      );
    }

    // Return the challenge as plain text (Meta expects this)
    return new NextResponse(challenge, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
      },
    });
  } catch (error) {
    console.error('WhatsApp webhook verification error:', error);
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/w/[slug]/channels/whatsapp/webhook
 *
 * Incoming messages and status updates from Meta.
 * Payload format: { object: 'whatsapp_business_account', entry: [...] }
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { slug } = await context.params;

    // Get workspace
    const workspace = await getWorkspaceBySlug(slug);
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    // Get WhatsApp channel
    const channel = await getWhatsAppChannelByWorkspace(workspace.id);
    if (!channel) {
      return NextResponse.json(
        { error: 'WhatsApp channel not found' },
        { status: 404 }
      );
    }

    if (!channel.is_enabled) {
      return NextResponse.json(
        { error: 'WhatsApp channel is disabled' },
        { status: 403 }
      );
    }

    // Get raw payload for signature verification
    const rawPayload = await request.text();

    // Get signature from header
    const signature = request.headers.get('x-hub-signature-256') || '';

    // Parse payload
    let payload: { object: string; entry: MetaWebhookEntry[] };
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    // Validate payload structure
    if (payload.object !== 'whatsapp_business_account' || !payload.entry) {
      return NextResponse.json(
        { error: 'Invalid webhook payload structure' },
        { status: 400 }
      );
    }

    // Process the webhook
    const result = await processWhatsAppWebhook(
      channel.phone_number_id,
      payload.entry,
      rawPayload,
      signature
    );

    if (!result.success) {
      // Return 200 even for errors to avoid Meta retries for known issues
      // Meta will retry on 5xx errors
      if (result.error === 'Invalid signature') {
        return NextResponse.json(
          { error: result.error },
          { status: 403 }
        );
      }

      // For other errors, return 200 to acknowledge receipt
      return NextResponse.json({ status: 'acknowledged', error: result.error });
    }

    // Meta expects a 200 response
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('WhatsApp webhook processing error:', error);
    // Return 200 to prevent Meta retries
    return NextResponse.json({ status: 'error', message: 'Processing failed' });
  }
}