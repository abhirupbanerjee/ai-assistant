import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cacheRoot, cacheFilename, writeCache, readCache, removeCache } from './cache';
import { hash } from './policy';
import { ARTIFACT_PREVIEW_SCHEMA } from '../db/artifact-preview-migration';

test('atomic private cache is content-addressed and rejects path-like versions', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'artifact-cache-'));
  const prior = process.env.DATA_DIR; process.env.DATA_DIR=temp;
  try {
    const key=hash('scope'),render=hash('render'),bytes=Buffer.from('%PDF-test');
    await writeCache(key,render,bytes,randomUUID());
    assert.deepEqual(await readCache(key,render),bytes);
    assert.deepEqual(await fs.readdir(cacheRoot()),[cacheFilename(key,render)]);
    assert.equal((await fs.stat(path.join(cacheRoot(),cacheFilename(key,render)))).mode & 0o777,0o600);
    assert.throws(()=>cacheFilename('../escape',render));
    await assert.rejects(readCache(hash('other-owner'),render));
    await removeCache(key,render); await assert.rejects(readCache(key,render));
  } finally { if(prior===undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR=prior; await fs.rm(temp,{recursive:true,force:true}); }
});
test('fresh-install schema matches migration; source cascades do not delete converter quarantine', async () => {
  const schema=await fs.readFile('src/lib/db/schema/postgres.sql','utf8');
  assert.ok(schema.includes(ARTIFACT_PREVIEW_SCHEMA));
  assert.ok(ARTIFACT_PREVIEW_SCHEMA.includes('REFERENCES thread_uploads(id) ON DELETE CASCADE'));
  assert.ok(ARTIFACT_PREVIEW_SCHEMA.includes('REFERENCES thread_outputs(id) ON DELETE CASCADE'));
  const slot=ARTIFACT_PREVIEW_SCHEMA.split('CREATE TABLE IF NOT EXISTS artifact_preview_converter (')[1].split(');')[0];
  assert.equal(slot.includes('REFERENCES'),false);
});
