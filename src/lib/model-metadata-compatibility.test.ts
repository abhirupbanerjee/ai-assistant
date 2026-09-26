/** Offline execution of actual modules with fail-closed dependency injection.
 * Never imports the app's configuration/DB graph or makes a network request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Deliberately dynamic at the test-only module boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dynamic = any;
function load(file: string, dependencies: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports: Dynamic = {};
  const require = (id: string) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected import (DB/config/network forbidden): ${id}`);
    return dependencies[id];
  };
  new Function('exports', 'require', ...Object.keys(globals), compiled)(exports, require, ...Object.values(globals));
  return exports;
}
const compatibility = load('./model-compatibility.ts');
const metadata = load('./model-metadata-compatibility.ts', { './model-compatibility': compatibility });
const thinking = load('./llm-thinking.ts', { './model-compatibility': compatibility });
const ids = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'claude-fable-5-1', 'claude-opus-5-5'];
const stale = { toolCapable: false, visionCapable: false, parallelToolCapable: false,
  thinkingCapable: false, forcedToolCapable: true, maxInputTokens: 24000, maxOutputTokens: 4096,
  inputCostPer1M: 9.5, enabled: false, capabilityTier: 'swarm_limited', custom: 'keep' };

test('exact metadata specifications win; persisted budgets and unrelated values survive', () => {
  for (const id of ids) {
    for (const qualified of [id, `provider/${id}`, ` ${id.toUpperCase()}:latest `]) {
      const known = metadata.getKnownModelMetadata(qualified);
      assert.equal(known.maxInputTokens, id.startsWith('gpt') ? 1050000 : 1000000);
      assert.equal(known.maxOutputTokens, 128000);
      assert.equal(known.forcedToolCapable, id.startsWith('gpt'));
      const spec = metadata.applyModelMetadataSpecifications(qualified, stale);
      assert.equal(spec.maxInputTokens, known.maxInputTokens);
      assert.equal(spec.maxOutputTokens, 128000);
      const saved = metadata.applyPersistedModelMetadata(qualified, stale);
      assert.equal(saved.maxInputTokens, 24000);
      assert.equal(saved.maxOutputTokens, 4096);
      for (const key of ['toolCapable', 'visionCapable', 'parallelToolCapable', 'thinkingCapable']) {
        assert.equal(saved[key], true);
      }
      assert.equal(saved.forcedToolCapable, known.forcedToolCapable);
      for (const key of ['inputCostPer1M', 'enabled', 'capabilityTier', 'custom']) {
        assert.equal(saved[key], stale[key as keyof typeof stale]);
      }
      assert.equal(stale.thinkingCapable, false, 'input is not mutated');
    }
    for (const budget of [null, undefined, 0, -1, NaN, Infinity, 9999999]) {
      const saved = metadata.applyPersistedModelMetadata(id, { maxInputTokens: budget, maxOutputTokens: budget });
      assert.equal(saved.maxInputTokens, metadata.getKnownModelMetadata(id).maxInputTokens);
      assert.equal(saved.maxOutputTokens, 128000);
    }
    const patch = metadata.applyModelMetadataUpdate(id, { displayName: 'custom', thinkingCapable: false });
    assert.equal(Object.hasOwn(patch, 'maxInputTokens'), false);
    assert.equal(Object.hasOwn(patch, 'maxOutputTokens'), false);
    assert.equal(patch.thinkingCapable, true);
    assert.equal(patch.displayName, 'custom');
  }
});

test('unknown IDs and lookalikes retain their existing metadata without broad family corrections', () => {
  for (const id of ['gpt-6', 'gpt-6-astra-mini', 'gpt-6-sol-2026-09-01', 'gpt-5.6-sol',
    'claude-fable-5', 'claude-fable-5-10', 'claude-opus-5-50', '__proto__']) {
    assert.equal(metadata.getKnownModelMetadata(id), undefined);
    assert.equal(metadata.applyPersistedModelMetadata(id, stale), stale);
    assert.equal(metadata.applyModelMetadataSpecifications(id, stale), stale);
    assert.equal(metadata.applyModelMetadataUpdate(id, stale), stale);
  }
});

function discovery(apiModels: unknown[]) {
  const requested: string[] = [];
  const api = load('./services/model-discovery.ts', {
    '../db/compat/llm-providers': { getProviderApiKey: async () => 'offline-fake-key' },
    '../db/compat/enabled-models': { getEnabledModel: async () => null, getDeployedModelIds: async () => new Set() },
    '@/lib/llm-thinking': thinking,
    '../llm-utils': { generateDisplayName: (id: string) => id },
    '../moonshot-config': {},
    '../model-metadata-compatibility': metadata,
  }, { fetch: async (url: string) => {
    requested.push(url);
    return { ok: true, json: async () => ({ data: apiModels }) };
  } });
  return { api, requested };
}

test('mocked OpenAI discovery exposes exact GPT6 tools, vision, thinking, parallel and limits', async () => {
  const { api, requested } = discovery([...ids.slice(0, 3), 'gpt-6-astra-mini'].map(id => ({ id })));
  const result = await api.discoverModels('openai');
  assert.equal(result.success, true);
  assert.equal(requested.length, 1);
  for (const id of ids.slice(0, 3)) {
    const model = result.models.find((m: Dynamic) => m.id === id);
    for (const [key, value] of Object.entries(metadata.getKnownModelMetadata(id))) assert.equal(model[key], value);
    assert.equal(model.isEnabled, false);
  }
  assert.equal(api.isToolCapable('gpt-6-astra-mini'), false);
  assert.equal(api.getContextWindow('gpt-6-astra-mini'), null);
});

test('Anthropic API metadata is consumed including explicit false; exact hard restrictions win', async () => {
  const { api } = discovery([
    { id: 'claude-future-test', max_input_tokens: 777777, max_tokens: 55555,
      capabilities: { image_input: { supported: false }, thinking: { supported: false } } },
    { id: 'claude-missing-test', max_input_tokens: -4, max_tokens: 0, capabilities: null },
    ...ids.slice(3).map(id => ({ id, max_input_tokens: 12, max_tokens: 13,
      capabilities: { image_input: { supported: false }, thinking: { supported: false } } })),
  ]);
  const result = await api.discoverModels('anthropic');
  assert.equal(result.success, true);
  const future = result.models.find((m: Dynamic) => m.id === 'claude-future-test');
  assert.equal(future.maxInputTokens, 777777);
  assert.equal(future.maxOutputTokens, 55555);
  assert.equal(future.visionCapable, false);
  assert.equal(future.thinkingCapable, false);
  const missing = result.models.find((m: Dynamic) => m.id === 'claude-missing-test');
  assert.equal(missing.maxOutputTokens, 32000);
  assert.equal(missing.visionCapable, true);
  for (const id of ids.slice(3)) {
    const model = result.models.find((m: Dynamic) => m.id === id);
    assert.equal(model.maxInputTokens, 1000000);
    assert.equal(model.maxOutputTokens, 128000);
    assert.equal(model.forcedToolCapable, false);
    assert.equal(model.thinkingCapable, true);
  }
});

// Minimal in-memory query builder: predicates, patches, and transaction boundaries
// are exercised, not a SQL/database service. Reject any unexpected table access.
function memoryDb(tables: Record<string, Dynamic[]>) {
  const writes: Dynamic[] = [];
  function builder(table: string, write = false) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
    const predicates: ((row: Dynamic) => boolean)[] = [];
    let patch: Dynamic;
    const query: Dynamic = {
      select: () => query,
      selectAll: () => query,
      forUpdate: () => query,
      where: (key: string, operator: string, value: unknown) => {
        assert.ok(['=', 'is'].includes(operator));
        predicates.push(row => row[key] === value);
        return query;
      },
      set: (value: unknown) => { patch = value; return query; },
      execute: async () => {
        const rows = tables[table].filter(row => predicates.every(predicate => predicate(row)));
        if (write) {
          writes.push({ table, patch, ids: rows.map(row => row.id) });
          for (const row of rows) {
            Object.assign(row, patch);
            if (typeof row.capabilities === 'string') row.capabilities = JSON.parse(row.capabilities);
          }
        }
        return rows;
      },
      executeTakeFirst: async () => (await query.execute())[0],
    };
    return query;
  }
  const db = { selectFrom: (table: string) => builder(table), updateTable: (table: string) => builder(table, true) };
  return { db, writes, tables };
}

test('versioned correction patches BOTH stores, preserves smaller budgets/extensions, is idempotent', async () => {
  const legacy = ids.map((id, i) => ({ id: i % 2 ? `provider/${id}` : id,
    tool_capable: 0, vision_capable: 0, parallel_tool_capable: 0, thinking_capable: 0, forced_tool_capable: 1,
    max_input_tokens: i === 0 ? null : 32000, max_output_tokens: i === 1 ? 999999 : 32000,
    enabled: 0, is_default: 1, sort_order: 47, input_cost_per_1m: 7, capability_scores: { custom: 0.4 },
  }));
  const catalog = legacy.map(row => ({ ...row, capability_id: 'llm', status: 'retired',
    capabilities: { tool_capable: false, thinking_capable: false, forced_tool_capable: true,
      provider_extension: { retained: true } } }));
  const untouched = { id: 'gpt-6-astra-mini', max_output_tokens: null, thinking_capable: 0 };
  const nonLLM = { id: 'gpt-6-sol', capability_id: 'embedding', capabilities: { custom: true } };
  const mem = memoryDb({ enabled_models: [...legacy, untouched], model_catalog: [...catalog, nonLLM] });
  const migration = load('./db/compat/model-metadata-migration.ts', { '../../model-metadata-compatibility': metadata });
  await migration.correctPersistedModelMetadata(mem.db);
  assert.equal(mem.writes.length, 10);
  assert.equal(legacy[0].max_input_tokens, 1050000);
  assert.equal(legacy[1].max_output_tokens, 128000);
  for (const row of [...legacy, ...catalog]) {
    assert.equal(row.enabled, 0);
    assert.equal(row.is_default, 1);
    assert.equal(row.sort_order, 47);
    assert.equal(row.input_cost_per_1m, 7);
    assert.deepEqual(row.capability_scores, { custom: 0.4 });
    if (row !== legacy[0] && row !== catalog[0]) assert.equal(row.max_input_tokens, 32000);
    if (row !== legacy[1] && row !== catalog[1]) assert.equal(row.max_output_tokens, 32000);
  }
  for (const row of legacy) {
    assert.equal(row.thinking_capable, 1);
    assert.equal(row.forced_tool_capable, row.id.includes('claude') ? 0 : 1);
  }
  for (const row of catalog) {
    assert.equal(row.capabilities.thinking_capable, true);
    assert.equal(row.capabilities.forced_tool_capable, !row.id.includes('claude'));
    assert.deepEqual(row.capabilities.provider_extension, { retained: true });
    assert.equal(row.status, 'retired');
  }
  assert.deepEqual(untouched, { id: 'gpt-6-astra-mini', max_output_tokens: null, thinking_capable: 0 });
  assert.deepEqual(nonLLM.capabilities, { custom: true });
  await migration.correctPersistedModelMetadata(mem.db);
  assert.equal(mem.writes.length, 10, 'second application does not rewrite timestamps or rows');
});

function enabledModels(catalogReads: boolean, row: Dynamic) {
  const mem = memoryDb({ enabled_models: [row] });
  const api = load('./db/compat/enabled-models.ts', {
    '../kysely': { getDb: async () => mem.db, sql: () => ({ execute: async () => ({ rows: [row] }) }) },
    './llm-providers': {}, '../../model-metadata-compatibility': metadata,
  }, { process: { env: { MODEL_CATALOG_READS: catalogReads ? 'on' : 'off' } } });
  return api;
}

test('catalog/org and legacy actual read paths correct stale flags without resetting budgets or state', async () => {
  for (const id of ids) {
    const legacy = { id, tool_capable: 0, thinking_capable: 0, forced_tool_capable: 1,
      max_input_tokens: 32000, max_output_tokens: 8192, enabled: 0, is_default: 1, sort_order: 37 };
    const catalog = { mc_id: id, mc_capabilities: { thinking_capable: false, forced_tool_capable: true },
      mc_max_input_tokens: 32000, mc_max_output_tokens: 8192,
      od_enabled: false, od_is_default_for_capability: true, od_sort_order: 37 };
    for (const [catalogReads, row] of [[false, legacy], [true, catalog]] as const) {
      const api = enabledModels(catalogReads, row);
      const result = await api.getEnabledModel(id);
      assert.equal(result.thinkingCapable, true);
      assert.equal(result.toolCapable, true);
      assert.equal(result.parallelToolCapable, true);
      assert.equal(result.forcedToolCapable, !id.includes('claude'));
      assert.equal(result.maxInputTokens, 32000);
      assert.equal(result.maxOutputTokens, 8192);
      assert.equal(result.enabled, false);
      assert.equal(result.isDefault, true);
      assert.equal(result.sortOrder, 37);
    }
  }
  const api = enabledModels(false, {});
  assert.equal(await api.isModelForcedToolCapable('claude-opus-5-5'), false, 'restriction holds even for unregistered models');
});

test('get-details actual web and fallback responses cannot override exact compatibility', async () => {
  const { api: detection } = discovery([]);
  for (const web of [false, true]) {
    for (const id of ids) {
      const route = load('../app/api/admin/llm/models/get-details/route.ts', {
        'next/server': { NextResponse: { json: (body: unknown) => body } },
        '@/lib/auth': { getCurrentUser: async () => ({ isAdmin: true }) },
        '@/lib/db/compat': { getEnabledModel: async () => ({ id }), getWebSearchConfig: async () => ({ config: { apiKey: 'fake' } }) },
        '@/lib/tools/tavily': { isTavilyConfigured: async () => web },
        '@/lib/llm-utils': { callLLMForJson: async () => JSON.stringify({ ...stale, confidence: 'high', maxOutputTokens: 200000 }) },
        '@/lib/services/model-discovery': detection,
        '@/lib/model-metadata-compatibility': metadata,
      }, { fetch: async () => ({ ok: true, json: async () => ({ answer: 'mock', results: [] }) }) });
      const result = await route.POST({ nextUrl: { searchParams: new URLSearchParams({ id }) } });
      assert.equal(result.source, web ? 'web_search' : 'pattern_match');
      for (const [key, value] of Object.entries(metadata.getKnownModelMetadata(id))) assert.equal(result[key], value, key);
      assert.equal(result.inputCostPer1M, web ? 9.5 : null);
    }
  }
});

test('actual partial updates mirror restrictions into both stores and preserve omitted budgets', async () => {
  for (const catalogReads of [false, true]) {
    const id = 'claude-opus-5-5';
    const legacy = { id, thinking_capable: 0, forced_tool_capable: 1,
      max_input_tokens: 32000, max_output_tokens: 4096 };
    const catalog = { id, mc_id: id, mc_capabilities: { thinking_capable: false, forced_tool_capable: true },
      mc_max_input_tokens: 32000, mc_max_output_tokens: 4096,
      capabilities: { custom: 'retained', thinking_capable: false, forced_tool_capable: true },
      max_input_tokens: 32000, max_output_tokens: 4096 };
    const mem = memoryDb({ enabled_models: [legacy], model_catalog: [catalog] });
    const api = load('./db/compat/enabled-models.ts', {
      '../kysely': {
        getDb: async () => mem.db,
        transaction: async (callback: Dynamic) => callback(mem.db),
        sql: (parts: TemplateStringsArray, ...values: unknown[]) => {
          if (parts.join('').includes('COALESCE(capabilities')) {
            assert.match(parts.join(''), /\|\|/);
            return { ...catalog.capabilities, ...JSON.parse(values[0] as string) };
          }
          return { execute: async () => ({ rows: [catalog] }) };
        },
      },
      './llm-providers': {}, '../../model-metadata-compatibility': metadata,
    }, { process: { env: { MODEL_CATALOG_READS: catalogReads ? 'on' : 'off' } } });
    await api.updateEnabledModel(id, { displayName: 'admin label', thinkingCapable: false, forcedToolCapable: true });
    assert.equal(legacy.thinking_capable, 1);
    assert.equal(legacy.forced_tool_capable, 0);
    assert.equal(catalog.capabilities.thinking_capable, true);
    assert.equal(catalog.capabilities.forced_tool_capable, false);
    assert.equal(catalog.capabilities.custom, 'retained');
    for (const row of [legacy, catalog]) {
      assert.equal(row.max_input_tokens, 32000);
      assert.equal(row.max_output_tokens, 4096);
    }
    for (const write of mem.writes) {
      assert.equal(Object.hasOwn(write.patch, 'max_input_tokens'), false);
      assert.equal(Object.hasOwn(write.patch, 'max_output_tokens'), false);
    }
  }
});

test('new correction is registered after catalog seed through transactional versioned migration', async () => {
  const source = readFileSync(new URL('./db/kysely.ts', import.meta.url), 'utf8');
  const registration = "await runMigration(database, '2026-09-26-exact-model-metadata-v1', correctPersistedModelMetadata)";
  assert.ok(source.includes(registration));
  assert.ok(source.indexOf(registration) > source.indexOf('Phase 0 invariant assertions passed'));
  // Execute the existing version wrapper without importing the DB factory.
  const parsed = ts.createSourceFile('kysely.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'runMigration');
  assert.ok(declaration);
  const js = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const runMigration = new Function('console', `${js}; return runMigration;`)({ log: () => {} });
  let applied = false;
  let transactions = 0;
  let corrections = 0;
  const trx = { insertInto: () => ({ values: () => ({ execute: async () => { applied = true; } }) }) };
  const database = {
    selectFrom: () => ({ select: () => ({ where: () => ({ executeTakeFirst: async () => applied ? { id: 'done' } : undefined }) }) }),
    transaction: () => ({ execute: async (callback: Dynamic) => { transactions++; await callback(trx); } }),
  };
  const correct = async (transaction: unknown) => { assert.equal(transaction, trx); corrections++; };
  await runMigration(database, 'offline-id', correct);
  await runMigration(database, 'offline-id', correct);
  assert.equal(transactions, 1);
  assert.equal(corrections, 1);
});
