/**
 * GET /api/browser-sessions/[id]/stream — SSE stream of screenshot frames + state.
 *
 * Proxies the worker's SSE stream, re-emitting each event with `sessionId`
 * attached so the client can key frames to the right panel.
 */

import { NextRequest } from 'next/server';
import { getSSEHeaders } from '@/lib/streaming';
import { requireOwnedSession, toErrorResponse } from '../../_helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    await requireOwnedSession(id);
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const workerUrl = (process.env.BROWSER_WORKER_URL || '').replace(/\/+$/, '');
  const secret = process.env.BROWSER_WORKER_SHARED_SECRET || '';

  if (!workerUrl || !secret) {
    return new Response(
      JSON.stringify({ error: 'Browser worker is not configured', code: 'BROWSER_NOT_CONFIGURED' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const upstream = await fetch(
    `${workerUrl}/sessions/${encodeURIComponent(id)}/stream`,
    { headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store' }
  );

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ error: 'Worker stream unavailable', code: 'SERVICE_ERROR' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const upstreamBody = upstream.body;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamBody.getReader();
      let buffer = '';

      const pushLine = (line: string): void => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.startsWith(':')) {
          controller.enqueue(encoder.encode(`${trimmed}\n\n`)); // keep-alive comment
          return;
        }
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice('data:'.length).trim();
        try {
          const event = JSON.parse(payload) as Record<string, unknown>;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ ...event, sessionId: id })}\n\n`)
          );
        } catch {
          /* skip malformed frame */
        }
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) pushLine(part);
        }
        if (buffer) pushLine(buffer);
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      void upstreamBody.cancel();
    },
  });

  return new Response(stream, { headers: getSSEHeaders() });
}
