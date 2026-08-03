/**
 * Operations — implementations of every tool in the registry.
 *
 * Each function calls the corresponding Google REST API using an access
 * token from `google.ts`. When a `userId` is provided (Phase 2), the adapter
 * first checks the vault for a per-user OAuth token; if none exists it falls
 * back to the shared service-account identity (Phase 1 behavior).
 *
 * On a 401 the token cache is invalidated and the call is retried once.
 * When the vault reports `RECONNECT_REQUIRED`, a structured error is returned
 * so the LLM can prompt the user to reconnect their Drive (§8 Task 6).
 */

import { authHeaders, invalidateToken, RECONNECT_REQUIRED } from './google';
import { authHeaders as msAuthHeaders, invalidateToken as msInvalidateToken } from './microsoft';
import { getJson, postJson, request, HttpError } from './http';
import { AppConfig } from './config';
import { logger } from './logger';

/** Number of retries on transient/auth failures. */
const MAX_RETRIES = 1;

/** Standard envelope returned by every operation. */
export interface OpResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  /** HTTP status from Google if available. */
  status?: number;
  /** Machine-readable error code for structured handling (e.g. RECONNECT_REQUIRED). */
  code?: string;
}

function ok<T>(data: T): OpResult<T> {
  return { ok: true, data };
}

function fail(message: string, status?: number, code?: string): OpResult<never> {
  return { ok: false, error: message, status, code };
}

/**
 * Run an async Google-API call with one automatic retry on 401
 * (invalidates the cached token first).
 *
 * When `userId` is provided, the adapter checks the vault for a per-user
 * token before falling back to the service account. If the vault returns
 * `RECONNECT_REQUIRED`, this function throws the sentinel so the caller's
 * catch block can convert it into a structured `OpResult`.
 */
