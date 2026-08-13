/**
 * Playwright session manager for the browser worker.
 *
 * Owns a single dedicated Chromium instance (launched WITHOUT --no-sandbox so
 * the Chromium sandbox stays enabled) and one isolated, cookie-less
 * `BrowserContext` per session. Enforces the checkpoint state machine and never
 * emits sensitive `value` attributes in ARIA snapshots.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createEgressGuard } from './egress';
import { logger } from './logger';
import type {
  Action,
  AriaNode,
  BrowserState,
  Checkpoint,
  CommandResult,
  Observation,
  SessionSnapshot,
} from './types';

interface Session {
  /** Key used by the app (browser_sessions.id) for routing commands/events. */
  appSessionId: string;
  /** Opaque handle the app stores as browser_sessions.worker_session_id. */
  workerSessionId: string;
  context: BrowserContext;
  page: Page;
  state: BrowserState;
  checkpoint: Checkpoint | null;
  allowlist: string[];
  lastFrame?: string;
  lastUrl: string;
  lastTitle: string;
  lastActivity: number;
  ttlTimer: NodeJS.Timeout;
}

/** Selectors that the agent is NEVER allowed to fill (credential/payment data). */
const SENSITIVE_SELECTOR_RE =
  /password|passwd|pwd|otp|mfa|captcha|cvv|cc-number|card.?number|credit.?card|account.?number/i;

/** Text patterns that mark an irreversible action. */
const IRREVERSIBLE_TEXT_RE =
  /(book|pay now|confirm (booking|order|payment|reservation)|purchase|reserve|submit order|place order|finalize|complete booking)/i;

const SENSITIVE_URL_RE =
  /(login|signin|sign-in|auth|mfa|otp|captcha|verify|checkout|payment|billing|card|pay\b)/i;

export class BrowserSessionManager extends EventEmitter {
  private browser: Browser | null = null;
  private sessions = new Map<string, Session>(); // keyed by app sessionId
  private ttlMs: number;

  constructor(ttlMs: number) {
    super();
    this.ttlMs = ttlMs;
  }

