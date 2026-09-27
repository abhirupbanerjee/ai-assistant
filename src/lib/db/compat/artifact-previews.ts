import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Selectable, type Insertable } from 'kysely';
import { getDb } from '../kysely';
import type { DB, ArtifactPreviewsTable, ArtifactPreviewCommentsTable } from '../db-types';
import { PreviewError, partition, assertRecordScope, QUEUE_MS, LEASE_MS, DB_LOCK_MS, DB_STATEMENT_MS, OUTPUT_LIMIT, STORAGE_LIMIT, type SourceKind } from '../../artifact-preview/policy';

export type PreviewRow = Selectable<ArtifactPreviewsTable>;
export type CommentRow = Selectable<ArtifactPreviewCommentsTable>;
export interface SourceRef { kind: SourceKind; id: number; owner: number }

/** The factory is also the integration-test seam: production remains lazy and
 * test repositories receive isolated connections without startup migrations. */
export function createArtifactPreviewRepository(database: () => Promise<Kysely<DB>> = getDb) {
  async function previewTransaction<T>(work: (db: Kysely<DB>) => Promise<T>) {
    try {
      return await (await database()).transaction().execute(async db => {
        await sql`SELECT set_config('lock_timeout', ${`${DB_LOCK_MS}ms`}, true),
          set_config('statement_timeout', ${`${DB_STATEMENT_MS}ms`}, true),
          set_config('idle_in_transaction_session_timeout', '15000ms', true)`.execute(db);
        return await work(db);
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (['55P03', '57014', '40P01', '25P03'].includes(code || '')) throw new PreviewError('PREVIEW_BUSY', 409);
      throw error;
    }
  }

  async function source(db: Kysely<DB>, ref: SourceRef, lock = false) {
    const table = ref.kind === 'upload' ? 'thread_uploads' : 'thread_outputs';
    const result = await sql<{ id: number; thread_id: string; filename: string; filepath: string; file_size: number; user_id: number; organization_id: number | null; email: string }>`
      SELECT s.id, s.thread_id, s.filename, s.filepath, s.file_size, t.user_id, t.organization_id, u.email
      FROM ${sql.table(table)} s JOIN threads t ON t.id = s.thread_id JOIN users u ON u.id = t.user_id
      WHERE s.id = ${ref.id} AND t.user_id = ${ref.owner}
      ${lock ? sql`FOR UPDATE OF s, t, u` : sql``}
    `.execute(db);
    const row = result.rows[0];
    if (!row) throw new PreviewError('SOURCE_UNAVAILABLE', 404);
    let expires_at: string | null = null;
    if (ref.kind === 'output') {
      const output = await db.selectFrom('thread_outputs').select('expires_at').where('id', '=', ref.id).executeTakeFirst();
      expires_at = output?.expires_at ?? null;
      if (!output || (expires_at && (!Number.isFinite(Date.parse(expires_at)) || Date.parse(expires_at) <= Date.now()))) throw new PreviewError('SOURCE_UNAVAILABLE', 404);
    }
    if (row.organization_id !== null) {
      let membership = db.selectFrom('organization_memberships').select('user_id')
        .where('organization_id', '=', row.organization_id).where('user_id', '=', ref.owner).where('status', '=', 'active');
      if (lock) membership = membership.forUpdate();
      const member = await membership.executeTakeFirst();
      if (!member) throw new PreviewError('ACCESS_DENIED', 403);
    }
    return { ...row, expires_at, partition: partition(row.user_id, row.organization_id) };
  }
  async function getArtifactSource(ref: SourceRef) { return await previewTransaction(db => source(db, ref)); }
  async function serialize(db: Kysely<DB>) {
    const result = await sql<{ acquired: boolean }>`SELECT pg_try_advisory_xact_lock(728140923) AS acquired`.execute(db);
    if (!result.rows[0]?.acquired) throw new PreviewError('PREVIEW_BUSY', 409);
  }
  async function getArtifactPreview(key: string) {
    return await previewTransaction(db => db.selectFrom('artifact_previews').selectAll().where('cache_key', '=', key).executeTakeFirst());
  }
  async function invalidateArtifactPreview(key: string, token: string) {
    await previewTransaction(db => db.updateTable('artifact_previews').set({ state: 'failed' }).where('cache_key', '=', key).where('token', '=', token).where('state', '=', 'ready').execute());
  }
  async function reserveArtifactPreview(ref: SourceRef, fields: { key: string; partition: string; version: string; expires: string; converted: boolean; deadline?: number }) {
    return await previewTransaction(async db => {
      await serialize(db);
      const src = await source(db, ref, true);
      if (src.partition !== fields.partition) throw new PreviewError('SOURCE_CHANGED', 409);
      const now = Date.now();
      const deadline = fields.deadline ?? now + QUEUE_MS;
      if (now >= deadline) throw new PreviewError('QUEUE_TIMEOUT', 429);
      const existing = await db.selectFrom('artifact_previews').selectAll().where('cache_key', '=', fields.key).executeTakeFirst();
      if (existing && ((existing.state === 'ready' && Date.parse(existing.expires_at) > now) || ((existing.state === 'queued' || existing.state === 'active') && Date.parse(existing.lease_until) > now))) return { row: existing, owned: false };
      const live = await db.selectFrom('artifact_previews').select(['state', 'byte_size']).where('converted', '=', true).where('expires_at', '>', new Date(now).toISOString()).execute();
      const queued = await db.selectFrom('artifact_previews').select('cache_key').where('converted', '=', fields.converted).where('state', '=', 'queued').where('lease_until', '>', new Date(now).toISOString()).execute();
      if (queued.length >= 2) throw new PreviewError('QUEUE_FULL', 429);
      if (fields.converted && live.reduce((n, r) => n + (r.state === 'ready' ? r.byte_size : r.state === 'failed' ? 0 : OUTPUT_LIMIT), 0) + OUTPUT_LIMIT > STORAGE_LIMIT) throw new PreviewError('STORAGE_LIMIT', 507);
      const values = { cache_key: fields.key, upload_id: ref.kind === 'upload' ? ref.id : null, output_id: ref.kind === 'output' ? ref.id : null,
        thread_id: src.thread_id, owner_id: ref.owner, partition_key: fields.partition, source_version: fields.version,
        state: 'queued' as const, token: randomUUID(), lease_until: new Date(deadline).toISOString(), expires_at: fields.expires,
        render_version: null, page_count: null, byte_size: 0, converted: fields.converted };
      const row = await db.insertInto('artifact_previews').values(values).onConflict(oc => oc.column('cache_key').doUpdateSet(values)).returningAll().executeTakeFirstOrThrow();
      return { row, owned: true };
    });
  }
  async function activateArtifactPreview(key: string, token: string) {
    return await previewTransaction(async db => {
      await serialize(db);
      const now = new Date().toISOString();
      const row = await db.selectFrom('artifact_previews').selectAll().where('cache_key', '=', key).where('token', '=', token).where('state', '=', 'queued').where('lease_until', '>', now).executeTakeFirst();
      if (!row) throw new PreviewError('PREVIEW_RETRY', 409);
      const first = await db.selectFrom('artifact_previews').select('token').where('converted', '=', row.converted).where('state', '=', 'queued').where('lease_until', '>', now).orderBy('created_at').orderBy('cache_key').executeTakeFirst();
      if (first?.token !== token) return false;
      if (row.converted) {
        const slot = await db.selectFrom('artifact_preview_converter').selectAll().where('id', '=', 1).executeTakeFirstOrThrow();
        if (Date.parse(slot.lease_until) > Date.now()) return false;
      } else {
        // Original PDFs have their own one-active/two-queued inspection lane.
        const active = await db.selectFrom('artifact_previews').select('cache_key').where('converted', '=', false)
          .where('state', '=', 'active').where('lease_until', '>', now).executeTakeFirst();
        if (active) return false;
      }
      const lease = new Date(Date.now() + LEASE_MS).toISOString();
      if (row.converted) await db.updateTable('artifact_preview_converter').set({ token, lease_until: lease }).where('id', '=', 1).execute();
      const changed = await db.updateTable('artifact_previews').set({ state: 'active', lease_until: lease }).where('cache_key', '=', key).where('token', '=', token)
        .where('lease_until', '>', sql<string>`clock_timestamp()`).executeTakeFirst();
      if (Number(changed.numUpdatedRows) !== 1) throw new PreviewError('QUEUE_TIMEOUT', 429);
      return true;
    });
  }
  /** Renew only a still-live fenced converter lease, immediately before I/O.
   * Expired/old tokens can never resurrect a slot after recovery. */
  async function authorizeArtifactSubmission(key: string, token: string) {
    return await previewTransaction(async db => {
      await serialize(db);
      const row = await db.selectFrom('artifact_previews').selectAll().where('cache_key', '=', key).where('token', '=', token)
        .where('state', '=', 'active').where('converted', '=', true).where('lease_until', '>', sql<string>`clock_timestamp()`)
        .where('expires_at', '>', sql<string>`clock_timestamp()`).executeTakeFirst();
      if (!row) throw new PreviewError('PREVIEW_RETRY', 409);
      const src = await source(db, { kind: row.upload_id !== null ? 'upload' : 'output', id: row.upload_id ?? row.output_id!, owner: row.owner_id }, true);
      if (src.partition !== row.partition_key || src.thread_id !== row.thread_id) throw new PreviewError('SOURCE_CHANGED', 409);
      const renewed = await db.updateTable('artifact_preview_converter')
        .set({ lease_until: sql<string>`clock_timestamp() + ${LEASE_MS} * interval '1 millisecond'` })
        .where('id', '=', 1).where('token', '=', token).where('lease_until', '>', sql<string>`clock_timestamp()`)
        .returning('lease_until').executeTakeFirst();
      if (!renewed) throw new PreviewError('PREVIEW_RETRY', 409);
      await db.updateTable('artifact_previews').set({ lease_until: renewed.lease_until }).where('cache_key', '=', key).where('token', '=', token).execute();
      return Date.parse(renewed.lease_until);
    });
  }
  async function finishArtifactPreview(ref: SourceRef, key: string, token: string, partitionKey: string, render: string, pages: number, bytes: number, finalize: () => Promise<void>) {
    return await previewTransaction(async db => {
      await serialize(db);
      const src = await source(db, ref, true);
      if (src.partition !== partitionKey) throw new PreviewError('SOURCE_CHANGED', 409);
      const active = await db.selectFrom('artifact_previews').selectAll().where('cache_key', '=', key).where('token', '=', token)
        .where('state', '=', 'active').where('lease_until', '>', new Date().toISOString()).where('expires_at', '>', new Date().toISOString()).executeTakeFirst();
      if (!active) throw new PreviewError('PREVIEW_RETRY', 409);
      assertRecordScope(ref, src.thread_id, active);
      if (active.partition_key !== partitionKey) throw new PreviewError('ACCESS_DENIED', 403);
      // Fence the filesystem rename with the same global and source-row locks as
      // retries/deletion. A delayed old process must never overwrite a new file.
      await finalize();
      const result = await db.updateTable('artifact_previews').set({ state: 'ready', render_version: render, page_count: pages, byte_size: bytes })
        .where('cache_key', '=', key).where('token', '=', token).where('state', '=', 'active')
        .where('lease_until', '>', new Date().toISOString()).where('expires_at', '>', new Date().toISOString()).executeTakeFirst();
      if (Number(result.numUpdatedRows) !== 1) throw new PreviewError('PREVIEW_RETRY', 409);
    });
  }
  async function releaseArtifactPreview(key: string, token: string, providerSettled: boolean) {
    await previewTransaction(async db => {
      await serialize(db);
      await db.updateTable('artifact_previews').set({ state: 'failed' }).where('cache_key', '=', key).where('token', '=', token).where('state', '!=', 'ready').execute();
      // An aborted TCP request does not prove LibreOffice stopped. Keep the global
      // quarantine lease even if the source row was cascade-deleted.
      if (providerSettled) await db.updateTable('artifact_preview_converter').set({ token: null, lease_until: new Date().toISOString() }).where('id', '=', 1).where('token', '=', token).execute();
    });
  }
  async function listArtifactComments(ref: SourceRef, sourceVersion: string) {
    return await previewTransaction(db => db.selectFrom('artifact_preview_comments').selectAll().where('owner_id', '=', ref.owner)
      .where(ref.kind === 'upload' ? 'upload_id' : 'output_id', '=', ref.id).where('source_version', '=', sourceVersion).orderBy('created_at').execute());
  }
  async function getArtifactComment(id: string, owner: number) {
    return await previewTransaction(db => db.selectFrom('artifact_preview_comments').selectAll().where('id', '=', id).where('owner_id', '=', owner).executeTakeFirst());
  }
  async function createArtifactComment(ref: SourceRef, values: Insertable<ArtifactPreviewCommentsTable>) {
    return await previewTransaction(async db => {
      const src = await source(db, ref, true);
      if (src.partition !== values.partition_key) throw new PreviewError('SOURCE_CHANGED', 409);
      assertRecordScope(ref, src.thread_id, { ...values, upload_id: values.upload_id ?? null, output_id: values.output_id ?? null });
      const prior = await db.selectFrom('artifact_preview_comments').selectAll().where('owner_id', '=', ref.owner)
        .where(ref.kind === 'upload' ? 'upload_id' : 'output_id', '=', ref.id).where('source_version', '=', values.source_version).where('client_token', '=', values.client_token).executeTakeFirst();
      if (prior) {
        for (const field of ['comment_text', 'selected_text', 'surrounding_context', 'page_number', 'render_version'] as const) {
          if (prior[field] !== values[field]) throw new PreviewError('TOKEN_CONFLICT', 409);
        }
        return prior;
      }
      const count = await db.selectFrom('artifact_preview_comments').select(db.fn.countAll<string>().as('n')).where('owner_id', '=', ref.owner).executeTakeFirstOrThrow();
      if (Number(count.n) >= 5000) throw new PreviewError('COMMENT_LIMIT', 429);
      return await db.insertInto('artifact_preview_comments').values(values).returningAll().executeTakeFirstOrThrow();
    });
  }
  async function deleteArtifactComment(ref: SourceRef, sourceVersion: string, id: string) {
    await previewTransaction(db => db.deleteFrom('artifact_preview_comments').where('id', '=', id).where('owner_id', '=', ref.owner)
      .where(ref.kind === 'upload' ? 'upload_id' : 'output_id', '=', ref.id).where('source_version', '=', sourceVersion).execute());
  }
  /** Legacy generated images have UUID display IDs but numeric output storage
   * records. Match only exact server-generated filenames in the owned thread. */
  async function getArtifactImageOutput(owner: number, threadId: string, imageId: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(imageId)) throw new PreviewError('INVALID_SOURCE');
    return await previewTransaction(async db => {
      const rows = await db.selectFrom('thread_outputs as o').innerJoin('threads as t', 't.id', 'o.thread_id')
        .select('o.id').where('t.user_id', '=', owner).where('o.thread_id', '=', threadId).where('o.file_type', '=', 'image')
        .where('o.filename', 'in', ['png', 'jpg', 'jpeg', 'webp', 'gif'].map(ext => `${imageId}.${ext}`)).limit(2).execute();
      if (rows.length !== 1) throw new PreviewError('SOURCE_UNAVAILABLE', 404);
      return rows[0].id;
    });
  }
  async function sweepArtifactPreviewRecords<T>(sweepFiles: (live: Pick<PreviewRow, 'cache_key' | 'render_version' | 'token' | 'state'>[]) => Promise<T>) {
    return await previewTransaction(async db => {
      // File sweeping and finalization share a fence: an old orphan snapshot
      // cannot unlink a newly finalized file with the same content-addressed name.
      await serialize(db);
      const now = new Date().toISOString();
      await db.deleteFrom('artifact_preview_comments').where('output_id', 'in', db.selectFrom('thread_outputs').select('id').where('expires_at', '<=', now)).execute();
      await db.deleteFrom('artifact_previews').where(eb => eb.or([
        eb('expires_at', '<=', now),
        eb('output_id', 'in', db.selectFrom('thread_outputs').select('id').where('expires_at', '<=', now)),
        eb.and([eb('state', '!=', 'ready'), eb('lease_until', '<=', now)]),
      ])).execute();
      const live = await db.selectFrom('artifact_previews').select(['cache_key', 'render_version', 'token', 'state']).execute();
      return await sweepFiles(live);
    });
  }

  return { getArtifactSource, getArtifactPreview, invalidateArtifactPreview, reserveArtifactPreview, activateArtifactPreview, authorizeArtifactSubmission, finishArtifactPreview, releaseArtifactPreview, listArtifactComments, getArtifactComment, createArtifactComment, deleteArtifactComment, getArtifactImageOutput, sweepArtifactPreviewRecords };
}

export const { getArtifactSource, getArtifactPreview, invalidateArtifactPreview, reserveArtifactPreview, activateArtifactPreview, authorizeArtifactSubmission, finishArtifactPreview, releaseArtifactPreview, listArtifactComments, getArtifactComment, createArtifactComment, deleteArtifactComment, getArtifactImageOutput, sweepArtifactPreviewRecords } = createArtifactPreviewRepository();
