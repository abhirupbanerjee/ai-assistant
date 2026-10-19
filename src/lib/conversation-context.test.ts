/**
 * Tests for the buildHistory token-budget fast-path fix (Phase A4b).
 *
 * Run: npx tsx --test src/lib/conversation-context.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory } from './conversation-context';
import { countTokens } from './summarization';
import type { Message } from '@/types';

function makeMessage(id: string, role: 'user' | 'assistant', content: string): Message {
  return { id, role, content, threadId: 't1', createdAt: new Date().toISOString() } as unknown as Message;
}

describe('buildHistory fast path (A4b)', () => {
  test('below message-count limit and under token budget: all included', () => {
    const messages = [
      makeMessage('1', 'user', 'hello world'),
      makeMessage('2', 'assistant', 'hi there'),
      makeMessage('3', 'user', 'how are you'),
    ];
    const result = buildHistory(messages, 10, 6000);
    assert.equal(result.all.length, 3);
    const expected = messages.reduce((sum, m) => sum + countTokens(m.content), 0);
    assert.equal(result.tokens, expected);
  });

  test('below count limit but OVER token budget: oldest dropped, recent kept', () => {
    // 3 messages, one giant 100k-char (~25k token) message, cap 6000.
    const messages = [
      makeMessage('1', 'user', 'giant '.repeat(20000)), // ~120,000 chars
      makeMessage('2', 'assistant', 'small answer'),
      makeMessage('3', 'user', 'recent question'),
    ];
    const result = buildHistory(messages, 10, 6000);
    // Fast path previously returned everything (~24k tokens). Now the giant
    // old message must be dropped; the most recent is always kept.
    assert.ok(result.tokens <= 6000 + countOfMostRecent(messages), `tokens=${result.tokens}`);
    assert.ok(result.all.some(m => m.id === '3'), 'most recent message must survive');
    assert.ok(!result.all.some(m => m.id === '1'), 'oversized oldest message must be dropped');
  });

  test('most recent message always survives even when alone over budget', () => {
    const messages = [
      makeMessage('1', 'user', 'x'.repeat(200)), // 50 tokens
      makeMessage('2', 'user', 'y'.repeat(100000)), // 25000 tokens
    ];
    const result = buildHistory(messages, 10, 6000);
    // The newest message consumes the allowance first; an older anchor must
    // not add to an already oversized newest message.
    assert.ok(result.all.some(m => m.id === '2'), 'most recent message must survive');
    assert.deepEqual(result.all.map(m => m.id), ['2']);
  });

  test('two individually fitting messages retain only the newest when their sum exceeds the budget', () => {
    const messages = [
      makeMessage('old', 'user', 'old message '.repeat(100)),
      makeMessage('recent', 'assistant', 'recent message '.repeat(100)),
    ];
    const budget = Math.max(...messages.map(m => countTokens(m.content)));
    const result = buildHistory(messages, 10, budget);
    assert.deepEqual(result.all.map(m => m.id), ['recent']);
    assert.ok(result.tokens <= budget);
  });

  test('single oversized message is retained once as the mandatory newest message', () => {
    const messages = [makeMessage('only', 'user', 'large '.repeat(100))];
    const result = buildHistory(messages, 10, 1);
    assert.deepEqual(result.all.map(m => m.id), ['only']);
    assert.equal(result.tokens, countTokens(messages[0].content));
  });

  test('anchors dropped before recents when over budget', () => {
    const messages = [
      makeMessage('a1', 'user', 'anchor one '.repeat(1000)), // anchor
      makeMessage('a2', 'assistant', 'anchor two '.repeat(1000)), // anchor
      makeMessage('m3', 'user', 'mid'),
      makeMessage('m4', 'assistant', 'mid2'),
      makeMessage('m5', 'user', 'last'),
    ];
    const result = buildHistory(messages, 10, 600);
    const ids = result.all.map(m => m.id);
    // Most recent must always be present.
    assert.ok(ids.includes('m5'));
    assert.ok(result.tokens <= 600 + countOfMostRecent(messages));
  });
});

function countOfMostRecent(messages: Message[]): number {
  const last = messages[messages.length - 1];
  return countTokens(last.content);
}
