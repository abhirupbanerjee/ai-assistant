import { createInternalCompletion } from '@/lib/llm-client';
import {
  addPersonalInterest,
  getOrCreatePersonalPreferenceProfile,
  getPersonalMemoryStats,
  listPersonalInterests,
  markPersonalInterestsUsed,
  upsertPendingPersonalPreferenceCandidates,
  updateInferredPersonalPreferences,
  validatePersonalPreferencePatch,
  type PersonalInterest,
  type PersonalPreferencePatch,
  type PersonalPreferenceProfile,
} from '@/lib/db/compat';
import { getMemorySettings } from '@/lib/db/compat';
import { SUPPORTED_LANGUAGES } from '@/lib/translation/provider-factory';
import {
  type PersonaTone,
  type PresetPersonaTone,
  type ResolvedResponseStyle,
  type Verbosity,
  isPersonaTone,
  isPresetPersonaTone,
  isVerbosity,
  mapLegacyResponseTone,
  trimToNull,
} from '@/lib/response-style';

export interface FactEntry {
  text: string;
  timestamp?: string;
}

export interface UserMemory {
  id: number;
  userId: number;
  categoryId: number | null;
  facts: FactEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryStats {
  usersWithMemory: number;
  totalFacts: number;
  categoriesActive: number;
  extractionsToday: number;
  activeInterests?: number;
  inferredInterests?: number;
}

const EMPTY_STATS: MemoryStats = {
  usersWithMemory: 0,
  totalFacts: 0,
  categoriesActive: 0,
  extractionsToday: 0,
};

export async function getMemoryForUser(
  _userId: number,
  _categoryId: number | null = null
): Promise<UserMemory | null> {
  return null;
}

export async function getAllMemoriesForUser(_userId: number): Promise<UserMemory[]> {
  return [];
}

export async function updateMemory(
  _userId: number,
  _categoryId: number | null,
  _facts: string[] | FactEntry[]
): Promise<UserMemory> {
  throw new Error('Legacy memory is disabled while Personal Memory Phase 2 is pending');
}

export async function syncMemoryToVectorStore(
  _userId: number,
  _categoryId: number | null,
  _facts: string[]
): Promise<void> {}

export async function deleteFact(
  _userId: number,
  _categoryId: number | null,
  _factText: string
): Promise<UserMemory> {
  throw new Error('Legacy memory is disabled while Personal Memory Phase 2 is pending');
}

export async function clearMemory(
  _userId: number,
  _categoryId?: number | null
): Promise<void> {}

export async function getMemoryStats(): Promise<MemoryStats> {
  const stats = await getPersonalMemoryStats();
  return {
    usersWithMemory: stats.usersWithMemory,
    totalFacts: stats.totalInterests,
    categoriesActive: 0,
    extractionsToday: 0,
    activeInterests: stats.activeInterests,
    inferredInterests: stats.inferredInterests,
  };
}

export async function extractFacts(
  _messages: Array<{ role: string; content: string }>,
  existingFacts: string[] = [],
  _maxFacts: number = 20
): Promise<string[]> {
  return existingFacts;
}

export function formatMemoryForPrompt(_facts: string[] | FactEntry[]): string {
  return '';
}

export async function getMemoryContext(
  userId: number,
  _activeCategoryId: number | null = null,
  query = ''
): Promise<string> {
  const context = await assemblePersonalMemoryContext({
    surface: 'main-chat',
    userId,
    query,
  });
  return context.promptContext;
}

/**
 * Explicit chat-input signals that feed preference inference. Only canonical
 * preset persona tones are eligible; `custom` free-text personas are never
 * inferred (they are user-authored only) and `default` carries no signal.
 */
export interface PersonalMemorySignals {
  responseTone?: PresetPersonaTone;
}

/**
 * Map a chat-selected tone to an inference signal. Returns a value only for
 * canonical preset tones (`friendly`/`formal`/`direct`/`professional`);
 * `custom`, legacy selector values, and `default` are always excluded.
 */
export function resolveChatToneSignal(responseTone: string | undefined): PresetPersonaTone | undefined {
  if (!responseTone) return undefined;
  return isPresetPersonaTone(responseTone) ? responseTone : undefined;
}

export async function processConversationForMemory(
  userId: number,
  _categoryId: number | null,
  messages: Array<{ role: string; content: string }>,
  signals?: PersonalMemorySignals,
): Promise<void> {
  await extractAndPersistPersonalMemory(userId, messages, signals);
}

export type MemorySurface = 'main-chat' | 'workspace' | 'agent-bot';

export interface ExplicitPersonalControls {
  targetLanguage?: string;
  responseTone?: string;
  verbosity?: string;
  customToneName?: string;
  customToneInstruction?: string;
}

export interface PersonalMemoryContext {
  profile: PersonalPreferenceProfile | null;
  relevantInterests: PersonalInterest[];
  promptContext: string;
  resolvedTargetLanguage: string;
  resolvedTone: PersonaTone;
  resolvedVerbosity: Verbosity;
  resolvedCustomName: string | null;
  resolvedCustomInstruction: string | null;
}

function resolveLanguageCode(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase();
  if (SUPPORTED_LANGUAGES[normalized]) return normalized;
  const match = Object.entries(SUPPORTED_LANGUAGES)
    .find(([, name]) => name.toLocaleLowerCase() === normalized);
  return match?.[0] ?? null;
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'could', 'from', 'have',
  'into', 'just', 'more', 'some', 'than', 'that', 'their', 'then', 'there', 'these',
  'they', 'this', 'those', 'what', 'when', 'where', 'which', 'with', 'would', 'your',
]);

