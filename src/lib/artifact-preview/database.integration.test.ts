import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Kysely, PostgresDialect, sql, type Insertable } from 'kysely';
import type { DB, ArtifactPreviewCommentsTable } from '../db/db-types';
import { createArtifactPreviewRepository } from '../db/compat/artifact-previews';
import { migrateArtifactPreviews } from '../db/artifact-preview-migration';
import { integrationDatabaseUrl } from './integration-config';
import { cacheKey, hash, PreviewError } from './policy';

const url = integrationDatabaseUrl();
const fixtureSchema = `
CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT NOT NULL);
CREATE TABLE threads(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), organization_id INTEGER);
CREATE TABLE organization_memberships(organization_id INTEGER, user_id INTEGER REFERENCES users(id), status TEXT NOT NULL, PRIMARY KEY(organization_id,user_id));
CREATE TABLE thread_uploads(id INTEGER PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, filename TEXT NOT NULL, filepath TEXT NOT NULL, file_size INTEGER NOT NULL);
CREATE TABLE thread_outputs(id INTEGER PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, filename TEXT NOT NULL, filepath TEXT NOT NULL, file_size INTEGER NOT NULL, file_type TEXT NOT NULL, expires_at TIMESTAMPTZ);
CREATE TABLE unrelated_sentinel(value TEXT NOT NULL);
INSERT INTO unrelated_sentinel VALUES ('untouched');
`;

