/**
 * WhatsApp Channel Database Operations
 *
 * CRUD operations for WhatsApp channels, contacts, and messages.
 * Uses Kysely for PostgreSQL access.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, transaction } from '@/lib/db/kysely';
import { encrypt, decrypt } from '@/lib/encryption';
import { hashWebhookToken } from './signature';
import type {
  WhatsAppChannel,
  WhatsAppContact,
  WhatsAppMessage,
  CreateWhatsAppChannelInput,
  UpdateWhatsAppChannelInput,
} from './types';

// ============================================================================
// Channel Operations
// ============================================================================

/**
 * Get WhatsApp channel by workspace ID
 */
export async function getWhatsAppChannelByWorkspace(
  workspaceId: string
): Promise<WhatsAppChannel | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_whatsapp_channels')
    .selectAll()
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();

  return row ? rowToChannel(row) : null;
}

/**
 * Get WhatsApp channel by phone number ID
 */
export async function getWhatsAppChannelByPhoneNumberId(
  phoneNumberId: string
): Promise<WhatsAppChannel | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_whatsapp_channels')
    .selectAll()
    .where('phone_number_id', '=', phoneNumberId)
    .executeTakeFirst();

  return row ? rowToChannel(row) : null;
}

/**
 * Get WhatsApp channel by ID
 */
export async function getWhatsAppChannelById(id: string): Promise<WhatsAppChannel | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_whatsapp_channels')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? rowToChannel(row) : null;
}

/**
 * Create a WhatsApp channel for a workspace
 */
export async function createWhatsAppChannel(
  workspaceId: string,
  input: CreateWhatsAppChannelInput,
  createdBy: string
): Promise<WhatsAppChannel> {
  const id = uuidv4();
  const accessTokenEncrypted = encrypt(input.access_token);
  const appSecretEncrypted = encrypt(input.app_secret);
  const webhookVerifyTokenHash = hashWebhookToken(input.webhook_verify_token);

  const db = await getDb();
  await db
    .insertInto('workspace_whatsapp_channels')
    .values({
      id,
      workspace_id: workspaceId,
      phone_number_id: input.phone_number_id,
      business_account_id: input.business_account_id || null,
      display_phone_number: input.display_phone_number || null,
      access_token_encrypted: accessTokenEncrypted,
      app_secret_encrypted: appSecretEncrypted,
      webhook_verify_token_hash: webhookVerifyTokenHash,
      is_enabled: 1,
      created_by: createdBy,
    })
    .execute();

  const channel = await getWhatsAppChannelById(id);
  if (!channel) {
    throw new Error('Failed to create WhatsApp channel');
  }
  return channel;
}

/**
 * Update a WhatsApp channel
 */
export async function updateWhatsAppChannel(
  id: string,
  input: UpdateWhatsAppChannelInput
): Promise<WhatsAppChannel | null> {
  const db = await getDb();
  const updates: Record<string, unknown> = {};

  if (input.phone_number_id !== undefined) {
    updates.phone_number_id = input.phone_number_id;
  }
  if (input.business_account_id !== undefined) {
    updates.business_account_id = input.business_account_id;
  }
  if (input.display_phone_number !== undefined) {
    updates.display_phone_number = input.display_phone_number;
  }
  if (input.access_token !== undefined) {
    updates.access_token_encrypted = encrypt(input.access_token);
  }
  if (input.app_secret !== undefined) {
    updates.app_secret_encrypted = encrypt(input.app_secret);
  }
  if (input.webhook_verify_token !== undefined) {
    updates.webhook_verify_token_hash = hashWebhookToken(input.webhook_verify_token);
  }
  if (input.is_enabled !== undefined) {
    updates.is_enabled = input.is_enabled ? 1 : 0;
  }

  if (Object.keys(updates).length === 0) {
    return getWhatsAppChannelById(id);
  }

  await db
    .updateTable('workspace_whatsapp_channels')
    .set(updates)
    .where('id', '=', id)
    .execute();

  return getWhatsAppChannelById(id);
}

