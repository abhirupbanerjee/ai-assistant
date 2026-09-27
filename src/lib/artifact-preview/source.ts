import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getArtifactSource, type SourceRef } from '@/lib/db/compat';
import { getThreadUploadsDir } from '@/lib/storage';
import { identity, hash, cacheKey, INPUT_LIMIT, TTL_MS, PreviewError } from './policy';

export function contained(root: string, file: string) {
  const rel = path.relative(root, file);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
export async function readPrivateFile(root: string, filename: string, limit: number) {
  try {
    const [base, real] = await Promise.all([fs.realpath(root), fs.realpath(filename)]);
    if (!contained(base, real) || !contained(path.resolve(root), path.resolve(filename))) throw new PreviewError('SOURCE_UNAVAILABLE', 404);
    const file = await fs.open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1) throw new PreviewError('SOURCE_UNAVAILABLE', 404);
      if (stat.size > limit) throw new PreviewError('INPUT_TOO_LARGE', 413);
      const bytes = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const read = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      const after = await file.stat();
      if (offset !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new PreviewError('SOURCE_CHANGED', 409);
      return bytes.subarray(0, offset);
    } finally { await file.close(); }
  } catch (e) {
    if (e instanceof PreviewError) throw e;
    throw new PreviewError('SOURCE_UNAVAILABLE', 404);
  }
}
export async function resolveSource(owner: number, kind: string, id: string) {
  const parsed = identity(kind, id);
  const ref: SourceRef = { ...parsed, owner };
  const row = await getArtifactSource(ref);
  const root = parsed.kind === 'upload' ? getThreadUploadsDir(row.email, row.thread_id) : (process.env.DOC_OUTPUT_DIR || path.join(process.cwd(), 'data', 'outputs'));
  const bytes = await readPrivateFile(root, row.filepath, INPUT_LIMIT);
  const format = path.extname(row.filename).slice(1).toLowerCase();
  const sourceVersion = hash(bytes);
  const key = cacheKey(row.partition, parsed.kind, parsed.id, sourceVersion);
  const expires = new Date(Math.min(Date.now() + TTL_MS, row.expires_at ? Date.parse(row.expires_at) : Infinity)).toISOString();
  return { ref, row, bytes, format, sourceVersion, key, expires, title: path.basename(row.filename).slice(0, 255) };
}
export type ResolvedSource = Awaited<ReturnType<typeof resolveSource>>;
/** Used inside the compat finalization transaction, which already authorizes
 * and locks the source rows. Avoid acquiring a second pool connection there. */
export async function reauthorizeContent(src: ResolvedSource) {
  const root = src.ref.kind === 'upload' ? getThreadUploadsDir(src.row.email, src.row.thread_id) : (process.env.DOC_OUTPUT_DIR || path.join(process.cwd(), 'data', 'outputs'));
  const bytes = await readPrivateFile(root, src.row.filepath, INPUT_LIMIT);
  if (hash(bytes) !== src.sourceVersion) throw new PreviewError('SOURCE_CHANGED', 409);
}
export async function reauthorize(src: ResolvedSource) {
  const current = await resolveSource(src.ref.owner, src.ref.kind, String(src.ref.id));
  if (current.key !== src.key || current.row.filepath !== src.row.filepath) throw new PreviewError('SOURCE_CHANGED', 409);
  return current;
}
