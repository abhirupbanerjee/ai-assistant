import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { transcribeAudio, getActiveMaxFileSize } from '@/lib/stt';
import type { TranscribeResponse, ApiError } from '@/types';

const ALLOWED_TYPES = [
  'audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/wav',
  'audio/m4a', 'audio/mp4', 'audio/ogg', 'audio/flac',
];

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File | null;

    if (!audioFile) {
      return NextResponse.json<ApiError>(
        { error: 'No audio file provided', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(audioFile.type)) {
      return NextResponse.json<ApiError>(
        { error: 'Invalid audio format. Supported: webm, mp3, wav, m4a, ogg, flac', code: 'INVALID_FILE_TYPE' },
        { status: 400 }
      );
    }

    // Validate file size (dynamic based on active provider)
    const maxSize = await getActiveMaxFileSize();
    if (audioFile.size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      return NextResponse.json<ApiError>(
        { error: `File too large (max ${maxMB}MB)`, code: 'FILE_TOO_LARGE' },
        { status: 413 }
      );
    }

    // Convert to buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Transcribe with route-based fallback
    const { text, duration, provider } = await transcribeAudio(buffer, audioFile.name);

    return NextResponse.json<TranscribeResponse>({ text, duration, provider });
  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json<ApiError>(
      {
        error: 'Transcription failed',
        code: 'SERVICE_ERROR',
        details: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
