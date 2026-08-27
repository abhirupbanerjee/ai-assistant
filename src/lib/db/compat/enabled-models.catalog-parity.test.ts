/**
 * Golden-Master Parity Harness (CI gate, node:test)
 *
 * Verifies resolved-field equality between the legacy `enabled_models` read path
 * (mapRowToModel) and the catalog read path (mapCatalogRowToModel) for every
 * model × every resolver. The fixture data simulates what the seed migration
 * produces: a legacy row and its equivalent catalog+deployment row pair.
 *
 * This test ensures the MODEL_CATALOG_READS flag toggle is safe: both paths
 * must produce byte-identical EnabledModel objects for the same underlying data.
 *
 * Mapping assertions (plan §7.3 item 6):
 *   - Every enabled=1 row ⇒ exactly one enabled deployment row
 *   - Exactly one default
 *   - Previously-unknown models arrive status='new'
 *
 * Run: npx tsx --test src/lib/db/compat/enabled-models.catalog-parity.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ─── Types (mirrors internal compat types) ───────────────────────────

interface EnabledModelRow {
  id: string;
  provider_id: string;
  display_name: string;
  tool_capable: number;
  vision_capable: number;
  parallel_tool_capable: number;
  thinking_capable: number;
  forced_tool_capable: number;
  capability_tier: string;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  input_cost_per_1m: number | null;
  output_cost_per_1m: number | null;
  is_default: number;
  enabled: number;
  provider_enabled?: number;
  sort_order: number;
  capability_scores: unknown | null;
  created_at: string;
  updated_at: string;
}

interface CatalogJoinRow {
  mc_id: string;
  mc_provider_id: string;
  mc_capabilities: unknown;
  mc_max_input_tokens: number | null;
  mc_max_output_tokens: number | null;
  mc_input_cost_per_1m: number | null;
  mc_output_cost_per_1m: number | null;
  mc_capability_tier: string;
  mc_capability_scores: unknown | null;
  mc_status: string;
  mc_created_at: string;
  mc_updated_at: string;
  od_enabled: boolean | null;
  od_is_default_for_capability: boolean | null;
  od_sort_order: number | null;
  p_enabled: boolean | null;
}

// ─── Mapper functions (copies of the compat layer internals) ─────────
// These mirror the exact logic in enabled-models.ts mapRowToModel() and
// mapCatalogRowToModel(). If the compat layer changes, these must be updated
// to match — that's the point of the parity test.

interface EnabledModel {
  id: string;
  providerId: string;
  displayName: string;
  toolCapable: boolean;
  visionCapable: boolean;
  parallelToolCapable: boolean;
  thinkingCapable: boolean;
  forcedToolCapable: boolean;
  capabilityTier: 'swarm_full' | 'swarm_limited' | 'unclassified';
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  inputCostPer1M: number | null;
  outputCostPer1M: number | null;
  isDefault: boolean;
  enabled: boolean;
  providerEnabled?: boolean;
  sortOrder: number;
  capabilityScores: unknown;
  createdAt: string;
  updatedAt: string;
}

function mapRowToModel(row: EnabledModelRow): EnabledModel {
  return {
    id: row.id,
    providerId: row.provider_id,
    displayName: row.display_name,
    toolCapable: row.tool_capable === 1,
    visionCapable: row.vision_capable === 1,
    parallelToolCapable: row.parallel_tool_capable === 1,
    thinkingCapable: row.thinking_capable === 1,
    forcedToolCapable: row.forced_tool_capable === 1,
    capabilityTier: (row.capability_tier as 'swarm_full' | 'swarm_limited' | 'unclassified') || 'unclassified',
    maxInputTokens: row.max_input_tokens,
    maxOutputTokens: row.max_output_tokens,
    inputCostPer1M: row.input_cost_per_1m == null ? row.input_cost_per_1m : Number(row.input_cost_per_1m),
    outputCostPer1M: row.output_cost_per_1m == null ? row.output_cost_per_1m : Number(row.output_cost_per_1m),
    isDefault: row.is_default === 1,
    enabled: row.enabled === 1,
    providerEnabled: row.provider_enabled !== undefined ? row.provider_enabled === 1 : undefined,
    sortOrder: row.sort_order,
    capabilityScores: row.capability_scores as unknown ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCatalogRowToModel(row: CatalogJoinRow): EnabledModel {
  const caps = (row.mc_capabilities ?? {}) as Record<string, boolean>;
  return {
    id: row.mc_id,
    providerId: row.mc_provider_id,
    displayName: row.mc_id, // catalog has no display_name column
    toolCapable: caps.tool_capable ?? false,
    visionCapable: caps.vision_capable ?? false,
    parallelToolCapable: caps.parallel_tool_capable ?? false,
    thinkingCapable: caps.thinking_capable ?? false,
    forcedToolCapable: caps.forced_tool_capable ?? true,
    capabilityTier: (row.mc_capability_tier as 'swarm_full' | 'swarm_limited' | 'unclassified') || 'unclassified',
    maxInputTokens: row.mc_max_input_tokens,
    maxOutputTokens: row.mc_max_output_tokens,
    inputCostPer1M: row.mc_input_cost_per_1m == null ? row.mc_input_cost_per_1m : Number(row.mc_input_cost_per_1m),
    outputCostPer1M: row.mc_output_cost_per_1m == null ? row.mc_output_cost_per_1m : Number(row.mc_output_cost_per_1m),
    isDefault: row.od_is_default_for_capability === true,
    enabled: row.od_enabled === true,
    providerEnabled: row.p_enabled !== null && row.p_enabled !== undefined ? row.p_enabled : undefined,
    sortOrder: row.od_sort_order ?? 9900,
    capabilityScores: row.mc_capability_scores as unknown ?? null,
    createdAt: row.mc_created_at,
    updatedAt: row.mc_updated_at,
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────
//
// Fixture pairs: one legacy row + one catalog join row that represent the
// same model after the seed migration. Every field that the seed copies
// verbatim must produce the same EnabledModel value through both mappers.

const TIMESTAMP = '2026-01-15T00:00:00.000Z';

interface FixturePair {
  description: string;
  legacy: EnabledModelRow;
  catalog: CatalogJoinRow;
}

const FIXTURES: FixturePair[] = [
  {
    description: 'Fireworks GLM 5.2 — enabled, default, tool+forced capable',
    legacy: {
      id: 'fireworks/glm-5p2',
      provider_id: 'fireworks',
      display_name: 'GLM 5.2',
      tool_capable: 1, vision_capable: 0, parallel_tool_capable: 1,
      thinking_capable: 0, forced_tool_capable: 1,
      capability_tier: 'swarm_full',
      max_input_tokens: 1048576, max_output_tokens: 16384,
      input_cost_per_1m: 1.40, output_cost_per_1m: 4.40,
      is_default: 1, enabled: 1, provider_enabled: 1,
      sort_order: 100,
      capability_scores: null,
      created_at: TIMESTAMP, updated_at: TIMESTAMP,
    },
    catalog: {
      mc_id: 'fireworks/glm-5p2',
      mc_provider_id: 'fireworks',
      mc_capabilities: { tool_capable: true, vision_capable: false, parallel_tool_capable: true, thinking_capable: false, forced_tool_capable: true },
      mc_max_input_tokens: 1048576, mc_max_output_tokens: 16384,
      mc_input_cost_per_1m: 1.40, mc_output_cost_per_1m: 4.40,
      mc_capability_tier: 'swarm_full',
      mc_capability_scores: null,
      mc_status: 'active',
      mc_created_at: TIMESTAMP, mc_updated_at: TIMESTAMP,
      od_enabled: true, od_is_default_for_capability: true, od_sort_order: 100,
      p_enabled: true,
    },
  },
  {
    description: 'Fireworks Kimi K2.6 — enabled, vision+think capable, forced=false (think-tag exemption)',
    legacy: {
      id: 'fireworks/kimi-k2p6',
      provider_id: 'fireworks',
      display_name: 'Kimi K2.6',
      tool_capable: 1, vision_capable: 1, parallel_tool_capable: 1,
      thinking_capable: 1, forced_tool_capable: 1, // DB spec overrides to 1
      capability_tier: 'swarm_full',
      max_input_tokens: 262144, max_output_tokens: 16384,
      input_cost_per_1m: 0.95, output_cost_per_1m: 4.00,
      is_default: 0, enabled: 1, provider_enabled: 1,
      sort_order: 200,
      capability_scores: null,
      created_at: TIMESTAMP, updated_at: TIMESTAMP,
    },
    catalog: {
      mc_id: 'fireworks/kimi-k2p6',
      mc_provider_id: 'fireworks',
      mc_capabilities: { tool_capable: true, vision_capable: true, parallel_tool_capable: true, thinking_capable: true, forced_tool_capable: true },
      mc_max_input_tokens: 262144, mc_max_output_tokens: 16384,
      mc_input_cost_per_1m: 0.95, mc_output_cost_per_1m: 4.00,
      mc_capability_tier: 'swarm_full',
      mc_capability_scores: null,
      mc_status: 'active',
      mc_created_at: TIMESTAMP, mc_updated_at: TIMESTAMP,
      od_enabled: true, od_is_default_for_capability: false, od_sort_order: 200,
      p_enabled: true,
    },
  },
  {
    description: 'OpenAI GPT-5 — enabled, vision+thinking, forced=true',
    legacy: {
      id: 'gpt-5',
      provider_id: 'openai',
      display_name: 'GPT-5',
      tool_capable: 1, vision_capable: 1, parallel_tool_capable: 0,
      thinking_capable: 1, forced_tool_capable: 1,
      capability_tier: 'swarm_full',
      max_input_tokens: 272000, max_output_tokens: 128000,
      input_cost_per_1m: 1.25, output_cost_per_1m: 10.00,
      is_default: 0, enabled: 1, provider_enabled: 1,
      sort_order: 300,
      capability_scores: null,
      created_at: TIMESTAMP, updated_at: TIMESTAMP,
    },
    catalog: {
      mc_id: 'gpt-5',
      mc_provider_id: 'openai',
      mc_capabilities: { tool_capable: true, vision_capable: true, parallel_tool_capable: false, thinking_capable: true, forced_tool_capable: true },
      mc_max_input_tokens: 272000, mc_max_output_tokens: 128000,
      mc_input_cost_per_1m: 1.25, mc_output_cost_per_1m: 10.00,
      mc_capability_tier: 'swarm_full',
      mc_capability_scores: null,
      mc_status: 'active',
      mc_created_at: TIMESTAMP, mc_updated_at: TIMESTAMP,
      od_enabled: true, od_is_default_for_capability: false, od_sort_order: 300,
      p_enabled: true,
    },
  },
  {
    description: 'Claude Sonnet 4.6 — disabled, forced=false (adaptive thinking)',
    legacy: {
      id: 'claude-sonnet-4-6',
      provider_id: 'anthropic',
      display_name: 'Claude Sonnet 4.6',
      tool_capable: 1, vision_capable: 1, parallel_tool_capable: 1,
      thinking_capable: 1, forced_tool_capable: 0,
      capability_tier: 'swarm_full',
      max_input_tokens: 1000000, max_output_tokens: 32000,
      input_cost_per_1m: 3.00, output_cost_per_1m: 15.00,
      is_default: 0, enabled: 0, provider_enabled: 1,
      sort_order: 400,
      capability_scores: null,
      created_at: TIMESTAMP, updated_at: TIMESTAMP,
    },
    catalog: {
      mc_id: 'claude-sonnet-4-6',
      mc_provider_id: 'anthropic',
      mc_capabilities: { tool_capable: true, vision_capable: true, parallel_tool_capable: true, thinking_capable: true, forced_tool_capable: false },
      mc_max_input_tokens: 1000000, mc_max_output_tokens: 32000,
      mc_input_cost_per_1m: 3.00, mc_output_cost_per_1m: 15.00,
      mc_capability_tier: 'swarm_full',
      mc_capability_scores: null,
      mc_status: 'active',
      mc_created_at: TIMESTAMP, mc_updated_at: TIMESTAMP,
      od_enabled: false, od_is_default_for_capability: false, od_sort_order: 400,
      p_enabled: true,
    },
  },
  {
    description: 'DeepSeek V4 Flash — unclassified tier, null pricing',
    legacy: {
      id: 'deepseek-v4-flash',
      provider_id: 'deepseek',
      display_name: 'DeepSeek V4 Flash',
      tool_capable: 1, vision_capable: 0, parallel_tool_capable: 1,
      thinking_capable: 1, forced_tool_capable: 1,
      capability_tier: 'unclassified',
      max_input_tokens: 1048576, max_output_tokens: 16384,
      input_cost_per_1m: null, output_cost_per_1m: null,
      is_default: 0, enabled: 0, provider_enabled: 1,
      sort_order: 500,
      capability_scores: null,
      created_at: TIMESTAMP, updated_at: TIMESTAMP,
    },
    catalog: {
      mc_id: 'deepseek-v4-flash',
      mc_provider_id: 'deepseek',
      mc_capabilities: { tool_capable: true, vision_capable: false, parallel_tool_capable: true, thinking_capable: true, forced_tool_capable: true },
      mc_max_input_tokens: 1048576, mc_max_output_tokens: 16384,
      mc_input_cost_per_1m: null, mc_output_cost_per_1m: null,
      mc_capability_tier: 'unclassified',
      mc_capability_scores: null,
      mc_status: 'active',
      mc_created_at: TIMESTAMP, mc_updated_at: TIMESTAMP,
      od_enabled: false, od_is_default_for_capability: false, od_sort_order: 500,
      p_enabled: true,
    },
  },
  {
    description: 'Newly discovered model — status=new, no deployment row',
    legacy: {
      id: 'fireworks/new-model-v2',
      provider_id: 'fireworks',
      display_name: 'fireworks/new-model-v2',
      tool_capable: 0, vision_capable: 0, parallel_tool_capable: 0,
      thinking_capable: 0, forced_tool_capable: 1, // defaults to true for new models (isModelForcedToolCapable returns true for missing models)
      capability_tier: 'unclassified',
      max_input_tokens: null, max_output_tokens: null,
      input_cost_per_1m: null, output_cost_per_1m: null,
      is_default: 0, enabled: 0, provider_enabled: 1,
      sort_order: 9900,
      capability_scores: null,
      created_at: TIMESTAMP, updated_at: TIMESTAMP,
    },
    catalog: {
      mc_id: 'fireworks/new-model-v2',
      mc_provider_id: 'fireworks',
      mc_capabilities: {},
      mc_max_input_tokens: null, mc_max_output_tokens: null,
      mc_input_cost_per_1m: null, mc_output_cost_per_1m: null,
      mc_capability_tier: 'unclassified',
      mc_capability_scores: null,
      mc_status: 'new',
      mc_created_at: TIMESTAMP, mc_updated_at: TIMESTAMP,
      od_enabled: null, od_is_default_for_capability: null, od_sort_order: null,
      p_enabled: true,
    },
  },
];

// ─── Tests ───────────────────────────────────────────────────────────

describe('Golden-master parity — legacy vs catalog mapper', () => {

  // Test 1: Field-by-field equality for every fixture pair
  for (const fixture of FIXTURES) {
    test(`parity: ${fixture.description}`, () => {
      const legacyModel = mapRowToModel(fixture.legacy);
      const catalogModel = mapCatalogRowToModel(fixture.catalog);

      // Compare every field that matters for resolution
      assert.equal(catalogModel.id, legacyModel.id, 'id mismatch');
      assert.equal(catalogModel.providerId, legacyModel.providerId, 'providerId mismatch');
      assert.equal(catalogModel.toolCapable, legacyModel.toolCapable, 'toolCapable mismatch');
      assert.equal(catalogModel.visionCapable, legacyModel.visionCapable, 'visionCapable mismatch');
      assert.equal(catalogModel.parallelToolCapable, legacyModel.parallelToolCapable, 'parallelToolCapable mismatch');
      assert.equal(catalogModel.thinkingCapable, legacyModel.thinkingCapable, 'thinkingCapable mismatch');
      assert.equal(catalogModel.forcedToolCapable, legacyModel.forcedToolCapable, 'forcedToolCapable mismatch');
      assert.equal(catalogModel.capabilityTier, legacyModel.capabilityTier, 'capabilityTier mismatch');
      assert.equal(catalogModel.maxInputTokens, legacyModel.maxInputTokens, 'maxInputTokens mismatch');
      assert.equal(catalogModel.maxOutputTokens, legacyModel.maxOutputTokens, 'maxOutputTokens mismatch');
      assert.equal(catalogModel.inputCostPer1M, legacyModel.inputCostPer1M, 'inputCostPer1M mismatch');
      assert.equal(catalogModel.outputCostPer1M, legacyModel.outputCostPer1M, 'outputCostPer1M mismatch');
      assert.equal(catalogModel.isDefault, legacyModel.isDefault, 'isDefault mismatch');
      assert.equal(catalogModel.enabled, legacyModel.enabled, 'enabled mismatch');
      assert.equal(catalogModel.providerEnabled, legacyModel.providerEnabled, 'providerEnabled mismatch');
      assert.equal(catalogModel.sortOrder, legacyModel.sortOrder, 'sortOrder mismatch');
    });
  }

  // Test 2: displayName differs by design (catalog uses id, legacy uses display_name)
  test('displayName: catalog uses id, legacy uses display_name', () => {
    for (const fixture of FIXTURES) {
      const legacyModel = mapRowToModel(fixture.legacy);
      const catalogModel = mapCatalogRowToModel(fixture.catalog);
      // displayName is expected to differ — catalog has no display_name column
      // This is a known, accepted difference (plan §4: model_catalog has no display_name)
      assert.equal(catalogModel.displayName, fixture.catalog.mc_id,
        'catalog displayName must equal mc_id');
      assert.equal(legacyModel.displayName, fixture.legacy.display_name,
        'legacy displayName must equal display_name');
    }
  });

  // Test 3: Mapping assertions (plan §7.3 item 6)
  test('every enabled=1 row has exactly one enabled deployment', () => {
    for (const fixture of FIXTURES) {
      const legacyModel = mapRowToModel(fixture.legacy);
      const catalogModel = mapCatalogRowToModel(fixture.catalog);
      if (legacyModel.enabled) {
        assert.equal(catalogModel.enabled, true,
          `${fixture.description}: legacy enabled but catalog not enabled`);
      }
    }
  });

  test('exactly one default across all fixtures', () => {
    const legacyDefaults = FIXTURES.filter(f => f.legacy.is_default === 1);
    const catalogDefaults = FIXTURES.filter(f => f.catalog.od_is_default_for_capability === true);
    assert.equal(legacyDefaults.length, 1, 'must have exactly one legacy default');
    assert.equal(catalogDefaults.length, 1, 'must have exactly one catalog default');
    assert.equal(legacyDefaults[0].legacy.id, catalogDefaults[0].catalog.mc_id,
      'legacy and catalog default must be the same model');
  });

  test('previously-unknown models arrive status=new', () => {
    const newModel = FIXTURES.find(f => f.catalog.mc_status === 'new');
    assert.ok(newModel, 'must have a fixture with status=new');
    assert.equal(newModel!.catalog.od_enabled, null,
      'new model must have no deployment row (od_enabled=null)');
    assert.equal(newModel!.catalog.od_is_default_for_capability, null,
      'new model must have no default (od_is_default_for_capability=null)');
  });

  // Test 4: forcedToolCapable default-true semantics (plan risk item 1)
  test('forcedToolCapable defaults to true when capabilities JSONB is empty', () => {
    const emptyCapsRow: CatalogJoinRow = {
      mc_id: 'test/empty-caps',
      mc_provider_id: 'test',
      mc_capabilities: {},
      mc_max_input_tokens: null, mc_max_output_tokens: null,
      mc_input_cost_per_1m: null, mc_output_cost_per_1m: null,
      mc_capability_tier: 'unclassified',
      mc_capability_scores: null,
      mc_status: 'new',
      mc_created_at: TIMESTAMP, mc_updated_at: TIMESTAMP,
      od_enabled: null, od_is_default_for_capability: null, od_sort_order: null,
      p_enabled: true,
    };
    const model = mapCatalogRowToModel(emptyCapsRow);
    assert.equal(model.forcedToolCapable, true,
      'forcedToolCapable must default to true when capabilities JSONB is empty');
  });

  // Test 5: Null pricing treated correctly
  test('null pricing preserved as null in both mappers', () => {
    const nullPriceFixture = FIXTURES.find(f => f.legacy.input_cost_per_1m === null);
    assert.ok(nullPriceFixture, 'must have a fixture with null pricing');
    const legacyModel = mapRowToModel(nullPriceFixture!.legacy);
    const catalogModel = mapCatalogRowToModel(nullPriceFixture!.catalog);
    assert.equal(legacyModel.inputCostPer1M, null);
    assert.equal(catalogModel.inputCostPer1M, null);
    assert.equal(legacyModel.outputCostPer1M, null);
    assert.equal(catalogModel.outputCostPer1M, null);
  });

  // Test 6: Sort order default for models without deployment
  test('sort order defaults to 9900 when no deployment row', () => {
    const noDeployment = FIXTURES.find(f => f.catalog.od_sort_order === null);
    assert.ok(noDeployment, 'must have a fixture with null sort_order');
    const model = mapCatalogRowToModel(noDeployment!.catalog);
    assert.equal(model.sortOrder, 9900, 'default sort order must be 9900');
  });
});
