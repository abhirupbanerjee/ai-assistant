/**
 * Browser Sessions Database Operations (PostgreSQL via Kysely).
 *
 * Persists the checkpoint state machine for remote browser sessions. The live
 * Playwright context lives only in the browser-worker sidecar; this table is
 * the durable record used for ownership checks, resumability, and expiry.
 */

import { getDb } from '../kysely';
import { v4 as uuidv4 } from 'uuid';
import type {
  BrowserSessionInfo,
  BrowserSessionState,
  BrowserCheckpoint,
} from '@/types/browser';

// ============ Helpers ============

interface BrowserSessionRow {
  id: string;
  user_id: number;
  thread_id: string | null;
  task: string | null;
  worker_session_id: string | null;
  state: string;
  current_url: string | null;
  page_title: string | null;
  pending_checkpoint: string | null;
  last_aria_json: string | null;
  allowlist_json: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  terminated_at: string | null;
}

const VALID_STATES: readonly BrowserSessionState[] = [
  'created',
  'observing',
  'needs_form_input',
  'takeover',
  'final_confirm',
  'completed',
  'expired',
  'terminated',
  'error',
];

const VALID_CHECKPOINTS: readonly BrowserCheckpoint[] = [
  'needs_form_input',
  'takeover',
  'final_confirm',
];

function mapRow(row: BrowserSessionRow): BrowserSessionInfo {
  return {
    sessionId: row.id,
    threadId: row.thread_id,
    task: row.task,
    state: row.state as BrowserSessionState,
    currentUrl: row.current_url,
    pageTitle: row.page_title,
    pendingCheckpoint: (row.pending_checkpoint as BrowserCheckpoint) || null,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertValidState(state: string): asserts state is BrowserSessionState {
  if (!(VALID_STATES as readonly string[]).includes(state)) {
    throw new Error(`Invalid browser session state: ${state}`);
  }
}

// ============ CRUD ============

export interface CreateBrowserSessionInput {
  userId: number;
  threadId?: string | null;
  /** Natural-language goal shown in the panel and persisted for resumability. */
  task?: string | null;
  /** Effective domain allowlist for this session (persisted for audit/UI). */
  allowlist?: string[];
  /** Session TTL in ms. */
  expiresInMs?: number;
}

export async function createBrowserSession(
  input: CreateBrowserSessionInput
): Promise<BrowserSessionInfo> {
  const id = uuidv4();
  const expiresAt = input.expiresInMs
    ? new Date(Date.now() + input.expiresInMs).toISOString()
    : null;

  const db = await getDb();
  await db
    .insertInto('browser_sessions')
    .values({
      id,
      user_id: input.userId,
      thread_id: input.threadId ?? null,
      task: input.task ?? null,
      state: 'created',
      allowlist_json: input.allowlist?.length
        ? JSON.stringify(input.allowlist)
        : null,
      expires_at: expiresAt,
    })
    .execute();

  const row = await db
    .selectFrom('browser_sessions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

  return mapRow(row as unknown as BrowserSessionRow);
}

export async function getBrowserSession(
  sessionId: string
): Promise<BrowserSessionInfo | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('browser_sessions')
    .selectAll()
    .where('id', '=', sessionId)
    .executeTakeFirst();

  return row ? mapRow(row as unknown as BrowserSessionRow) : undefined;
}

/** Ownership-gated read — the canonical guard for every route handler. */
export async function getBrowserSessionForUser(
  sessionId: string,
  userId: number
): Promise<BrowserSessionInfo | undefined> {
  const db = await getDb();
  const row = await db
    .selectFrom('browser_sessions')
    .selectAll()
    .where('id', '=', sessionId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  return row ? mapRow(row as unknown as BrowserSessionRow) : undefined;
}

export async function userOwnsBrowserSession(
  sessionId: string,
  userId: number
): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .selectFrom('browser_sessions')
    .select('id')
    .where('id', '=', sessionId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  return Boolean(row);
}

export async function listBrowserSessionsForThread(
  threadId: string,
  userId: number
): Promise<BrowserSessionInfo[]> {
  const db = await getDb();
  const rows = await db
    .selectFrom('browser_sessions')
    .selectAll()
    .where('thread_id', '=', threadId)
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map((row) => mapRow(row as unknown as BrowserSessionRow));
}

// ============ State transitions ============

export interface BrowserSessionPatch {
  state?: BrowserSessionState;
  workerSessionId?: string | null;
  currentUrl?: string | null;
  pageTitle?: string | null;
  pendingCheckpoint?: BrowserCheckpoint | null;
  lastAriaJson?: string | null;
}

export async function updateBrowserSession(
  sessionId: string,
  patch: BrowserSessionPatch
): Promise<BrowserSessionInfo> {
  const db = await getDb();

  if (patch.state) assertValidState(patch.state);
  if (patch.pendingCheckpoint !== undefined && patch.pendingCheckpoint !== null) {
    if (!(VALID_CHECKPOINTS as readonly string[]).includes(patch.pendingCheckpoint)) {
      throw new Error(`Invalid browser checkpoint: ${patch.pendingCheckpoint}`);
    }
  }

  await db
    .updateTable('browser_sessions')
    .set({
      state: patch.state,
      worker_session_id: patch.workerSessionId,
      current_url: patch.currentUrl,
      page_title: patch.pageTitle,
      pending_checkpoint: patch.pendingCheckpoint,
      last_aria_json: patch.lastAriaJson,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', sessionId)
    .execute();

  const row = await db
    .selectFrom('browser_sessions')
    .selectAll()
    .where('id', '=', sessionId)
    .executeTakeFirstOrThrow();

  return mapRow(row as unknown as BrowserSessionRow);
}

/** Set the pending checkpoint and (optionally) the matching state atomically. */
export async function setBrowserSessionCheckpoint(
  sessionId: string,
  checkpoint: BrowserCheckpoint | null,
  state?: BrowserSessionState
): Promise<BrowserSessionInfo> {
  return updateBrowserSession(sessionId, {
    state,
    pendingCheckpoint: checkpoint,
  });
}

/** Refresh the idle TTL while a session is active. */
export async function touchBrowserSession(
  sessionId: string,
  expiresInMs?: number
): Promise<void> {
  const db = await getDb();
  await db
    .updateTable('browser_sessions')
    .set({
      updated_at: new Date().toISOString(),
      expires_at: expiresInMs
        ? new Date(Date.now() + expiresInMs).toISOString()
        : undefined,
    })
    .where('id', '=', sessionId)
    .execute();
}

// ============ Expiry & termination ============

export async function terminateBrowserSession(
  sessionId: string,
  userId?: number
): Promise<boolean> {
  const db = await getDb();
  let query = db
    .updateTable('browser_sessions')
    .set({
      state: 'terminated',
      terminated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', sessionId);

  if (userId !== undefined) {
    query = query.where('user_id', '=', userId);
  }

  const result = await query.executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0) > 0;
}

/** Lazily expire sessions whose TTL has passed (called on access and from a periodic task). */
export async function expireStaleBrowserSessions(): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db
    .updateTable('browser_sessions')
    .set({
      state: 'expired',
      updated_at: now,
    })
    .where('expires_at', 'is not', null)
    .where('expires_at', '<=', now)
    .where('state', 'in', ['created', 'observing', 'needs_form_input', 'takeover', 'final_confirm'])
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0);
}
