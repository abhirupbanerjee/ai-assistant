/**
 * Drive upload bridge.
 *
 * POST /api/drive/upload
 * Uploads a generated artifact to the authenticated user's Google Drive.
 *
 * Mode A — server-side artifact:
 *   { outputId: number, context: 'thread' | 'workspace', folderName?, folderId?, convertToGoogleFormat? }
 *
 * Mode B — client-rendered artifact:
 *   { filename: string, mimeType: string, contentBase64: string, folderName?, folderId?, convertToGoogleFormat? }
 */

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import { getCurrentUser } from '@/lib/auth';
import { getUserByEmail } from '@/lib/db/compat';
import {
  getThreadOutputById,
  getThreadById,
  userOwnsThread,
  getWorkspaceOutputById,
  canUserAccessWorkspace,
  hasConnectedAccount,
} from '@/lib/db/compat';
import { buildConnectorIdentityHeaders } from '@/lib/connector-identity';
import { fetchWithSsrfGuard, getSsrfAllowedHosts } from '@/lib/ssrf-guard';

export const dynamic = 'force-dynamic';

const CONNECTOR_BASE_URL = process.env.DRIVE_CONNECTOR_URL || 'http://drive-connector:8090';
const MAX_CLIENT_BYTES = 25 * 1024 * 1024; // 25 MB cap for Mode B

interface ThreadOutput {
  id: number;
  thread_id: string;
  filename: string;
  filepath: string;
  file_type: string;
  file_size: number;
}

interface WorkspaceOutput {
  id: number;
  workspace_id: string;
  session_id: string;
  filename: string;
  filepath: string;
  file_type: string;
  file_size: number;
}

const EXT_MIME_MAP: Record<string, string> = {
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  md: 'text/markdown',
  html: 'text/html',
  zip: 'application/zip',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/**
 * Resolve the upload MIME type. Prefer the filename extension (image_gen can
 * emit webp, which a file_type='image' → png mapping would get wrong), then
 * fall back to the coarse file_type mapping.
 */
function mimeForOutput(filename: string, fileType: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext && EXT_MIME_MAP[ext]) return EXT_MIME_MAP[ext];
  switch (fileType) {
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pdf':
      return 'application/pdf';
    case 'image':
      return 'image/png';
    case 'md':
      return 'text/markdown';
    case 'html':
      return 'text/html';
    case 'zip':
      return 'application/zip';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    default:
      return 'application/octet-stream';
  }
}

