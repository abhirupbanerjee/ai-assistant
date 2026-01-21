import { NextAuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import GoogleProvider from 'next-auth/providers/google';
import { isUserAllowed, getUserRole } from './users';

// Access control mode: 'allowlist' (specific users) or 'domain' (any user from allowed domains)
const ACCESS_MODE = process.env.ACCESS_MODE || 'allowlist';

const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || 'abhirup.app,gov.gd')
  .split(',')
  .map(d => d.trim().toLowerCase());

export const authOptions: NextAuthOptions = {
  // @ts-expect-error - trustHost is supported in runtime but not in v4 types yet
  trustHost: true, // Trust X-Forwarded-* headers from Traefik reverse proxy
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID || '',
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET || '',
      tenantId: process.env.AZURE_AD_TENANT_ID || 'common',
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (process.env.AUTH_DISABLED === 'true') {
        return true;
      }

      const email = user.email || '';

      if (ACCESS_MODE === 'allowlist') {
        // Check if user is in the allowlist
        const allowed = await isUserAllowed(email);
        if (!allowed) {
          return '/auth/error?error=AccessDenied';
        }
        return true;
      }

      // Domain-based access control
      const domain = email.split('@')[1];
      if (!domain || !ALLOWED_DOMAINS.includes(domain.toLowerCase())) {
        return '/auth/error?error=AccessDenied';
      }

      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const role = await getUserRole(user.email);
        token.role = role || 'user';
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
};
