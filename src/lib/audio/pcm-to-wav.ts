/**
 * PCM to WAV conversion
 *
 * Gemini TTS outputs raw PCM (24kHz, 16-bit, mono).
 * This adds a 44-byte WAV header to make it playable.
 *
 * WAV is universally supported across all platforms.
 * Trade-off: ~3x larger than MP3, but zero encoding complexity.
 */

import { Readable } from 'stream';

// Type definitions for wav package
interface WavWriterOptions {
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

interface WavWriter extends NodeJS.WritableStream {
  on(event: 'data', listener: (chunk: Buffer) => void): this;
  on(event: 'end', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

interface WavModule {
  Writer: new (options: WavWriterOptions) => WavWriter;
}

export interface PCMOptions {
  sampleRate: number;  // 24000 for Gemini TTS
  channels: number;    // 1 (mono)
  bitDepth: number;    // 16
}

/**
 * Default options for Gemini TTS PCM output
 */
export const GEMINI_TTS_PCM_OPTIONS: PCMOptions = {
  sampleRate: 24000,
  channels: 1,
  bitDepth: 16,
};

/**
 * Convert raw PCM audio data to WAV format
 *
 * @param pcmBuffer - Raw PCM audio data from Gemini TTS
 * @param options - PCM format options (sample rate, channels, bit depth)
 * @returns WAV formatted audio buffer
 */
export async function pcmToWav(pcmBuffer: Buffer, options: PCMOptions = GEMINI_TTS_PCM_OPTIONS): Promise<Buffer> {
  // Dynamic import for wav module
  const wavModule = await import('wav') as WavModule;
  const { Writer } = wavModule;

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const writer = new Writer({
      sampleRate: options.sampleRate,
      channels: options.channels,
      bitDepth: options.bitDepth,
    });

    writer.on('data', (chunk: Buffer) => chunks.push(chunk));
    writer.on('end', () => resolve(Buffer.concat(chunks)));
    writer.on('error', reject);

    // Pipe PCM data through WAV writer
    const readable = Readable.from(pcmBuffer);
    readable.pipe(writer);
  });
}

/**
 * Estimate WAV file size from PCM buffer
 * WAV adds 44-byte header + raw PCM data
 */
export function estimateWavSize(pcmBuffer: Buffer): number {
  return pcmBuffer.length + 44;
}

/**
 * Estimate duration in seconds from PCM buffer
 */
export function estimateDurationFromPCM(pcmBuffer: Buffer, options: PCMOptions = GEMINI_TTS_PCM_OPTIONS): number {
  const bytesPerSample = options.bitDepth / 8;
  const bytesPerSecond = options.sampleRate * options.channels * bytesPerSample;
  return pcmBuffer.length / bytesPerSecond;
}