test('artifact preview PostgreSQL integration (isolated schema, two independent pools)', { skip: !url, timeout: 60_000 }, async t => {
  const schema = `artifact_preview_it_${randomUUID().replaceAll('-','')}`;
  const admin = new Pool({connectionString:url!,max:1,connectionTimeoutMillis:2000});
  const databases: Kysely<DB>[] = [];
  let created = false;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`); created=true;
    for(let n=0;n<2;n++) {
      const pool=new Pool({connectionString:url!,max:4,connectionTimeoutMillis:2000,options:`-c search_path=${schema}`});
      databases.push(new Kysely<DB>({dialect:new PostgresDialect({pool})}));
    }
    const [db,otherDb]=databases;
    const repo=createArtifactPreviewRepository(async()=>db),other=createArtifactPreviewRepository(async()=>otherDb);
    await sql.raw(fixtureSchema).execute(db);
    await migrateArtifactPreviews(db);
    await migrateArtifactPreviews(db);
    const version=hash('fixture-source');
    const ref=(id=1)=>({kind:'upload' as const,id,owner:1});
    const fields=(id=1,converted=true)=>({key:cacheKey('owner:1','upload',id,version),partition:'owner:1',version,expires:new Date(Date.now()+600000).toISOString(),converted});
    const comment=(id=1): Insertable<ArtifactPreviewCommentsTable>=>({id:randomUUID(),upload_id:id,output_id:null,thread_id:'owned',owner_id:1,partition_key:'owner:1',source_version:version,render_version:null,kind:'general',comment_text:'Review',selected_text:null,surrounding_context:null,page_number:null,client_token:'same-token'});
    async function reset() {
      await sql`TRUNCATE artifact_preview_comments, artifact_previews, thread_uploads, thread_outputs, organization_memberships, threads, users CASCADE`.execute(db);
      await sql`UPDATE artifact_preview_converter SET token=NULL, lease_until=clock_timestamp() - interval '1 second'`.execute(db);
      await sql`INSERT INTO users VALUES (1,'one@example.test'),(2,'two@example.test'); INSERT INTO threads VALUES ('owned',1,NULL),('other',2,NULL);`.execute(db);
      for(let id=1;id<=5;id++) await sql`INSERT INTO thread_uploads VALUES (${id},'owned',${`fixture${id}.xlsx`},'/unused',4)`.execute(db);
      await sql`INSERT INTO thread_uploads VALUES (9,'other','private.xlsx','/unused',4); INSERT INTO thread_outputs VALUES (1,'owned','fixture.pdf','/unused',4,'pdf',NULL)`.execute(db);
    }
    async function retry<T>(fn:()=>Promise<T>):Promise<T> {
      for(let n=0;n<20;n++) {
        try{return await fn();}catch(e){if(!(e instanceof PreviewError)||e.code!=='PREVIEW_BUSY'||n===19)throw e;}
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      throw new Error('unreachable');
    }
    await t.test('repeat-safe migration preserves unrelated tables and string timestamps',async()=>{
      await reset();const reserved=await repo.reserveArtifactPreview(ref(),fields());
      assert.equal(typeof reserved.row.created_at,'string');assert.equal(typeof reserved.row.lease_until,'string');
      assert.equal((await sql<{value:string}>`SELECT value FROM unrelated_sentinel`.execute(db)).rows[0].value,'untouched');
      await assert.rejects(repo.getArtifactSource({kind:'upload',id:9,owner:1}),{code:'SOURCE_UNAVAILABLE'});
    });
    await t.test('independent pools deduplicate simultaneous reservations',async()=>{
      await reset();const [a,b]=await Promise.all([retry(()=>repo.reserveArtifactPreview(ref(),fields())),retry(()=>other.reserveArtifactPreview(ref(),fields()))]);
      assert.equal(Number(a.owned)+Number(b.owned),1);assert.equal(a.row.token,b.row.token);
    });
    await t.test('one Office active, two queued, separate PDF lane',async()=>{
      await reset();const a=await repo.reserveArtifactPreview(ref(),fields());assert.equal(await repo.activateArtifactPreview(fields().key,a.row.token),true);
      const b=await other.reserveArtifactPreview(ref(2),fields(2));await repo.reserveArtifactPreview(ref(3),fields(3));
      await assert.rejects(other.reserveArtifactPreview(ref(4),fields(4)),{code:'QUEUE_FULL'});
      assert.equal(await other.activateArtifactPreview(fields(2).key,b.row.token),false);
      const pdf=await repo.reserveArtifactPreview(ref(4),fields(4,false));assert.equal(await repo.activateArtifactPreview(fields(4).key,pdf.row.token),true);
      assert.equal((await sql<{token:string}>`SELECT token FROM artifact_preview_converter`.execute(db)).rows[0].token,a.row.token);
    });
    await t.test('uncertain release and source deletion preserve global quarantine; expired recovery fences old token',async()=>{
      await reset();const a=await repo.reserveArtifactPreview(ref(),fields());await repo.activateArtifactPreview(fields().key,a.row.token);
      await repo.releaseArtifactPreview(fields().key,a.row.token,false);
      await sql`DELETE FROM thread_uploads WHERE id=1`.execute(db);
      const b=await other.reserveArtifactPreview(ref(2),fields(2));assert.equal(await other.activateArtifactPreview(fields(2).key,b.row.token),false);
      await sql`UPDATE artifact_preview_converter SET lease_until=clock_timestamp()-interval '1 second'`.execute(db);
      assert.equal(await other.activateArtifactPreview(fields(2).key,b.row.token),true);
      await assert.rejects(repo.authorizeArtifactSubmission(fields().key,a.row.token),{code:'PREVIEW_RETRY'});
      await repo.releaseArtifactPreview(fields().key,a.row.token,true);
      assert.equal((await sql<{token:string}>`SELECT token FROM artifact_preview_converter`.execute(db)).rows[0].token,b.row.token);
    });
    await t.test('partition changes and membership revocation deny submission',async()=>{
      await reset();const a=await repo.reserveArtifactPreview(ref(),fields());await repo.activateArtifactPreview(fields().key,a.row.token);
      await sql`UPDATE threads SET organization_id=7 WHERE id='owned'; INSERT INTO organization_memberships VALUES (7,1,'active')`.execute(db);
      await assert.rejects(repo.authorizeArtifactSubmission(fields().key,a.row.token),{code:'SOURCE_CHANGED'});
      await sql`UPDATE organization_memberships SET status='disabled' WHERE user_id=1`.execute(db);
      await assert.rejects(repo.getArtifactSource(ref()),{code:'ACCESS_DENIED'});
    });
    await t.test('concurrent idempotent comment create and spoof rejection',async()=>{
      await reset();const data=comment();const [a,b]=await Promise.all([retry(()=>repo.createArtifactComment(ref(),data)),retry(()=>other.createArtifactComment(ref(),{...data,id:randomUUID()}))]);
      assert.equal(a.id,b.id);assert.equal(typeof a.created_at,'string');
      await assert.rejects(repo.createArtifactComment(ref(),{...data,comment_text:'changed'}),{code:'TOKEN_CONFLICT'});
      await assert.rejects(repo.createArtifactComment(ref(),{...data,owner_id:2}),{code:'ACCESS_DENIED'});
      assert.equal(await other.getArtifactComment(a.id,2),undefined);
      await other.deleteArtifactComment({kind:'upload',id:1,owner:2},version,a.id);
      assert.ok(await repo.getArtifactComment(a.id,1));
    });
    await t.test('source deletion before finalization cannot recreate cache metadata',async()=>{
      await reset();const a=await repo.reserveArtifactPreview(ref(),fields());await repo.activateArtifactPreview(fields().key,a.row.token);
      await sql`DELETE FROM thread_uploads WHERE id=1`.execute(db);let called=false;
      await assert.rejects(repo.finishArtifactPreview(ref(),fields().key,a.row.token,'owner:1',hash('render'),1,4,async()=>{called=true;}),{code:'SOURCE_UNAVAILABLE'});
      assert.equal(called,false);assert.equal(await repo.getArtifactPreview(fields().key),undefined);
    });
    await t.test('finalization fences deletion and sweeping until commit',async()=>{
      await reset();const a=await repo.reserveArtifactPreview(ref(),fields());await repo.activateArtifactPreview(fields().key,a.row.token);
      let entered!:()=>void,release!:()=>void;
      const inside=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
      const finishing=repo.finishArtifactPreview(ref(),fields().key,a.row.token,'owner:1',hash('render'),1,4,async()=>{entered();await gate;});
      try {
        await inside;
        await assert.rejects(other.sweepArtifactPreviewRecords(async()=>undefined),{code:'PREVIEW_BUSY'});
        await assert.rejects(otherDb.transaction().execute(async trx=>{
          await sql`SET LOCAL lock_timeout='100ms'`.execute(trx);await sql`DELETE FROM thread_uploads WHERE id=1`.execute(trx);
        }),e=>(e as {code?:string}).code==='55P03');
      } finally {release();await finishing;}
      assert.equal((await repo.getArtifactPreview(fields().key))?.state,'ready');
    });
    await t.test('cache expiry retains comments; source expiry/thread deletion purge reviews',async()=>{
      await reset();await repo.createArtifactComment(ref(),comment());await repo.reserveArtifactPreview(ref(),fields());
      await sql`UPDATE artifact_previews SET expires_at=clock_timestamp()-interval '1 second'`.execute(db);
      await repo.sweepArtifactPreviewRecords(async()=>undefined);assert.equal((await repo.listArtifactComments(ref(),version)).length,1);
      const output={kind:'output' as const,id:1,owner:1};await repo.createArtifactComment(output,{...comment(),upload_id:null,output_id:1});
      await sql`UPDATE thread_outputs SET expires_at=clock_timestamp()-interval '1 second' WHERE id=1`.execute(db);
      await assert.rejects(repo.getArtifactSource(output),{code:'SOURCE_UNAVAILABLE'});
      await repo.sweepArtifactPreviewRecords(async()=>undefined);assert.equal((await repo.listArtifactComments(output,version)).length,0);
      await sql`DELETE FROM threads WHERE id='owned'`.execute(db);assert.equal((await repo.listArtifactComments(ref(),version)).length,0);
    });
  } finally {
    for(const db of databases)await db.destroy();
    if(created)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
