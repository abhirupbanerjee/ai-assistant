/**
 * Internal Mermaid diagram render endpoint (Phase 3).
 *
 * POST { code: string } → { svg: string } | { error: string, code: string }
 *
 * Reuses the self-hosted Playwright + bundled mermaid.min.js pipeline from
 * server-renderer.ts. Air-gap safe — NO external egress (mermaid.ink/pako
 * dropped per user constraint). This is the fallback when client-side
 * mermaid.render() fails.
 *
 * Auth: requires an authenticated session (NOT in the middleware public-routes
 * exclusion list). Diagrams are small, but we size-cap the input to guard
 * against abuse.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { renderMermaidToSvg } from '@/lib/docgen/html/server-renderer';
import { sanitizeMermaidCode } from '@/lib/diagram-gen/validator';
import { detectDiagramType } from '@/lib/diagram-gen/validator';

const MAX_CODE_BYTES = 100_000; // 100 KB — diagrams are small; cap abuse surface

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'AUTH_REQUIRED' },
      { status: 401 }
    );
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  const rawCode = body.code;
  if (typeof rawCode !== 'string' || rawCode.length === 0) {
    return NextResponse.json(
      { error: 'Missing or invalid "code" field', code: 'VALIDATION_ERROR' },
      { status: 400 }
    );
  }

  if (Buffer.byteLength(rawCode, 'utf-8') > MAX_CODE_BYTES) {
    return NextResponse.json(
      { error: `Diagram code exceeds ${MAX_CODE_BYTES} byte limit`, code: 'VALIDATION_ERROR' },
      { status: 413 }
    );
  }

  // Sanitize before rendering (same pipeline as diagram_gen output).
  const code = sanitizeMermaidCode(rawCode);
  const diagramType = detectDiagramType(code);

  const svg = await renderMermaidToSvg(code);

  if (!svg) {
    // Phase 7 telemetry — server-side fallback render failure.
    logger.warn('[DiagramRender] server fallback failed', { diagramType });
    return NextResponse.json(
      { error: 'Server-side render failed (Playwright unavailable or diagram invalid)', code: 'RENDER_FAILED' },
      { status: 422 }
    );
  }

  // Phase 7 telemetry — server-side fallback render success.
  logger.info('[DiagramRender] server fallback succeeded', { diagramType, svgBytes: svg.length });
  return NextResponse.json({ svg });
}
