/**
 * Browser Automation Tools — browser_task_start / browser_task_continue.
 *
 * These tools drive the isolated browser-worker sidecar through the narrow
 * transport interface in `src/lib/browser/`. They are admin/category-gated via
 * tool_configs and disabled by default. Sensitive data (passwords, OTPs,
 * CAPTCHAs, payment details) never passes through these tools — the worker
 * refuses those fields and the checkpoint machine hands control to the user.
 */

import { getToolConfig } from '../db/compat/tool-config';
import { getRequestContext } from '../request-context';
import {
  createBrowserSession,
  getBrowserSession,
  getBrowserSessionForUser,
  getUserByEmail,
  updateBrowserSession,
} from '../db/compat';
import { getBrowserWorkerClient, isBrowserWorkerConfigured } from '../browser/client';
import type { ToolDefinition, ValidationResult, ToolExecutionOptions } from '../tools';
import type { BrowserAction, BrowserCommandResult } from '@/types/browser';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function fail(errorCode: string, error: string): string {
  return JSON.stringify({ success: false, error, errorCode });
}

async function resolveDbUserId(): Promise<number> {
  const ctx = getRequestContext();
  if (!ctx.userId) throw new Error('No authenticated user context available');
  const dbUser = await getUserByEmail(ctx.userId);
  if (!dbUser) throw new Error('Authenticated user not found in database');
  return dbUser.id;
}

async function getAllowlist(toolName: string): Promise<string[]> {
  const cfg = await getToolConfig(toolName);
  const allowlist = (cfg?.config as Record<string, unknown> | undefined)?.allowlist;
  return Array.isArray(allowlist) ? allowlist.map(String) : [];
}

function isValidAction(action: unknown): action is BrowserAction {
  if (!action || typeof action !== 'object') return false;
  const a = action as Record<string, unknown>;
  if (a.type === 'navigate') return typeof a.url === 'string';
  if (a.type === 'click' || a.type === 'fill' || a.type === 'select') {
    return typeof a.selector === 'string';
  }
  return false;
}

async function persistCommandResult(sessionId: string, result: BrowserCommandResult): Promise<void> {
  await updateBrowserSession(sessionId, {
    state: result.state,
    pendingCheckpoint: result.checkpoint,
    currentUrl: result.observation?.url ?? null,
    pageTitle: result.observation?.title ?? null,
    lastAriaJson: result.observation ? JSON.stringify(result.observation.aria) : undefined,
  });
}

// ============ browser_task_start ============

export const browserTaskStartTool: ToolDefinition = {
  name: 'browser_task_start',
  displayName: 'Start Browser Task',
  description: 'Open a live browser session to complete an interactive web task',
  category: 'autonomous',
  definition: {
    type: 'function',
    function: {
      name: 'browser_task_start',
      description:
        'Start an interactive browser session for a task that requires live, stateful web interaction ' +
        '(JS-rendered search results, form filling, multi-step flows, checkout). Returns a sanitized page ' +
        'observation: URL, title, accessibility tree, and optionally a screenshot. Only call this when ' +
        'stateless search/extract tools cannot complete the task. Never enter passwords, OTPs, CAPTCHAs, or ' +
        'payment data — those pause the session for user takeover.',
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Short description of the goal (e.g., "Find a hotel in Boston and reach checkout").',
          },
          startUrl: {
            type: 'string',
            description: 'Optional URL to navigate to first. Must be on an allowed domain.',
          },
        },
        required: ['task'],
      },
    },
  },
  defaultConfig: {
    allowlist: [] as string[],
    screenshotEnabled: true,
    sessionTtlMinutes: 15,
  },
  configSchema: {
    type: 'object',
    properties: {
      allowlist: {
        type: 'array',
        items: { type: 'string' },
        title: 'Allowed domains',
        description: 'Domains the browser may visit (e.g., booking.com, *.booking.com). Empty = disabled.',
      },
      screenshotEnabled: {
        type: 'boolean',
        title: 'Include screenshots',
        description: 'Offer a redacted screenshot to the model in observations.',
      },
      sessionTtlMinutes: {
        type: 'number',
        title: 'Session TTL (minutes)',
        description: 'Idle timeout before the session expires.',
      },
    },
  },
  validateConfig: (config: Record<string, unknown>): ValidationResult => {
    const errors: string[] = [];
    if (config.allowlist !== undefined && !Array.isArray(config.allowlist)) {
      errors.push('Allowed domains must be an array of strings');
    }
    if (config.sessionTtlMinutes !== undefined && typeof config.sessionTtlMinutes !== 'number') {
      errors.push('Session TTL must be a number');
    }
    return { valid: errors.length === 0, errors };
  },
  execute: async (args, options?: ToolExecutionOptions): Promise<string> => {
    try {
      if (!isBrowserWorkerConfigured()) {
        return fail('BROWSER_NOT_CONFIGURED', 'Browser worker is not configured. Ask an administrator to enable browser automation.');
      }

      const userId = await resolveDbUserId();
      const threadId = (options?.threadId || getRequestContext().threadId) ?? null;
      const allowlist = await getAllowlist('browser_task_start');
      if (allowlist.length === 0) {
        return fail('DOMAIN_ALLOWLIST_EMPTY', 'Browser automation has no allowed domains configured.');
      }

      const startUrl =
        typeof args.startUrl === 'string' && args.startUrl.trim() ? args.startUrl.trim() : undefined;

      const session = await createBrowserSession({
        userId,
        threadId,
        task: typeof args.task === 'string' ? args.task : null,
        allowlist,
        expiresInMs: DEFAULT_TTL_MS,
      });

      const client = getBrowserWorkerClient();
      const snap = await client.createSession(session.sessionId, allowlist);
      await updateBrowserSession(session.sessionId, { workerSessionId: snap.workerSessionId });

      if (startUrl) {
        const nav = await client.executeAction(session.sessionId, { type: 'navigate', url: startUrl });
        await persistCommandResult(session.sessionId, nav);
        if (!nav.success) {
          return JSON.stringify({ success: false, error: nav.message || 'Navigation failed', errorCode: 'BROWSER_NAVIGATION_FAILED' });
        }
      }

      const screenshotEnabled = await (async () => {
        const cfg = await getToolConfig('browser_task_start');
        return (cfg?.config as Record<string, unknown> | undefined)?.screenshotEnabled !== false;
      })();

      const observation = await client.observe(session.sessionId, screenshotEnabled);
      await updateBrowserSession(session.sessionId, {
        state: observation.state,
        currentUrl: observation.url,
        pageTitle: observation.title,
        pendingCheckpoint: observation.checkpoint,
        lastAriaJson: JSON.stringify(observation.aria),
      });

      const info = await getBrowserSession(session.sessionId);
      return JSON.stringify({
        success: true,
        browserSession: info,
        observation,
      });
    } catch (err) {
      return fail('BROWSER_EXECUTION_ERROR', err instanceof Error ? err.message : String(err));
    }
  },
};

