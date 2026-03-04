/**
 * Send Email Tool
 *
 * Provides email notification functionality via SendGrid.
 * Uses the official @sendgrid/mail package.
 * Used by share_thread tool and potentially other tools.
 *
 * Configuration is managed through the Tools admin UI.
 */

import sgMail from '@sendgrid/mail';
import { getToolConfig } from '../db/compat/tool-config';
import type { ToolDefinition, ValidationResult } from '../tools';
import type { SendEmailToolConfig } from '@/types';

// ============ Tool Configuration ============

/**
 * Get send_email tool configuration from database
 */
export async function getSendEmailConfig(): Promise<{ enabled: boolean; config: SendEmailToolConfig }> {
  const toolConfig = await getToolConfig('send_email');
  if (toolConfig) {
    const config = toolConfig.config as Record<string, unknown>;
    return {
      enabled: toolConfig.isEnabled,
      config: {
        sendgridApiKey: (config.sendgridApiKey as string) || '',
        senderEmail: (config.senderEmail as string) || '',
        senderName: (config.senderName as string) || 'Policy Bot',
        rateLimitPerHour: (config.rateLimitPerHour as number) ?? 50,
      },
    };
  }
  return {
    enabled: false,
    config: {
      sendgridApiKey: '',
      senderEmail: '',
      senderName: 'Policy Bot',
      rateLimitPerHour: 50,
    },
  };
}

/**
 * Check if SendGrid is properly configured
 */
export async function isSendGridConfigured(): Promise<boolean> {
  const { config } = await getSendEmailConfig();
  return !!(config.sendgridApiKey && config.senderEmail);
}

// ============ Rate Limiting ============

// Simple in-memory rate limiting (resets on server restart)
// For production, consider using Redis or database-backed rate limiting
const emailRateLimits: Map<string, { count: number; resetAt: number }> = new Map();

/**
 * Check rate limit for sending emails
 */
export async function checkEmailRateLimit(): Promise<{ allowed: boolean; message?: string }> {
  const { config } = await getSendEmailConfig();
  const key = 'global'; // Could be per-user if needed
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;

  const limit = emailRateLimits.get(key);
  if (!limit || now > limit.resetAt) {
    emailRateLimits.set(key, { count: 1, resetAt: now + hourMs });
    return { allowed: true };
  }

  if (limit.count >= config.rateLimitPerHour) {
    return {
      allowed: false,
      message: `Email rate limit exceeded (${config.rateLimitPerHour} per hour). Please try again later.`,
    };
  }

  limit.count++;
  return { allowed: true };
}

// ============ Email Sending ============

export interface SendEmailParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send email via SendGrid using @sendgrid/mail package
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { enabled, config } = await getSendEmailConfig();

  console.log('[SendEmail] Attempting to send email:', {
    to: params.to,
    subject: params.subject,
    enabled,
    hasApiKey: !!config.sendgridApiKey,
    senderEmail: config.senderEmail,
  });

  if (!enabled) {
    console.log('[SendEmail] Email sending is disabled');
    return { success: false, error: 'Email sending is disabled' };
  }

  if (!(await isSendGridConfigured())) {
    console.log('[SendEmail] SendGrid not configured - missing API key or sender email');
    return { success: false, error: 'SendGrid is not configured. Please set API key and sender email.' };
  }

  // Check rate limit
  const rateCheck = await checkEmailRateLimit();
  if (!rateCheck.allowed) {
    console.log('[SendEmail] Rate limit exceeded');
    return { success: false, error: rateCheck.message };
  }

  const { to, subject, text, html } = params;

  try {
    // Set the API key for this request
    sgMail.setApiKey(config.sendgridApiKey);

    console.log('[SendEmail] Sending email via @sendgrid/mail...');

    const msg = {
      to,
      from: {
        email: config.senderEmail,
        name: config.senderName,
      },
      subject,
      text: text || '',
      html: html || '',
    };

    const [response] = await sgMail.send(msg);

    console.log('[SendEmail] SendGrid response status:', response.statusCode);

    if (response.statusCode === 202) {
      const messageId = response.headers['x-message-id'] as string | undefined;
      console.log('[SendEmail] Email sent successfully, messageId:', messageId);
      return { success: true, messageId };
    }

    console.error('[SendEmail] Unexpected response status:', response.statusCode);
    return { success: false, error: `SendGrid error: ${response.statusCode}` };
  } catch (error) {
    console.error('[SendEmail] Failed to send email:', error);

    // Extract error message from SendGrid error response
    let errorMessage = 'Failed to send email';
    if (error && typeof error === 'object' && 'response' in error) {
      const sgError = error as { response?: { body?: { errors?: Array<{ message: string }> } } };
      if (sgError.response?.body?.errors?.[0]?.message) {
        errorMessage = sgError.response.body.errors[0].message;
      }
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return { success: false, error: errorMessage };
  }
}

