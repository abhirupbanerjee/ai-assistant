/**
 * Podcast Generation Tool Types
 *
 * Types for generating audio podcasts from text content using TTS providers.
 */

// ===== Provider Types =====

export type TTSProvider = 'openai' | 'gemini';

export type PodcastStyle = 'formal' | 'conversational' | 'news';

export type PodcastLength = 'short' | 'medium' | 'long';

export type AudioFormat = 'mp3' | 'wav';

// All 13 gpt-4o-mini-tts voices (marin and cedar are best quality)
export type OpenAIVoice =
  | 'marin' | 'cedar'  // Best quality (recommended)
  | 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable'
  | 'nova' | 'onyx' | 'sage' | 'shimmer' | 'verse';

// Gemini TTS models (preview)
export type GeminiTTSModel = 'gemini-2.5-flash-preview-tts' | 'gemini-2.5-pro-preview-tts';

// Gemini TTS voices (30 available)
export type GeminiVoice =
  | 'Zephyr' | 'Puck' | 'Charon' | 'Kore' | 'Fenrir'
  | 'Leda' | 'Orus' | 'Aoede' | 'Callirrhoe' | 'Autonoe'
  | 'Enceladus' | 'Iapetus' | 'Umbriel' | 'Algieba' | 'Despina'
  | 'Erinome' | 'Algenib' | 'Rasalgethi' | 'Laomedeia' | 'Achernar'
  | 'Alnilam' | 'Schedar' | 'Gacrux' | 'Pulcherrima' | 'Achird'
  | 'Zubenelgenubi' | 'Vindemiatrix' | 'Sadachbia' | 'Sadaltager' | 'Sulafat';

// Gemini voice personality descriptions
export const GEMINI_VOICE_INFO: Record<GeminiVoice, { description: string; category: 'conversational' | 'informative' | 'expressive' }> = {
  Zephyr: { description: 'Bright', category: 'expressive' },
  Puck: { description: 'Upbeat', category: 'conversational' },
  Charon: { description: 'Informative', category: 'informative' },
  Kore: { description: 'Firm', category: 'informative' },
  Fenrir: { description: 'Excitable', category: 'expressive' },
  Leda: { description: 'Youthful', category: 'conversational' },
  Orus: { description: 'Firm', category: 'informative' },
  Aoede: { description: 'Breezy', category: 'conversational' },
  Callirrhoe: { description: 'Easy-going', category: 'conversational' },
  Autonoe: { description: 'Bright', category: 'expressive' },
  Enceladus: { description: 'Breathy', category: 'expressive' },
  Iapetus: { description: 'Clear', category: 'informative' },
  Umbriel: { description: 'Easy-going', category: 'conversational' },
  Algieba: { description: 'Smooth', category: 'conversational' },
  Despina: { description: 'Smooth', category: 'conversational' },
  Erinome: { description: 'Clear', category: 'informative' },
  Algenib: { description: 'Gravelly', category: 'expressive' },
  Rasalgethi: { description: 'Informative', category: 'informative' },
  Laomedeia: { description: 'Upbeat', category: 'conversational' },
  Achernar: { description: 'Soft', category: 'expressive' },
  Alnilam: { description: 'Firm', category: 'informative' },
  Schedar: { description: 'Even', category: 'informative' },
  Gacrux: { description: 'Mature', category: 'informative' },
  Pulcherrima: { description: 'Forward', category: 'expressive' },
  Achird: { description: 'Friendly', category: 'conversational' },
  Zubenelgenubi: { description: 'Casual', category: 'conversational' },
  Vindemiatrix: { description: 'Gentle', category: 'expressive' },
  Sadachbia: { description: 'Lively', category: 'expressive' },
  Sadaltager: { description: 'Knowledgeable', category: 'informative' },
  Sulafat: { description: 'Warm', category: 'conversational' },
};

// ===== Provider Configuration Types =====

export interface OpenAITTSConfig {
  enabled: boolean;
  model: 'gpt-4o-mini-tts';  // Single model only
  voice: OpenAIVoice;
  speed: number; // 0.25 to 4.0
  instructions?: string;  // Voice style control
}

