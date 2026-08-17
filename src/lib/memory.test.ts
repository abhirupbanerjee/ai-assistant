import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatPersonalPreferences,
  selectRelevantPersonalInterests,
} from './memory';
import type { PersonalInterest, PersonalPreferenceProfile } from './db/compat';
import { validatePersonalPreferencePatch } from './db/compat';
import { toPersonalPreferencePatch } from './personal-memory-profile';

const baseInterest = (overrides: Partial<PersonalInterest>): PersonalInterest => ({
  id: 1,
  userId: 7,
  topic: 'Azure networking',
  normalizedTopic: 'azure networking',
  source: 'user_set',
  confidence: 1,
  isActive: true,
  lastUsedAt: null,
  hitCount: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

test('personal interest matching excludes unrelated and disabled interests', () => {
  const matches = selectRelevantPersonalInterests('How do Azure virtual networks peer?', [
    baseInterest({ id: 1 }),
    baseInterest({ id: 2, topic: 'Financial regulation', normalizedTopic: 'financial regulation' }),
    baseInterest({ id: 3, topic: 'Azure policy', normalizedTopic: 'azure policy', isActive: false }),
  ]);
  assert.deepEqual(matches.map((interest) => interest.id), [1]);
});

test('personal preference context labels defaults and explicit precedence', () => {
  const profile: PersonalPreferenceProfile = {
    userId: 7,
    preferredLanguage: 'French',
    translationLanguage: null,
    translationMode: 'never',
    tone: 'professional',
    verbosity: 'brief',
    complexity: 'technical',
    preferredFormat: 'bullets',
    preferredDiagramFormat: 'mermaid',
    preferredDocumentFormat: 'pdf',
    includeExamples: true,
    includeCitations: null,
    source: 'user_set',
    sources: {
      preferredLanguage: 'user_set', translationLanguage: 'inferred', translationMode: 'inferred',
      tone: 'user_set', verbosity: 'user_set', complexity: 'user_set', preferredFormat: 'user_set',
      preferredDiagramFormat: 'user_set', preferredDocumentFormat: 'user_set',
      includeExamples: 'user_set', includeCitations: 'inferred',
    },
    learningEnabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const context = formatPersonalPreferences(profile);
  assert.match(context, /\[Personal Response Preferences\]/);
  assert.match(context, /Current-turn explicit instructions and controls override/);
  assert.match(context, /Answer length: brief/);
  assert.match(context, /prefer mermaid format/);
  assert.match(context, /prefer pdf format/);
});

test('pending preference validation accepts only bounded known values', () => {
  assert.deepEqual(validatePersonalPreferencePatch({ tone: 'formal', includeExamples: null }), {
    ok: true,
    value: { tone: 'formal', includeExamples: null },
  });
  assert.equal(validatePersonalPreferencePatch({ tone: 'hostile' }).ok, false);
  assert.equal(validatePersonalPreferencePatch({ unknownField: true }).ok, false);
  assert.equal(validatePersonalPreferencePatch({ preferredLanguage: 'x'.repeat(81) }).ok, false);
  assert.equal(validatePersonalPreferencePatch({ includeCitations: 'yes' }).ok, false);
  assert.deepEqual(validatePersonalPreferencePatch({ preferredDiagramFormat: 'ascii', preferredDocumentFormat: 'docx' }), {
    ok: true,
    value: { preferredDiagramFormat: 'ascii', preferredDocumentFormat: 'docx' },
  });
  assert.equal(validatePersonalPreferencePatch({ preferredDiagramFormat: 'svg' }).ok, false);
  assert.equal(validatePersonalPreferencePatch({ preferredDocumentFormat: 'odt' }).ok, false);
});

test('pending preference validation trims language values without coercion', () => {
  assert.deepEqual(validatePersonalPreferencePatch({ preferredLanguage: '  French  ' }), {
    ok: true,
    value: { preferredLanguage: 'French' },
  });
  assert.equal(validatePersonalPreferencePatch({}).ok, false);
  assert.equal(validatePersonalPreferencePatch([]).ok, false);
});

test('personal preference save projection strips loaded profile metadata', () => {
  const loadedProfile = {
    userId: 42,
    preferredLanguage: 'en',
    translationLanguage: null,
    translationMode: 'never' as const,
    tone: 'professional' as const,
    verbosity: 'balanced' as const,
    complexity: 'technical' as const,
    preferredFormat: 'bullets' as const,
    preferredDiagramFormat: 'mermaid' as const,
    preferredDocumentFormat: 'pdf' as const,
    includeExamples: true,
    includeCitations: null,
    source: 'user_set',
    sources: {},
    learningEnabled: true,
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
  };

  const patch = toPersonalPreferencePatch(loadedProfile);

  assert.deepEqual(Object.keys(patch), [
    'preferredLanguage',
    'translationLanguage',
    'translationMode',
    'tone',
    'verbosity',
    'complexity',
    'preferredFormat',
    'preferredDiagramFormat',
    'preferredDocumentFormat',
    'includeExamples',
    'includeCitations',
  ]);
  assert.deepEqual(validatePersonalPreferencePatch(patch), { ok: true, value: patch });
});
