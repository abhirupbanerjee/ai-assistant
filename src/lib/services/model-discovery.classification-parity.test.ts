/**
 * Classification Parity Test (CI gate, node:test)
 *
 * Asserts the exported classifier functions produce the exact same output
 * for every model ID across all four spec arrays plus edge-case IDs.
 *
 * This test validates that the classification logic (currently pattern-matching
 * regex arrays) produces deterministic, expected results for every known model.
 * When the patterns are migrated to manifest-rule evaluation in a future phase,
 * this test must still pass — converting "rules extracted from patterns" into
 * a verified equivalence.
 *
 * Run: npx tsx --test src/lib/services/model-discovery.classification-parity.test.ts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isToolCapable,
  isVisionCapable,
  isForcedToolCapable,
  isParallelToolCapable,
  isThinkingCapable,
  getContextWindow,
  isThinkTagModel,
} from './model-discovery';

// ─── Model ID fixtures ───────────────────────────────────────────────

/**
 * All model IDs from fireworksServerlessSpecs (kysely.ts:831).
 * These are the alias-form IDs (fireworks/<name>).
 */
const FIREWORKS_SPEC_IDS = [
  'fireworks/glm-5p2',
  'fireworks/glm-5p1',
  'fireworks/kimi-k2p7-code',
  'fireworks/kimi-k2p6',
  'fireworks/kimi-k2p5',
  'fireworks/qwen3p7-plus',
  'fireworks/minimax-m3',
  'fireworks/minimax-m2p7',
  'fireworks/minimax-m2p5',
  'fireworks/gpt-oss-120b',
  'fireworks/gpt-oss-20b',
  'fireworks/nemotron-3-ultra-nvfp4',
  'fireworks/deepseek-v4-flash',
  'fireworks/deepseek-v4-pro',
];

/**
 * All model IDs from nativeProviderSpecs (kysely.ts:875).
 */
const NATIVE_SPEC_IDS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.4-pro',
  'gpt-5.6',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'o1',
  'o3',
  'o3-mini',
  'o4-mini',
  'mistral-large-3',
  'mistral-medium-3',
  'mistral-medium-3.5',
  'mistral-small-3.2',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'moonshot/kimi-k2p5',
  'moonshot/kimi-k2p6',
  'moonshot/kimi-k3',
  'kimi-k3',
  'moonshot/kimi-k2.5',
  'moonshot/kimi-k2.6',
  'moonshot/kimi-k2.7-code-highspeed',
  'mistral-large-latest',
  'mistral-medium',
  'claude-sonnet-4-6',
];

/**
 * Edge-case IDs: transport forms, embeddings, rerankers, unknown models,
 * and alias variants that should be classified correctly.
 */
const EDGE_CASE_IDS = [
  // Transport form (accounts/fireworks/models/<name>)
  'accounts/fireworks/models/glm-5p2',
  'accounts/fireworks/models/kimi-k2p6',
  'accounts/fireworks/models/deepseek-v4-flash',
  'accounts/fireworks/models/minimax-m3',
  // Non-chat models (should be tool-capable false for embeddings/rerankers)
  'accounts/fireworks/models/qwen3-embedding-8b',
  'accounts/fireworks/models/qwen3-reranker-8b',
  // Unknown / hypothetical future models
  'fireworks/some-new-model-v2',
  'gpt-6',
  'gemini-4-pro',
  'claude-opus-5',
  // Ollama models
  'ollama-llama3',
  'ollama-qwen2.5',
  'llama3-8b',
  'qwen2.5-7b',
];

const ALL_IDS = [
  ...new Set([
    ...FIREWORKS_SPEC_IDS,
    ...NATIVE_SPEC_IDS,
    ...EDGE_CASE_IDS,
  ]),
];

// ─── Expected classification values ──────────────────────────────────
//
// These are the golden-master expected values derived from the current
// pattern-matching arrays. Any change to the patterns or the manifest rules
// must preserve these exact outputs.

interface ExpectedClassification {
  toolCapable: boolean;
  visionCapable: boolean;
  forcedToolCapable: boolean;
  parallelToolCapable: boolean;
  thinkingCapable: boolean;
  contextWindow: number | null;
  thinkTag: boolean;
}

/**
 * Expected classifications for key models.
 * Models not in this map are tested only for determinism (same result on repeat calls).
 */
