import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { saveUpload, deleteUpload, getThread, getThreadUploadCount } from '@/lib/threads';
import { getUploadLimits } from '@/lib/db/compat';
import { extractWebContent, generateFilenameFromUrl, formatWebContentForIngestion, isTavilyConfigured } from '@/lib/tools/tavily';
import { getYouTubeConfig, extractWithSupadata } from '@/lib/tools/youtube';
import { extractVideoId, isYouTubeUrl as checkYouTubeUrl } from '@/lib/youtube';
import type { UploadResponse, ApiError } from '@/types';

interface RouteParams {
  params: Promise<{ threadId: string }>;
}

// URL upload request body
interface UrlUploadRequest {
  url: string;
  type: 'web' | 'youtube';
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;

    // Verify thread exists and belongs to user
    const thread = await getThread(user.id, threadId);
    if (!thread) {
      return NextResponse.json<ApiError>(
        { error: 'Thread not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Get upload limits and check per-thread limit
    const uploadLimits = await getUploadLimits();
    const currentUploadCount = await getThreadUploadCount(threadId);

    if (uploadLimits.maxFilesPerThread > 0 && currentUploadCount >= uploadLimits.maxFilesPerThread) {
      return NextResponse.json<ApiError>(
        { error: `Thread has reached maximum file limit (${uploadLimits.maxFilesPerThread})`, code: 'THREAD_UPLOAD_LIMIT' },
        { status: 400 }
      );
    }

    // Detect content type to determine if this is a file upload or URL extraction
    const contentType = request.headers.get('content-type') || '';

    // Handle URL extraction (JSON request)
    if (contentType.includes('application/json')) {
      const body = await request.json() as UrlUploadRequest;
      const { url, type } = body;

      if (!url || !type) {
        return NextResponse.json<ApiError>(
          { error: 'URL and type are required', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }

      // Validate URL
      try {
        new URL(url);
      } catch {
        return NextResponse.json<ApiError>(
          { error: 'Invalid URL format', code: 'VALIDATION_ERROR' },
          { status: 400 }
        );
      }

      let content: string;
      let filename: string;
      let title: string | undefined;

      if (type === 'youtube') {
        // Handle YouTube URL
        if (!checkYouTubeUrl(url)) {
          return NextResponse.json<ApiError>(
            { error: 'Invalid YouTube URL', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        const videoId = extractVideoId(url);
        if (!videoId) {
          return NextResponse.json<ApiError>(
            { error: 'Could not extract video ID from URL', code: 'VALIDATION_ERROR' },
            { status: 400 }
          );
        }

        const { config } = await getYouTubeConfig();
        if (!config.apiKey) {
          return NextResponse.json<ApiError>(
            { error: 'YouTube extraction not configured. Contact admin.', code: 'NOT_CONFIGURED' },
            { status: 400 }
          );
        }

        try {
          const result = await extractWithSupadata(videoId, config.apiKey, config.preferredLanguage);

          // Validate transcript is not empty
          if (!result.transcript || result.transcript.trim().length === 0) {
            return NextResponse.json<ApiError>(
              { error: 'No transcript available for this video. The video may not have captions enabled.', code: 'SERVICE_ERROR' },
              { status: 400 }
            );
          }

          content = `Source: YouTube Video\nURL: ${url}\nVideo ID: ${videoId}\nLanguage: ${result.language}\nExtracted: ${new Date().toISOString()}\n\n---\n\n${result.transcript}`;
          filename = `youtube-${Date.now()}-${videoId}.txt`;
          title = `YouTube: ${videoId}`;
        } catch (error) {
          return NextResponse.json<ApiError>(
            { error: error instanceof Error ? error.message : 'Failed to extract YouTube transcript', code: 'SERVICE_ERROR' },
            { status: 500 }
          );
        }
      } else {
        // Handle Web URL
        if (!isTavilyConfigured()) {
          return NextResponse.json<ApiError>(
            { error: 'Web extraction not configured. Contact admin.', code: 'NOT_CONFIGURED' },
            { status: 400 }
          );
        }

        const results = await extractWebContent([url]);
        const result = results[0];

        if (!result || !result.success || !result.content) {
          return NextResponse.json<ApiError>(
            { error: result?.error || 'Failed to extract web content', code: 'SERVICE_ERROR' },
            { status: 500 }
          );
        }

        content = formatWebContentForIngestion(url, result.content);
        filename = generateFilenameFromUrl(url);
        try {
          const urlObj = new URL(url);
          title = urlObj.hostname;
        } catch {
          title = undefined;
        }
      }

      // Save extracted content as text file
      const buffer = Buffer.from(content, 'utf-8');
      const saveResult = await saveUpload(user.id, threadId, filename, buffer);

      return NextResponse.json({
        filename: saveResult.filename,
        size: buffer.length,
        uploadCount: saveResult.uploadCount,
        sourceType: type,
        originalUrl: url,
        title,
      });
    }

    // Handle file upload (multipart form data)
    const maxFileSizeBytes = uploadLimits.maxFileSizeMB * 1024 * 1024;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json<ApiError>(
        { error: 'No file provided', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validate file type against config allowedTypes
    if (!uploadLimits.allowedTypes.includes(file.type)) {
      const allowedExtensions = uploadLimits.allowedTypes
        .map(t => {
          if (t === 'application/pdf') return 'PDF';
          if (t === 'image/png') return 'PNG';
          if (t === 'image/jpeg') return 'JPG';
          if (t === 'text/plain') return 'TXT';
          return t;
        })
        .join(', ');
      return NextResponse.json<ApiError>(
        { error: `Invalid file type. Allowed: ${allowedExtensions}`, code: 'INVALID_FILE_TYPE' },
        { status: 400 }
      );
    }

    // Validate file size
    if (file.size > maxFileSizeBytes) {
      return NextResponse.json<ApiError>(
        { error: `File too large (max ${uploadLimits.maxFileSizeMB}MB)`, code: 'FILE_TOO_LARGE' },
        { status: 413 }
      );
    }

    // Save file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await saveUpload(user.id, threadId, file.name, buffer);

    return NextResponse.json<UploadResponse>({
      filename: result.filename,
      size: file.size,
      uploadCount: result.uploadCount,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json<ApiError>(
      {
        error: error instanceof Error ? error.message : 'Failed to upload file',
        code: 'SERVICE_ERROR',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json<ApiError>(
        { error: 'Unauthorized', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    const { threadId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const filename = searchParams.get('filename');

    if (!filename) {
      return NextResponse.json<ApiError>(
        { error: 'Filename is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const uploadCount = await deleteUpload(user.id, threadId, filename);

    return NextResponse.json({
      success: true,
      filename,
      uploadCount,
    });
  } catch (error) {
    console.error('Delete upload error:', error);
    return NextResponse.json<ApiError>(
      {
        error: error instanceof Error ? error.message : 'Failed to delete file',
        code: 'SERVICE_ERROR',
      },
      { status: 500 }
    );
  }
}
