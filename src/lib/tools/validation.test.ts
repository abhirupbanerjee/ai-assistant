import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numInRange, coerceNum } from './validation';

test('numInRange accepts numbers within range', () => {
  assert.equal(numInRange(5, 1, 10), true);
});

test('numInRange accepts numeric strings from legacy storage', () => {
  assert.equal(numInRange('15', 1, 100), true);
});

test('numInRange rejects null, undefined, and empty string', () => {
  assert.equal(numInRange(null, 1, 10), false);
  assert.equal(numInRange(undefined, 1, 10), false);
  assert.equal(numInRange('', 1, 10), false);
});

test('numInRange rejects out-of-range and non-finite values', () => {
  assert.equal(numInRange(11, 1, 10), false);
  assert.equal(numInRange(Number.NaN, 1, 10), false);
  assert.equal(numInRange(Number.POSITIVE_INFINITY, 1, 10), false);
});

test('coerceNum coerces finite numbers and numeric strings', () => {
  assert.equal(coerceNum('42'), 42);
  assert.equal(coerceNum(7), 7);
});

test('coerceNum returns undefined for non-coercible values', () => {
  assert.equal(coerceNum(null), undefined);
  assert.equal(coerceNum(undefined), undefined);
  assert.equal(coerceNum(''), undefined);
  assert.equal(coerceNum('abc'), undefined);
});
