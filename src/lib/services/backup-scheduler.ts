/**
 * Automated Backup Scheduler
 *
 * Runs daily backups using the existing createBackup() function.
 * Saves ZIP files to $DATA_DIR/backups/ with configurable retention.
 *
 * Schedule config stored in settings table (key: 'backup-schedule').
 * Initialized on app startup from kysely.ts after DB migrations.
 */

import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import path from 'path';
import { getDataDir } from '../storage';

// ── Types ──

export interface BackupScheduleConfig {
  enabled: boolean;
  /** Hour of day to run (0-23), default 2 (2 AM) */
  hour: number;
  /** Days to keep backups, default 7 */
  retentionDays: number;
}

export interface BackupFileInfo {
  filename: string;
  size: number;
  createdAt: string;
}

const DEFAULT_SCHEDULE: BackupScheduleConfig = {
  enabled: true,
  hour: 2,
  retentionDays: 7,
};

// ── Scheduler State ──

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ── Directory Helpers ──

function getBackupsDir(): string {
  return path.join(getDataDir(), 'backups');
}

async function ensureBackupsDir(): Promise<string> {
  const dir = getBackupsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ── Schedule Config (DB) ──

export async function getBackupScheduleConfig(): Promise<BackupScheduleConfig> {
  const { getSetting } = await import('../db/compat/config');
  const stored = await getSetting<Partial<BackupScheduleConfig>>('backup-schedule');
  if (!stored) return { ...DEFAULT_SCHEDULE };
  return { ...DEFAULT_SCHEDULE, ...stored };
}

export async function setBackupScheduleConfig(
  config: Partial<BackupScheduleConfig>,
  updatedBy?: string
): Promise<BackupScheduleConfig> {
  const { getSetting, setSetting } = await import('../db/compat/config');
  const current = await getSetting<BackupScheduleConfig>('backup-schedule') ?? DEFAULT_SCHEDULE;
  const merged = { ...current, ...config };
  await setSetting('backup-schedule', merged, updatedBy);
  return merged;
}

// ── Backup File Management ──

export async function getBackupFiles(): Promise<BackupFileInfo[]> {
  const dir = getBackupsDir();
  try {
    const entries = await fs.readdir(dir);
    const files: BackupFileInfo[] = [];

    for (const entry of entries) {
      if (!entry.startsWith('backup-') || !entry.endsWith('.zip')) continue;
      const filePath = path.join(dir, entry);
      const stat = await fs.stat(filePath);
      files.push({
        filename: entry,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
      });
    }

    // Sort newest first
    files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return files;
  } catch {
    return [];
  }
}

export async function deleteBackupFile(filename: string): Promise<boolean> {
  // Prevent path traversal
  if (!filename.startsWith('backup-') || !filename.endsWith('.zip') || filename.includes('/') || filename.includes('..')) {
    return false;
  }
  const filePath = path.join(getBackupsDir(), filename);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export function getBackupFilePath(filename: string): string | null {
  if (!filename.startsWith('backup-') || !filename.endsWith('.zip') || filename.includes('/') || filename.includes('..')) {
    return null;
  }
  return path.join(getBackupsDir(), filename);
}

// ── Run Backup ──

export async function runScheduledBackup(): Promise<BackupFileInfo | null> {
  if (isRunning) {
    console.log('[Backup] Skipping — backup already in progress');
    return null;
  }

  isRunning = true;
  try {
    const { createBackup } = await import('../backup');
    const dir = await ensureBackupsDir();

    const options = {
      includeDocuments: true,
      includeDocumentFiles: true,
      includeCategories: true,
      includeSettings: true,
      includeUsers: true,
      includeThreads: true,
      includeTools: true,
      includeSkills: true,
      includeCategoryPrompts: true,
      includeDataSources: true,
      includeWorkspaces: true,
      includeFunctionApis: true,
      includeUserMemories: true,
      includeToolRouting: true,
      includeThreadShares: true,
      includeAgentBots: true,
    };

    const { stream, filename } = await createBackup(options, 'system@automated');
    const filePath = path.join(dir, filename);

    // Pipe stream to file
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(filePath);
      stream.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      stream.on('error', reject);
    });

    const stat = await fs.stat(filePath);
    const sizeMB = (stat.size / (1024 * 1024)).toFixed(1);
    console.log(`[Backup] Created: ${filename} (${sizeMB} MB)`);

    // Run retention cleanup
    await cleanupOldBackups();

    return {
      filename,
      size: stat.size,
      createdAt: stat.mtime.toISOString(),
    };
  } catch (err) {
    console.error('[Backup] Failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    isRunning = false;
  }
}

// ── Retention Cleanup ──

async function cleanupOldBackups(): Promise<void> {
  try {
    const config = await getBackupScheduleConfig();
    const files = await getBackupFiles();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.retentionDays);

    let deleted = 0;
    for (const file of files) {
      if (new Date(file.createdAt) < cutoff) {
        await deleteBackupFile(file.filename);
        deleted++;
      }
    }
    if (deleted > 0) {
      console.log(`[Backup] Retention cleanup: removed ${deleted} old backup(s)`);
    }
  } catch (err) {
    console.warn('[Backup] Retention cleanup failed:', err instanceof Error ? err.message : err);
  }
}

// ── Scheduler ──

async function checkAndRunBackup(): Promise<void> {
  try {
    const config = await getBackupScheduleConfig();
    if (!config.enabled) return;

    const now = new Date();
    if (now.getUTCHours() !== config.hour) return;

    // Check if we already have a backup for today
    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const files = await getBackupFiles();
    const hasToday = files.some(f => f.filename.includes(today));
    if (hasToday) return;

    console.log('[Backup] Running scheduled daily backup...');
    await runScheduledBackup();
  } catch (err) {
    console.warn('[Backup] Schedule check failed:', err instanceof Error ? err.message : err);
  }
}

export async function initBackupScheduler(): Promise<void> {
  // Clear any existing interval
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
  }

  const config = await getBackupScheduleConfig();
  console.log(`[Backup] Scheduler initialized (daily at ${String(config.hour).padStart(2, '0')}:00 UTC, keep ${config.retentionDays} days, ${config.enabled ? 'enabled' : 'disabled'})`);

  // Check every hour
  schedulerInterval = setInterval(checkAndRunBackup, 60 * 60 * 1000);

  // Also check immediately on startup (in case we missed today's backup)
  setTimeout(checkAndRunBackup, 10_000); // 10s delay to let app fully start
}
