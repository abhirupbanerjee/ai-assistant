# Authentication System

This document provides comprehensive coverage of Policy Bot's authentication system, including OAuth providers (Microsoft/Google), credentials authentication (email/password), and admin management features.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication Providers](#authentication-providers)
   - [Microsoft Azure AD](#microsoft-azure-ad)
   - [Google OAuth](#google-oauth)
   - [Credentials Authentication](#credentials-authentication)
3. [Environment Configuration](#environment-configuration)
4. [Access Control Modes](#access-control-modes)
5. [Admin User Management](#admin-user-management)
6. [Disabling Credentials Login](#disabling-credentials-login)
7. [Fresh VM / First-Time Setup](#fresh-vm--first-time-setup)
8. [Security Considerations](#security-considerations)
9. [Future: Auth.js v5 Migration](#future-authjs-v5-migration)
10. [Future: National ID Integration](#future-national-id-integration)

---

## Overview

Policy Bot uses [NextAuth.js v4](https://next-auth.js.org/) for authentication with a flexible multi-provider architecture:

| Provider | Type | Use Case | Default State |
|----------|------|----------|---------------|
| Microsoft Azure AD | OAuth 2.0 | Enterprise SSO | Available if configured |
| Google OAuth | OAuth 2.0 | Public/enterprise accounts | Available if configured |
| Credentials | Email/Password | Dev mode, offline, fresh VM | **Enabled by default** |

**Key Design Decisions:**
- Credentials authentication is **enabled by default** to support fresh VM setups before OAuth is configured
- OAuth providers are only registered when their client IDs are set in environment variables
- All authentication flows converge on the same user database and role system
- Server restart required after changing authentication settings

---

## Authentication Providers

### Microsoft Azure AD

Enterprise single sign-on via Microsoft 365 / Azure Active Directory.

#### Azure Portal Setup

1. Go to [Azure Portal](https://portal.azure.com) > **Azure Active Directory** > **App registrations**
2. Click **New registration**
3. Configure:
   - **Name:** `Policy Bot` (or your app name)
   - **Supported account types:** Choose based on your needs:
     - Single tenant: Only your organization
     - Multi-tenant: Any Azure AD directory
     - Multi-tenant + personal: Including Microsoft accounts
   - **Redirect URI:** `https://your-domain.com/api/auth/callback/azure-ad`

4. After creation, note:
   - **Application (client) ID** → `AZURE_AD_CLIENT_ID`
   - **Directory (tenant) ID** → `AZURE_AD_TENANT_ID`

5. Create a client secret:
   - Go to **Certificates & secrets** > **New client secret**
   - Copy the secret value → `AZURE_AD_CLIENT_SECRET`

6. Configure API permissions:
   - **Microsoft Graph** > **User.Read** (usually pre-configured)

#### Environment Variables

```bash
# Azure AD OAuth
AZURE_AD_CLIENT_ID=your-application-client-id
AZURE_AD_CLIENT_SECRET=your-client-secret
AZURE_AD_TENANT_ID=your-tenant-id-or-common
```

**Tenant ID Options:**
- Specific ID: Restricts to your organization
- `common`: Any Azure AD + personal Microsoft accounts
- `organizations`: Any Azure AD directory
- `consumers`: Personal Microsoft accounts only

---

### Google OAuth

Google Workspace or personal Google account authentication.

#### Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) > **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Configure:
   - **Application type:** Web application
   - **Name:** `Policy Bot`
   - **Authorized redirect URIs:** `https://your-domain.com/api/auth/callback/google`

4. Note the credentials:
   - **Client ID** → `GOOGLE_CLIENT_ID`
   - **Client Secret** → `GOOGLE_CLIENT_SECRET`

5. Configure OAuth consent screen:
   - Go to **OAuth consent screen**
   - Set up your app information
   - Add scopes: `email`, `profile`, `openid`
   - For internal use: Set user type to "Internal"

#### Environment Variables

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

---

### Credentials Authentication

Email/password login for development, offline use, or fresh deployments.

#### How It Works

1. **Password Storage:** Passwords are hashed using bcrypt with 12 salt rounds
2. **Login Flow:**
   - User enters email + password
   - System verifies user exists and has `credentials_enabled = 1`
   - Password is verified against stored hash
   - NextAuth session is created

3. **Database Columns:**
   ```sql
   -- Added to users table
   password_hash TEXT,               -- bcrypt hash
   credentials_enabled INTEGER DEFAULT 1  -- 1 = enabled
   ```

#### When to Use

| Scenario | Recommendation |
|----------|----------------|
| Fresh VM before OAuth setup | Use credentials with `CREDENTIALS_ADMIN_PASSWORD` |
| Local development | Credentials for quick testing |
| Offline / air-gapped deployment | Only option without internet |
| Ollama-only local setup | Credentials works without external services |
| Production with OAuth configured | Consider disabling credentials |

#### Setting User Passwords

**Via Admin UI:**
1. Go to **Admin** > **Users** section
2. Select a user
3. Use the credentials management option to set/reset password

**Via Environment (First Admin Only):**
```bash
# Sets password for first admin in ADMIN_EMAILS on first run
CREDENTIALS_ADMIN_PASSWORD=your-secure-password
```

This only works if the admin user doesn't already have a password set.

---

## Environment Configuration

### Complete Authentication Variables

```bash
# ============================================================================
#                          AUTHENTICATION
# ============================================================================

# [REQUIRED] NextAuth secret - generate with: openssl rand -base64 32
NEXTAUTH_SECRET=your-random-secret-here

# [REQUIRED for Production] Application URL
NEXTAUTH_URL=https://your-domain.com

# ============================================================================
#                          OAUTH PROVIDERS
# ============================================================================

# Azure AD (Microsoft) - Optional
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_TENANT_ID=

# Google OAuth - Optional
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ============================================================================
#                          ACCESS CONTROL
# ============================================================================

# [REQUIRED] Admin email addresses (comma-separated)
# These users get full admin access
ADMIN_EMAILS=admin@example.com,backup-admin@example.com

# [HAS DEFAULT] Access control mode
# - 'allowlist': Only users in database can sign in (default)
# - 'domain': Any user from ALLOWED_DOMAINS can sign in
ACCESS_MODE=allowlist

# [OPTIONAL] Allowed email domains (for domain mode)
ALLOWED_DOMAINS=example.com,company.org

# ============================================================================
#                          CREDENTIALS AUTH
# ============================================================================

# [OPTIONAL] Initial admin password
# Password for the first admin in ADMIN_EMAILS list
# Only used on first run if admin has no password set
CREDENTIALS_ADMIN_PASSWORD=

# [DEVELOPMENT ONLY] Disable all authentication
AUTH_DISABLED=false
```

### Minimum Configuration Examples

**OAuth Only (Production):**
```bash
NEXTAUTH_SECRET=generated-secret
NEXTAUTH_URL=https://app.example.com
ADMIN_EMAILS=admin@example.com
AZURE_AD_CLIENT_ID=xxx
AZURE_AD_CLIENT_SECRET=xxx
AZURE_AD_TENANT_ID=xxx
```

**Credentials Only (Development):**
```bash
NEXTAUTH_SECRET=dev-secret
NEXTAUTH_URL=http://localhost:3000
ADMIN_EMAILS=admin@example.com
CREDENTIALS_ADMIN_PASSWORD=devpassword123
```

**Both Providers (Flexible):**
```bash
NEXTAUTH_SECRET=generated-secret
NEXTAUTH_URL=https://app.example.com
ADMIN_EMAILS=admin@example.com
CREDENTIALS_ADMIN_PASSWORD=initial-password
AZURE_AD_CLIENT_ID=xxx
AZURE_AD_CLIENT_SECRET=xxx
AZURE_AD_TENANT_ID=xxx
```

---

## Access Control Modes

Policy Bot supports two access control modes:

### Allowlist Mode (Default)

Only users explicitly added to the database can sign in.

```bash
ACCESS_MODE=allowlist
```

**Workflow:**
1. Admin adds user via Admin UI with email and role
2. User signs in via OAuth or credentials
3. System verifies user exists in database
4. If not found → Access Denied

**Best for:** Enterprise deployments with controlled user access.

### Domain Mode

Any user from specified email domains can sign in.

```bash
ACCESS_MODE=domain
ALLOWED_DOMAINS=company.com,partner.org
```

**Workflow:**
1. User signs in via OAuth
2. System checks email domain against `ALLOWED_DOMAINS`
3. If domain matches → auto-create user with 'user' role
4. If domain doesn't match → Access Denied

**Best for:** Organizations wanting self-service signup from specific domains.

---

## Admin User Management

### User Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full system access, manage all users, configure settings |
| `superuser` | Manage assigned categories, limited admin functions |
| `user` | Access assigned categories, chat functionality |

### Managing Users (Admin UI)

1. Navigate to **Admin** > **Users**
2. Available actions:
   - **Add User:** Email, name, role, category assignments
   - **Edit User:** Update role, name, categories
   - **Manage Credentials:** Set/reset password, enable/disable credentials login
   - **Delete User:** Remove from system

### Managing Credentials (Admin UI)

Located in **Admin** > **Users** > **Credentials Authentication** section:

| Setting | Description | Default |
|---------|-------------|---------|
| Enable Credentials Login | System-wide toggle | `true` (enabled) |
| Minimum Password Length | Password policy (4-128 chars) | `8` |

**Per-User Credentials:**
- Set password for any user
- Enable/disable credentials for specific users
- Remove credentials (clear password)

### API Endpoints

**Settings API:**
```
GET  /api/admin/settings/credentials-auth
PUT  /api/admin/settings/credentials-auth
```

**User Credentials API:**
```
PUT    /api/admin/users/[userId]/credentials  # Set password
PATCH  /api/admin/users/[userId]/credentials  # Enable/disable
DELETE /api/admin/users/[userId]/credentials  # Remove credentials
```

---

## Disabling Credentials Login

To remove email/password login and use OAuth only:

### Method 1: Admin UI (Recommended)

1. Go to **Admin** > **Users** > **Credentials Authentication**
2. Toggle **Enable Credentials Login** to OFF
3. Click **Save Changes**
4. **Restart the server** for changes to take effect

### Method 2: Database Direct

```sql
-- SQLite
UPDATE settings
SET value = '{"enabled":false,"minPasswordLength":8}'
WHERE key = 'credentials-auth-settings';

-- PostgreSQL
UPDATE settings
SET value = '{"enabled":false,"minPasswordLength":8}'::jsonb
WHERE key = 'credentials-auth-settings';
```

Then restart the server.

### What Happens When Disabled

- Login page shows **only OAuth buttons** (Microsoft/Google)
- Email/password form is hidden
- Existing user passwords remain in database (not deleted)
- Can be re-enabled anytime via Admin UI

### Important Considerations

Before disabling credentials:
1. Ensure at least one OAuth provider is properly configured
2. Verify admin users can successfully sign in via OAuth
3. Test OAuth login works in your environment

**Warning:** If you disable credentials without working OAuth, you may lock yourself out!

---

## Fresh VM / First-Time Setup

For deploying to a new server without OAuth configured:

### Step 1: Configure Environment

```bash
# .env
ADMIN_EMAILS=admin@yourcompany.com
CREDENTIALS_ADMIN_PASSWORD=SecureInitialPassword123!
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32
NEXTAUTH_URL=http://your-server-ip:3000
```

### Step 2: Start Application

```bash
docker compose up -d
```

### Step 3: Initial Login

1. Navigate to `http://your-server-ip:3000/auth/signin`
2. Enter email: `admin@yourcompany.com`
3. Enter password: `SecureInitialPassword123!`
4. You're now logged in as admin

### Step 4: Configure OAuth (Optional)

1. Set up Azure AD / Google OAuth as described above
2. Add credentials to `.env`
3. Restart the application
4. (Optional) Disable credentials login via Admin UI

### Step 5: Change Initial Password

After OAuth is set up, either:
- Disable credentials entirely, OR
- Change the admin password via Admin UI

---

## Security Considerations

### Password Security

- **Hashing:** bcrypt with 12 salt rounds (adaptive, resistant to GPU attacks)
- **Minimum Length:** Configurable, default 8 characters
- **Storage:** Only hash stored, never plaintext
- **Verification:** Constant-time comparison to prevent timing attacks

### Session Security

- Sessions managed by NextAuth.js
- JWT tokens with configurable expiry
- CSRF protection built-in

### Recommendations

| Environment | Recommendation |
|-------------|----------------|
| Production (Internet) | Use OAuth only, disable credentials |
| Production (Intranet) | OAuth preferred, credentials as backup |
| Development | Credentials for convenience |
| Air-gapped | Credentials required |

### Environment Variable Security

```bash
# NEVER commit these to version control
NEXTAUTH_SECRET=xxx
AZURE_AD_CLIENT_SECRET=xxx
GOOGLE_CLIENT_SECRET=xxx
CREDENTIALS_ADMIN_PASSWORD=xxx
```

Use environment variable management:
- Docker secrets
- Kubernetes secrets
- HashiCorp Vault
- Cloud provider secret managers (AWS Secrets Manager, Azure Key Vault)

---

## Future: Auth.js v5 Migration

NextAuth.js is being renamed to [Auth.js](https://authjs.dev/) with v5 bringing significant changes:

### Key Changes in v5

| Feature | NextAuth v4 | Auth.js v5 |
|---------|-------------|------------|
| Package name | `next-auth` | `next-auth@5` / `@auth/nextjs` |
| Configuration | `[...nextauth].ts` | `auth.ts` |
| Edge compatibility | Limited | Full edge runtime support |
| Database adapters | Separate packages | Built-in with `@auth/adapter-*` |
| Credentials provider | Supported | Enhanced with WebAuthn support |

### Migration Path

When upgrading:

1. **Update packages:**
   ```bash
   npm install next-auth@5
   ```

2. **Update configuration:**
   ```typescript
   // auth.ts (new location)
   import NextAuth from "next-auth"
   import AzureAD from "next-auth/providers/azure-ad"
   import Google from "next-auth/providers/google"
   import Credentials from "next-auth/providers/credentials"

   export const { handlers, auth, signIn, signOut } = NextAuth({
     providers: [AzureAD, Google, Credentials],
     // ...
   })
   ```

3. **Update route handlers:**
   ```typescript
   // app/api/auth/[...nextauth]/route.ts
   export { GET, POST } from "@/auth"
   ```

4. **Update middleware:**
   ```typescript
   // middleware.ts
   export { auth as middleware } from "@/auth"
   ```

### Current Status

Policy Bot currently uses **NextAuth v4**. Migration to v5 is planned when:
- v5 reaches stable release
- All required providers have v5 support
- Edge runtime benefits become necessary

---

## Future: National ID Integration

For government deployments requiring national identity verification:

### Integration Patterns

**Pattern 1: OIDC Bridge**
National ID systems often expose OIDC endpoints:

```typescript
// Conceptual - depends on specific national ID provider
import NationalIDProvider from "next-auth/providers/oauth"

NationalIDProvider({
  id: "national-id",
  name: "National ID",
  clientId: process.env.NATIONAL_ID_CLIENT_ID,
  clientSecret: process.env.NATIONAL_ID_CLIENT_SECRET,
  authorization: {
    url: "https://id.gov.xx/oauth/authorize",
    params: { scope: "openid profile national_id" }
  },
  token: "https://id.gov.xx/oauth/token",
  userinfo: "https://id.gov.xx/oauth/userinfo",
})
```

**Pattern 2: SAML Federation**
For SAML-based national ID systems:

```typescript
import SAMLProvider from "next-auth/providers/saml"

// Requires additional SAML adapter setup
```

**Pattern 3: Custom Integration**
For proprietary national ID APIs:

```typescript
// Custom credentials provider with national ID verification
CredentialsProvider({
  id: "national-id",
  name: "National ID",
  credentials: {
    nationalId: { label: "National ID", type: "text" },
    otp: { label: "OTP", type: "text" }
  },
  async authorize(credentials) {
    // Call national ID verification API
    const verified = await verifyNationalId(
      credentials.nationalId,
      credentials.otp
    )
    if (verified) {
      return { id: credentials.nationalId, ... }
    }
    return null
  }
})
```

### Considerations

- **Compliance:** National ID integration often requires government certification
- **Privacy:** Handle national ID numbers as PII with appropriate protections
- **Offline:** Consider fallback authentication when national ID services are unavailable
- **Audit:** Log all national ID verification attempts for compliance

---

## Troubleshooting

### Common Issues

**"Access Denied" after OAuth login:**
- Check if user exists in database (allowlist mode)
- Verify email domain matches `ALLOWED_DOMAINS` (domain mode)
- Confirm user is added via Admin UI

**Credentials login not showing:**
- Check `credentials_auth_settings` in database has `enabled: true`
- Restart server after changing settings
- Verify no JavaScript errors in browser console

**OAuth callback error:**
- Verify redirect URI matches exactly in provider console
- Check `NEXTAUTH_URL` matches your deployment URL
- Ensure client ID and secret are correct

**Password not working:**
- Verify user has `credentials_enabled = 1` in database
- Check `password_hash` is not NULL
- Confirm minimum password length requirements met

### Debug Mode

Enable NextAuth debug logging:

```bash
# Add to .env
NEXTAUTH_DEBUG=true
```

Check server logs for detailed authentication flow information.

---

## Related Documentation

- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) - Docker deployment and environment setup
- [DATABASE.md](DATABASE.md) - Database schema including users table
- [ADMIN_GUIDE.md](../user_manuals/ADMIN_GUIDE.md) - Admin UI user management
- [API_SPECIFICATION.md](../API/API_SPECIFICATION.md) - Authentication API endpoints