async function withRetry<T>(
  cfg: AppConfig,
  fn: (headers: Record<string, string>) => Promise<T>,
  userId?: string
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const headers = await authHeaders(cfg, undefined, userId);
    try {
      return await fn(headers);
    } catch (err) {
      lastErr = err;
      // Propagate the RECONNECT_REQUIRED sentinel up to the op function.
      if (err === RECONNECT_REQUIRED) {
        throw err;
      }
      if (err instanceof HttpError && err.status === 401 && attempt === 0) {
        logger.warn('Google API returned 401 — invalidating token and retrying', { userId: userId || null });
        invalidateToken(userId);
        continue;
      }
      // Second 401 with a per-user token → the token is revoked or the
      // refresh token is invalid. Surface RECONNECT_REQUIRED so the LLM
      // can prompt the user to reconnect their Drive (§8 Task 6).
      if (err instanceof HttpError && err.status === 401 && userId && attempt >= 1) {
        logger.warn('Per-user token revoked after retry — returning RECONNECT_REQUIRED', { userId });
        throw RECONNECT_REQUIRED;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Wrap a withRetry call in a try/catch that converts the RECONNECT_REQUIRED
 * sentinel into a structured OpResult. Reduces boilerplate in every op.
 */
async function runOp<T>(
  cfg: AppConfig,
  fn: (headers: Record<string, string>) => Promise<T>,
  userId?: string
): Promise<OpResult<T>> {
  try {
    const data = await withRetry<T>(cfg, fn, userId);
    return ok(data);
  } catch (err) {
    if (err === RECONNECT_REQUIRED) {
      return fail(
        'Your Google Drive connection has expired or been revoked. Please reconnect your account in Settings to continue using Drive tools.',
        401,
        'RECONNECT_REQUIRED'
      );
    }
    const status = err instanceof HttpError ? err.status : undefined;
    return fail(extractError(err), status);
  }
}

/** Escape a path segment for a Google API URL. */
function enc(s: string): string {
  return encodeURIComponent(s);
}

// ── Sheets v4 ────────────────────────────────────────────────────────────────
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

interface SheetsValueRange {
  range: string;
  majorDimension: string;
  values: unknown[][];
}

interface SheetsBatchResponse {
  spreadsheetId: string;
  valueRanges: SheetsValueRange[];
}

interface SheetsUpdateResponse {
  spreadsheetId: string;
  updatedRange: string;
  updatedCells: number;
  updatedRows: number;
  updatedColumns: number;
}

interface SheetsAppendResponse extends SheetsUpdateResponse {
  updates: {
    spreadsheetId: string;
    updatedRange: string;
    updatedCells: number;
    updatedRows: number;
    updatedColumns: number;
  };
}

interface SheetsMetadata {
  spreadsheetId: string;
  properties: { title: string; locale: string; timeZone: string };
  sheets: Array<{
    properties: {
      sheetId: number;
      title: string;
      index: number;
      sheetType: string;
      gridProperties?: { rowCount: number; columnCount: number };
    };
  }>;
  namedRanges?: unknown[];
}

export async function sheetsGetValues(
  cfg: AppConfig,
  spreadsheetId: string,
  range: string,
  userId?: string
): Promise<OpResult<SheetsValueRange>> {
  return runOp<SheetsValueRange>(cfg, async (headers) =>
    (await getJson(
      `${SHEETS_BASE}/${enc(spreadsheetId)}/values/${enc(range)}`,
      headers,
      cfg.googleTimeoutMs
    )) as SheetsValueRange,
    userId
  );
}

export async function sheetsBatchGetValues(
  cfg: AppConfig,
  spreadsheetId: string,
  ranges: string[],
  userId?: string
): Promise<OpResult<SheetsBatchResponse>> {
  const query = ranges.map((r) => `ranges=${enc(r)}`).join('&');
  return runOp<SheetsBatchResponse>(cfg, async (headers) =>
    (await getJson(
      `${SHEETS_BASE}/${enc(spreadsheetId)}/values:batchGet?${query}`,
      headers,
      cfg.googleTimeoutMs
    )) as SheetsBatchResponse,
    userId
  );
}

export async function sheetsUpdateValues(
  cfg: AppConfig,
  spreadsheetId: string,
  range: string,
  values: unknown[][],
  valueInputOption = 'USER_ENTERED',
  userId?: string
): Promise<OpResult<SheetsUpdateResponse>> {
  const url =
    `${SHEETS_BASE}/${enc(spreadsheetId)}/values/${enc(range)}?` +
    `valueInputOption=${enc(valueInputOption)}`;
  return runOp<SheetsUpdateResponse>(cfg, async (headers) =>
    (await putJson(url, { values }, headers, cfg.googleTimeoutMs)) as SheetsUpdateResponse,
    userId
  );
}

export async function sheetsAppendValues(
  cfg: AppConfig,
  spreadsheetId: string,
  range: string,
  values: unknown[][],
  valueInputOption = 'USER_ENTERED',
  insertDataOption = 'INSERT_ROWS',
  userId?: string
): Promise<OpResult<SheetsAppendResponse>> {
  const url =
    `${SHEETS_BASE}/${enc(spreadsheetId)}/values/${enc(range)}:append?` +
    `valueInputOption=${enc(valueInputOption)}&` +
    `insertDataOption=${enc(insertDataOption)}`;
  return runOp<SheetsAppendResponse>(cfg, async (headers) =>
    (await postJson(url, { values }, headers, cfg.googleTimeoutMs)) as SheetsAppendResponse,
    userId
  );
}

export async function sheetsGetSpreadsheet(
  cfg: AppConfig,
  spreadsheetId: string,
  userId?: string
): Promise<OpResult<SheetsMetadata>> {
  return runOp<SheetsMetadata>(cfg, async (headers) =>
    (await getJson(
      `${SHEETS_BASE}/${enc(spreadsheetId)}`,
      headers,
      cfg.googleTimeoutMs
    )) as SheetsMetadata,
    userId
  );
}

// ── Drive v3 ─────────────────────────────────────────────────────────────────
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  [k: string]: unknown;
}

interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
  incompleteSearch?: boolean;
}

export async function driveListFiles(
  cfg: AppConfig,
  opts: { q?: string; pageSize?: number; pageToken?: string; fields?: string; userId?: string }
): Promise<OpResult<DriveFileList>> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  params.set('pageSize', String(opts.pageSize ?? 100));
  if (opts.pageToken) params.set('pageToken', opts.pageToken);
  params.set('fields', opts.fields || 'nextPageToken,files(id,name,mimeType,modifiedTime,size)');
  return runOp<DriveFileList>(cfg, async (headers) =>
    (await getJson(`${DRIVE_BASE}?${params.toString()}`, headers, cfg.googleTimeoutMs)) as DriveFileList,
    opts.userId
  );
}

