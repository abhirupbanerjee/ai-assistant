import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isConsolidatedSettingsType,
  isConsolidatedSettingsKey,
  shouldBlockLegacyWrites,
  CONSOLIDATED_SETTINGS_TYPES,
  CONSOLIDATED_SETTINGS_KEYS,
  LEGACY_WRITE_DISABLED_CODE,
  LEGACY_WRITE_DISABLED_MESSAGE,
} from './legacy-writes';

test('CONSOLIDATED_SETTINGS_TYPES covers the AI/API settings owned by the consolidated page', () => {
  assert.deepEqual(
    [...CONSOLIDATED_SETTINGS_TYPES].sort(),
    ['embedding', 'llm', 'ocr', 'reranker', 'tavily']
  );
});

test('CONSOLIDATED_SETTINGS_KEYS covers the legacy SQLite rows owned by the consolidated page', () => {
  assert.deepEqual(
    [...CONSOLIDATED_SETTINGS_KEYS].sort(),
    ['embedding-settings', 'llm-settings', 'ocr-settings', 'reranker-settings', 'tavily-settings']
  );
});

test('isConsolidatedSettingsKey() flags only consolidated-owned settings keys', () => {
  for (const key of CONSOLIDATED_SETTINGS_KEYS) {
    assert.equal(isConsolidatedSettingsKey(key), true, `${key} should be consolidated-owned`);
  }

  // Non-AI settings keys (and RAG) must still be resettable via restoreAllDefaults.
  const notOwned = [
    'rag-settings',
    'memory-settings',
    'summarization-settings',
    'limits-settings',
    'upload-limits',
    'retention-settings',
    'branding-settings',
    'acronym-mappings',
    'skills-settings',
    'display-settings',
    'token-limits-settings',
    'model-token-limits',
    'system-prompt',
  ];
  for (const key of notOwned) {
    assert.equal(isConsolidatedSettingsKey(key), false, `${key} should not be consolidated-owned`);
  }
});

test('isConsolidatedSettingsType() flags only consolidated-owned settings types', () => {
  for (const type of CONSOLIDATED_SETTINGS_TYPES) {
    assert.equal(isConsolidatedSettingsType(type), true, `${type} should be consolidated-owned`);
  }

  // Non-AI admin settings and the un-consolidated RAG tuning type must not be blocked.
  const notOwned = [
    'rag',
    'memory',
    'summarization',
    'limits',
    'uploadLimits',
    'retention',
    'branding',
    'acronyms',
    'skills',
    'display',
    'token-limits',
    'model-tokens',
    'restoreAllDefaults',
  ];
  for (const type of notOwned) {
    assert.equal(isConsolidatedSettingsType(type), false, `${type} should not be consolidated-owned`);
  }
});

test('shouldBlockLegacyWrites() is on only when the consolidated UI flag is enabled', () => {
  assert.equal(shouldBlockLegacyWrites(true), true);
  assert.equal(shouldBlockLegacyWrites(false), false);
});

test('legacy write refusal carries a stable code and a pointer to the consolidated page', () => {
  assert.equal(LEGACY_WRITE_DISABLED_CODE, 'LEGACY_WRITE_DISABLED');
  assert.match(LEGACY_WRITE_DISABLED_MESSAGE, /AI & API Setup/);
});
