import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairTruncatedJson } from './json-repair';

test('intact JSON passes through unchanged', () => {
  const input = '{"title":"Q3","slides":[{"type":"title","title":"Q3 Review"}]}';
  assert.equal(repairTruncatedJson(input), input);
});

test('truncated mid-string value is closed and recovered', () => {
  // Cut off mid-slide-title, inside the string
  const truncated = '{"title":"Q3 Review","slides":[{"type":"content","title":"Key Met';
  const repaired = repairTruncatedJson(truncated);
  assert.ok(repaired);
  const parsed = JSON.parse(repaired!) as { title: string; slides: Array<{ type?: string; title?: string }> };
  assert.equal(parsed.title, 'Q3 Review');
  // The rewind closes the partial slide at its last complete pair — it keeps
  // {"type":"content"} but drops the partial "Key Met" string. The slide is
  // structurally valid but semantically partial (missing title) — that's the
  // pptx-gen guard's job to drop.
  assert.equal(parsed.slides.length, 1);
  assert.equal(parsed.slides[0].type, 'content');
  assert.equal(parsed.slides[0].title, undefined);
});

test('truncated after complete elements drops only the partial one', () => {
  const truncated =
    '{"title":"Q3","slides":[{"type":"title","title":"Cover"},{"type":"content","title":"Agenda"},{"type":"chart","ti';
  const repaired = repairTruncatedJson(truncated);
  assert.ok(repaired);
  const parsed = JSON.parse(repaired!) as { slides: Array<{ type: string; title: string }> };
  assert.equal(parsed.slides.length, 2);
  assert.equal(parsed.slides[0].type, 'title');
  assert.equal(parsed.slides[1].title, 'Agenda');
});

test('truncated bare array of slides recovers complete slides', () => {
  const truncated = '[{"type":"title","title":"A"},{"type":"content","title":"B","content":"x';
  const repaired = repairTruncatedJson(truncated);
  assert.ok(repaired);
  const parsed = JSON.parse(repaired!) as Array<{ type: string }>;
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].type, 'title');
});

test('truncated between key and value (dangling colon) is rewound', () => {
  const truncated = '{"title":"Q3","slides":[{"type":"title","title":"Cover"}],"theme';
  const repaired = repairTruncatedJson(truncated);
  assert.ok(repaired);
  const parsed = JSON.parse(repaired!) as { title: string; slides: unknown[] };
  assert.equal(parsed.title, 'Q3');
  assert.equal(parsed.slides.length, 1);
});

test('escaped quotes inside strings do not confuse the scanner', () => {
  const truncated = '{"title":"He said \\"hi\\"","slides":[{"type":"content","title":"Trunc';
  const repaired = repairTruncatedJson(truncated);
  assert.ok(repaired);
  const parsed = JSON.parse(repaired!) as { title: string };
  assert.equal(parsed.title, 'He said "hi"');
});

test('malformed (unbalanced close) input is rejected, not guessed', () => {
  assert.equal(repairTruncatedJson('{"a":1}]'), null);
});

test('balanced-but-invalid JSON (bad escape) is rejected', () => {
  // Literal control char in string — syntax error, not truncation
  assert.equal(repairTruncatedJson('{"a":"line\nbreak"}'), null);
});

test('non-object/array input is rejected', () => {
  assert.equal(repairTruncatedJson('not json at all'), null);
  assert.equal(repairTruncatedJson(''), null);
});

test('nested truncation closes stack in reverse open order', () => {
  const truncated = '{"deck":{"slides":[{"type":"chart","chartData":{"series":[{"name":"Rev';
  const repaired = repairTruncatedJson(truncated);
  assert.ok(repaired);
  const parsed = JSON.parse(repaired!) as { deck: { slides: Array<{ type?: string }> } };
  // The rewind boundary is the comma after "chart" — the outer partial slide
  // object closes with only its complete pairs ({"type":"chart"}). Structurally
  // valid; semantically partial slides are dropped by the pptx-gen guard.
  assert.equal(parsed.deck.slides.length, 1);
  assert.equal(parsed.deck.slides[0].type, 'chart');
  assert.equal(Object.keys(parsed.deck.slides[0]).length, 1);
});