function connectorError(status: number, error: string, code = 'CONNECTOR_ERROR'): NextResponse {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  const bearerToken = process.env.CONNECTOR_BEARER_TOKEN;
  if (!bearerToken) {
    return NextResponse.json(
      { error: 'Drive connector not configured', code: 'CONNECTOR_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  // Pre-flight: without a connected Google account the connector would fall
  // back to the service-account identity and the file would land in the SA's
  // Drive (inaccessible to the user) — fail fast instead.
  try {
    const connected = await hasConnectedAccount(user.email, 'google');
    if (!connected) {
      return NextResponse.json(
        { error: 'Google account not connected. Connect it in Settings to save to Drive.', code: 'RECONNECT_REQUIRED' },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Failed to verify connected account', code: 'VAULT_ERROR' },
      { status: 500 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  let filename: string;
  let mimeType: string;
  let contentBase64: string;
  let convertToGoogleFormat: boolean | undefined;

  const folderName = typeof body.folderName === 'string' ? body.folderName : undefined;
  const folderId = typeof body.folderId === 'string' ? body.folderId : undefined;

  if ('outputId' in body) {
    // ── Mode A: server-side artifact ────────────────────────────────────────
    const outputId = Number(body.outputId);
    if (Number.isNaN(outputId)) {
      return NextResponse.json(
        { error: 'Invalid outputId', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const context = body.context === 'workspace' ? 'workspace' : 'thread';
    let output: ThreadOutput | WorkspaceOutput | undefined;

    try {
      if (context === 'thread') {
        output = (await getThreadOutputById(outputId)) as ThreadOutput | undefined;
      } else {
        output = (await getWorkspaceOutputById(outputId)) as WorkspaceOutput | undefined;
      }
    } catch {
      return NextResponse.json(
        { error: 'Failed to load output metadata', code: 'DATABASE_ERROR' },
        { status: 500 }
      );
    }

    if (!output) {
      return NextResponse.json(
        { error: 'Output not found', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Ownership / access check.
    const dbUser = await getUserByEmail(user.email);
    if (!dbUser) {
      return NextResponse.json(
        { error: 'User record not found', code: 'AUTH_REQUIRED' },
        { status: 401 }
      );
    }

    if (context === 'thread') {
      const threadOutput = output as ThreadOutput;
      const thread = await getThreadById(threadOutput.thread_id);
      if (!thread) {
        return NextResponse.json(
          { error: 'Thread not found', code: 'NOT_FOUND' },
          { status: 404 }
        );
      }
      const owns = await userOwnsThread(dbUser.id, threadOutput.thread_id);
      if (!owns) {
        return NextResponse.json(
          { error: 'Access denied', code: 'ACCESS_DENIED' },
          { status: 403 }
        );
      }
    } else {
      const wsOutput = output as WorkspaceOutput;
      const canAccess = await canUserAccessWorkspace(dbUser.id, wsOutput.workspace_id);
      if (!canAccess) {
        return NextResponse.json(
          { error: 'Access denied', code: 'ACCESS_DENIED' },
          { status: 403 }
        );
      }
    }

    if (!fs.existsSync(output.filepath)) {
      return NextResponse.json(
        { error: 'Output file not found on server', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const buf = fs.readFileSync(output.filepath);
    filename = output.filename;
    mimeType = mimeForOutput(output.filename, output.file_type);
    contentBase64 = buf.toString('base64');
    convertToGoogleFormat = body.convertToGoogleFormat as boolean | undefined;
  } else {
    // ── Mode B: client-rendered bytes ───────────────────────────────────────
    if (
      typeof body.filename !== 'string' ||
      typeof body.mimeType !== 'string' ||
      typeof body.contentBase64 !== 'string'
    ) {
      return NextResponse.json(
        { error: 'Missing filename, mimeType, or contentBase64', code: 'VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    const raw = Buffer.from(body.contentBase64, 'base64');
    if (raw.length > MAX_CLIENT_BYTES) {
      return NextResponse.json(
        { error: 'Payload exceeds 25 MB limit', code: 'PAYLOAD_TOO_LARGE' },
        { status: 413 }
      );
    }

    filename = body.filename;
    mimeType = body.mimeType;
    contentBase64 = body.contentBase64;
    convertToGoogleFormat = body.convertToGoogleFormat as boolean | undefined;
  }

  const payload: Record<string, unknown> = {
    filename,
    mimeType,
    contentBase64,
  };
  if (folderName !== undefined) payload.folderName = folderName;
  if (folderId !== undefined) payload.folderId = folderId;
  if (convertToGoogleFormat !== undefined) payload.convertToGoogleFormat = convertToGoogleFormat;

  const url = `${CONNECTOR_BASE_URL}/drive_upload_file`;
  const allowedHosts = getSsrfAllowedHosts();

  try {
    const { response } = await fetchWithSsrfGuard(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bearerToken}`,
          ...buildConnectorIdentityHeaders(user.email),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60_000),
      },
      { allowedHosts }
    );

    const data = (await response.json()) as {
      ok: boolean;
      data?: { fileId: string; name: string; mimeType: string; webViewLink?: string };
      error?: string;
      code?: string;
      status?: number;
    };

    if (!response.ok || !data.ok) {
      const code = data.code || 'CONNECTOR_ERROR';
      // Log the raw connector code before mapping — this is what distinguishes
      // a stale-scope 403 from a vault-fallback or a genuine Drive failure.
      console.warn('[drive/upload] connector error', { code, status: data.status ?? response.status });
      const status =
        code === 'RECONNECT_REQUIRED' || code === 'INSUFFICIENT_SCOPE'
          ? 401
          : data.status && data.status >= 400
            ? data.status
            : response.status || 502;
      return connectorError(status, data.error || 'Drive upload failed', code);
    }

    return NextResponse.json({
      success: true,
      fileId: data.data?.fileId,
      name: data.data?.name,
      mimeType: data.data?.mimeType,
      webViewLink: data.data?.webViewLink,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to upload to Google Drive',
        code: 'CONNECTOR_ERROR',
      },
      { status: 502 }
    );
  }
}
