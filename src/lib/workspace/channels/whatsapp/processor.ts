/**
 * WhatsApp Message Processor
 *
 * Handles incoming WhatsApp messages and generates responses using
 * the workspace chat infrastructure.
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '@/lib/db/kysely';
import {
  getWhatsAppChannelByPhoneNumberId,
  getOrCreateWhatsAppContact,
  updateContactServiceWindow,
  isMessageProcessed,
  logInboundMessage,
  logOutboundMessage,
  decryptAccessToken,
  decryptAppSecret,
} from './db';
import {
  WhatsAppClient,
  splitMessageForWhatsApp,
} from './client';
import { verifySignature } from './signature';
import type {
  WhatsAppChannel,
  WhatsAppContact,
  MetaWebhookEntry,
  MetaWebhookMessage,
  MetaWebhookContact,
} from './types';

/**
 * Process incoming WhatsApp webhook data
 */
export async function processWhatsAppWebhook(
  phoneNumberId: string,
  entries: MetaWebhookEntry[],
  rawPayload: string,
  signature: string
): Promise<{ success: boolean; error?: string }> {
  // Get channel by phone number ID
  const channel = await getWhatsAppChannelByPhoneNumberId(phoneNumberId);
  if (!channel) {
    console.warn(`[WhatsApp] No channel found for phone number ID: ${phoneNumberId}`);
    return { success: false, error: 'Channel not found' };
  }

  if (!channel.is_enabled) {
    console.warn(`[WhatsApp] Channel ${channel.id} is disabled`);
    return { success: false, error: 'Channel disabled' };
  }

  // Verify signature
  const appSecret = decryptAppSecret(channel);
  if (!verifySignature(rawPayload, signature, appSecret)) {
    console.error(`[WhatsApp] Invalid signature for channel ${channel.id}`);
    return { success: false, error: 'Invalid signature' };
  }

  // Process each entry
  for (const entry of entries) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') {
        continue;
      }

      const { messages, contacts, statuses } = change.value;

      // Handle incoming messages
      if (messages && messages.length > 0) {
        for (const message of messages) {
          await processInboundMessage(channel, message, contacts || []);
        }
      }

      // Handle status updates (delivery receipts)
      if (statuses && statuses.length > 0) {
        for (const status of statuses) {
          await processStatusUpdate(channel, status.id, status.status);
        }
      }
    }
  }

  return { success: true };
}

/**
 * Process a single inbound WhatsApp message
 */
async function processInboundMessage(
  channel: WhatsAppChannel,
  message: MetaWebhookMessage,
  contacts: MetaWebhookContact[]
): Promise<void> {
  const metaMessageId = message.id;

  // Check for duplicate (idempotency)
  if (await isMessageProcessed(channel.id, metaMessageId)) {
    console.log(`[WhatsApp] Message ${metaMessageId} already processed`);
    return;
  }

  // Get contact info
  const waId = message.from;
  const contactInfo = contacts.find(c => c.wa_id === waId);
  const displayName = contactInfo?.profile?.name || null;

  // Get or create contact (with session/thread)
  const contact = await getOrCreateWhatsAppContact(
    channel.id,
    waId,
    displayName,
    channel.workspace_id
  );

  // Update service window
  await updateContactServiceWindow(contact.id);

  // Extract message content based on type
  let textContent: string | null = null;
  let messageType = 'text';

  switch (message.type) {
    case 'text':
      textContent = message.text?.body || null;
      messageType = 'text';
      break;
    case 'image':
      textContent = message.image?.caption || '[Image received]';
      messageType = 'image';
      break;
    case 'document':
      textContent = message.document?.caption || message.document?.filename || '[Document received]';
      messageType = 'document';
      break;
    case 'audio':
      textContent = '[Audio received]';
      messageType = 'audio';
      break;
    default:
      textContent = `[${message.type} received]`;
      messageType = message.type;
  }

  // Log inbound message
  await logInboundMessage(
    channel.id,
    contact.id,
    metaMessageId,
    messageType,
    textContent,
    message
  );

  // Only process text messages for AI response in MVP
  if (messageType !== 'text' || !textContent) {
    console.log(`[WhatsApp] Skipping non-text message type: ${messageType}`);
    return;
  }

  try {
    // Generate response using workspace chat
    const response = await generateWorkspaceResponse(
      channel,
      contact,
      textContent
    );

    if (response) {
      // Send response via WhatsApp
      await sendWhatsAppResponse(channel, contact, response);
    }
  } catch (error) {
    console.error(`[WhatsApp] Error processing message ${metaMessageId}:`, error);
  }
}

/**
 * Generate a response using the workspace chat infrastructure
 */