/**
 * Delete a WhatsApp channel
 */
export async function deleteWhatsAppChannel(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .deleteFrom('workspace_whatsapp_channels')
    .where('id', '=', id)
    .executeTakeFirst();

  return result.numDeletedRows > 0;
}

/**
 * Decrypt the access token for a channel
 */
export function decryptAccessToken(channel: WhatsAppChannel): string {
  return decrypt(channel.access_token_encrypted);
}

/**
 * Decrypt the app secret for a channel
 */
export function decryptAppSecret(channel: WhatsAppChannel): string {
  return decrypt(channel.app_secret_encrypted);
}

// ============================================================================
// Contact Operations
// ============================================================================

/**
 * Get or create a WhatsApp contact for a channel
 * Maps a WhatsApp phone number to a workspace session and thread
 */
export async function getOrCreateWhatsAppContact(
  channelId: string,
  waId: string,
  displayName: string | null,
  workspaceId: string
): Promise<WhatsAppContact> {
  const db = await getDb();

  // Try to get existing contact
  const existing = await db
    .selectFrom('workspace_whatsapp_contacts')
    .selectAll()
    .where('channel_id', '=', channelId)
    .where('wa_id', '=', waId)
    .executeTakeFirst();

  if (existing) {
    return rowToContact(existing);
  }

  // Create new session and thread for this contact
  const sessionId = uuidv4();
  const threadId = uuidv4();
  const now = new Date().toISOString();

  // Create session
  await db
    .insertInto('workspace_sessions')
    .values({
      id: sessionId,
      workspace_id: workspaceId,
      visitor_id: null,
      user_id: null,
      referrer_url: null,
      ip_hash: null,
      message_count: 0,
      started_at: now,
      last_activity: now,
      expires_at: null,
    })
    .execute();

  // Create thread
  await db
    .insertInto('workspace_threads')
    .values({
      id: threadId,
      workspace_id: workspaceId,
      session_id: sessionId,
      title: displayName || `WhatsApp: ${waId}`,
      is_archived: 0,
    })
    .execute();

  // Create contact
  const contactId = uuidv4();
  const serviceWindowExpiry = new Date();
  serviceWindowExpiry.setHours(serviceWindowExpiry.getHours() + 24);

  await db
    .insertInto('workspace_whatsapp_contacts')
    .values({
      id: contactId,
      channel_id: channelId,
      wa_id: waId,
      display_name: displayName,
      workspace_session_id: sessionId,
      workspace_thread_id: threadId,
      last_inbound_at: now,
      service_window_expires_at: serviceWindowExpiry.toISOString(),
    })
    .execute();

  const contact = await db
    .selectFrom('workspace_whatsapp_contacts')
    .selectAll()
    .where('id', '=', contactId)
    .executeTakeFirst();

  if (!contact) {
    throw new Error('Failed to create WhatsApp contact');
  }

  return rowToContact(contact);
}

/**
 * Update contact's last inbound time and service window
 */
export async function updateContactServiceWindow(contactId: string): Promise<void> {
  const db = await getDb();
  const serviceWindowExpiry = new Date();
  serviceWindowExpiry.setHours(serviceWindowExpiry.getHours() + 24);

  await db
    .updateTable('workspace_whatsapp_contacts')
    .set({
      last_inbound_at: new Date().toISOString(),
      service_window_expires_at: serviceWindowExpiry.toISOString(),
    })
    .where('id', '=', contactId)
    .execute();
}

/**
 * Get contact by ID
 */