  async start(): Promise<void> {
    if (this.browser && this.browser.isConnected()) return;
    this.browser = await chromium.launch({
      headless: true,
      // Sandbox stays enabled. The container must provide a compatible seccomp
      // profile / user-namespace configuration (see Dockerfile note).
      args: ['--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
    });
    this.browser.on('disconnected', () => {
      this.browser = null;
    });
    logger.info('Chromium launched (sandbox enabled)');
  }

  async createSession(sessionId: string, allowlist: string[]): Promise<SessionSnapshot> {
    await this.start();
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`);
    }
    if (!this.browser) throw new Error('Browser unavailable');

    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      // No storageState / no persistent context → no cookie persistence.
    });
    const page = await context.newPage();
    await context.route('**/*', createEgressGuard(allowlist));

    const workerSessionId = randomUUID();
    const session: Session = {
      appSessionId: sessionId,
      workerSessionId,
      context,
      page,
      state: 'created',
      checkpoint: null,
      allowlist,
      lastUrl: 'about:blank',
      lastTitle: '',
      lastActivity: Date.now(),
      ttlTimer: this.scheduleTtl(sessionId),
    };
    this.sessions.set(sessionId, session);

    logger.info('Session created', { sessionId, workerSessionId, allowlist });
    return this.getSnapshot(sessionId);
  }

  private scheduleTtl(sessionId: string): NodeJS.Timeout {
    return setTimeout(() => {
      const s = this.sessions.get(sessionId);
      if (!s) return;
      if (Date.now() - s.lastActivity >= this.ttlMs) {
        logger.info('Session expired by TTL', { sessionId });
        this.terminate(sessionId).catch((err) =>
          logger.warn('TTL terminate failed', { err: String(err) })
        );
      } else {
        s.ttlTimer = this.scheduleTtl(sessionId);
      }
    }, this.ttlMs);
  }

  private getSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    session.lastActivity = Date.now();
    return session;
  }

  getSnapshot(sessionId: string): SessionSnapshot {
    const session = this.getSession(sessionId);
    return {
      workerSessionId: session.workerSessionId,
      state: session.state,
      checkpoint: session.checkpoint,
      url: session.lastUrl,
      title: session.lastTitle,
    };
  }

  /** Build a sanitized ARIA-like tree. `value` attributes are never read. */
  private async buildAria(page: Page): Promise<AriaNode[]> {
    return page.evaluate((): AriaNode[] => {
      const out: AriaNode[] = [];
      const seen = new Set<Element>();
      const nodes = Array.from(
        document.querySelectorAll('a, button, input, select, textarea, [role]')
      ).slice(0, 200);

      const cssEscape = (s: string): string => {
        try {
          if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
            return CSS.escape(s);
          }
        } catch {
          /* fall through */
        }
        return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
      };
      const attrEscape = (s: string): string =>
        s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

      for (const el of nodes) {
        if (seen.has(el)) continue;
        seen.add(el);
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || tag;
        const name = (
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.getAttribute('placeholder') ||
          (el.textContent || '').trim()
        )
          .trim()
          .slice(0, 120);

        let selector: string;
        if (el.id) selector = `#${cssEscape(el.id)}`;
        else if (el.getAttribute('data-testid')) selector = `[data-testid="${attrEscape(el.getAttribute('data-testid')!)}"]`;
        else if (el.getAttribute('name')) selector = `${tag}[name="${attrEscape(el.getAttribute('name')!)}"]`;
        else if (el.getAttribute('aria-label')) selector = `[aria-label="${attrEscape(el.getAttribute('aria-label')!)}"]`;
        else selector = tag;

        out.push({ role, name, selector });
      }
      return out;
    });
  }

  /** Detect login / MFA / CAPTCHA / payment → require user takeover. */
  private async detectSensitiveState(page: Page): Promise<{ state: BrowserState; checkpoint: Checkpoint | null }> {
    const url = page.url().toLowerCase();
    let title = '';
    try {
      title = (await page.title()).toLowerCase();
    } catch {
      /* ignore */
    }

    if (SENSITIVE_URL_RE.test(`${url} ${title}`)) {
      return { state: 'takeover', checkpoint: 'takeover' };
    }

    const passwordCount = await page.locator('input[type="password"]').count().catch(() => 0);
    if (passwordCount > 0) return { state: 'takeover', checkpoint: 'takeover' };

    const cardCount = await page
      .locator('input[autocomplete="cc-number"], input[name*="card"], input[name*="cc"]')
      .count()
      .catch(() => 0);
    if (cardCount > 0) return { state: 'takeover', checkpoint: 'takeover' };

    return { state: 'observing', checkpoint: null };
  }

  private async refreshMeta(session: Session): Promise<void> {
    session.lastUrl = session.page.url();
    try {
      session.lastTitle = await session.page.title();
    } catch {
      session.lastTitle = '';
    }
  }

  async observe(sessionId: string, includeScreenshot: boolean): Promise<Observation> {
    const session = this.getSession(sessionId);
    await this.refreshMeta(session);

    const detected = await this.detectSensitiveState(session.page);
    if (detected.state === 'takeover') {
      session.state = 'takeover';
      session.checkpoint = 'takeover';
    } else if (session.state === 'created' || session.state === 'needs_form_input') {
      session.state = 'observing';
      session.checkpoint = null;
    }

    const aria = await this.buildAria(session.page);
    let screenshotDataUrl: string | undefined;
    if (includeScreenshot) {
      screenshotDataUrl = await this.captureFrame(session);
    }

    return {
      url: session.lastUrl,
      title: session.lastTitle,
      state: session.state,
      checkpoint: session.checkpoint,
      aria,
      screenshotDataUrl,
    };
  }

  private async captureFrame(session: Session): Promise<string> {
    const buf = await session.page.screenshot({ type: 'jpeg', quality: 65 });
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    session.lastFrame = dataUrl;
    return dataUrl;
  }

  async getFrame(sessionId: string): Promise<string> {
    const session = this.getSession(sessionId);
    return this.captureFrame(session);
  }

  async executeAction(
    sessionId: string,
    action: Action,
    confirmToken?: string
  ): Promise<CommandResult> {
    const session = this.getSession(sessionId);

    if (session.state === 'takeover') {
      return {
        success: false,
        state: session.state,
        checkpoint: session.checkpoint,
        message: 'Session is in user takeover. Agent observation and control are suspended.',
      };
    }

    switch (action.type) {
      case 'navigate': {
        await session.page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        return this.afterAction(session);
      }
      case 'fill': {
        if (SENSITIVE_SELECTOR_RE.test(action.selector)) {
          return {
            success: false,
            state: session.state,
            checkpoint: session.checkpoint,
            message: 'Refusing to fill a sensitive field (password/OTP/card). This requires user takeover.',
          };
        }
        const locator = session.page.locator(action.selector).first();
        if ((await locator.count()) === 0) {
          session.state = 'needs_form_input';
          session.checkpoint = 'needs_form_input';
          return {
            success: false,
            state: session.state,
            checkpoint: session.checkpoint,
            message: `Could not find form field matching selector "${action.selector}".`,
          };
        }
        await locator.fill(action.value);
        return this.afterAction(session);
      }
      case 'select': {
        if (SENSITIVE_SELECTOR_RE.test(action.selector)) {
          return {
            success: false,
            state: session.state,
            checkpoint: session.checkpoint,
            message: 'Refusing to select a sensitive field. This requires user takeover.',
          };
        }
        const locator = session.page.locator(action.selector).first();
        if ((await locator.count()) === 0) {
          session.state = 'needs_form_input';
          session.checkpoint = 'needs_form_input';
          return {
            success: false,
            state: session.state,
            checkpoint: session.checkpoint,
            message: `Could not find select element matching selector "${action.selector}".`,
          };
        }
        await locator.selectOption(action.value);
        return this.afterAction(session);
      }
      case 'click': {
        const irreversible = await this.isIrreversibleTarget(session, action.selector);
        if (irreversible) {
          if (session.state === 'final_confirm' && confirmToken) {
            await session.page.locator(action.selector).first().click();
            return this.afterAction(session);
          }
          session.state = 'final_confirm';
          session.checkpoint = 'final_confirm';
          this.emit('state', sessionId);
          return {
            success: false,
            state: session.state,
            checkpoint: session.checkpoint,
            message:
              'This action is irreversible and requires explicit user confirmation. Present a summary and have the user click the final action in the panel.',
          };
        }
        const locator = session.page.locator(action.selector).first();
        if ((await locator.count()) === 0) {
          session.state = 'needs_form_input';
          session.checkpoint = 'needs_form_input';
          return {
            success: false,
            state: session.state,
            checkpoint: session.checkpoint,
            message: `Could not find clickable element matching selector "${action.selector}".`,
          };
        }
        await locator.click();
        return this.afterAction(session);
      }
      default:
        return { success: false, state: session.state, checkpoint: session.checkpoint, message: 'Unknown action type' };
    }
  }

  private async isIrreversibleTarget(session: Session, selector: string): Promise<boolean> {
    try {
      return await session.page.evaluate((sel: string): boolean => {
        let el: Element | null = null;
        try {
          el = document.querySelector(sel);
        } catch {
          return false;
        }
        if (!el) return false;
        const text = (el.textContent || '') + ' ' + ((el as HTMLInputElement).value || '');
        return IRREVERSIBLE_TEXT_RE.test(text);
      }, selector);
    } catch {
      return false;
    }
  }

  private async afterAction(session: Session): Promise<CommandResult> {
    await session.page
      .waitForLoadState('domcontentloaded', { timeout: 15000 })
      .catch(() => undefined);
    await this.refreshMeta(session);

    const detected = await this.detectSensitiveState(session.page);
    if (detected.state === 'takeover') {
      session.state = 'takeover';
      session.checkpoint = 'takeover';
      this.emit('state', session.appSessionId);
    }

    const aria = await this.buildAria(session.page);
    return {
      success: true,
      state: session.state,
      checkpoint: session.checkpoint,
      observation: {
        url: session.lastUrl,
        title: session.lastTitle,
        state: session.state,
        checkpoint: session.checkpoint,
        aria,
      },
    };
  }

  async takeover(sessionId: string): Promise<SessionSnapshot> {
    const session = this.getSession(sessionId);
    session.state = 'takeover';
    session.checkpoint = 'takeover';
    this.emit('state', sessionId);
    return this.getSnapshot(sessionId);
  }

  async resume(sessionId: string): Promise<SessionSnapshot> {
    const session = this.getSession(sessionId);
    session.state = 'observing';
    session.checkpoint = null;
    this.emit('state', sessionId);
    return this.getSnapshot(sessionId);
  }

  async terminate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    clearTimeout(session.ttlTimer);
    this.sessions.delete(sessionId);
    try {
      await session.context.close();
    } catch (err) {
      logger.warn('Context close failed', { sessionId, err: String(err) });
    }
    logger.info('Session terminated', { sessionId });
  }

  async stop(): Promise<void> {
    for (const id of Array.from(this.sessions.keys())) {
      await this.terminate(id);
    }
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
    }
  }
}
