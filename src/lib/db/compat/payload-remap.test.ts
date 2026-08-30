import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remapPayloadReferences } from './payload-remap';

test('remapPayloadReferences rewrites thread id and message ids in JSON payloads', () => {
  const idMap = new Map<string, string>([
    ['msg-old-1', 'msg-new-1'],
    ['msg-old-2', 'msg-new-2'],
  ]);
  const input = JSON.stringify({
    threadId: 'thread-old',
    messageId: 'msg-old-1',
    path: '/data/outputs/thread-old-report.pdf',
  });

  const out = remapPayloadReferences(input, 'thread-old', 'thread-new', idMap);

  assert.equal(
    out,
    JSON.stringify({
      threadId: 'thread-new',
      messageId: 'msg-new-1',
      path: '/data/outputs/thread-new-report.pdf',
    })
  );
});

test('remapPayloadReferences returns null for a null payload', () => {
  assert.equal(remapPayloadReferences(null, 'a', 'b', new Map()), null);
});

test('remapPayloadReferences leaves unrelated text unchanged', () => {
  assert.equal(
    remapPayloadReferences('plain text', 'thread-old', 'thread-new', new Map()),
    'plain text'
  );
});

test('remapPayloadReferences rewrites every mapped message id occurrence', () => {
  const idMap = new Map<string, string>([['old-a', 'new-a']]);
  assert.equal(
    remapPayloadReferences('{"a":"old-a","b":"old-a"}', 'src', 'dst', idMap),
    '{"a":"new-a","b":"new-a"}'
  );
});
