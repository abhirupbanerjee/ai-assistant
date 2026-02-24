/**
 * Agent Bot Webhook Delivery
 *
 * Delivers webhook notifications for async job completion:
 * - HMAC-SHA256 signature generation
 * - Retry logic with exponential backoff
 * - Payload formatting
 */

import { createHmac } from 'crypto';
import type {
  WebhookPayload,
  AgentBotJob,
  AgentBotJobOutput,
  InvokeOutputItem,
  TokenUsage,
} from '@/types/agent-bot';

// ============================================================================
// Types
// ============================================================================

export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  attempts: number;
}

export interface WebhookConfig {
  url: string;
  secret: string;
  timeout?: number;
  maxRetries?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // 1s, 5s, 15s

// ============================================================================
// Signature Generation
// ============================================================================

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
export function generateSignature(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify webhook signature
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = generateSignature(payload, secret);

  // Use timing-safe comparison
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < signature.length; i++) {
    result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  return result === 0;
}

// ============================================================================
// Payload Builders
// ============================================================================

/**
 * Build webhook payload for completed job
 */
export function buildCompletedPayload(
  job: AgentBotJob,
  agentBotSlug: string,
  outputs: InvokeOutputItem[],
  tokenUsage?: TokenUsage,
  processingTimeMs?: number
): WebhookPayload {
  return {
    event: 'job.completed',
    jobId: job.id,
    agentBotId: job.agent_bot_id,
    agentBotSlug,
    status: 'completed',
    outputs,
    tokenUsage,
    processingTimeMs,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build webhook payload for failed job
 */
export function buildFailedPayload(
  job: AgentBotJob,
  agentBotSlug: string,
  errorMessage: string,
  errorCode: string
): WebhookPayload {
  return {
    event: 'job.failed',
    jobId: job.id,
    agentBotId: job.agent_bot_id,
    agentBotSlug,
    status: 'failed',
    error: {
      message: errorMessage,
      code: errorCode,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Convert job outputs to API response format
 */
export function formatOutputsForWebhook(
  outputs: AgentBotJobOutput[],
  baseUrl: string,
  jobId: string
): InvokeOutputItem[] {
  return outputs.map((output) => {
    const item: InvokeOutputItem = {
      type: output.output_type,
    };

    // For text/json content, include directly
    if (output.content && (output.output_type === 'text' || output.output_type === 'json')) {
      try {
        item.content = output.output_type === 'json'
          ? JSON.parse(output.content)
          : output.content;
      } catch {
        item.content = output.content;
      }
    }

    // For file outputs, provide download URL
    if (output.filepath) {
      item.filename = output.filename || undefined;
      item.downloadUrl = `${baseUrl}/api/agent-bots/jobs/${jobId}/outputs/${output.id}/download`;
      item.fileSize = output.file_size || undefined;
      item.mimeType = output.mime_type || undefined;
    }

    return item;
  });
}

// ============================================================================
// Webhook Delivery
// ============================================================================

/**
 * Deliver webhook with retries
 */
export async function deliverWebhook(
  config: WebhookConfig,
  payload: WebhookPayload
): Promise<WebhookDeliveryResult> {
  const timeout = config.timeout ?? DEFAULT_TIMEOUT;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;

  const payloadString = JSON.stringify(payload);
  const signature = generateSignature(payloadString, config.secret);

  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Wait before retry (except first attempt)
      if (attempt > 0) {
        const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
        await sleep(delay);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Bot-Signature': signature,
          'X-Agent-Bot-Event': payload.event,
          'X-Agent-Bot-Job-Id': payload.jobId,
          'X-Agent-Bot-Delivery-Attempt': (attempt + 1).toString(),
          'User-Agent': 'AgentBot-Webhook/1.0',
        },
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      lastStatusCode = response.status;

      // Success: 2xx responses
      if (response.ok) {
        return {
          success: true,
          statusCode: response.status,
          attempts: attempt + 1,
        };
      }

      // Don't retry on client errors (4xx) except 408, 429
      if (response.status >= 400 && response.status < 500) {
        if (response.status !== 408 && response.status !== 429) {
          return {
            success: false,
            statusCode: response.status,
            error: `HTTP ${response.status}: ${response.statusText}`,
            attempts: attempt + 1,
          };
        }
      }

      lastError = `HTTP ${response.status}: ${response.statusText}`;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          lastError = 'Request timeout';
        } else {
          lastError = error.message;
        }
      } else {
        lastError = 'Unknown error';
      }
    }
  }

  return {
    success: false,
    statusCode: lastStatusCode,
    error: lastError,
    attempts: maxRetries + 1,
  };
}

/**
 * Deliver webhook without waiting (fire and forget)
 * Useful for non-critical notifications
 */
export function deliverWebhookAsync(
  config: WebhookConfig,
  payload: WebhookPayload
): void {
  // Fire and forget - don't await
  deliverWebhook(config, payload).catch((error) => {
    console.error('[Webhook] Async delivery failed:', error);
  });
}

/**
 * Send job completed notification
 */
export async function notifyJobCompleted(
  webhookUrl: string,
  webhookSecret: string,
  job: AgentBotJob,
  agentBotSlug: string,
  outputs: InvokeOutputItem[],
  tokenUsage?: TokenUsage,
  processingTimeMs?: number
): Promise<WebhookDeliveryResult> {
  const payload = buildCompletedPayload(
    job,
    agentBotSlug,
    outputs,
    tokenUsage,
    processingTimeMs
  );

  return deliverWebhook(
    { url: webhookUrl, secret: webhookSecret },
    payload
  );
}

/**
 * Send job failed notification
 */
export async function notifyJobFailed(
  webhookUrl: string,
  webhookSecret: string,
  job: AgentBotJob,
  agentBotSlug: string,
  errorMessage: string,
  errorCode: string
): Promise<WebhookDeliveryResult> {
  const payload = buildFailedPayload(
    job,
    agentBotSlug,
    errorMessage,
    errorCode
  );

  return deliverWebhook(
    { url: webhookUrl, secret: webhookSecret },
    payload
  );
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