export async function driveGetFile(
  cfg: AppConfig,
  fileId: string,
  fields?: string,
  userId?: string
): Promise<OpResult<DriveFile>> {
  const f = fields || 'id,name,mimeType,createdTime,modifiedTime,size,parents,webViewLink,iconLink';
  return runOp<DriveFile>(cfg, async (headers) =>
    (await getJson(
      `${DRIVE_BASE}/${enc(fileId)}?fields=${enc(f)}`,
      headers,
      cfg.googleTimeoutMs
    )) as DriveFile,
    userId
  );
}

// ── Drive media export (used by Docs and Slides) ────────────────────────────
const DRIVE_EXPORT = 'https://www.googleapis.com/drive/v3/files';

async function driveExport(
  cfg: AppConfig,
  fileId: string,
  mimeType: string,
  userId?: string
): Promise<OpResult<{ content: string; mimeType: string; fileId: string }>> {
  const url =
    `${DRIVE_EXPORT}/${enc(fileId)}?` +
    `alt=media&mimeType=${enc(mimeType)}`;
  const result = await runOp<{ content: string; status: number }>(cfg, async (headers) => {
    const res = await request({
      method: 'GET',
      url,
      headers,
      timeoutMs: cfg.googleTimeoutMs,
      // Do NOT set json:true — exported content is raw text/binary.
    });
    return { content: res.text, status: res.status };
  }, userId);
  if (!result.ok) return fail(result.error!, result.status, result.code);
  return ok({ content: result.data!.content, mimeType, fileId });
}

export async function docsExport(
  cfg: AppConfig,
  fileId: string,
  mimeType = 'text/markdown',
  userId?: string
): Promise<OpResult<{ content: string; mimeType: string; fileId: string }>> {
  return driveExport(cfg, fileId, mimeType, userId);
}

export async function slidesExport(
  cfg: AppConfig,
  fileId: string,
  mimeType = 'text/plain',
  userId?: string
): Promise<OpResult<{ content: string; mimeType: string; fileId: string }>> {
  return driveExport(cfg, fileId, mimeType, userId);
}

// ── Google Slides API ───────────────────────────────────────────────────────
const SLIDES_BASE = 'https://slides.googleapis.com/v1/presentations';

interface SlidesPresentation {
  presentationId: string;
  title: string;
  slides?: SlidesSlide[];
}

interface SlidesSlide {
  objectId: string;
  slideProperties?: { notesPage?: { speakerNotesShape?: { text?: { textElements?: Array<{ textRun?: { content?: string } }> } } } };
  pageElements?: SlidesPageElement[];
}

interface SlidesPageElement {
  shape?: { text?: { textElements?: Array<{ textRun?: { content?: string } }> } };
  table?: { tableRows?: Array<{ tableCells?: Array<{ text?: { textElements?: Array<{ textRun?: { content?: string } }> } }> }> };
}

interface SlideSummary {
  slideId: string;
  title: string;
  text: string;
  notes?: string;
}

