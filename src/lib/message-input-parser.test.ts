import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubmitPayload } from './message-input-parser';

const AGENTS = new Set(['tpl-researcher', 'tpl-planner', 'tpl-presenter', 'tpl-code-executor']);
const COMMANDS = new Set(['pdf', 'flowchart', 'bar-chart']);

function base(overrides: Partial<Parameters<typeof buildSubmitPayload>[0]> = {}) {
  return buildSubmitPayload({
    message: '',
    activeAgentMentions: [],
    activeSlashCommands: [],
    knownAgentIds: AGENTS,
    knownCommandKeys: COMMANDS,
    pipelineModeState: 'strict',
    maxSlashCommands: 3,
    ...overrides,
  });
}

describe('buildSubmitPayload — plain message', () => {
  it('passes through a plain message with no hints', () => {
    const r = base({ message: 'hello world' });
    assert.equal(r.finalMessage, 'hello world');
    assert.equal(r.toolHints, undefined);
    assert.equal(r.agentMention, undefined);
    assert.equal(r.pipeline, undefined);
  });
});

describe('buildSubmitPayload — raw slash commands (Gap 4)', () => {
  it('extracts a single leading /command', () => {
    const r = base({ message: '/pdf make a report' });
    assert.deepEqual(r.toolHints, ['pdf']);
    assert.equal(r.finalMessage, 'make a report');
  });

  it('extracts MULTIPLE raw /command tokens in one prompt', () => {
    const r = base({ message: '/pdf /flowchart summarize the design' });
    assert.deepEqual(r.toolHints, ['pdf', 'flowchart']);
    assert.ok(!r.finalMessage.includes('/pdf'));
    assert.ok(!r.finalMessage.includes('/flowchart'));
    assert.ok(r.finalMessage.includes('summarize'));
  });

  it('ignores unknown /tokens', () => {
    const r = base({ message: '/notacmd do something' });
    assert.equal(r.toolHints, undefined);
    assert.ok(r.finalMessage.includes('/notacmd'));
  });

  it('caps raw slash hints at maxSlashCommands', () => {
    const r = base({ message: '/pdf /flowchart /bar-chart /pdf extra', maxSlashCommands: 2 });
    assert.equal(r.toolHints!.length, 2);
  });

  it('degrades to single leading /command when registry keys are empty', () => {
    const r = base({ message: '/pdf report', knownCommandKeys: new Set<string>() });
    assert.deepEqual(r.toolHints, ['pdf']);
    assert.equal(r.finalMessage, 'report');
  });
});

describe('buildSubmitPayload — slash chips', () => {
  it('uses selected slash chips verbatim', () => {
    const r = base({ message: 'do the thing', activeSlashCommands: ['pdf', 'flowchart'] });
    assert.deepEqual(r.toolHints, ['pdf', 'flowchart']);
    assert.equal(r.finalMessage, 'do the thing');
  });
});

describe('buildSubmitPayload — single @ mention chip', () => {
  it('sets agentMention and combines with slash chips', () => {
    const r = base({
      message: 'analyze this',
      activeAgentMentions: ['tpl-researcher'],
      activeSlashCommands: ['pdf'],
    });
    assert.equal(r.agentMention, 'tpl-researcher');
    assert.deepEqual(r.toolHints, ['pdf']);
    assert.equal(r.pipeline, undefined);
  });

  it('strips a leading @token matching the chip', () => {
    const r = base({ message: '@tpl-researcher analyze', activeAgentMentions: ['tpl-researcher'] });
    assert.equal(r.finalMessage, 'analyze');
  });
});

describe('buildSubmitPayload — pipeline detection', () => {
  it('forms a pipeline from 2+ inline @agents', () => {
    const r = base({ message: '@tpl-researcher research X then @tpl-presenter summarize' });
    assert.ok(r.pipeline);
    assert.equal(r.pipeline!.length, 2);
    assert.equal(r.pipelineMode, 'strict');
  });

  it('does NOT drop selected slash chips when a chip @ + inline @ forms a pipeline (Gap 2)', () => {
    // Single @ chip + a selected /flowchart chip, then a second inline @agent.
    const r = base({
      message: '@tpl-presenter present it',
      activeAgentMentions: ['tpl-researcher'],
      activeSlashCommands: ['flowchart'],
    });
    assert.ok(r.pipeline, 'a pipeline should form');
    assert.equal(r.pipeline!.length, 2);
    // The flowchart chip must survive as a step-1 tool hint.
    assert.deepEqual(r.pipeline![0].toolHints, ['flowchart']);
    assert.equal(r.pipeline![0].agentId, 'tpl-researcher');
    assert.equal(r.pipeline![1].agentId, 'tpl-presenter');
  });

  it('does not form a pipeline when knownAgentIds is empty (degraded first-load)', () => {
    const r = base({
      message: '@tpl-researcher research then @tpl-presenter summarize',
      knownAgentIds: new Set<string>(),
    });
    assert.equal(r.pipeline, undefined);
  });
});
