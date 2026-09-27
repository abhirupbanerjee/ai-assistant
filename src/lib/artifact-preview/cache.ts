import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getDataDir } from '@/lib/storage';
import { OUTPUT_LIMIT, STORAGE_LIMIT, PreviewError, version } from './policy';
import { readPrivateFile } from './source';

export const cacheRoot = () => path.resolve(getDataDir(), 'artifact-previews');
export function cacheFilename(key: string, render: string) { return `${version(key)}-${version(render)}.pdf`; }
export async function readCache(key: string, render: string) { return await readPrivateFile(cacheRoot(), path.join(cacheRoot(), cacheFilename(key, render)), OUTPUT_LIMIT); }
export async function writeCache(key: string, render: string, bytes: Buffer, token: string) {
  const root = cacheRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  let total = 0;
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    if (item.isFile()) total += (await fs.stat(path.join(root, item.name))).size;
  }
  if (total + bytes.length > STORAGE_LIMIT) throw new PreviewError('STORAGE_LIMIT', 507);
  const target = path.join(root, cacheFilename(key, render));
  const temporary = path.join(root, `${key}-${token}.tmp`);
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    await fs.rename(temporary, target);
  } finally { await fs.unlink(temporary).catch(() => undefined); }
}
export async function removeCache(key: string, render: string) { await fs.unlink(path.join(cacheRoot(), cacheFilename(key, render))).catch(() => undefined); }
