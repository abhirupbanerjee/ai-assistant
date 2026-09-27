import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePreview, type PreparationDependencies } from './service';
import { hash, LEASE_MS, PreviewError } from './policy';
import type { ResolvedSource } from './source';
import type { PreviewRow } from '@/lib/db/compat';

function harness(format = 'xlsx') {
  const src = { ref: { kind: 'upload', id: 7, owner: 1 }, row: { partition: 'owner:1', thread_id: 'thread' },
    format, bytes: Buffer.from('source'), key: hash('key'), sourceVersion: hash('source'), expires: new Date(Date.now()+600000).toISOString(), title: 'Fixture' } as ResolvedSource;
  const row = { cache_key: src.key, token: 'token', state: 'queued', converted: format !== 'pdf', expires_at: src.expires } as PreviewRow;
  const calls: string[] = []; const releases: boolean[] = [];
  const dependencies: PreparationDependencies = {
    reserveArtifactPreview: async (_ref, fields) => { calls.push('reserve'); assert.equal(fields.converted,format!=='pdf'); return {row,owned:true}; },
    activateArtifactPreview: async () => { calls.push('activate'); return true; },
    authorizeArtifactSubmission: async () => { calls.push('submission'); return Date.now()+LEASE_MS; },
    getArtifactPreview: async () => row,
    finishArtifactPreview: async (_ref,_key,_token,_partition,_render,_pages,_bytes,finalize) => { calls.push('finish'); await finalize(); },
    releaseArtifactPreview: async (_key,_token,settled) => { calls.push('release'); releases.push(settled); },
    reauthorize: async () => { calls.push('reauthorize'); return src; },
    reauthorizeContent: async () => { calls.push('content'); },
    inspect: async (_bytes,format) => { calls.push(`inspect:${format}`); return format==='pdf'?2:0; },
    convert: async (_bytes,_format,_signal,_fetch,lease) => { calls.push('convert'); assert.ok(lease && lease>Date.now()); return Buffer.from('%PDF-fixture'); },
    writeCache: async () => { calls.push('write'); },
    servePreview: async () => { calls.push('serve'); return {bytes:Buffer.from('pdf'),row:{...row,state:'ready',render_version:hash('render'),page_count:2}}; },
  };
  return {src,row,calls,releases,dependencies};
}

test('preparation lifecycle and failure fencing', async t => {
  const enabled=process.env.ARTIFACT_PREVIEW_ENABLED,url=process.env.ARTIFACT_GOTENBERG_URL;
  process.env.ARTIFACT_PREVIEW_ENABLED='true'; process.env.ARTIFACT_GOTENBERG_URL='http://gotenberg:3000';
  try {
    await t.test('Office validates then renews before submission and reauthorizes before finalization',async()=>{
      const h=harness(); const result=await preparePreview(h.src,new AbortController().signal,h.dependencies);
      assert.equal(result.state,'ready'); assert.equal(result.pageCount,2);
      assert.ok(h.calls.indexOf('inspect:xlsx')<h.calls.indexOf('submission'));
      assert.ok(h.calls.indexOf('submission')<h.calls.indexOf('convert'));
      assert.ok(h.calls.indexOf('inspect:pdf')<h.calls.indexOf('write'));
      assert.deepEqual(h.releases,[true]);
    });
    await t.test('original PDF never submits or writes derivative and works with conversion disabled',async()=>{
      const h=harness('pdf'); process.env.ARTIFACT_PREVIEW_ENABLED='false';
      try {
        const result=await preparePreview(h.src,new AbortController().signal,h.dependencies);
        assert.equal(result.converted,false); assert.equal(h.calls.includes('submission'),false);
        assert.equal(h.calls.includes('convert'),false); assert.equal(h.calls.includes('write'),false);
      } finally {process.env.ARTIFACT_PREVIEW_ENABLED='true';}
    });
    await t.test('lost lease cannot submit and releases only its own reservation',async()=>{
      const h=harness();h.dependencies.authorizeArtifactSubmission=async()=>{throw new PreviewError('PREVIEW_RETRY',409);};
      await assert.rejects(preparePreview(h.src,new AbortController().signal,h.dependencies),{code:'PREVIEW_RETRY'});
      assert.equal(h.calls.includes('convert'),false); assert.deepEqual(h.releases,[true]);
    });
    await t.test('uncertain provider failure keeps quarantine',async()=>{
      const h=harness();h.dependencies.convert=async()=>{throw new PreviewError('CONVERSION_TIMEOUT',502);};
      await assert.rejects(preparePreview(h.src,new AbortController().signal,h.dependencies));
      assert.deepEqual(h.releases,[false]); assert.equal(h.calls.includes('write'),false);
    });
    await t.test('source deletion after conversion prevents finalization',async()=>{
      const h=harness();let reads=0;
      h.dependencies.reauthorize=async()=>{if(++reads===3)throw new PreviewError('SOURCE_UNAVAILABLE',404);return h.src;};
      await assert.rejects(preparePreview(h.src,new AbortController().signal,h.dependencies));
      assert.equal(h.calls.includes('finish'),false); assert.deepEqual(h.releases,[true]);
    });
    await t.test('duplicate ready reservation reuses cache without activation',async()=>{
      const h=harness();h.row.state='ready';h.row.render_version=hash('render');
      h.dependencies.reserveArtifactPreview=async()=>({row:h.row,owned:false});
      await preparePreview(h.src,new AbortController().signal,h.dependencies);
      assert.deepEqual(h.calls,['serve']); assert.deepEqual(h.releases,[]);
    });
    await t.test('cancelled owned reservation is released without submission',async()=>{
      const h=harness(),abort=new AbortController();abort.abort();
      await assert.rejects(preparePreview(h.src,abort.signal,h.dependencies));
      assert.equal(h.calls.includes('convert'),false);assert.deepEqual(h.releases,[true]);
    });
  } finally {
    if(enabled===undefined)delete process.env.ARTIFACT_PREVIEW_ENABLED;else process.env.ARTIFACT_PREVIEW_ENABLED=enabled;
    if(url===undefined)delete process.env.ARTIFACT_GOTENBERG_URL;else process.env.ARTIFACT_GOTENBERG_URL=url;
  }
});
