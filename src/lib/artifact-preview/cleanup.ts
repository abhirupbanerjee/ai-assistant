import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sweepArtifactPreviewRecords } from '@/lib/db/compat';
import { cacheRoot, cacheFilename } from './cache';
import { LEASE_MS } from './policy';

/** Cascade deletion is immediate logical invalidation; this removes private
 * orphan/expired bytes. Never traverse subdirectories or follow symlinks. */
export async function cleanupArtifactPreviews() {
  return await sweepArtifactPreviewRecords(async live => {
    const keep = new Set(live.flatMap(row => row.state === 'ready' && row.render_version ? [cacheFilename(row.cache_key, row.render_version)] : []));
    const root = cacheRoot();
    let removed = 0;
    let entries;
    try { entries = await fs.readdir(root, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed }; throw error; }
    for (const entry of entries) {
      if ((!entry.isFile() && !entry.isSymbolicLink()) || !/^[a-f0-9]{64}-[a-f0-9-]+\.(pdf|tmp)$/.test(entry.name) || keep.has(entry.name)) continue;
      const file = path.join(root, entry.name);
      const stat = await fs.lstat(file);
      // Grace protects atomic finalization and in-flight temporary writes. The
      // API already denies access as soon as the source is logically gone.
      if (Date.now() - stat.mtimeMs <= LEASE_MS * 2) continue;
      await fs.unlink(file); removed++;
    }
    return { removed };
  });
}
