/**
 * Podcast Generation Tool Types
 *
 * Types for generating audio podcasts from text content using TTS providers.
 */

// ===== Provider Types =====

export type TTSProvider = 'openai';

export type PodcastStyle = 'formal' | 'conversational' | 'news';

export type PodcastLength = 'short' | 'medium' | 'long';

export type AudioFormat = 'mp3';

export type OpenAIVoice = 'alloy' | 'echo' | 'fable' | 'nova' | 'onyx' | 'shimmer';

// ===== Provider Configuration Types =====

export interface OpenAITTSConfig {
  enabled: boolean;
  model: 'tts-1' | 'tts-1-hd';
  voice: OpenAIVoice;
  speed: number; // 0.25 to 4.0
}

// ===== Main Tool Configuration =====

export interface PodcastGenConfig {
  /** Active TTS provider: 'openai' or 'none' to disable */
  activeProvider: TTSProvider | 'none';

  /** Provider-specific configurations */
  providers: {
    openai: OpenAITTSConfig;
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
