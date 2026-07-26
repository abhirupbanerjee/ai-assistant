import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

/**
 * Web Share Target handler (Phase 2.3 — mobile UI refresh).
 *
 * Chrome Android's share sheet POSTs to this route with
 * `Content-Type: multipart/form-data` and the fields declared in the
 * manifest `share_target.params`: `title`, `text`, `url`.
 *
 * Behavior:
 *  1. Require an authenticated NextAuth session. Unauthenticated shares are
 *     redirected to the sign-in page with a callback so the share survives
 *     the auth round-trip.
 *  2. Assemble a single composer string from the shared fields (title /
 *     text / url), preferring `text` and appending `url` when distinct.
 *  3. Redirect to `/chat?share=<urlencoded>` so the chat page can prefill
 *     the composer via the `initialDraft` prop chain.
 *
 * Notes:
 *  - We accept `multipart/form-data` (per the manifest enctype) but read it
 *    as `application/x-www-form-urlencoded` too, since some clients send the
 *    latter. `formData()` handles both transparently.
 *  - We never persist anything here — the share becomes a draft the user
 *    reviews and sends.
 */
export async function POST(req: Request) {
  let title = '';
  let text = '';
  let url = '';

  try {
    const form = await req.formData();
    title = (form.get('title') as string | null)?.trim() ?? '';
    text = (form.get('text') as string | null)?.trim() ?? '';
    url = (form.get('url') as string | null)?.trim() ?? '';
  } catch {
    // Malformed body — fall through with empty fields.
  }

  // Assemble a readable draft. Avoid duplicating the URL if it already
  // appears inside `text`.
  const parts: string[] = [];
  if (text) parts.push(text);
  if (url && !text.includes(url)) parts.push(url);
  if (!parts.length && title) parts.push(title); // title-only fallback
  const draft = parts.join('\n\n');

  // Auth check — redirect unauthenticated users to sign-in, preserving the
  // share as a `share` query param so it survives the callback.
  const session = await getServerSession(authOptions);
  const shareParam = draft ? `?share=${encodeURIComponent(draft)}` : '';
  const chatTarget = `/chat${shareParam}`;

  if (!session) {
    const signInUrl = `/auth/signin?callbackUrl=${encodeURIComponent(chatTarget)}`;
    return NextResponse.redirect(new URL(signInUrl, req.url), { status: 303 });
  }

  return NextResponse.redirect(new URL(chatTarget, req.url), { status: 303 });
}

/**
 * GET handler — convenience redirect for manual testing / when a share is
 * invoked without a POST body. Keeps the route from 405-ing on direct hits.
 */
export async function GET() {
  return NextResponse.redirect(new URL('/chat', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'), { status: 302 });
}
