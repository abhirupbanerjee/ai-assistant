/**
 * Ephemeral CSV registration for chat-uploaded files.
 *
 * When a user uploads a CSV/JSON file in a thread, this module registers it as
 * a thread-scoped data source so the existing `data_source` tool can query it
 * with server-side aggregation. The registration is ephemeral — the source name
 * carries the threadId so we can find and clean up sources for closed threads.
 *
 * Wire this from the chat file-upload handler:
 *
 *   import { registerUploadedCsvIfTabular } from '@/lib/data-sources/ephemeral-csv';
 *   await registerUploadedCsvIfTabular({
 *     threadId,
 *     filePath: savedFilePath,
 *     originalFilename: file.name,
 *     categoryIds: thread.categoryIds,
 *     uploadedBy: user.email,
 *   });
 *
 * Idempotent: re-registering the same threadId+filePath returns the existing source.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  createDataCSV,
  getAllDataCSVs,
  getDataCSVByName,
  deleteDataCSV,
} from '../db/compat/data-sources';
import { parseCSVFile } from './csv-handler';

export interface RegisterEphemeralCsvArgs {
  threadId: string;
  filePath: string;
  originalFilename: string;
  categoryIds: number[];
  uploadedBy: string;
}

/** Source-name convention so we can identify ephemeral thread uploads at cleanup time. */
export function buildEphemeralSourceName(threadId: string, filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath))
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .substring(0, 40);
  // Underscore prefix + threadId namespacing keeps these out of the admin lists too if
  // the UI filters out underscore-prefixed sources.
  return `__thread_${threadId}_${base}`;
}

/**
 * Parse an ephemeral source name back to its owning thread.
 * Convention: `__thread_<threadId>_<basename>`. UUID thread IDs contain hyphens,
 * not underscores, while sanitized basenames may contain underscores.
 */
export function parseEphemeralSourceName(name: string): { threadId: string } | null {
  const match = name.match(/^__thread_([^_]+)_/);
  return match ? { threadId: match[1] } : null;
}

/** Returns true for file extensions we can register and query. */
function isTabularExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.csv' || ext === '.tsv';
}

/**
 * Register a freshly-uploaded CSV/TSV file as an ephemeral data source for the thread.
 * Silently no-ops for non-tabular files. Idempotent.
 *
 * Returns the registered source name, or null if the file was not tabular.
 */
export async function registerUploadedCsvIfTabular(
  args: RegisterEphemeralCsvArgs,
): Promise<string | null> {
  if (!isTabularExtension(args.filePath)) return null;
  if (!fs.existsSync(args.filePath)) {
    console.warn(`[EphemeralCsv] File not found: ${args.filePath}`);
    return null;
  }

  const name = buildEphemeralSourceName(args.threadId, args.filePath);

  // Idempotent — return existing registration if any
  const existing = await getDataCSVByName(name);
  if (existing) return name;

  let parsed;
  try {
    parsed = parseCSVFile(args.filePath, { hasHeader: true });
  } catch (err) {
    console.warn(`[EphemeralCsv] Failed to parse ${args.filePath}:`, err);
    return null;
  }

  const stat = fs.statSync(args.filePath);

  try {
    await createDataCSV(
      {
        name,
        description: `Ephemeral upload from thread ${args.threadId}: ${args.originalFilename}`,
        filePath: args.filePath,
        originalFilename: args.originalFilename,
        columns: parsed.columns,
        sampleData: parsed.sampleData,
        rowCount: parsed.rowCount,
        fileSize: stat.size,
        categoryIds: args.categoryIds,
      },
      args.uploadedBy,
    );
    return name;
  } catch (err) {
    console.warn(`[EphemeralCsv] Registration failed:`, err);
    return null;
  }
}

/**
 * Remove the ephemeral CSV source for one uploaded file. This only removes the
 * data-source registry row; disk deletion is handled by the upload route.
 */
export async function unregisterUploadedCsv(args: {
  threadId: string;
  filePath: string;
  deletedBy: string;
}): Promise<boolean> {
  const name = buildEphemeralSourceName(args.threadId, args.filePath);
  const existing = await getDataCSVByName(name);
  if (!existing) return false;

  try {
    return await deleteDataCSV(existing.id, args.deletedBy);
  } catch (err) {
    console.warn(`[EphemeralCsv] unregister failed for ${name}:`, err);
    return false;
  }
}

/**
 * Remove all ephemeral CSV sources for a thread (called on thread close / cleanup).
 * Silently swallows individual delete failures so one stuck source doesn't block the others.
 */
export async function cleanupEphemeralCsvsForThread(
  threadId: string,
  deletedBy: string,
): Promise<number> {
  const prefix = `__thread_${threadId}_`;
  const matches = (await getAllDataCSVs()).filter((c) => c.name.startsWith(prefix));
  let removed = 0;
  for (const m of matches) {
    try {
      if (await deleteDataCSV(m.id, deletedBy)) removed++;
    } catch (err) {
      console.warn(`[EphemeralCsv] Failed to delete ${m.name}:`, err);
    }
  }
  return removed;
}