// ============ Share Notification Email ============

export interface ShareNotificationParams {
  recipientEmail: string;
  sharedByName: string;
  threadTitle: string;
  shareUrl: string;
  expiresAt?: Date | null;
  allowDownload: boolean;
}

/**
 * Send share notification email
 */
export async function sendShareNotificationEmail(
  params: ShareNotificationParams
): Promise<SendEmailResult> {
  const { recipientEmail, sharedByName, threadTitle, shareUrl, expiresAt, allowDownload } = params;
  const { config } = await getSendEmailConfig();

  const subject = `${sharedByName} shared a conversation with you`;

  const expiryText = expiresAt
    ? `This link expires on ${expiresAt.toLocaleDateString()}.`
    : 'This link does not expire.';

  const downloadText = allowDownload
    ? 'You can download attachments and documents from this conversation.'
    : 'Downloads are disabled for this share.';

  const text = `
${sharedByName} has shared a conversation with you: "${threadTitle}"

View the conversation: ${shareUrl}

${expiryText}
${downloadText}

Note: You must be logged in to view this conversation.

---
Sent by ${config.senderName}
  `.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shared Conversation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${config.senderName}</h1>
  </div>

  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="margin-top: 0; color: #111827;">You've received a shared conversation</h2>

    <p><strong>${sharedByName}</strong> has shared a conversation with you:</p>

    <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px; margin: 20px 0;">
      <p style="margin: 0; font-weight: 600; color: #374151;">${threadTitle}</p>
    </div>

    <a href="${shareUrl}"
       style="display: inline-block; background: #4f46e5; color: white; padding: 12px 24px;
              border-radius: 6px; text-decoration: none; font-weight: 500; margin: 10px 0;">
      View Conversation
    </a>

    <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
      ${expiryText}<br>
      ${downloadText}<br>
      <em>Note: You must be logged in to view this conversation.</em>
    </p>
  </div>

  <div style="padding: 20px; text-align: center; color: #9ca3af; font-size: 12px;">
    <p>Sent by ${config.senderName}</p>
  </div>
</body>
</html>
  `.trim();

  return sendEmail({
    to: recipientEmail,
    subject,
    text,
    html,
  });
}

// ============ Tool Definition ============

/**
 * Send Email tool definition
 * Category: processor (supports other tools, not LLM-autonomous)
 */
export const sendEmailTool: ToolDefinition = {
  name: 'send_email',
  displayName: 'Send Email',
  description: 'Send email notifications via SendGrid. Used by share_thread and other tools.',
  category: 'processor',

  // No OpenAI function definition - this is used by other tools, not LLM-triggered
  definition: undefined,

  // Execute function (not used for processor tools)
  execute: async () => {
    return JSON.stringify({
      error: 'send_email is a processor tool and should not be executed via LLM',
      errorCode: 'NOT_AUTONOMOUS',
    });
  },

  // Validate configuration
  validateConfig: (config: Record<string, unknown>): ValidationResult => {
    const errors: string[] = [];

    // Validate sendgridApiKey format (should start with SG.)
    if (config.sendgridApiKey) {
      const apiKey = config.sendgridApiKey as string;
      if (apiKey && !apiKey.startsWith('SG.')) {
        errors.push('SendGrid API key should start with "SG."');
      }
    }

    // Validate senderEmail format
    if (config.senderEmail) {
      const email = config.senderEmail as string;
      if (email && !email.includes('@')) {
        errors.push('Sender email must be a valid email address');
      }
    }

    // Validate rateLimitPerHour
    if (config.rateLimitPerHour !== undefined) {
      const limit = config.rateLimitPerHour as number;
      if (typeof limit !== 'number' || limit < 1 || limit > 10000) {
        errors.push('rateLimitPerHour must be between 1 and 10000');
      }
    }

    return { valid: errors.length === 0, errors };
  },

  // Default configuration
  defaultConfig: {
    sendgridApiKey: '',
    senderEmail: '',
    senderName: 'Policy Bot',
    rateLimitPerHour: 50,
  },

  // JSON Schema for admin UI
  configSchema: {
    type: 'object',
    properties: {
      sendgridApiKey: {
        type: 'string',
        title: 'SendGrid API Key',
        description: 'Your SendGrid API key (starts with SG.)',
        format: 'password',
      },
      senderEmail: {
        type: 'string',
        title: 'Sender Email',
        description: 'Email address to send from (must be verified in SendGrid)',
        format: 'email',
      },
      senderName: {
        type: 'string',
        title: 'Sender Name',
        description: 'Display name for outgoing emails',
        default: 'Policy Bot',
      },
      rateLimitPerHour: {
        type: 'number',
        title: 'Rate Limit (per hour)',
        description: 'Maximum number of emails that can be sent per hour',
        minimum: 1,
        maximum: 10000,
        default: 50,
      },
    },
  },
};
