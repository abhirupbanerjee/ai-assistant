/**
 * Canonical response-style model.
 *
 * This module is the single source of truth for the persona/tone + verbosity
 * axes used by the `<response_style>` system-prompt block, plus the server-side
 * legacy → new mapping for the old chat-selector vocabulary. It contains no
 * database access and no UI imports so it can be shared safely across the
 * request boundary, memory resolution, prompt assembly, and cache-key building.
 */

export const PERSONA_TONES = ['default', 'friendly', 'formal', 'direct', 'professional', 'custom'] as const;
export type PersonaTone = (typeof PERSONA_TONES)[number];

export const VERBOSITY_LEVELS = ['brief', 'balanced', 'detailed'] as const;
export type Verbosity = (typeof VERBOSITY_LEVELS)[number];

/**
 * Canonical persona tones that are eligible for preference inference from an
 * explicit chat-input selection. `default` (no preference) and `custom`
 * (user-authored free-text, never inferred) are deliberately excluded.
 */
export const PRESET_PERSONA_TONES = ['friendly', 'formal', 'direct', 'professional'] as const;
export type PresetPersonaTone = (typeof PRESET_PERSONA_TONES)[number];

/**
 * Display labels for the canonical axes. Shared by the chat-input selector,
 * inline chips, and the profile Persona editor so no UI reintroduces its own
 * label vocabulary.
 */
export const PERSONA_TONE_LABELS: Readonly<Record<PersonaTone, string>> = {
  default: 'Default',
  friendly: 'Friendly',
  formal: 'Formal',
  direct: 'Direct',
  professional: 'Professional',
  custom: 'Custom',
};

export const VERBOSITY_LABELS: Readonly<Record<Verbosity, string>> = {
  brief: 'Brief',
  balanced: 'Balanced',
  detailed: 'Detailed',
};

/**
 * The resolved response style for a single turn. `customName` and
 * `customInstruction` are only populated when the tone resolves to `custom`.
 */
export interface ResolvedResponseStyle {
  tone: PersonaTone;
  verbosity: Verbosity;
  customName: string | null;
  customInstruction: string | null;
}

export interface LegacyToneMapping {
  tone: PersonaTone;
  verbosity?: Verbosity;
  customName?: string;
  customInstruction?: string;
}

/**
 * Legacy chat-selector values that are not part of the canonical persona enum.
 *
 * `default` and `formal` are already canonical persona tones and are therefore
 * handled by `isPersonaTone` rather than mapped here.
 */
export const LEGACY_TONE_MAP: Readonly<Record<string, LegacyToneMapping>> = {
  concise: { tone: 'default', verbosity: 'brief' },
  detailed: { tone: 'default', verbosity: 'detailed' },
  explanatory: {
    tone: 'custom',
    customName: 'Explanatory',
    customInstruction: 'Explain concepts clearly with context and background. Break down complex topics into understandable parts.',
  },
  creative: {
    tone: 'custom',
    customName: 'Creative',
    customInstruction: 'Use engaging, creative language while maintaining accuracy. Make the response interesting and memorable.',
  },
};

export function isPersonaTone(value: string): value is PersonaTone {
  return (PERSONA_TONES as readonly string[]).includes(value);
}

export function isPresetPersonaTone(value: string): value is PresetPersonaTone {
  return (PRESET_PERSONA_TONES as readonly string[]).includes(value);
}

export function isVerbosity(value: string): value is Verbosity {
  return (VERBOSITY_LEVELS as readonly string[]).includes(value);
}

export function isLegacyResponseTone(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_TONE_MAP, value);
}

export function mapLegacyResponseTone(value: string): LegacyToneMapping | null {
  return isLegacyResponseTone(value) ? LEGACY_TONE_MAP[value] : null;
}

/** Trim a value to a non-empty string, or `null` when empty/whitespace. */
export function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Assemble the single delimited `<response_style>` block from the resolved
 * fields. The block is appended to the system prompt AFTER grounding content.
 */
export function formatResponseStyleBlock(style: ResolvedResponseStyle): string {
  const lines = ['<response_style>', `Tone: ${style.tone}`, `Length: ${style.verbosity}`];
  if (style.customInstruction) {
    lines.push(`Custom: ${style.customInstruction}`);
  }
  lines.push("Unless the user's current message explicitly overrides this, follow it.");
  lines.push('</response_style>');
  return lines.join('\n');
}

/**
 * Stable, delimiter-joined serialization used as the cache-key discriminator so
 * differently-styled responses are never served from the response cache.
 */
export function serializeResponseStyle(style: ResolvedResponseStyle): string {
  return [style.tone, style.verbosity, style.customName ?? '', style.customInstruction ?? ''].join('\u001f');
}