export function selectRelevantPersonalInterests(
  query: string,
  interests: PersonalInterest[],
  limit = 3,
): PersonalInterest[] {
  const terms = new Set(
    query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)),
  );
  if (terms.size === 0) return [];
  return interests
    .filter((interest) => interest.isActive)
    .map((interest) => {
      const topicTerms = interest.normalizedTopic.split(' ').filter(Boolean);
      const matches = topicTerms.filter((term) => terms.has(term)).length;
      const phraseMatch = query.toLocaleLowerCase().includes(interest.normalizedTopic) ? 2 : 0;
      const recency = interest.lastUsedAt
        ? Math.max(0.1, 1 - ((Date.now() - Date.parse(interest.lastUsedAt)) / 86_400_000 / 180))
        : 0.5;
      return { interest, score: (matches + phraseMatch) * interest.confidence * recency * (1 + Math.log1p(interest.hitCount) / 10) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ interest }) => interest);
}

export function formatPersonalPreferences(profile: PersonalPreferenceProfile): string {
  const entries: string[] = [];
  if (profile.preferredLanguage) entries.push(`Preferred response language: ${profile.preferredLanguage}.`);
  if (profile.translationMode === 'always' && profile.translationLanguage) {
    entries.push(`Always deliver the final answer in ${profile.translationLanguage}.`);
  }
  if (profile.tone === 'custom') {
    const customName = profile.customToneName?.trim();
    entries.push(customName ? `Tone: Custom persona — ${customName}.` : 'Tone: Custom persona.');
  } else if (profile.tone !== 'default') {
    entries.push(`Tone: ${profile.tone}.`);
  }
  if (profile.verbosity !== 'balanced') entries.push(`Answer length: ${profile.verbosity}.`);
  if (profile.complexity !== 'standard') entries.push(`Complexity: ${profile.complexity}.`);
  if (profile.preferredFormat !== 'auto') entries.push(`Preferred format: ${profile.preferredFormat}.`);
  if (profile.preferredDiagramFormat !== 'auto') entries.push(`When a diagram is useful, prefer ${profile.preferredDiagramFormat} format.`);
  if (profile.preferredDocumentFormat !== 'auto') entries.push(`When generating a document artifact, prefer ${profile.preferredDocumentFormat} format.`);
  if (profile.includeExamples !== null) entries.push(profile.includeExamples ? 'Include examples when useful.' : 'Do not add examples unless requested.');
  if (profile.includeCitations !== null) entries.push(profile.includeCitations ? 'Include citations when available.' : 'Do not add optional citations.');
  if (entries.length === 0) return '';
  return `[Personal Response Preferences]\n${entries.join('\n')}\nCurrent-turn explicit instructions and controls override these defaults.`;
}

