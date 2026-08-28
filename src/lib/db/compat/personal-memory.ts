import { sql, type Updateable } from 'kysely';
import { getDb } from '../kysely';
import type { PersonalPreferenceProfilesTable, PendingPersonalPreferenceCandidatesTable } from '../db-types';
import type { Selectable } from 'kysely';

export type PersonalMemorySource = 'user_set' | 'inferred';
export type TranslationMode = 'never' | 'when_requested' | 'always';
export type PersonalTone = 'default' | 'friendly' | 'formal' | 'direct' | 'professional' | 'custom';
export type PersonalVerbosity = 'brief' | 'balanced' | 'detailed';
export type PersonalComplexity = 'simple' | 'standard' | 'technical' | 'executive';
export type PersonalFormat = 'auto' | 'bullets' | 'steps' | 'prose' | 'table';
export type PersonalDiagramFormat = 'auto' | 'mermaid' | 'ascii' | 'infographic';
export type PersonalDocumentFormat = 'auto' | 'markdown' | 'docx' | 'pdf';

export interface PersonalPreferenceProfile {
  userId: number;
  preferredLanguage: string | null;
  translationLanguage: string | null;
  translationMode: TranslationMode;
  tone: PersonalTone;
  customToneName: string | null;
  customToneInstruction: string | null;
  verbosity: PersonalVerbosity;
  complexity: PersonalComplexity;
  preferredFormat: PersonalFormat;
  preferredDiagramFormat: PersonalDiagramFormat;
  preferredDocumentFormat: PersonalDocumentFormat;
  includeExamples: boolean | null;
  includeCitations: boolean | null;
  source: PersonalMemorySource;
  sources: Record<keyof PersonalPreferencePatch, PersonalMemorySource>;
  learningEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalInterest {
  id: number;
  userId: number;
  topic: string;
  normalizedTopic: string;
  source: PersonalMemorySource;
  confidence: number;
  isActive: boolean;
  lastUsedAt: string | null;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalPreferencePatch {
  preferredLanguage?: string | null;
  translationLanguage?: string | null;
  translationMode?: TranslationMode;
  tone?: PersonalTone;
  customToneName?: string | null;
  customToneInstruction?: string | null;
  verbosity?: PersonalVerbosity;
  complexity?: PersonalComplexity;
  preferredFormat?: PersonalFormat;
  preferredDiagramFormat?: PersonalDiagramFormat;
  preferredDocumentFormat?: PersonalDocumentFormat;
  includeExamples?: boolean | null;
  includeCitations?: boolean | null;
}

export type PersonalPreferenceField = keyof PersonalPreferencePatch;

export interface PendingPersonalPreferenceCandidate {
  id: number;
  userId: number;
  field: PersonalPreferenceField;
  value: PersonalPreferencePatch[PersonalPreferenceField];
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

const PREFERENCE_FIELDS = [
  'preferredLanguage', 'translationLanguage', 'translationMode', 'tone', 'customToneName', 'customToneInstruction',
  'verbosity', 'complexity', 'preferredFormat', 'preferredDiagramFormat', 'preferredDocumentFormat',
  'includeExamples', 'includeCitations',
] as const satisfies readonly PersonalPreferenceField[];

/** User-authored only. Never inferred, never a pending candidate, no `_source` column. */
const CUSTOM_PERSONA_FIELDS = new Set<PersonalPreferenceField>(['customToneName', 'customToneInstruction']);

const PREFERENCE_FIELD_SET = new Set<string>(PREFERENCE_FIELDS);
const ENUM_VALUES: Partial<Record<PersonalPreferenceField, ReadonlySet<unknown>>> = {
  translationMode: new Set(['never', 'when_requested', 'always']),
  tone: new Set(['default', 'friendly', 'formal', 'direct', 'professional', 'custom']),
  verbosity: new Set(['brief', 'balanced', 'detailed']),
  complexity: new Set(['simple', 'standard', 'technical', 'executive']),
  preferredFormat: new Set(['auto', 'bullets', 'steps', 'prose', 'table']),
  preferredDiagramFormat: new Set(['auto', 'mermaid', 'ascii', 'infographic']),
  preferredDocumentFormat: new Set(['auto', 'markdown', 'docx', 'pdf']),
};

/** Pure allow-list validator shared by extraction and the API boundary. */
export function validatePersonalPreferencePatch(input: unknown):
  | { ok: true; value: PersonalPreferencePatch }
  | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Preferences must be an object' };
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: 'At least one preference is required' };
  const output: PersonalPreferencePatch = {};
  for (const [field, rawValue] of entries) {
    if (!PREFERENCE_FIELD_SET.has(field)) return { ok: false, error: `Unsupported preference field: ${field}` };
    const key = field as PersonalPreferenceField;
    let value = rawValue;
    if (key === 'preferredLanguage' || key === 'translationLanguage') {
      if (value !== null && (typeof value !== 'string' || !value.trim() || value.trim().length > 80)) {
        return { ok: false, error: `${field} must be null or a non-empty string of at most 80 characters` };
      }
      if (typeof value === 'string') value = value.trim();
    } else if (key === 'customToneName' || key === 'customToneInstruction') {
      const maxLength = key === 'customToneName' ? 60 : 500;
      if (value !== null && (typeof value !== 'string' || value.trim().length > maxLength)) {
        return { ok: false, error: `${field} must be null or a string of at most ${maxLength} characters` };
      }
      value = typeof value === 'string' ? (value.trim() || null) : null;
    } else if (key === 'includeExamples' || key === 'includeCitations') {
      if (value !== null && typeof value !== 'boolean') return { ok: false, error: `${field} must be boolean or null` };
    } else if (!ENUM_VALUES[key]?.has(value)) {
      return { ok: false, error: `Invalid value for ${field}` };
    }
    (output as Record<string, unknown>)[key] = value;
  }
  if (output.tone === 'custom' && !(typeof output.customToneInstruction === 'string' && output.customToneInstruction.trim())) {
    return { ok: false, error: 'customToneInstruction is required (non-empty) when tone is custom' };
  }
  return { ok: true, value: output };
}

const DEFAULT_PROFILE: Omit<PersonalPreferenceProfile, 'userId' | 'createdAt' | 'updatedAt'> = {
  preferredLanguage: null,
  translationLanguage: null,
  translationMode: 'never',
  tone: 'default',
  customToneName: null,
  customToneInstruction: null,
  verbosity: 'balanced',
  complexity: 'standard',
  preferredFormat: 'auto',
  preferredDiagramFormat: 'auto',
  preferredDocumentFormat: 'auto',
  includeExamples: null,
  includeCitations: null,
  source: 'user_set',
  sources: {
    preferredLanguage: 'inferred', translationLanguage: 'inferred', translationMode: 'inferred',
    tone: 'inferred', customToneName: 'user_set', customToneInstruction: 'user_set',
    verbosity: 'inferred', complexity: 'inferred', preferredFormat: 'inferred',
    preferredDiagramFormat: 'inferred', preferredDocumentFormat: 'inferred',
    includeExamples: 'inferred', includeCitations: 'inferred',
  },
  learningEnabled: false,
};

function mapProfile(row: Selectable<PersonalPreferenceProfilesTable>): PersonalPreferenceProfile {
  return {
    userId: row.user_id,
    preferredLanguage: row.preferred_language,
    translationLanguage: row.translation_language,
    translationMode: row.translation_mode,
    tone: row.tone,
    customToneName: row.custom_tone_name,
    customToneInstruction: row.custom_tone_instruction,
    verbosity: row.verbosity,
    complexity: row.complexity,
    preferredFormat: row.preferred_format,
    preferredDiagramFormat: row.preferred_diagram_format,
    preferredDocumentFormat: row.preferred_document_format,
    includeExamples: row.include_examples,
    includeCitations: row.include_citations,
    source: row.source,
    sources: {
      preferredLanguage: row.preferred_language_source,
      translationLanguage: row.translation_language_source,
      translationMode: row.translation_mode_source,
      tone: row.tone_source,
      customToneName: 'user_set',
      customToneInstruction: 'user_set',
      verbosity: row.verbosity_source,
      complexity: row.complexity_source,
      preferredFormat: row.preferred_format_source,
      preferredDiagramFormat: row.preferred_diagram_format_source,
      preferredDocumentFormat: row.preferred_document_format_source,
      includeExamples: row.include_examples_source,
      includeCitations: row.include_citations_source,
    },
    learningEnabled: row.learning_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInterest(row: {
  id: number; user_id: number; topic: string; normalized_topic: string;
  source: PersonalMemorySource; confidence: number; is_active: boolean;
  last_used_at: string | null; hit_count: number; created_at: string; updated_at: string;
}): PersonalInterest {
  return {
    id: row.id,
    userId: row.user_id,
    topic: row.topic,
    normalizedTopic: row.normalized_topic,
    source: row.source,
    confidence: row.confidence,
    isActive: row.is_active,
    lastUsedAt: row.last_used_at,
    hitCount: row.hit_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPendingCandidate(row: {
  id: number; user_id: number; field: PersonalPreferenceField; value: unknown;
  confidence: number; created_at: string; updated_at: string;
}): PendingPersonalPreferenceCandidate {
  return {
    id: row.id,
    userId: row.user_id,
    field: row.field,
    value: row.value as PersonalPreferencePatch[PersonalPreferenceField],
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeInterestTopic(topic: string): string {
  return topic.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export async function getPersonalPreferenceProfile(userId: number): Promise<PersonalPreferenceProfile | null> {
  const db = await getDb();
  const row = await db.selectFrom('personal_preference_profiles')
    .selectAll()
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row ? mapProfile(row) : null;
}

export async function getOrCreatePersonalPreferenceProfile(userId: number): Promise<PersonalPreferenceProfile> {
  const existing = await getPersonalPreferenceProfile(userId);
  if (existing) return existing;
  const db = await getDb();
  const row = await db.insertInto('personal_preference_profiles')
    .values({ user_id: userId })
    .onConflict((oc) => oc.column('user_id').doNothing())
    .returningAll()
    .executeTakeFirst();
  if (row) return mapProfile(row);
  const concurrent = await getPersonalPreferenceProfile(userId);
  if (!concurrent) throw new Error('Failed to create personal preference profile');
  return concurrent;
}

function toDbPatch(patch: PersonalPreferencePatch): Updateable<PersonalPreferenceProfilesTable> {
  const values: Updateable<PersonalPreferenceProfilesTable> = {};
  if ('preferredLanguage' in patch) values.preferred_language = patch.preferredLanguage ?? null;
  if ('translationLanguage' in patch) values.translation_language = patch.translationLanguage ?? null;
  if (patch.translationMode !== undefined) values.translation_mode = patch.translationMode;
  if (patch.tone !== undefined) values.tone = patch.tone;
  if ('customToneName' in patch) values.custom_tone_name = patch.customToneName ?? null;
  if ('customToneInstruction' in patch) values.custom_tone_instruction = patch.customToneInstruction ?? null;
  if (patch.verbosity !== undefined) values.verbosity = patch.verbosity;
  if (patch.complexity !== undefined) values.complexity = patch.complexity;
  if (patch.preferredFormat !== undefined) values.preferred_format = patch.preferredFormat;
  if (patch.preferredDiagramFormat !== undefined) values.preferred_diagram_format = patch.preferredDiagramFormat;
  if (patch.preferredDocumentFormat !== undefined) values.preferred_document_format = patch.preferredDocumentFormat;
  if ('includeExamples' in patch) values.include_examples = patch.includeExamples ?? null;
  if ('includeCitations' in patch) values.include_citations = patch.includeCitations ?? null;
  return values;
}

// Custom persona fields are deliberately absent: they are user-set only and have
// no `*_source` columns in the schema.
const SOURCE_COLUMN_BY_FIELD: Partial<Record<PersonalPreferenceField, keyof Updateable<PersonalPreferenceProfilesTable>>> = {
  preferredLanguage: 'preferred_language_source', translationLanguage: 'translation_language_source',
  translationMode: 'translation_mode_source', tone: 'tone_source', verbosity: 'verbosity_source',
  complexity: 'complexity_source', preferredFormat: 'preferred_format_source',
  preferredDiagramFormat: 'preferred_diagram_format_source', preferredDocumentFormat: 'preferred_document_format_source',
  includeExamples: 'include_examples_source', includeCitations: 'include_citations_source',
};

function addSourceColumns(
  values: Updateable<PersonalPreferenceProfilesTable>,
  patch: PersonalPreferencePatch,
  source: PersonalMemorySource,
): Updateable<PersonalPreferenceProfilesTable> {
  for (const field of Object.keys(patch) as Array<keyof PersonalPreferencePatch>) {
    if (patch[field] !== undefined || Object.prototype.hasOwnProperty.call(patch, field)) {
      const sourceColumn = SOURCE_COLUMN_BY_FIELD[field];
      if (sourceColumn) (values as Record<string, unknown>)[sourceColumn] = source;
    }
  }
  return values;
}

/** Column-scoped explicit update. Only fields present in patch are written. */
export async function updatePersonalPreferenceProfile(
  userId: number,
  patch: PersonalPreferencePatch,
): Promise<PersonalPreferenceProfile> {
  await getOrCreatePersonalPreferenceProfile(userId);
  const db = await getDb();
  const values = addSourceColumns(toDbPatch(patch), patch, 'user_set');
  const row = await db.updateTable('personal_preference_profiles')
    .set({ ...values, source: 'user_set', updated_at: sql<string>`NOW()` })
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirstOrThrow();
  return mapProfile(row);
}

/**
 * Column-scoped inferred update. A profile touched by the user is immutable to
 * inference, so learned values can never overwrite user-configured values.
 */
export async function updateInferredPersonalPreferences(
  userId: number,
  patch: PersonalPreferencePatch,
): Promise<PersonalPreferenceProfile> {
  const profile = await getOrCreatePersonalPreferenceProfile(userId);
  if (!profile.learningEnabled) return profile;
  const safePatch: PersonalPreferencePatch = {};
  for (const field of Object.keys(patch) as Array<keyof PersonalPreferencePatch>) {
    if (CUSTOM_PERSONA_FIELDS.has(field)) continue; // user-authored only; never inferred
    if (profile.sources[field] !== 'user_set') (safePatch as Record<string, unknown>)[field] = patch[field];
  }
  const values = addSourceColumns(toDbPatch(safePatch), safePatch, 'inferred');
  if (Object.keys(values).length === 0) return profile;
  const db = await getDb();
  const row = await db.updateTable('personal_preference_profiles')
    .set({ ...values, source: 'inferred', updated_at: sql<string>`NOW()` })
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();
  return row ? mapProfile(row) : profile;
}

/** Store validated inferred candidates without changing the effective profile. */
export async function upsertPendingPersonalPreferenceCandidates(
  userId: number,
  patch: PersonalPreferencePatch,
  confidence = 0.75,
): Promise<PendingPersonalPreferenceCandidate[]> {
  const validated = validatePersonalPreferencePatch(patch);
  if (!validated.ok) throw new Error(validated.error);
  const profile = await getOrCreatePersonalPreferenceProfile(userId);
  if (!profile.learningEnabled) return [];
  const db = await getDb();
  for (const field of Object.keys(validated.value) as PersonalPreferenceField[]) {
    if (CUSTOM_PERSONA_FIELDS.has(field)) continue; // user-authored only; never a candidate
    // Explicit fields remain authoritative and do not need confirmation prompts.
    if (profile.sources[field] === 'user_set') continue;
    await db.insertInto('pending_personal_preference_candidates').values({
      user_id: userId,
      field: field as PendingPersonalPreferenceCandidatesTable['field'],
      value: sql`${JSON.stringify(validated.value[field])}::jsonb`,
      confidence: Math.max(0, Math.min(1, confidence)),
    }).onConflict((oc) => oc.columns(['user_id', 'field']).doUpdateSet({
      value: sql`excluded.value`,
      confidence: sql`excluded.confidence`,
      updated_at: sql<string>`NOW()`,
    })).execute();
  }
  return listPendingPersonalPreferenceCandidates(userId);
}

export async function listPendingPersonalPreferenceCandidates(userId: number): Promise<PendingPersonalPreferenceCandidate[]> {
  const db = await getDb();
  const rows = await db.selectFrom('pending_personal_preference_candidates')
    .selectAll().where('user_id', '=', userId).orderBy('updated_at', 'desc').execute();
  return rows.map(mapPendingCandidate);
}

/**
 * Resolve by candidate id and user id in one transaction. A plain acceptance
 * remains inferred and cannot overwrite an explicit field. Supplying a valid
 * replacement is an explicit user-set preference.
 */
export async function resolvePendingPersonalPreferenceCandidate(
  userId: number,
  candidateId: number,
  action: 'accept' | 'reject',
  replacement?: PersonalPreferencePatch,
): Promise<boolean> {
  if (!Number.isInteger(candidateId) || candidateId <= 0) return false;
  const validatedReplacement = replacement === undefined ? null : validatePersonalPreferencePatch(replacement);
  if (validatedReplacement && !validatedReplacement.ok) throw new RangeError(validatedReplacement.error);
  const db = await getDb();
  return db.transaction().execute(async (trx) => {
    const candidate = await trx.selectFrom('pending_personal_preference_candidates').selectAll()
      .where('id', '=', candidateId).where('user_id', '=', userId).forUpdate().executeTakeFirst();
    if (!candidate) return false;
    if (action === 'accept') {
      let patch: PersonalPreferencePatch;
      let source: PersonalMemorySource;
      if (validatedReplacement?.ok) {
        const replacementEntries = Object.entries(validatedReplacement.value);
        if (replacementEntries.length !== 1 || replacementEntries[0][0] !== candidate.field) {
          throw new RangeError('Replacement must contain only the candidate field');
        }
        patch = validatedReplacement.value;
        source = 'user_set';
      } else {
        const validatedCandidate = validatePersonalPreferencePatch({ [candidate.field]: candidate.value });
        if (!validatedCandidate.ok) throw new Error('Stored preference candidate is invalid');
        patch = validatedCandidate.value;
        source = 'inferred';
      }
      const profile = await trx.selectFrom('personal_preference_profiles').selectAll().where('user_id', '=', userId).executeTakeFirstOrThrow();
      if (source === 'user_set' || profile[SOURCE_COLUMN_BY_FIELD[candidate.field] as keyof typeof profile] !== 'user_set') {
        const values = addSourceColumns(toDbPatch(patch), patch, source);
        await trx.updateTable('personal_preference_profiles').set({ ...values, source, updated_at: sql<string>`NOW()` })
          .where('user_id', '=', userId).execute();
      }
    }
    await trx.deleteFrom('pending_personal_preference_candidates').where('id', '=', candidateId).where('user_id', '=', userId).execute();
    return true;
  });
}

export async function clearPendingPersonalPreferenceCandidates(userId: number): Promise<number> {
  const db = await getDb();
  const result = await db.deleteFrom('pending_personal_preference_candidates').where('user_id', '=', userId).executeTakeFirst();
  return Number(result.numDeletedRows);
}

/** Clear learned values/candidates while preserving every explicit column. */
export async function clearInferredPersonalMemory(userId: number): Promise<void> {
  const profile = await getOrCreatePersonalPreferenceProfile(userId);
  const inferredReset: PersonalPreferencePatch = {};
  for (const field of PREFERENCE_FIELDS) {
    if (profile.sources[field] === 'inferred') {
      (inferredReset as Record<string, unknown>)[field] = DEFAULT_PROFILE[field];
    }
  }
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('pending_personal_preference_candidates').where('user_id', '=', userId).execute();
    await trx.deleteFrom('personal_interests').where('user_id', '=', userId).where('source', '=', 'inferred').execute();
    if (Object.keys(inferredReset).length > 0) {
      const values = addSourceColumns(toDbPatch(inferredReset), inferredReset, 'inferred');
      await trx.updateTable('personal_preference_profiles').set({ ...values, updated_at: sql<string>`NOW()` }).where('user_id', '=', userId).execute();
    }
  });
}

export async function setPersonalMemoryLearning(userId: number, enabled: boolean): Promise<PersonalPreferenceProfile> {
  await getOrCreatePersonalPreferenceProfile(userId);
  const db = await getDb();
  const row = await db.updateTable('personal_preference_profiles')
    .set({ learning_enabled: enabled, updated_at: sql<string>`NOW()` })
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirstOrThrow();
  return mapProfile(row);
}

export async function resetPersonalPreferences(userId: number): Promise<PersonalPreferenceProfile> {
  await getOrCreatePersonalPreferenceProfile(userId);
  const db = await getDb();
  const row = await db.updateTable('personal_preference_profiles')
    .set({
      preferred_language: DEFAULT_PROFILE.preferredLanguage,
      translation_language: DEFAULT_PROFILE.translationLanguage,
      translation_mode: DEFAULT_PROFILE.translationMode,
      tone: DEFAULT_PROFILE.tone,
      custom_tone_name: DEFAULT_PROFILE.customToneName,
      custom_tone_instruction: DEFAULT_PROFILE.customToneInstruction,
      verbosity: DEFAULT_PROFILE.verbosity,
      complexity: DEFAULT_PROFILE.complexity,
      preferred_format: DEFAULT_PROFILE.preferredFormat,
      preferred_diagram_format: DEFAULT_PROFILE.preferredDiagramFormat,
      preferred_document_format: DEFAULT_PROFILE.preferredDocumentFormat,
      include_examples: DEFAULT_PROFILE.includeExamples,
      include_citations: DEFAULT_PROFILE.includeCitations,
      source: 'user_set',
      preferred_language_source: 'inferred', translation_language_source: 'inferred',
      translation_mode_source: 'inferred', tone_source: 'inferred', verbosity_source: 'inferred',
      complexity_source: 'inferred', preferred_format_source: 'inferred',
      preferred_diagram_format_source: 'inferred', preferred_document_format_source: 'inferred',
      include_examples_source: 'inferred', include_citations_source: 'inferred',
      updated_at: sql<string>`NOW()`,
    })
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirstOrThrow();
  return mapProfile(row);
}

export async function listPersonalInterests(userId: number, activeOnly = false): Promise<PersonalInterest[]> {
  const db = await getDb();
  let query = db.selectFrom('personal_interests').selectAll().where('user_id', '=', userId);
  if (activeOnly) query = query.where('is_active', '=', true);
  const rows = await query.orderBy('source', 'asc').orderBy('updated_at', 'desc').execute();
  return rows.map(mapInterest);
}

export async function addPersonalInterest(
  userId: number,
  topic: string,
  source: PersonalMemorySource = 'user_set',
  confidence = 1,
  maxInterests = 25,
): Promise<PersonalInterest | null> {
  const normalized = normalizeInterestTopic(topic);
  if (!normalized) throw new Error('Interest topic is required');
  const db = await getDb();
  const count = await db.selectFrom('personal_interests')
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .where('user_id', '=', userId)
    .executeTakeFirstOrThrow();
  const existing = await db.selectFrom('personal_interests')
    .selectAll()
    .where('user_id', '=', userId)
    .where('normalized_topic', '=', normalized)
    .executeTakeFirst();
  if (!existing && Number(count.count) >= maxInterests) return null;

  const row = await db.insertInto('personal_interests')
    .values({
      user_id: userId,
      topic: topic.trim().slice(0, 160),
      normalized_topic: normalized.slice(0, 160),
      source,
      confidence: Math.max(0, Math.min(1, confidence)),
      is_active: true,
    })
    .onConflict((oc) => oc.columns(['user_id', 'normalized_topic']).doUpdateSet((eb) => ({
      topic: source === 'user_set' ? topic.trim().slice(0, 160) : eb.ref('personal_interests.topic'),
      source: source === 'user_set' ? 'user_set' : eb.ref('personal_interests.source'),
      confidence: source === 'user_set' ? 1 : eb.ref('personal_interests.confidence'),
      is_active: source === 'user_set' ? true : eb.ref('personal_interests.is_active'),
      updated_at: sql<string>`NOW()`,
    })))
    .returningAll()
    .executeTakeFirstOrThrow();
  return mapInterest(row);
}

export async function setPersonalInterestActive(userId: number, interestId: number, active: boolean): Promise<boolean> {
  const db = await getDb();
  const result = await db.updateTable('personal_interests')
    .set({ is_active: active, updated_at: sql<string>`NOW()` })
    .where('id', '=', interestId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export async function deletePersonalInterest(userId: number, interestId: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.deleteFrom('personal_interests')
    .where('id', '=', interestId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return Number(result.numDeletedRows) > 0;
}

export async function clearPersonalInterests(userId: number, inferredOnly = false): Promise<number> {
  const db = await getDb();
  let query = db.deleteFrom('personal_interests').where('user_id', '=', userId);
  if (inferredOnly) query = query.where('source', '=', 'inferred');
  const result = await query.executeTakeFirst();
  return Number(result.numDeletedRows);
}

export async function markPersonalInterestsUsed(userId: number, interestIds: number[]): Promise<void> {
  if (interestIds.length === 0) return;
  const db = await getDb();
  await db.updateTable('personal_interests')
    .set({ last_used_at: sql<string>`NOW()`, hit_count: sql<number>`hit_count + 1` })
    .where('user_id', '=', userId)
    .where('id', 'in', interestIds)
    .execute();
}

export async function clearAllPersonalMemory(userId: number): Promise<void> {
  const db = await getDb();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('pending_personal_preference_candidates').where('user_id', '=', userId).execute();
    await trx.deleteFrom('personal_interests').where('user_id', '=', userId).execute();
    await trx.deleteFrom('personal_preference_profiles').where('user_id', '=', userId).execute();
  });
}

export async function getPersonalMemoryStats(): Promise<{
  usersWithMemory: number;
  totalInterests: number;
  activeInterests: number;
  inferredInterests: number;
}> {
  const db = await getDb();
  const [profiles, interests] = await Promise.all([
    db.selectFrom('personal_preference_profiles')
      .select(({ fn }) => fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow(),
    db.selectFrom('personal_interests')
      .select(({ fn }) => [
        fn.countAll<number>().as('total'),
        fn.count<number>('id').filterWhere('is_active', '=', true).as('active'),
        fn.count<number>('id').filterWhere('source', '=', 'inferred').as('inferred'),
      ])
      .executeTakeFirstOrThrow(),
  ]);
  return {
    usersWithMemory: Number(profiles.count),
    totalInterests: Number(interests.total),
    activeInterests: Number(interests.active),
    inferredInterests: Number(interests.inferred),
  };
}