async function generateWorkspaceResponse(
  channel: WhatsAppChannel,
  contact: WhatsAppContact,
  userMessage: string
): Promise<string | null> {
  const db = await getDb();

  // Get workspace
  const workspace = await db
    .selectFrom('workspaces')
    .selectAll()
    .where('id', '=', channel.workspace_id)
    .executeTakeFirst();

  if (!workspace) {
    console.error(`[WhatsApp] Workspace ${channel.workspace_id} not found`);
    return null;
  }

  // Get recent messages for context
  const recentMessages = await db
    .selectFrom('workspace_messages')
    .selectAll()
    .where('thread_id', '=', contact.workspace_thread_id)
    .orderBy('created_at', 'desc')
    .limit(10)
    .execute();

  // Build conversation history
  const conversationHistory = recentMessages
    .reverse()
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  // Get workspace categories for RAG
  const categorySlugs = await db
    .selectFrom('workspace_categories')
    .innerJoin('categories', 'workspace_categories.category_id', 'categories.id')
    .select('categories.slug')
    .where('workspace_categories.workspace_id', '=', channel.workspace_id)
    .execute();

  const categorySlugList = categorySlugs.map(c => c.slug);

  // Store user message in workspace_messages
  const userMsgId = uuidv4();
  await db
    .insertInto('workspace_messages')
    .values({
      id: userMsgId,
      workspace_id: channel.workspace_id,
      session_id: contact.workspace_session_id,
      thread_id: contact.workspace_thread_id,
      role: 'user',
      content: userMessage,
      sources_json: null,
      latency_ms: null,
      tokens_used: null,
      model: null,
    })
    .execute();

  // For MVP, use a simple LLM call without full RAG
  // This can be enhanced later to use the full workspace chat pipeline
  const response = await callLLMForWhatsApp(
    workspace.system_prompt || 'You are a helpful assistant.',
    conversationHistory,
    userMessage,
    categorySlugList
  );

  if (!response) {
    return null;
  }

  // Store assistant message in workspace_messages
  const assistantMsgId = uuidv4();
  await db
    .insertInto('workspace_messages')
    .values({
      id: assistantMsgId,
      workspace_id: channel.workspace_id,
      session_id: contact.workspace_session_id,
      thread_id: contact.workspace_thread_id,
      role: 'assistant',
      content: response,
      sources_json: null,
      latency_ms: null,
      tokens_used: null,
      model: null,
    })
    .execute();

  // Update session message count
  await db
    .updateTable('workspace_sessions')
    .set({
      message_count: Number(recentMessages.length) + 2,
      last_activity: new Date().toISOString(),
    })
    .where('id', '=', contact.workspace_session_id)
    .execute();

  // Update thread
  await db
    .updateTable('workspace_threads')
    .set({ updated_at: new Date().toISOString() })
    .where('id', '=', contact.workspace_thread_id)
    .execute();

  return response;
}

/**
 * Simple LLM call for WhatsApp responses
 * Uses the configured LLM settings for the workspace
 */
async function callLLMForWhatsApp(
  systemPrompt: string,
  conversationHistory: string,
  userMessage: string,
  categorySlugs: string[]
): Promise<string | null> {
  try {
    // Import LLM client
    const { getLlmSettings } = await import('@/lib/db/compat/config');
    const { createInternalCompletion } = await import('@/lib/llm-client');

    const llmSettings = await getLlmSettings();

    type MessageRole = 'system' | 'user' | 'assistant';
    const messages: Array<{ role: MessageRole; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (conversationHistory) {
      messages.push({
        role: 'user',
        content: `Previous conversation:\n${conversationHistory}\n\n---\n\nNew message: ${userMessage}`,
      });
    } else {
      messages.push({ role: 'user', content: userMessage });
    }

    const response = await createInternalCompletion({
      messages,
      model: llmSettings.model,
      temperature: 0.7,
      maxTokens: 2000,
    });

    return typeof response === 'string' ? response : response;
  } catch (error) {
    console.error('[WhatsApp] LLM call failed:', error);
    return null;
  }
}

/**
 * Send a response via WhatsApp
 */
async function sendWhatsAppResponse(
  channel: WhatsAppChannel,
  contact: WhatsAppContact,
  response: string
): Promise<void> {
  const accessToken = decryptAccessToken(channel);
  const client = new WhatsAppClient(channel.phone_number_id, accessToken);

  // Split long messages
  const chunks = splitMessageForWhatsApp(response);

  for (const chunk of chunks) {
    try {
      const result = await client.sendTextMessage(contact.wa_id, chunk);

      // Log outbound message
      if (result.messages && result.messages[0]) {
        await logOutboundMessage(
          channel.id,
          contact.id,
          null,
          result.messages[0].id,
          'text',
          chunk
        );
      }
    } catch (error) {
      console.error(`[WhatsApp] Failed to send message to ${contact.wa_id}:`, error);
    }
  }
}

/**
 * Process a status update (delivery/read receipt)
 */
async function processStatusUpdate(
  channel: WhatsAppChannel,
  metaMessageId: string,
  status: string
): Promise<void> {
  try {
    const { updateMessageStatus } = await import('./db');
    await updateMessageStatus(channel.id, metaMessageId, status);
  } catch (error) {
    console.error(`[WhatsApp] Failed to update message status:`, error);
  }
}

/**
 * Verify webhook challenge (GET request from Meta)
 */
export async function verifyWebhookChallenge(
  phoneNumberId: string,
  verifyToken: string
): Promise<{ verified: boolean; challenge?: string }> {
  const channel = await getWhatsAppChannelByPhoneNumberId(phoneNumberId);
  if (!channel) {
    return { verified: false };
  }

  const { verifyWebhookToken } = await import('./signature');
  const verified = verifyWebhookToken(verifyToken, channel.webhook_verify_token_hash);

  return { verified };
}