export async function getWhatsAppContactById(id: string): Promise<WhatsAppContact | null> {
  const db = await getDb();
  const row = await db
    .selectFrom('workspace_whatsapp_contacts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  return row ? rowToContact(row) : null;
}

// ============================================================================
// Message Operations
// ============================================================================

/**
 * Check if a message has already been processed (idempotency)
 */
export async function isMessageProcessed(
  channelId: string,
  metaMessageId: string
): Promise<boolean> {
  const db = await getDb();
  const result = await db
    .selectFrom('workspace_whatsapp_messages')
    .select('id')
    .where('channel_id', '=', channelId)
    .where('meta_message_id', '=', metaMessageId)
    .executeTakeFirst();

  return !!result;
}

/**
 * Log an inbound WhatsApp message
 */
export async function logInboundMessage(
  channelId: string,
  contactId: string | null,
  metaMessageId: string,
  messageType: string,
  textContent: string | null,
  rawPayload: unknown
): Promise<WhatsAppMessage> {
  const db = await getDb();
  const id = uuidv4();

  await db
    .insertInto('workspace_whatsapp_messages')
    .values({
      id,
      channel_id: channelId,
      contact_id: contactId,
      workspace_message_id: null,
      meta_message_id: metaMessageId,
      direction: 'inbound',
      status: 'received',
      message_type: messageType,
      text_content: textContent,
      error_message: null,
      raw_payload_json: JSON.stringify(rawPayload),
    })
    .execute();

  const message = await db
    .selectFrom('workspace_whatsapp_messages')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!message) {
    throw new Error('Failed to log inbound message');
  }

  return rowToMessage(message);
}

/**
 * Log an outbound WhatsApp message
 */
export async function logOutboundMessage(
  channelId: string,
  contactId: string | null,
  workspaceMessageId: string | null,
  metaMessageId: string,
  messageType: string,
  textContent: string | null
): Promise<WhatsAppMessage> {
  const db = await getDb();
  const id = uuidv4();

  await db
    .insertInto('workspace_whatsapp_messages')
    .values({
      id,
      channel_id: channelId,
      contact_id: contactId,
      workspace_message_id: workspaceMessageId,
      meta_message_id: metaMessageId,
      direction: 'outbound',
      status: 'sent',
      message_type: messageType,
      text_content: textContent,
      error_message: null,
      raw_payload_json: null,
    })
    .execute();

  const message = await db
    .selectFrom('workspace_whatsapp_messages')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();

  if (!message) {
    throw new Error('Failed to log outbound message');
  }

  return rowToMessage(message);
}

/**
 * Update message status (for delivery receipts)
 */
export async function updateMessageStatus(
  channelId: string,
  metaMessageId: string,
  status: string
): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('workspace_whatsapp_messages')
    .set({ status })
    .where('channel_id', '=', channelId)
    .where('meta_message_id', '=', metaMessageId)
    .execute();
}

// ============================================================================
// Row Converters
// ============================================================================

function rowToChannel(row: Record<string, unknown>): WhatsAppChannel {
  return {
    id: row.id as string,
    workspace_id: row.workspace_id as string,
    phone_number_id: row.phone_number_id as string,
    business_account_id: row.business_account_id as string | null,
    display_phone_number: row.display_phone_number as string | null,
    access_token_encrypted: row.access_token_encrypted as string,
    app_secret_encrypted: row.app_secret_encrypted as string,
    webhook_verify_token_hash: row.webhook_verify_token_hash as string,
    is_enabled: (row.is_enabled as number) === 1,
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToContact(row: Record<string, unknown>): WhatsAppContact {
  return {
    id: row.id as string,
    channel_id: row.channel_id as string,
    wa_id: row.wa_id as string,
    display_name: row.display_name as string | null,
    workspace_session_id: row.workspace_session_id as string,
    workspace_thread_id: row.workspace_thread_id as string,
    last_inbound_at: row.last_inbound_at as string | null,
    service_window_expires_at: row.service_window_expires_at as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function rowToMessage(row: Record<string, unknown>): WhatsAppMessage {
  return {
    id: row.id as string,
    channel_id: row.channel_id as string,
    contact_id: row.contact_id as string | null,
    workspace_message_id: row.workspace_message_id as string | null,
    meta_message_id: row.meta_message_id as string,
    direction: row.direction as 'inbound' | 'outbound',
    status: row.status as WhatsAppMessage['status'],
    message_type: row.message_type as WhatsAppMessage['message_type'],
    text_content: row.text_content as string | null,
    error_message: row.error_message as string | null,
    raw_payload_json: row.raw_payload_json as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}