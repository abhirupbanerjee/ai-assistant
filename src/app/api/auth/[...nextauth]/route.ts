import NextAuth from 'next-auth';
import { getAuthOptions } from '@/lib/auth-options';
import type { NextRequest } from 'next/server';

// Use a per-request handler so credentials settings are read from the correct
// DB provider (Postgres or SQLite) on each request rather than once at module load.
// In Next.js 15, params is a Promise — resolve it before passing to NextAuth v4
// which reads params.nextauth synchronously to determine the endpoint.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handler(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> | { nextauth: string[] } }) {
  const authOptions = await getAuthOptions();
  const params = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (NextAuth(authOptions) as any)(req, { params });
}

export { handler as GET, handler as POST };
