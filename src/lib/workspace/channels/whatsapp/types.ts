/**
 * WhatsApp Channel Types
 *
 * Type definitions for WhatsApp Business API integration.
 * Each standalone workspace can have one WhatsApp channel attached.
 */

// ============================================================================
// WhatsApp Channel Configuration
// ============================================================================

export interface WhatsAppChannel {
  id: string;
  workspace_id: string;
  phone_number_id: string;
  business_account_id: string | null;
  display_phone_number: string | null;
  access_token_encrypted: string;
  app_secret_encrypted: string;
  webhook_verify_token_hash: string;
  is_enabled: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppChannelWithWorkspace extends WhatsAppChannel {
  workspace_name: string;
  workspace_slug: string;
}

// ============================================================================
// WhatsApp Contact (maps phone number to workspace session/thread)
// ============================================================================

export interface WhatsAppContact {
  id: string;
  channel_id: string;
  wa_id: string; // WhatsApp phone number (e.g., "1234567890")
  display_name: string | null;
  workspace_session_id: string;
  workspace_thread_id: string;
  last_inbound_at: string | null;
  service_window_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// WhatsApp Message Log
// ============================================================================

export type WhatsAppMessageDirection = 'inbound' | 'outbound';
export type WhatsAppMessageStatus = 'received' | 'sent' | 'delivered' | 'read' | 'failed';
export type WhatsAppMessageType = 'text' | 'image' | 'document' | 'audio' | 'video' | 'template';

export interface WhatsAppMessage {
  id: string;
  channel_id: string;
  contact_id: string | null;
  workspace_message_id: string | null;
  meta_message_id: string;
  direction: WhatsAppMessageDirection;
  status: WhatsAppMessageStatus;
  message_type: WhatsAppMessageType;
  text_content: string | null;
  error_message: string | null;
  raw_payload_json: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreateWhatsAppChannelInput {
  phone_number_id: string;
  business_account_id?: string;
  display_phone_number?: string;
  access_token: string; // Will be encrypted before storage
  app_secret: string; // Will be encrypted before storage
  webhook_verify_token: string; // Will be hashed before storage
}

export interface UpdateWhatsAppChannelInput {
  phone_number_id?: string;
  business_account_id?: string | null;
  display_phone_number?: string | null;
  access_token?: string;
  app_secret?: string;
  webhook_verify_token?: string;
  is_enabled?: boolean;
}

export interface WhatsAppChannelApiResponse {
  id: string;
  workspace_id: string;
  phone_number_id: string;
  business_account_id: string | null;
  display_phone_number: string | null;
  is_enabled: boolean;
  webhook_url: string;
  created_at: string;
  updated_at: string;
  // Never return secrets in API responses
}

// ============================================================================
// Meta Cloud API Webhook Types
// ============================================================================

export interface MetaWebhookEntry {
  id: string;
  changes: MetaWebhookChange[];
}

export interface MetaWebhookChange {
  field: string;
  value: MetaWebhookValue;
}

export interface MetaWebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: MetaWebhookContact[];
  messages?: MetaWebhookMessage[];
  statuses?: MetaWebhookStatus[];
}

export interface MetaWebhookContact {
  profile: {
    name?: string;
  };
  wa_id: string;
}

export interface MetaWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'template' | 'interactive';
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
    sha256: string;
    caption?: string;
  };
  document?: {
    id: string;
    mime_type: string;
    sha256: string;
    filename?: string;
    caption?: string;
  };
  audio?: {
    id: string;
    mime_type: string;
    sha256: string;
  };
  context?: {
    forwarded?: boolean;
    from?: string;
    id?: string;
  };
}

export interface MetaWebhookStatus {
  id: string;
  status: WhatsAppMessageStatus;
  timestamp: string;
  recipient_id: string;
  conversation?: {
    id: string;
    origin: {
      type: string;
    };
  };
  pricing?: {
    billable: boolean;
    pricing_model: string;
    category: string;
  };
  errors?: Array<{
    code: number;
    title: string;
    message: string;
  }>;
}

// ============================================================================
// Meta Cloud API Send Types
// ============================================================================

export interface MetaSendMessageRequest {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string; // Phone number
  type: 'text' | 'template';
  text?: {
    preview_url?: boolean;
    body: string;
  };
  template?: {
    name: string;
    language: {
      code: string;
    };
    components?: Array<{
      type: string;
      parameters: Array<{
        type: string;
        text?: string;
      }>;
    }>;
  };
}

export interface MetaSendMessageResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
  }>;
}

// ============================================================================
// Database Row Types (for Kysely)
// ============================================================================

export interface WorkspaceWhatsappChannelsTable {
  id: string;
  workspace_id: string;
  phone_number_id: string;
  business_account_id: string | null;
  display_phone_number: string | null;
  access_token_encrypted: string;
  app_secret_encrypted: string;
  webhook_verify_token_hash: string;
  is_enabled: Generated<number>;
  created_by: string;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface WorkspaceWhatsappContactsTable {
  id: string;
  channel_id: string;
  wa_id: string;
  display_name: string | null;
  workspace_session_id: string;
  workspace_thread_id: string;
  last_inbound_at: string | null;
  service_window_expires_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface WorkspaceWhatsappMessagesTable {
  id: string;
  channel_id: string;
  contact_id: string | null;
  workspace_message_id: string | null;
  meta_message_id: string;
  direction: string;
  status: Generated<string>;
  message_type: string;
  text_content: string | null;
  error_message: string | null;
  raw_payload_json: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

// Import Generated type
import type { Generated } from 'kysely';