import { NextAuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import { isUserAllowed, getUserRole } from './users';
import { getUserByEmail, canLoginWithCredentials, getCredentialsAuthSettings, initializeAdminsFromEnv, initializeAdminCredentialsFromEnv } from './db/compat';
import { verifyPassword } from './password';

// Trigger user initialization at module load time
// This ensures admin users are created before auth routes are accessed
(async () => {
  try {
    await initializeAdminsFromEnv();
    await initializeAdminCredentialsFromEnv();
  } catch (err) {
    console.error('[Auth] Failed to initialize users:', err);
  }
})();

// Access control mode: 'allowlist' (specific users) or 'domain' (any user from allowed domains)
const ACCESS_MODE = process.env.ACCESS_MODE || 'allowlist';

const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || 'abhirup.app,gov.gd')
  .split(',')
  .map((d) => d.trim().toLowerCase());

// Callbacks typed via NextAuthOptions so inference is correct.
// Used by both getAuthOptions() and the static authOptions export.
// getServerSession() only needs callbacks/pages to verify the JWT; it doesn't need providers.
const callbacks: NextAuthOptions['callbacks'] = {
  async signIn({ user }) {
    if (process.env.AUTH_DISABLED === 'true') {
      return true;
    }

    const email = user.email || '';

    if (ACCESS_MODE === 'allowlist') {
      const allowed = await isUserAllowed(email);
      if (!allowed) {
        return '/auth/error?error=AccessDenied';
      }
      return true;
    }

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
};

const pages: NextAuthOptions['pages'] = {
  signIn: '/auth/signin',
  error: '/auth/error',
};

/**
 * Build NextAuth options dynamically (async).
 * Reads credentials settings from the compat layer so Postgres mode works correctly.
 * Called per-request in the NextAuth route handler.
 */
export async function getAuthOptions(): Promise<NextAuthOptions> {
  const credentialsSettings = await getCredentialsAuthSettings();

  // Build providers array dynamically
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providers: any[] = [];

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

          if (!await canLoginWithCredentials(email)) {
            return null;
          }

          const user = await getUserByEmail(email);
          if (!user || !user.password_hash) {
            return null;
          }

          const isValid = await verifyPassword(credentials.password, user.password_hash);
          if (!isValid) {
            return null;
          }

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
    // @ts-expect-error - trustHost is supported in runtime but not in next-auth v4 types
    trustHost: true,
    providers,
    callbacks,
    pages,
  };
}

// Static authOptions for getServerSession() callers.
// Session verification only needs callbacks/pages — providers are not used for JWT decoding.
// Changes to credentials settings take effect per-request via the dynamic handler above.
export const authOptions: NextAuthOptions = {
  // @ts-expect-error - trustHost is supported in runtime but not in next-auth v4 types
  trustHost: true,
  providers: [],
  callbacks,
  pages,
};
