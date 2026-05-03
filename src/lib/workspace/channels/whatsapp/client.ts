/**
 * WhatsApp Cloud API Client
 *
 * Handles sending messages via Meta's WhatsApp Cloud API.
 */

import type {
  MetaSendMessageRequest,
  MetaSendMessageResponse,
  WhatsAppMessageStatus,
} from './types';

const META_API_VERSION = 'v18.0';
const META_API_BASE = 'https://graph.facebook.com';

/**
 * WhatsApp Cloud API client
 */
export class WhatsAppClient {
  private phoneNumberId: string;
  private accessToken: string;

  constructor(phoneNumberId: string, accessToken: string) {
    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
  }

  /**
   * Send a text message to a WhatsApp user
   */
  async sendTextMessage(
    to: string,
    text: string,
    previewUrl: boolean = false
  ): Promise<MetaSendMessageResponse> {
    const request: MetaSendMessageRequest = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: previewUrl,
        body: text,
      },
    };

    return this.sendMessage(request);
  }

  /**
   * Send a message via the WhatsApp Cloud API
   */
  async sendMessage(
    message: MetaSendMessageRequest
  ): Promise<MetaSendMessageResponse> {
    const url = `${META_API_BASE}/${META_API_VERSION}/${this.phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `WhatsApp API error: ${response.status}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        // Use default error message
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<boolean> {
    const url = `${META_API_BASE}/${META_API_VERSION}/${this.phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });

    return response.ok;
  }

  /**
   * Upload media to WhatsApp servers
   * Returns the media ID for use in messages
   */
  async uploadMedia(
    file: Buffer,
    filename: string,
    mimeType: string
  ): Promise<string> {
    const url = `${META_API_BASE}/${META_API_VERSION}/${this.phoneNumberId}/media`;

    const formData = new FormData();
    // Create a new ArrayBuffer copy to avoid SharedArrayBuffer issues
    const arrayBuffer = new ArrayBuffer(file.length);
    new Uint8Array(arrayBuffer).set(file);
    formData.append('file', new Blob([arrayBuffer], { type: mimeType }), filename);
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', mimeType);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload media: ${errorText}`);
    }

    const result = await response.json();
    return result.id;
  }
}

/**
 * Split a long message into chunks that fit within WhatsApp's limits
 *
 * WhatsApp text messages have a limit of 4096 characters.
 * We split at paragraph or sentence boundaries when possible.
 */
export function splitMessageForWhatsApp(
  text: string,
  maxLength: number = 4096
): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good split point
    let splitIndex = maxLength;

    // Look for paragraph break first (double newline)
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxLength);
    if (paragraphBreak > maxLength * 0.5) {
      splitIndex = paragraphBreak + 2;
    } else {
      // Look for single newline
      const lineBreak = remaining.lastIndexOf('\n', maxLength);
      if (lineBreak > maxLength * 0.5) {
        splitIndex = lineBreak + 1;
      } else {
        // Look for sentence end (. ! ?)
        const sentenceEnd = Math.max(
          remaining.lastIndexOf('.', maxLength),
          remaining.lastIndexOf('!', maxLength),
          remaining.lastIndexOf('?', maxLength)
        );
        if (sentenceEnd > maxLength * 0.5) {
          splitIndex = sentenceEnd + 1;
        } else {
          // Look for word boundary
          const spaceIndex = remaining.lastIndexOf(' ', maxLength);
          if (spaceIndex > maxLength * 0.5) {
            splitIndex = spaceIndex + 1;
          }
          // Otherwise, hard split at maxLength
        }
      }
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}

/**
 * Calculate the 24-hour service window expiry time
 * WhatsApp allows free-form messages within 24 hours of the last user message
 */
export function calculateServiceWindowExpiry(): Date {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 24);
  return expiry;
}

/**
 * Check if a service window is still active
 */
export function isServiceWindowActive(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) > new Date();
}