/**
 * Resolve the persona/tone + verbosity for this turn, applying the canonical
 * precedence (§6.1):
 *   1. Explicit current-turn instruction — highest, lives in the assembled
 *      block text ("Unless the user's current message explicitly overrides..."),
 *      not here.
 *   2. Chat-input override (non-`default` `responseTone`, incl. transient `custom`).
 *   3. Stored profile tone / custom persona / verbosity.
 *   4. Application default.
 *
 * The legacy selector vocabulary (`concise`, `detailed`, `explanatory`,
 * `creative`) is mapped here through the server-side single source of truth in
 * `@/lib/response-style`.
 */
function resolveResponseStyle(
  profile: PersonalPreferenceProfile | null,
  explicit: ExplicitPersonalControls | undefined,
): ResolvedResponseStyle {
  const hasTone = explicit !== undefined && Object.prototype.hasOwnProperty.call(explicit, 'responseTone');
  const explicitTone = hasTone ? explicit!.responseTone : undefined;

  let tone: PersonaTone = profile?.tone ?? 'default';
  let verbosity: Verbosity = profile?.verbosity ?? 'balanced';
  let customName: string | null = null;
  let customInstruction: string | null = null;

  if (explicitTone) {
    const legacy = mapLegacyResponseTone(explicitTone);
    if (legacy) {
      tone = legacy.tone;
      if (legacy.verbosity) verbosity = legacy.verbosity;
      customName = legacy.customName ?? null;
      customInstruction = legacy.customInstruction ?? null;
    } else if (explicitTone !== 'default' && isPersonaTone(explicitTone)) {
      tone = explicitTone;
    }
  }

  // Chat-input verbosity override (independent of persona tone).
  if (explicit?.verbosity && isVerbosity(explicit.verbosity)) {
    verbosity = explicit.verbosity;
  }

  if (tone === 'custom') {
    // Precedence: transient chat override > legacy seed > stored profile persona.
    if (!customName) customName = trimToNull(profile?.customToneName ?? null);
    if (!customInstruction) customInstruction = trimToNull(profile?.customToneInstruction ?? null);

    const transientName = trimToNull(explicit?.customToneName);
    const transientInstruction = trimToNull(explicit?.customToneInstruction);
    if (transientName) customName = transientName;
    if (transientInstruction) customInstruction = transientInstruction;

    // Never produce an empty custom block (requirements 10/11).
    if (!customInstruction) {
      tone = 'default';
      customName = null;
      customInstruction = null;
    }
  } else {
    // Tone is not custom: never carry a stale custom persona into the block.
    customName = null;
    customInstruction = null;
  }

  return { tone, verbosity, customName, customInstruction };
}

export async function assemblePersonalMemoryContext(input: {
  surface: MemorySurface;
  userId: number | null;
  query: string;
  explicit?: ExplicitPersonalControls;
}): Promise<PersonalMemoryContext> {
  // Resolve with a null profile so the chat-input override still applies even
  // when personal memory is disabled or unavailable for this surface.
  const fallbackStyle = resolveResponseStyle(null, input.explicit);
  const empty: PersonalMemoryContext = {
    profile: null,
    relevantInterests: [],
    promptContext: '',
    resolvedTargetLanguage: input.explicit?.targetLanguage ?? 'en',
    resolvedTone: fallbackStyle.tone,
    resolvedVerbosity: fallbackStyle.verbosity,
    resolvedCustomName: fallbackStyle.customName,
    resolvedCustomInstruction: fallbackStyle.customInstruction,
  };
  if (input.surface !== 'main-chat' || input.userId === null) return empty;
  const settings = await getMemorySettings();
  if (!settings.enabled) return empty;

  const [profile, interests] = await Promise.all([
    getOrCreatePersonalPreferenceProfile(input.userId),
    listPersonalInterests(input.userId, true),
  ]);
  const relevantInterests = selectRelevantPersonalInterests(input.query, interests);
  if (relevantInterests.length > 0) {
    await markPersonalInterestsUsed(input.userId, relevantInterests.map((interest) => interest.id));
  }
  const sections = [formatPersonalPreferences(profile)];
  if (relevantInterests.length > 0) {
    sections.push(`[Relevant User Interests]\n${relevantInterests.map((interest) => `- ${interest.topic}`).join('\n')}\nUse only when relevant; do not force these topics into the answer.`);
  }

  // Presence, not value, determines whether the current request is explicit.
  const explicitLanguage = input.explicit && Object.prototype.hasOwnProperty.call(input.explicit, 'targetLanguage');
  const storedLanguage = profile.translationMode === 'always' && profile.translationLanguage
    ? profile.translationLanguage
    : profile.preferredLanguage;
  const style = resolveResponseStyle(profile, input.explicit);
  return {
    profile,
    relevantInterests,
    promptContext: sections.filter(Boolean).join('\n\n'),
    resolvedTargetLanguage: explicitLanguage
      ? input.explicit!.targetLanguage!
      : (resolveLanguageCode(storedLanguage) || 'en'),
    resolvedTone: style.tone,
    resolvedVerbosity: style.verbosity,
    resolvedCustomName: style.customName,
    resolvedCustomInstruction: style.customInstruction,
  };
}

