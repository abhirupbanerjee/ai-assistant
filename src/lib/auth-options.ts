import { NextAuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { isUserAllowed, getUserRole } from './users';
import { getUserByEmail, canLoginWithCredentials } from './db/users';
import { getCredentialsAuthSettings } from './db/config';
import { verifyPassword } from './password';

// Access control mode: 'allowlist' (specific users) or 'domain' (any user from allowed domains)
const ACCESS_MODE = process.env.ACCESS_MODE || 'allowlist';

const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || 'abhirup.app,gov.gd')
  .split(',')
  .map((d) => d.trim().toLowerCase());

/**
 * Build NextAuth options dynamically
 * This allows us to conditionally include providers based on settings
 */
export function getAuthOptions(): NextAuthOptions {
  const credentialsSettings = getCredentialsAuthSettings();

  // Build providers array dynamically
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providers: any[] = [];

  // Add OAuth providers only if configured
  if (process.env.AZURE_AD_CLIENT_ID) {
    providers.push(
      AzureADProvider({
        clientId: process.env.AZURE_AD_CLIENT_ID,
        clientSecret: process.env.AZURE_AD_CLIENT_SECRET || '',
        tenantId: process.env.AZURE_AD_TENANT_ID || 'common',
      })
    );
  }

  if (process.env.GOOGLE_CLIENT_ID) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      })
    );
  }

  // Add Credentials provider if enabled (default: true)
  if (credentialsSettings.enabled) {
    providers.push(
      CredentialsProvider({
        id: 'credentials',
        name: 'Email',
        credentials: {
          email: { label: 'Email', type: 'email', placeholder: 'admin@example.com' },
          password: { label: 'Password', type: 'password' },
        },
        async authorize(credentials) {
          if (!credentials?.email || !credentials?.password) {
            return null;
          }

          const email = credentials.email.toLowerCase();

          // Check if user exists and has credentials enabled
          if (!canLoginWithCredentials(email)) {
            return null;
          }

          const user = getUserByEmail(email);
          if (!user || !user.password_hash) {
            return null;
          }

          // Verify password
          const isValid = await verifyPassword(credentials.password, user.password_hash);
          if (!isValid) {
            return null;
          }

          // Return user object for NextAuth
          return {
            id: String(user.id),
            email: user.email,
            name: user.name || user.email,
          };
        },
      })
    );
  }

  return {
    // @ts-expect-error - trustHost is supported in runtime but not in v4 types yet
    trustHost: true, // Trust X-Forwarded-* headers from Traefik reverse proxy
    providers,
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
}

// Export static authOptions for backward compatibility
// Note: This is evaluated at module load time, so credentials settings
// changes require a server restart to take effect
export const authOptions: NextAuthOptions = getAuthOptions();