function extractTextFromElements(elements?: Array<{ textRun?: { content?: string } }>): string {
  if (!elements) return '';
  return elements
    .map((e) => e.textRun?.content || '')
    .join('')
    .trim();
}

function flattenSlideText(slide: SlidesSlide): string {
  const parts: string[] = [];
  for (const element of slide.pageElements || []) {
    if (element.shape?.text?.textElements) {
      parts.push(extractTextFromElements(element.shape.text.textElements));
    }
    if (element.table?.tableRows) {
      for (const row of element.table.tableRows) {
        for (const cell of row.tableCells || []) {
          parts.push(extractTextFromElements(cell.text?.textElements));
        }
      }
    }
  }
  return parts.filter(Boolean).join('\n').trim();
}

function flattenSlideNotes(slide: SlidesSlide): string {
  const notesShape = slide.slideProperties?.notesPage?.speakerNotesShape;
  return extractTextFromElements(notesShape?.text?.textElements);
}

export async function slidesGetPresentation(
  cfg: AppConfig,
  presentationId: string,
  includeNotes = true,
  userId?: string
): Promise<OpResult<{ presentationId: string; title: string; slideCount: number; slides: SlideSummary[] }>> {
  const url = `${SLIDES_BASE}/${enc(presentationId)}`;
  const result = await runOp<SlidesPresentation>(cfg, async (headers) => {
    return getJson(url, headers, cfg.googleTimeoutMs) as Promise<SlidesPresentation>;
  }, userId);

  if (!result.ok) return fail(result.error!, result.status, result.code);

  const presentation = result.data!;
  const slides: SlideSummary[] = (presentation.slides || []).map((slide) => {
    const text = flattenSlideText(slide);
    // Use the first line of text as the slide title; Google Slides does not
    // expose a dedicated title field in the API response.
    const title = text.split('\n')[0] || '';
    const summary: SlideSummary = {
      slideId: slide.objectId,
      title,
      text,
    };
    if (includeNotes) {
      summary.notes = flattenSlideNotes(slide) || undefined;
    }
    return summary;
  });

  return ok({
    presentationId: presentation.presentationId || presentationId,
    title: presentation.title || 'Untitled presentation',
    slideCount: slides.length,
    slides,
  });
}

// ── Microsoft Graph (OneDrive / Excel) ───────────────────────────────────────
// Graph API base for OneDrive file operations.
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

interface MsDriveItem {
  id: string;
  name: string;
  file?: { mimeType: string; size: number };
  folder?: { childCount: number };
  [k: string]: unknown;
}

interface MsDriveListResponse {
  value: MsDriveItem[];
  '@odata.nextLink'?: string;
}

/**
 * Run a Microsoft Graph API call with one automatic retry on 401.
 * Mirrors the Google withRetry / runOp pattern but uses the Microsoft adapter.
 */