// Gemini TTS configuration
export interface GeminiTTSConfig {
  enabled: boolean;
  model: GeminiTTSModel;
  multiSpeaker: boolean;
  /** Voice for host speaker in multi-speaker mode */
  hostVoice: GeminiVoice;
  /** Voice for expert speaker in multi-speaker mode */
  expertVoice: GeminiVoice;
  /** Optional accent for host (e.g., "British English from London") */
  hostAccent?: string;
  /** Optional accent for expert (e.g., "American English from New York") */
  expertAccent?: string;
}

// ===== Main Tool Configuration =====

export interface PodcastGenConfig {
  /** Active TTS provider: 'openai' or 'none' to disable */
  activeProvider: TTSProvider | 'none';

  /** Provider-specific configurations */
  providers: {
    openai: OpenAITTSConfig;
    gemini: GeminiTTSConfig;
  };

  /** Default podcast style */
  defaultStyle: PodcastStyle;

  /** Default podcast length */
  defaultLength: PodcastLength;

  /** Output audio format */
  outputFormat: AudioFormat;

  /** Days until generated podcasts expire (0 = never) */
  expirationDays: number;
}

// ===== Tool Arguments (from LLM function call) =====

export interface PodcastGenToolArgs {
  /** Topic/title for the podcast */
  topic: string;

  /** Content to convert to audio */
  content: string;

  /** Optional: Override default style */
  style?: PodcastStyle;

  /** Optional: Override default length */
  length?: PodcastLength;
}

// ===== Length Configuration =====

export const LENGTH_CONFIG: Record<PodcastLength, { words: number; minutes: string }> = {
  short: { words: 250, minutes: '1-2' },
  medium: { words: 600, minutes: '3-5' },
  long: { words: 1200, minutes: '8-10' },
};

// ===== Style Descriptions =====

export const STYLE_DESCRIPTIONS: Record<PodcastStyle, string> = {
  formal: 'Professional and authoritative, suitable for official communications',
  conversational: 'Friendly and approachable, as if explaining to a colleague',
  news: 'Clear and objective, like a news broadcast or report',
};

// ===== Generated Podcast Result =====

export interface GeneratedPodcast {
  /** Unique podcast ID */
  id: string;
  /** Filename on disk */
  filename: string;
  /** Full filepath */
  filepath: string;
  /** File size in bytes */
  fileSize: number;
  /** Duration in seconds */
  duration: number;
  /** Audio format */
  format: AudioFormat;
  /** Provider used */
  provider: TTSProvider;
  /** Model used */
  model: string;
  /** Voice used */
  voice: string;
  /** Generation timestamp */
  generatedAt: string;
  /** Download URL */
  downloadUrl: string;
  /** Stream URL */
  streamUrl: string;
  /** Expiration timestamp (null = never) */
  expiresAt: string | null;
}

// ===== Podcast Hint (for frontend rendering) =====

export interface PodcastHint {
  /** Podcast ID for tracking */
  id: string;
  /** Filename for display */
  filename: string;
  /** Duration in seconds */
  duration: number;
  /** Audio format */
  format: AudioFormat;
  /** Download URL */
  downloadUrl: string;
  /** Stream URL */
  streamUrl: string;
}

// ===== Tool Response Types =====

export interface PodcastGenResponse {
  /** Whether generation succeeded */
  success: boolean;
  /** Status message for LLM context */
  message?: string;
  /** Podcast hint for frontend rendering */
  podcastHint?: PodcastHint;
  /** Generation metadata */
  metadata?: {
    provider: TTSProvider;
    model: string;
    voice: string;
    style: PodcastStyle;
    length: PodcastLength;
    processingTimeMs: number;
  };
  /** Error information */
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

// ===== Formatter Types =====

export interface FormatterConfig {
  style: PodcastStyle;
  length: PodcastLength;
}

export interface FormatterResult {
  /** Formatted script ready for TTS */
  script: string;
  /** Estimated duration in seconds */
  estimatedDuration: number;
  /** Word count of the script */
  wordCount: number;
}

// ===== Podcast Metadata (stored in thread_outputs.metadata_json) =====

export interface PodcastMetadata {
  duration: number;
  format: AudioFormat;
  provider: TTSProvider;
  model: string;
  voice: string;
  style: PodcastStyle;
  length: PodcastLength;
  wordCount: number;
  expiresAt: string | null;
}
