import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePipelinePrompt, sanitizePipeline, MAX_PIPELINE_STEPS } from './pipeline-parser';
import type { PipelineStep } from '@/types/stream';

const KNOWN_AGENTS = new Set(['tpl-planner', 'tpl-researcher', 'tpl-presenter', 'tpl-code-executor']);
const KNOWN_COMMANDS = new Set(['pdf', 'flowchart', 'bar-chart']);

describe('parsePipelinePrompt', () => {
  it('returns empty steps when no @ tokens present', () => {
    const { steps } = parsePipelinePrompt('plain message', KNOWN_AGENTS, KNOWN_COMMANDS);
    assert.equal(steps.length, 0);
  });

  it('returns empty steps for a single valid @agent', () => {
    const { steps } = parsePipelinePrompt('@tpl-researcher do X', KNOWN_AGENTS, KNOWN_COMMANDS);
    assert.equal(steps.length, 0);
  });

  it('parses two valid @agent tokens into ordered steps', () => {
    const { steps } = parsePipelinePrompt(
      '@tpl-researcher research X then @tpl-planner plan Y',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps.length, 2);
    assert.equal(steps[0].agentId, 'tpl-researcher');
    assert.equal(steps[1].agentId, 'tpl-planner');
  });

  it('ignores unknown @tokens (not counted toward pipeline threshold)', () => {
    const { steps } = parsePipelinePrompt(
      '@tpl-researcher research then @notanagent plan',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps.length, 0);
  });

  it('caps at MAX_PIPELINE_STEPS', () => {
    const msg =
      '@tpl-researcher a @tpl-planner b @tpl-presenter c @tpl-code-executor d @tpl-planner e';
    const { steps } = parsePipelinePrompt(msg, KNOWN_AGENTS, KNOWN_COMMANDS);
    assert.equal(steps.length, MAX_PIPELINE_STEPS);
  });

  it('attaches /command tokens to the enclosing step', () => {
    const { steps } = parsePipelinePrompt(
      '@tpl-researcher /pdf report then @tpl-presenter /flowchart summary',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps[0].toolHints.length, 1);
    assert.equal(steps[0].toolHints[0], 'pdf');
    assert.equal(steps[1].toolHints.length, 1);
    assert.equal(steps[1].toolHints[0], 'flowchart');
  });

  it('strips /command tokens from step task text', () => {
    const { steps } = parsePipelinePrompt(
      '@tpl-researcher /pdf quarterly report then @tpl-presenter summary',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.ok(!steps[0].task.includes('/pdf'), 'task should not contain /pdf literal');
    assert.ok(steps[0].task.toLowerCase().includes('quarterly'), 'task should preserve content');
  });

  it('ignores unknown /tokens (left in task text, not a hint)', () => {
    const { steps } = parsePipelinePrompt(
      '@tpl-researcher /notarealcmd something then @tpl-presenter finish',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps[0].toolHints.length, 0);
    assert.ok(steps[0].task.includes('/notarealcmd'), 'unknown token remains in text');
  });

  it('prepends preamble text to step 1 task', () => {
    const { steps } = parsePipelinePrompt(
      'please @tpl-researcher research X then @tpl-presenter summarize',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.ok(steps[0].task.startsWith('please'));
  });

  it('sets remainder to text after last @token', () => {
    const { steps, remainder } = parsePipelinePrompt(
      '@tpl-researcher research X then @tpl-presenter summarize results',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps[1].task, 'summarize results');
    assert.equal(remainder, 'summarize results');
  });

  it('deduplicates repeated /command tokens in one step', () => {
    const { steps } = parsePipelinePrompt(
      '@tpl-researcher /pdf /pdf report then @tpl-presenter finish',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps[0].toolHints.length, 1);
  });

  it('handles mixed case agent ids case-insensitively', () => {
    const { steps } = parsePipelinePrompt(
      '@TPL-RESEARCHER research then @Tpl-Presenter summarize',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps.length, 2);
    assert.equal(steps[0].agentId, 'tpl-researcher');
    assert.equal(steps[1].agentId, 'tpl-presenter');
  });

  it('returns empty remainder when message ends exactly at the last @token', () => {
    const { steps, remainder } = parsePipelinePrompt(
      '@tpl-researcher research then @tpl-presenter',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps.length, 2);
    assert.equal(remainder, '');
  });

  it('does not confuse @ in email addresses as agent tokens', () => {
    // '@' at start of word boundary matches; "user@domain" (no space before @) is not a match.
    const { steps } = parsePipelinePrompt(
      'email user@example.com for @tpl-researcher research',
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps.length, 0); // only 1 valid @agent
  });
});

describe('sanitizePipeline', () => {
  const mk = (agentId: string, toolHints: string[] = [], task = 't'): PipelineStep => ({
    agentId,
    task,
    toolHints,
  });

  it('keeps steps with valid agent ids', () => {
    const { steps, droppedAgentIds } = sanitizePipeline(
      [mk('tpl-researcher'), mk('tpl-presenter')],
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps.length, 2);
    assert.equal(droppedAgentIds.length, 0);
  });

  it('drops steps with unknown agent ids and reports them', () => {
    const { steps, droppedAgentIds } = sanitizePipeline(
      [mk('tpl-researcher'), mk('evil-agent'), mk('tpl-presenter')],
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps.length, 2);
    assert.deepEqual(droppedAgentIds, ['evil-agent']);
  });

  it('filters tool hints down to enabled command keys', () => {
    const { steps } = sanitizePipeline(
      [mk('tpl-researcher', ['pdf', 'notacmd']), mk('tpl-presenter', ['flowchart'])],
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.deepEqual(steps[0].toolHints, ['pdf']);
    assert.deepEqual(steps[1].toolHints, ['flowchart']);
  });

  it('re-caps to MAX_PIPELINE_STEPS', () => {
    const many = Array.from({ length: MAX_PIPELINE_STEPS + 2 }, () => mk('tpl-researcher'));
    const { steps } = sanitizePipeline(many, KNOWN_AGENTS, KNOWN_COMMANDS);
    assert.equal(steps.length, MAX_PIPELINE_STEPS);
  });

  it('normalizes agent id case and dedupes tool hints', () => {
    const { steps } = sanitizePipeline(
      [mk('TPL-RESEARCHER', ['pdf', 'pdf'])],
      KNOWN_AGENTS,
      KNOWN_COMMANDS,
    );
    assert.equal(steps[0].agentId, 'tpl-researcher');
    assert.deepEqual(steps[0].toolHints, ['pdf']);
  });
});
