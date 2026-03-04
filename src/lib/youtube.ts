/**
 * YouTube Transcript Extraction Module
 *
 * Tiered approach:
 * 1. Primary: Supadata API (reliable, requires API key from supadata.ai)
 * 2. Fallback: youtube-transcript npm package (free, may be blocked by YouTube)
 */

import { YoutubeTranscript } from 'youtube-transcript';
import {
  getYouTubeConfig,
  extractWithSupadata,
  isSupadataConfigured,
} from './tools/youtube';

// ============ Types ============

export interface YouTubeVideoInfo {
  videoId: string;
  title: string;
  channelTitle: string;
  description: string;
  publishedAt: string;
  duration: string;
}

export interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export interface YouTubeExtractResult {
  success: boolean;
  videoId: string;
  source?: 'supadata' | 'youtube-transcript';
  videoInfo?: YouTubeVideoInfo;
  transcript?: string;
  segments?: TranscriptSegment[];
  error?: string;
}

// ============ URL Parsing ============

/**
 * Extract video ID from various YouTube URL formats
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Check if URL is a YouTube URL
 */
export function isYouTubeUrl(url: string): boolean {
  return /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//.test(url) ||
         /^[a-zA-Z0-9_-]{11}$/.test(url);
}

/**
 * Check if YouTube extraction is configured (Supadata API key)
 * Re-exported for backward compatibility
 */
export async function isYouTubeApiConfigured(): Promise<boolean> {
  return await isSupadataConfigured();
}

// ============ Supadata API (Primary) ============

/**
 * Try to get transcript using Supadata API
 */
async function trySupadataApi(videoId: string): Promise<YouTubeExtractResult | null> {
  const { config } = await getYouTubeConfig();

  if (!config.apiKey) {
    return null;
  }

  try {
    const result = await extractWithSupadata(
      videoId,
      config.apiKey,
      config.preferredLanguage
    );

    return {
      success: true,
      videoId,
      source: 'supadata',
      transcript: result.transcript,
    };
  } catch (error) {
    console.warn('Supadata API failed:', error);
    return null;
  }
}

// ============ youtube-transcript npm (Fallback) ============

/**
 * Try to get transcript using youtube-transcript npm package
 */
async function tryYouTubeTranscriptNpm(videoId: string): Promise<YouTubeExtractResult | null> {
  const { config } = await getYouTubeConfig();

  // Check if fallback is enabled
  if (!config.fallbackEnabled) {
    return null;
  }

  try {
    const transcriptItems = await YoutubeTranscript.fetchTranscript(videoId);

    if (!transcriptItems || transcriptItems.length === 0) {
      return null;
    }

    // Convert to our format
    const segments: TranscriptSegment[] = transcriptItems.map(item => ({
      text: item.text,
      offset: item.offset,
      duration: item.duration,
    }));

    // Combine into full transcript
    const transcript = segments.map(s => s.text).join(' ');

    return {
      success: true,
      videoId,
      source: 'youtube-transcript',
      transcript,
      segments,
    };
  } catch (error) {
    console.warn('youtube-transcript npm failed:', error);
    return null;
  }
}

// ============ Main Extraction Function ============

/**
 * Extract YouTube video transcript using tiered approach
 *
 * Primary: Supadata API (reliable, requires API key)
 * Fallback: youtube-transcript npm package (free, may be blocked)
 */
export async function extractYouTubeTranscript(url: string): Promise<YouTubeExtractResult> {
  const videoId = extractVideoId(url);

  if (!videoId) {
    return {
      success: false,
      videoId: '',
      error: 'Invalid YouTube URL or video ID',
    };
  }

  const { config } = await getYouTubeConfig();

  // Primary: Try Supadata API
  const supadataResult = await trySupadataApi(videoId);
  if (supadataResult) {
    return supadataResult;
  }

  // Fallback: Try youtube-transcript npm package
  const npmResult = await tryYouTubeTranscriptNpm(videoId);
  if (npmResult) {
    return npmResult;
  }

  // Both failed - provide helpful error message
  const errorMessage = config.apiKey
    ? 'Failed to extract transcript from this video'
    : 'YouTube extraction requires Supadata API key. Configure in Admin > Tools > YouTube.';

  return {
    success: false,
    videoId,
    error: errorMessage,
  };
}

// ============ Formatting for Ingestion ============

/**
 * Format transcript with metadata for document ingestion
 */
export function formatTranscriptForIngestion(result: YouTubeExtractResult): string {
  if (!result.success || !result.transcript) {
    throw new Error(result.error || 'No transcript available');
  }

  const lines: string[] = [];

  lines.push('Source: YouTube Video');
  lines.push(`Video ID: ${result.videoId}`);
  lines.push(`URL: https://www.youtube.com/watch?v=${result.videoId}`);
  lines.push(`Extraction Method: ${result.source}`);

  if (result.videoInfo) {
    lines.push(`Title: ${result.videoInfo.title}`);
    lines.push(`Channel: ${result.videoInfo.channelTitle}`);
    lines.push(`Published: ${result.videoInfo.publishedAt}`);
    lines.push(`Duration: ${result.videoInfo.duration}`);
  }

  lines.push(`Extracted: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('TRANSCRIPT:');
  lines.push('');
  lines.push(result.transcript);

  return lines.join('\n');
}
