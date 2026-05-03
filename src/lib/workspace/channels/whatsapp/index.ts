/**
 * WhatsApp Channel Module
 *
 * Provides WhatsApp Business API integration for standalone workspaces.
 * Each standalone workspace can have one WhatsApp channel attached.
 *
 * Usage:
 * 1. Admin creates a standalone workspace
 * 2. Admin configures WhatsApp channel via the admin UI
 * 3. Meta webhooks are sent to /api/w/[slug]/channels/whatsapp/webhook
 * 4. Messages are processed and responses sent via WhatsApp Cloud API
 */

// Types
export type {
  WhatsAppChannel,
  WhatsAppChannelWithWorkspace,
  WhatsAppContact,
  WhatsAppMessage,
  WhatsAppMessageDirection,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
  CreateWhatsAppChannelInput,
  UpdateWhatsAppChannelInput,
  WhatsAppChannelApiResponse,
  MetaWebhookEntry,
  MetaWebhookChange,
  MetaWebhookValue,
  MetaWebhookContact,
  MetaWebhookMessage,
  MetaWebhookStatus,
  MetaSendMessageRequest,
  MetaSendMessageResponse,
} from './types';

// Client
export { WhatsAppClient, splitMessageForWhatsApp, calculateServiceWindowExpiry, isServiceWindowActive } from './client';

// Signature verification
export { generateSignature, verifySignature, verifyWebhookToken, hashWebhookToken } from './signature';

// Database operations
export {
  getWhatsAppChannelByWorkspace,
  getWhatsAppChannelByPhoneNumberId,
  getWhatsAppChannelById,
  createWhatsAppChannel,
  updateWhatsAppChannel,
  deleteWhatsAppChannel,
  decryptAccessToken,
  decryptAppSecret,
  getOrCreateWhatsAppContact,
  updateContactServiceWindow,
  getWhatsAppContactById,
  isMessageProcessed,
  logInboundMessage,
  logOutboundMessage,
  updateMessageStatus,
} from './db';

// Message processor
export { processWhatsAppWebhook, verifyWebhookChallenge } from './processor';