// ============ browser_task_continue ============

export const browserTaskContinueTool: ToolDefinition = {
  name: 'browser_task_continue',
  displayName: 'Continue Browser Task',
  description: 'Perform an action (navigate, click, fill, select) on a live browser session',
  category: 'autonomous',
  definition: {
    type: 'function',
    function: {
      name: 'browser_task_continue',
      description:
        'Perform one action on an existing browser session: navigate to a URL, click an element, fill a ' +
        'non-sensitive field, or select an option. Returns the resulting sanitized observation and any ' +
        'checkpoint transition (needs_form_input, takeover, final_confirm). If the action is irreversible ' +
        '(booking/payment/purchase), the session enters final_confirm and requires the user to confirm.',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'The browser session id from browser_task_start.' },
          action: {
            type: 'object',
            description: 'The action to perform.',
            properties: {
              type: { type: 'string', enum: ['navigate', 'click', 'fill', 'select'] },
              url: { type: 'string', description: 'For navigate.' },
              selector: { type: 'string', description: 'CSS selector for click/fill/select.' },
              value: { type: 'string', description: 'Value for fill/select.' },
            },
            required: ['type'],
          },
          confirmToken: {
            type: 'string',
            description: 'Required only to confirm an irreversible final action the user explicitly approved.',
          },
        },
        required: ['sessionId', 'action'],
      },
    },
  },
  defaultConfig: {
    allowlist: [] as string[],
    screenshotEnabled: true,
  },
  configSchema: {
    type: 'object',
    properties: {
      allowlist: {
        type: 'array',
        items: { type: 'string' },
        title: 'Allowed domains',
      },
      screenshotEnabled: {
        type: 'boolean',
        title: 'Include screenshots',
      },
    },
  },
  validateConfig: (config: Record<string, unknown>): ValidationResult => {
    const errors: string[] = [];
    if (config.allowlist !== undefined && !Array.isArray(config.allowlist)) {
      errors.push('Allowed domains must be an array of strings');
    }
    return { valid: errors.length === 0, errors };
  },
  execute: async (args): Promise<string> => {
    try {
      if (!isBrowserWorkerConfigured()) {
        return fail('BROWSER_NOT_CONFIGURED', 'Browser worker is not configured.');
      }

      const sessionId = typeof args.sessionId === 'string' ? args.sessionId : '';
      if (!sessionId) return fail('VALIDATION_ERROR', 'sessionId is required');
      if (!isValidAction(args.action)) {
        return fail('VALIDATION_ERROR', 'A valid action object is required (type: navigate|click|fill|select).');
      }

      const userId = await resolveDbUserId();
      const session = await getBrowserSessionForUser(sessionId, userId);
      if (!session) {
        return fail('NOT_FOUND', 'Browser session not found or not owned by the current user.');
      }

      const client = getBrowserWorkerClient();
      const confirmToken = typeof args.confirmToken === 'string' ? args.confirmToken : undefined;
      const result = await client.executeAction(sessionId, args.action as BrowserAction, confirmToken);
      await persistCommandResult(sessionId, result);

      return JSON.stringify({
        success: result.success,
        state: result.state,
        checkpoint: result.checkpoint,
        message: result.message,
        observation: result.observation,
        sessionId,
      });
    } catch (err) {
      return fail('BROWSER_EXECUTION_ERROR', err instanceof Error ? err.message : String(err));
    }
  },
};
