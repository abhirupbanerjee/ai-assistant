import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateCapabilityRuntime } from './capability-status';

test('Tavily platform-managed health is ready when the runtime key is available', () => {
  assert.deepEqual(
    evaluateCapabilityRuntime({ kind: 'tavily', enabled: true, apiKeyAvailable: true }),
    { configured: true, runtimeAvailable: true, warnings: [] }
  );
});

test('Tavily BYOK remains fail-closed without an organization credential', () => {
  const status = evaluateCapabilityRuntime({
    kind: 'tavily',
    enabled: true,
    apiKeyAvailable: false,
  });
  assert.equal(status.runtimeAvailable, false);
  assert.match(status.warnings[0], /effective organization mode/);
});

test('Website Analysis is ready without an optional API key', () => {
  const status = evaluateCapabilityRuntime({
    kind: 'website-analysis',
    enabled: true,
    apiKeyAvailable: false,
  });
  assert.equal(status.configured, true);
  assert.equal(status.runtimeAvailable, true);
  assert.match(status.warnings[0], /optional/);
});

test('SonarCloud requires enabled tool, token, and organization', () => {
  assert.equal(evaluateCapabilityRuntime({
    kind: 'sonarcloud', enabled: true, tokenAvailable: true, organizationAvailable: true,
  }).runtimeAvailable, true);
  assert.equal(evaluateCapabilityRuntime({
    kind: 'sonarcloud', enabled: true, tokenAvailable: true, organizationAvailable: false,
  }).runtimeAvailable, false);
});

test('k6 requires its actual tool token and local CLI', () => {
  assert.equal(evaluateCapabilityRuntime({
    kind: 'k6', enabled: true, tokenAvailable: true, cliAvailable: true,
  }).runtimeAvailable, true);
  const missingCli = evaluateCapabilityRuntime({
    kind: 'k6', enabled: true, tokenAvailable: true, cliAvailable: false,
  });
  assert.equal(missingCli.runtimeAvailable, false);
  assert.match(missingCli.warnings[0], /CLI/);
});

test('keyless integrations use configuration rather than credential presence', () => {
  assert.deepEqual(
    evaluateCapabilityRuntime({ kind: 'keyless', configured: true }),
    { configured: true, runtimeAvailable: true, warnings: [] }
  );
});