async function msWithRetry<T>(
  cfg: AppConfig,
  fn: (headers: Record<string, string>) => Promise<T>,
  userId?: string
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const headers = await msAuthHeaders(cfg, undefined, userId);
    try {
      return await fn(headers);
    } catch (err) {
      lastErr = err;
      if (err === RECONNECT_REQUIRED) {
        throw err;
      }
      if (err instanceof HttpError && err.status === 401 && attempt === 0) {
        logger.warn('Microsoft Graph returned 401 — invalidating token and retrying', { userId: userId || null });
        msInvalidateToken(userId);
        continue;
      }
      if (err instanceof HttpError && err.status === 401 && userId && attempt >= 1) {
        logger.warn('Microsoft per-user token revoked after retry — returning RECONNECT_REQUIRED', { userId });
        throw RECONNECT_REQUIRED;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function msRunOp<T>(
  cfg: AppConfig,
  fn: (headers: Record<string, string>) => Promise<T>,
  userId?: string
): Promise<OpResult<T>> {
  try {
    const data = await msWithRetry<T>(cfg, fn, userId);
    return ok(data);
  } catch (err) {
    if (err === RECONNECT_REQUIRED) {
      return fail(
        'Your OneDrive connection has expired or been revoked. Please reconnect your Microsoft account in Settings to continue using OneDrive tools.',
        401,
        'RECONNECT_REQUIRED'
      );
    }
    const status = err instanceof HttpError ? err.status : undefined;
    return fail(extractMsError(err), status);
  }
}

export async function msDriveListFiles(
  cfg: AppConfig,
  opts: { top?: number; skip?: number; userId?: string }
): Promise<OpResult<MsDriveListResponse>> {
  const params = new URLSearchParams();
  params.set('$top', String(opts.top ?? 50));
  if (opts.skip) params.set('$skip', String(opts.skip));
  params.set('$select', 'id,name,file,folder,size,lastModifiedDateTime');
  return msRunOp<MsDriveListResponse>(
    cfg,
    async (headers) =>
      (await getJson(`${GRAPH_BASE}/me/drive/root/children?${params.toString()}`, headers, cfg.msGraphTimeoutMs)) as MsDriveListResponse,
    opts.userId
  );
}

export async function msDriveGetFile(
  cfg: AppConfig,
  itemId: string,
  userId?: string
): Promise<OpResult<MsDriveItem>> {
  return msRunOp<MsDriveItem>(
    cfg,
    async (headers) =>
      (await getJson(`${GRAPH_BASE}/me/drive/items/${enc(itemId)}`, headers, cfg.msGraphTimeoutMs)) as MsDriveItem,
    userId
  );
}

/**
 * Download a file's content from OneDrive (raw bytes → text).
 * Graph returns the file media at /me/drive/items/{id}/content.
 */
export async function msDriveDownloadFile(
  cfg: AppConfig,
  itemId: string,
  userId?: string
): Promise<OpResult<{ content: string; mimeType: string; itemId: string }>> {
  const result = await msRunOp<{ content: string; status: number; mimeType: string }>(
    cfg,
    async (headers) => {
      const res = await request({
        method: 'GET',
        url: `${GRAPH_BASE}/me/drive/items/${enc(itemId)}/content`,
        headers,
        timeoutMs: cfg.msGraphTimeoutMs,
      });
      const ct = res.headers['content-type'] || 'application/octet-stream';
      return { content: res.text, status: res.status, mimeType: ct };
    },
    userId
  );
  if (!result.ok) return fail(result.error!, result.status, result.code);
  return ok({ content: result.data!.content, mimeType: result.data!.mimeType, itemId });
}

/** Extract a human-readable message from a Microsoft Graph error. */
function extractMsError(err: unknown): string {
  if (err instanceof HttpError) {
    // Graph error bodies: { error: { code, message } }
    try {
      const parsed = JSON.parse(err.body) as { error?: { code?: string; message?: string } };
      if (parsed.error?.message) {
        return `Microsoft Graph ${err.status}: ${parsed.error.message}`;
      }
    } catch {
      // fall through
    }
    return err.message;
  }
  return (err as Error).message || String(err);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** PUT JSON expecting JSON. */
async function putJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  const payload = JSON.stringify(body);
  logger.debug('HTTP PUT', { url, bytes: payload.length });
  const res = await request({
    method: 'PUT',
    url,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload,
    timeoutMs,
    json: true,
  });
  return res.data;
}

/** Extract a human-readable message from an error. */
function extractError(err: unknown): string {
  if (err instanceof HttpError) {
    // Google error bodies are JSON: { error: { message, status, code } }
    try {
      const parsed = JSON.parse(err.body) as {
        error?: { message?: string; status?: string };
      };
      if (parsed.error?.message) {
        return `Google API ${err.status}: ${parsed.error.message}`;
      }
    } catch {
      // fall through
    }
    return err.message;
  }
  return (err as Error).message || String(err);
}
