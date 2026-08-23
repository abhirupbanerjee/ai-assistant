import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/admin/settings/AiApiSetup.tsx'),
  'utf8'
);

test('AI setup renders model controls only when registry metadata has options', () => {
  assert.match(source, /mapping\?\.selectionMode !== 'none' && modelOptions\.length > 0/);
  assert.match(source, /\{showModelSelection && \(/);
});

test('platform-managed mode does not render organization credential history or actions', () => {
  assert.match(source, /org\?\.credentialMode === 'ORGANIZATION_BYOK'/);
  assert.match(source, /p\.connectionMode === 'provider-key'/);
});

test('AI setup no longer fetches duplicate members or usage summaries', () => {
  assert.doesNotMatch(source, /\/members[`'"]/);
  assert.doesNotMatch(source, /\/usage[`'"]/);
  assert.doesNotMatch(source, />Cost & Usage</);
});