interface ExtractedPersonalMemory {
  durable: boolean;
  preferences?: PersonalPreferencePatch;
  interests?: Array<{ topic: string; confidence?: number }>;
}

function parseExtraction(raw: string): ExtractedPersonalMemory | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as ExtractedPersonalMemory;
    if (!parsed || typeof parsed !== 'object' || parsed.durable !== true) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function extractAndPersistPersonalMemory(
  userId: number,
  messages: Array<{ role: string; content: string }>,
  signals?: PersonalMemorySignals,
): Promise<void> {
  const settings = await getMemorySettings();
  if (!settings.enabled || (!settings.automaticPreferenceExtractionEnabled && !settings.automaticInterestExtractionEnabled)) return;
  const profile = await getOrCreatePersonalPreferenceProfile(userId);
  if (!profile.learningEnabled || messages.length < settings.extractionThreshold) return;

  const raw = await createInternalCompletion({
    messages: [
      {
        role: 'system',
        content: `Extract only explicit, durable personal communication, tool-output, artifact-format preferences, or interests. Ignore one-turn instructions, sensitive attributes, and category knowledge. Output JSON only: {"durable":boolean,"preferences":{"preferredLanguage":string|null,"translationLanguage":string|null,"translationMode":"never"|"when_requested"|"always","tone":"default"|"friendly"|"formal"|"direct"|"professional","verbosity":"brief"|"balanced"|"detailed","complexity":"simple"|"standard"|"technical"|"executive","preferredFormat":"auto"|"bullets"|"steps"|"prose"|"table","preferredDiagramFormat":"auto"|"mermaid"|"ascii"|"infographic","preferredDocumentFormat":"auto"|"markdown"|"docx"|"pdf","includeExamples":boolean|null,"includeCitations":boolean|null},"interests":[{"topic":string,"confidence":number}]}. Omit fields not stated.`,
      },
      { role: 'user', content: messages.map((message) => `${message.role}: ${message.content}`).join('\n') },
    ],
    temperature: 0,
    maxTokens: settings.extractionMaxTokens,
    responseFormat: { type: 'json_object' },
  });
  const extracted = parseExtraction(raw);
  const chatToneSignal = signals?.responseTone;

  if (settings.automaticPreferenceExtractionEnabled) {
    if (extracted?.preferences) {
      const preferences = validatePersonalPreferencePatch(extracted.preferences);
      if (preferences.ok) {
        if (settings.inferredPreferencesRequireConfirmation) {
          await upsertPendingPersonalPreferenceCandidates(userId, preferences.value);
        } else {
          await updateInferredPersonalPreferences(userId, preferences.value);
        }
      }
    }

    // Feed the explicit chat-input preset tone as a high-confidence usage
    // signal so inferred preset tone candidates reflect real usage. Custom
    // free-text personas are never inferred; `default`/`custom` are excluded
    // upstream by `resolveChatToneSignal` and re-guarded here. The existing
    // inferred pipeline refuses to overwrite `user_set` fields.
    if (chatToneSignal && isPresetPersonaTone(chatToneSignal)) {
      const validatedTone = validatePersonalPreferencePatch({ tone: chatToneSignal });
      if (validatedTone.ok) {
        if (settings.inferredPreferencesRequireConfirmation) {
          await upsertPendingPersonalPreferenceCandidates(userId, validatedTone.value, 1);
        } else {
          await updateInferredPersonalPreferences(userId, validatedTone.value);
        }
      }
    }
  }

  if (settings.automaticInterestExtractionEnabled) {
    for (const interest of extracted?.interests ?? []) {
      await addPersonalInterest(userId, interest.topic, 'inferred', interest.confidence ?? 0.75, settings.maxInterestsPerUser);
    }
  }
}
