import test from 'node:test';
import assert from 'node:assert/strict';
import { identity, partition, assertRecordScope, cacheKey, hash, assertSurface, expectedArtifactOrigin, providerUrl, version } from './policy';
import { contained, readPrivateFile } from './source';
import { commentInput } from './comments';
import { imageMime, resolveChatComments } from './chat';
import { buildUploadCanvasItem } from '@/lib/artifact-builders';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ResolvedSource } from './source';
import type { CommentRow } from '@/lib/db/compat';

test('stored records must match owner, thread and exactly one source kind',()=>{
  const ref={kind:'upload' as const,id:7,owner:1};
  const row={owner_id:1,thread_id:'owned',upload_id:7,output_id:null};
  assert.doesNotThrow(()=>assertRecordScope(ref,'owned',row));
  for(const patch of [{owner_id:2},{thread_id:'other'},{upload_id:8},{upload_id:null,output_id:7},{output_id:7}]) {
    assert.throws(()=>assertRecordScope(ref,'owned',{...row,...patch}),{code:'ACCESS_DENIED'});
  }
  assert.doesNotThrow(()=>assertRecordScope({kind:'output',id:7,owner:1},'owned',{...row,upload_id:null,output_id:7}));
});

test('strict source IDs and kind cannot alias', () => {
  for (const id of ['0', '-1', '01', '1a', 'upload-1', '1.0', ' 1', '2147483648']) assert.throws(() => identity('output', id));
  assert.throws(() => identity('workspace', '1'));
  assert.deepEqual(identity('upload', '1'), {kind:'upload',id:1});
  assert.notEqual(cacheKey('owner:1','upload',1,hash('a')),cacheKey('owner:1','output',1,hash('a')));
  assert.notEqual(cacheKey('owner:1','upload',1,hash('a')),cacheKey('owner:2','upload',1,hash('a')));
  assert.notEqual(cacheKey('owner:1','upload',1,hash('a')),cacheKey('owner:1','upload',1,hash('b')));
  assert.throws(() => version('../../x'));
});
test('tenant scope is never global and surfaces/mutations fail closed', () => {
  assert.equal(partition(1,null),'owner:1'); assert.equal(partition(1,2),'org:2:owner:1');
  assert.throws(() => partition(1,0));
  assert.throws(() => assertSurface(new Headers({'x-workspace-slug':''})));
  assert.throws(() => assertSurface(new Headers(),true,'https://app'));
  assert.throws(() => assertSurface(new Headers({origin:'https://evil'}),true,'https://app'));
  assert.doesNotThrow(() => assertSurface(new Headers({origin:'https://app'}),true,'https://app'));
});
test('CSRF origin uses trusted external URL behind TLS proxy, not internal or client-supplied headers', () => {
  const external = 'https://app.example';
  const internal = 'http://app:3000/api/chat/stream';
  const headers = new Headers({ origin: external, 'sec-fetch-site': 'same-origin', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http' });
  assert.equal(expectedArtifactOrigin(internal, external), external);
  assert.doesNotThrow(() => assertSurface(headers, true, expectedArtifactOrigin(internal, external)));
  assert.throws(() => assertSurface(new Headers({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }), true, expectedArtifactOrigin(internal, external)), { code: 'CSRF_REJECTED' });
  assert.throws(() => assertSurface(new Headers({ origin: external, 'sec-fetch-site': 'cross-site' }), true, expectedArtifactOrigin(internal, external)), { code: 'CSRF_REJECTED' });
  assert.equal(expectedArtifactOrigin('http://localhost:3000/api/chat/stream', ''), 'http://localhost:3000');
  assert.throws(() => expectedArtifactOrigin(internal, 'https://evil.example/path'), { code: 'CSRF_REJECTED' });
});
test('empty comment lists do not turn ordinary chat into a CSRF-gated comment submission', async () => {
  const empty = await resolveChatComments([], 1, 'thread', new Headers({ origin: 'https://app.example' }), 'http://app:3000');
  assert.deepEqual(empty.comments, []);
  assert.equal(empty.images.size, 0);
  await assert.rejects(resolveChatComments([], 1, 'thread', new Headers({ 'x-workspace-slug': 'other' }), 'https://app.example'), { code: 'ACCESS_DENIED' });
  await assert.rejects(resolveChatComments([{ commentId: 'saved', persisted: true }], 1, 'thread', new Headers({ origin: 'https://app.example' }), 'http://app:3000'), { code: 'CSRF_REJECTED' });
});
test('provider URL permits local trusted endpoint only', () => {
  const prior = process.env.ARTIFACT_PREVIEW_ENABLED; process.env.ARTIFACT_PREVIEW_ENABLED = 'true';
  try {
    assert.equal(providerUrl('http://gotenberg:3000'),'http://gotenberg:3000/forms/libreoffice/convert');
    for (const url of ['https://example.com','http://gotenberg.evil','http://user@gotenberg','http://gotenberg/path','file:///x']) assert.throws(() => providerUrl(url));
  } finally { if (prior === undefined) delete process.env.ARTIFACT_PREVIEW_ENABLED; else process.env.ARTIFACT_PREVIEW_ENABLED = prior; }
});
test('private files reject traversal and symlink escapes with bounded reads', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'artifact-source-'));
  try {
    await fs.mkdir(path.join(root,'private')); await fs.writeFile(path.join(root,'outside'),'secret');
    await fs.writeFile(path.join(root,'private','inside'),'okay');
    await fs.symlink(path.join(root,'outside'),path.join(root,'private','link'));
    assert.equal(contained('/private','/private-other/a'),false);
    await assert.rejects(readPrivateFile(path.join(root,'private'),path.join(root,'private','link'),10));
    await assert.rejects(readPrivateFile(path.join(root,'private'),path.join(root,'outside'),10));
    await assert.rejects(readPrivateFile(path.join(root,'private'),path.join(root,'private','inside'),2));
    assert.equal((await readPrivateFile(path.join(root,'private'),path.join(root,'private','inside'),10)).toString(),'okay');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('comment anchors and idempotency inputs are bounded', () => {
  const base = {sourceVersion:hash('a'),commentText:'Review',clientToken:'abcdefgh'};
  assert.equal(commentInput(base).kind,'general');
  assert.throws(() => commentInput({...base,pageNumber:201}));
  assert.throws(() => commentInput({...base,pageNumber:201,renderVersion:hash('b')}));
  assert.equal(commentInput({...base,pageNumber:1,renderVersion:hash('b')}).kind,'page');
  assert.equal(commentInput({...base,pageNumber:1}).kind,'page');
  assert.equal(commentInput({...base,selectedText:'quote'}).kind,'selection');
  assert.throws(() => commentInput({...base,commentText:'x'.repeat(4001)}));
});
test('legacy chart/image comments never authorize arbitrary URL fetching', async () => {
  const result = await resolveChatComments([{commentId:'legacy-one',artifactId:'chart-abc',artifactType:'chart',artifactTitle:'Chart',commentText:'Explain',imageUrl:'http://169.254.169.254/latest'}],1,'thread',new Headers({origin:'https://app'}),'https://app');
  assert.equal(result.comments[0].imageUrl,undefined); assert.equal(result.images.size,0);
  assert.equal(imageMime(Buffer.from('%PDF-1.7')),null);
  await assert.rejects(resolveChatComments([{commentId:'legacy-doc',artifactId:'fake',artifactType:'pdf',artifactTitle:'Doc',commentText:'x'}],1,'thread',new Headers({origin:'https://app'}),'https://app'));
});
test('saved chat references use authoritative snapshots and deny cross-owner/thread/stale refs', async () => {
  const src = {ref:{owner:1,kind:'upload',id:7}, row:{partition:'owner:1',thread_id:'thread'}, sourceVersion:hash('source'), title:'Real.pdf',format:'pdf',bytes:Buffer.from('%PDF-')} as ResolvedSource;
  const row = {id:'saved',upload_id:7,output_id:null,owner_id:1,partition_key:'owner:1',source_version:src.sourceVersion,render_version:null,kind:'general',comment_text:'Real comment',selected_text:null,surrounding_context:null,page_number:null,created_at:'2026-09-27T00:00:00Z'} as CommentRow;
  const deps = {getArtifactComment:async (_id:string, owner:number)=>owner===1?row:undefined,resolveSource:async()=>src};
  const headers = new Headers({origin:'https://app'});
  const input = [{commentId:'saved',persisted:true,commentText:'Spoof',imageUrl:'https://evil'}];
  const result = await resolveChatComments(input,1,'thread',headers,'https://app',deps);
  assert.equal(result.comments[0].commentText,'Real comment'); assert.equal(result.comments[0].imageUrl,undefined);
  await assert.rejects(resolveChatComments(input,2,'thread',headers,'https://app',deps));
  await assert.rejects(resolveChatComments(input,1,'other',headers,'https://app',deps));
  await assert.rejects(resolveChatComments([{...input[0],sourceVersion:hash('stale')}],1,'thread',headers,'https://app',deps));
  await assert.rejects(resolveChatComments([{...input[0],source:{kind:'output',id:'7'}}],1,'thread',headers,'https://app',deps));
});
test('legacy generated image UUID resolves an owned numeric output, not its URL',async()=>{
  const imageId='12345678-1234-1234-1234-123456789abc';
  const src={ref:{owner:1,kind:'output',id:9},row:{thread_id:'thread'},format:'png',title:'Image',bytes:Buffer.from([137,80,78,71,13,10,26,10])} as ResolvedSource;
  const result=await resolveChatComments([{commentId:'image-review',artifactId:imageId,artifactType:'image',artifactTitle:'Spoof',commentText:'Explain',imageUrl:'http://evil'}],1,'thread',new Headers({origin:'https://app'}),'https://app',{
    getArtifactComment:async()=>undefined,
    getArtifactImageOutput:async(owner,thread,id)=>{assert.equal(owner,1);assert.equal(thread,'thread');assert.equal(id,imageId);return 9;},
    resolveSource:async(owner,kind,id)=>{assert.equal(owner,1);assert.equal(kind,'output');assert.equal(id,'9');return src;},
  });
  assert.equal(result.images.size,1);assert.equal(result.comments[0].artifactTitle,'Image');
  assert.equal(result.images.get(imageId)?.mimeType,'image/png');
  assert.ok(!result.comments[0].imageUrl?.includes('evil'));
});
test('upload canvas item mappings preserve text, markdown, docx, and office types', () => {
  const baseUpload = { id: 10, threadId: 't-1', filename: 'notes.txt', fileType: 'text/plain', fileSize: 100, createdAt: '', uploadedAt: '' };
  assert.equal(buildUploadCanvasItem(baseUpload).artifactType, 'md');
  assert.equal(buildUploadCanvasItem({ ...baseUpload, filename: 'data.csv', fileType: 'text/csv' }).artifactType, 'md');
  assert.equal(buildUploadCanvasItem({ ...baseUpload, filename: 'payload.json', fileType: 'application/json' }).artifactType, 'md');
  assert.equal(buildUploadCanvasItem({ ...baseUpload, filename: 'doc.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }).artifactType, 'docx');
  assert.equal(buildUploadCanvasItem({ ...baseUpload, filename: 'slides.pptx', fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }).artifactType, 'pptx');
  assert.equal(buildUploadCanvasItem({ ...baseUpload, filename: 'sheet.xlsx', fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).artifactType, 'xlsx');
  assert.equal(buildUploadCanvasItem({ ...baseUpload, filename: 'old.doc', fileType: 'application/msword' }).artifactType, 'unsupported');
});