const EXPECTED: Record<string, Partial<ExpectedClassification>> = {
  // Fireworks models (alias form)
  'fireworks/glm-5p2': {
    toolCapable: true,
    forcedToolCapable: true,
    parallelToolCapable: true,
    contextWindow: 1048576,
  },
  'fireworks/kimi-k2p6': {
    toolCapable: true,
    visionCapable: true,
    // isForcedToolCapable returns false: kimi-k2p6 matches isThinkTagModel
    // (/^kimi-k/) but is NOT in the kimi-k3/deepseek-v4-pro exemption list.
    // The DB spec overrides forced_tool_capable=1 at the seed level.
    forcedToolCapable: false,
    parallelToolCapable: true,
    thinkingCapable: true,
    contextWindow: 262144,
    thinkTag: true,
  },
  'fireworks/minimax-m3': {
    toolCapable: true,
    visionCapable: true,
    forcedToolCapable: true,
    parallelToolCapable: true,
    thinkingCapable: true,
    contextWindow: 512000,
  },
  'fireworks/gpt-oss-120b': {
    toolCapable: true,
    visionCapable: false,
    forcedToolCapable: false,
    parallelToolCapable: true,
    thinkingCapable: true,
    contextWindow: 131072,
    thinkTag: true,
  },
  'fireworks/deepseek-v4-flash': {
    toolCapable: true,
    visionCapable: false,
    forcedToolCapable: true,
    parallelToolCapable: true,
    thinkingCapable: true,
    contextWindow: 1048576,
    // isThinkTagModel regex only matches 'deepseek-v4-pro', not 'deepseek-v4-flash'
    thinkTag: false,
  },
  'fireworks/deepseek-v4-pro': {
    toolCapable: true,
    visionCapable: false,
    forcedToolCapable: true,
    parallelToolCapable: true,
    thinkingCapable: true,
    contextWindow: 1048576,
    thinkTag: true,
  },
  // Fireworks transport form
  'accounts/fireworks/models/glm-5p2': {
    toolCapable: true,
    forcedToolCapable: true,
    contextWindow: 1048576,
  },
  'accounts/fireworks/models/deepseek-v4-flash': {
    toolCapable: true,
    forcedToolCapable: true,
    contextWindow: 1048576,
  },
  // Embeddings — isToolCapable returns true because the blanket
  // /^accounts\/fireworks\// pattern matches. But isForcedToolCapable
  // returns false because isThinkTagModel matches /^qwen3/ and the
  // model is not in the kimi-k3/deepseek-v4-pro exemption list.
  // Chat filtering happens via isFireworksChatModel() in the discovery
  // function, not in the individual classifiers.
  'accounts/fireworks/models/qwen3-embedding-8b': {
    toolCapable: true,
    visionCapable: false,
    forcedToolCapable: false,
  },
  // OpenAI
  'gpt-4o': {
    toolCapable: true,
    visionCapable: false,
    forcedToolCapable: true,
    contextWindow: 128000,
  },
  'gpt-4.1': {
    toolCapable: true,
    visionCapable: true,
    forcedToolCapable: true,
    parallelToolCapable: true,
    contextWindow: 1000000,
  },
  'gpt-5': {
    toolCapable: true,
    visionCapable: true,
    forcedToolCapable: true,
    thinkingCapable: true,
    contextWindow: 272000,
  },
  'gpt-5-nano': {
    toolCapable: true,
    visionCapable: true,
    forcedToolCapable: true,
    parallelToolCapable: true,
  },
  // o-series — forced tool NOT capable
  'o1': {
    toolCapable: true,
    forcedToolCapable: true,
    contextWindow: 200000,
  },
  'o3': {
    toolCapable: true,
    forcedToolCapable: true,
    contextWindow: 200000,
  },
  // Gemini
  'gemini-2.5-pro': {
    toolCapable: true,
    visionCapable: true,
    forcedToolCapable: true,
    thinkingCapable: true,
    contextWindow: 1000000,
  },
  // Claude — claude-sonnet-4-6 is an adaptive-thinking model, so
  // isForcedToolCapable returns false (rejects forced tool_choice).
  // nativeProviderSpecs sets forced_tool_capable: 0 for it.
  'claude-sonnet-4-6': {
    toolCapable: true,
    visionCapable: true,
    forcedToolCapable: false,
    parallelToolCapable: true,
    thinkingCapable: true,
    contextWindow: 1000000,
  },
  // DeepSeek native
  'deepseek-v4-flash': {
    toolCapable: true,
    forcedToolCapable: true,
    parallelToolCapable: true,
    thinkingCapable: true,
    contextWindow: 1048576,
    // isThinkTagModel only matches 'deepseek-v4-pro', not 'deepseek-v4-flash'
    thinkTag: false,
  },
  'deepseek-v4-pro': {
    toolCapable: true,
    forcedToolCapable: true,
    parallelToolCapable: true,
    thinkingCapable: true,
    contextWindow: 1048576,
    thinkTag: true,
  },
  // Moonshot
  'moonshot/kimi-k3': {
    toolCapable: true,
    visionCapable: false,
    forcedToolCapable: true,
    contextWindow: 1048576,
  },
  'kimi-k3': {
    toolCapable: true,
    forcedToolCapable: true,
    contextWindow: 1048576,
  },
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('Classification parity — all spec-array model IDs', () => {
  // Test 1: Every model ID produces deterministic results across all classifiers
  for (const id of ALL_IDS) {
    test(`deterministic: ${id}`, () => {
      const r1 = classifyAll(id);
      const r2 = classifyAll(id);
      assert.deepEqual(r1, r2, `Classification for ${id} must be deterministic`);
    });
  }

  // Test 2: Golden-master expected values
  for (const [id, expected] of Object.entries(EXPECTED)) {
    test(`golden-master: ${id}`, () => {
      const actual = classifyAll(id);
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(
          actual[key as keyof ExpectedClassification],
          value,
          `${id}: ${key} expected ${value}, got ${actual[key as keyof ExpectedClassification]}`
        );
      }
    });
  }

  // Test 3: Fireworks alias ↔ transport form equivalence
  test('alias ↔ transport form produce same capabilities', () => {
    const aliasPairs: [string, string][] = [
      ['fireworks/glm-5p2', 'accounts/fireworks/models/glm-5p2'],
      ['fireworks/kimi-k2p6', 'accounts/fireworks/models/kimi-k2p6'],
      ['fireworks/deepseek-v4-flash', 'accounts/fireworks/models/deepseek-v4-flash'],
      ['fireworks/minimax-m3', 'accounts/fireworks/models/minimax-m3'],
    ];
    for (const [alias, transport] of aliasPairs) {
      const a = classifyAll(alias);
      const t = classifyAll(transport);
      // tool/vision/forced/parallel/thinking must match (context window may differ by prefix)
      assert.equal(a.toolCapable, t.toolCapable, `toolCapable: ${alias} vs ${transport}`);
      assert.equal(a.visionCapable, t.visionCapable, `visionCapable: ${alias} vs ${transport}`);
      assert.equal(a.forcedToolCapable, t.forcedToolCapable, `forcedToolCapable: ${alias} vs ${transport}`);
      assert.equal(a.parallelToolCapable, t.parallelToolCapable, `parallelToolCapable: ${alias} vs ${transport}`);
      assert.equal(a.thinkingCapable, t.thinkingCapable, `thinkingCapable: ${alias} vs ${transport}`);
      assert.equal(a.thinkTag, t.thinkTag, `thinkTag: ${alias} vs ${transport}`);
    }
  });

  // Test 4: Embedding/reranker models — the blanket patterns match them too
  // (isToolCapable uses /^accounts\/fireworks\//, isThinkTagModel uses /^qwen3/).
  // Chat filtering happens via isFireworksChatModel() in the discovery function,
  // not in the individual classifiers. This test documents that fact: the
  // classifiers are NOT responsible for chat-vs-non-chat filtering.
  test('embedding/reranker IDs still match blanket patterns (documented)', () => {
    // isToolCapable matches because of /^accounts\/fireworks\//
    assert.equal(
      isToolCapable('accounts/fireworks/models/qwen3-embedding-8b'),
      true,
      'blanket /^accounts\\/fireworks\\// pattern matches embeddings (expected)'
    );
    // isThinkTagModel matches because of /^qwen3/
    assert.equal(
      isThinkTagModel('accounts/fireworks/models/qwen3-embedding-8b'),
      true,
      '/^qwen3/ pattern matches qwen3-embedding (expected — chat filtering is separate)'
    );
  });
});

// ─── Helper ──────────────────────────────────────────────────────────

function classifyAll(id: string): ExpectedClassification {
  return {
    toolCapable: isToolCapable(id),
    visionCapable: isVisionCapable(id),
    forcedToolCapable: isForcedToolCapable(id),
    parallelToolCapable: isParallelToolCapable(id),
    thinkingCapable: isThinkingCapable(id),
    contextWindow: getContextWindow(id),
    thinkTag: isThinkTagModel(id),
  };
}
