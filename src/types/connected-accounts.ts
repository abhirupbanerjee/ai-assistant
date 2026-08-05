/**
 * Connected Accounts types — per-user OAuth tokens for Drive connectors.
 *
 * Used by the Drive Connectors feature (Phase 2) to store encrypted
 * access/refresh tokens granted by users who connect their Google Drive
 * or Microsoft OneDrive accounts.
 */

export type ConnectedAccountProvider = 'google' | 'microsoft' | 'github' | 'notion' | 'slack';

export interface ConnectedAccount {
  id: string;
  provider: ConnectedAccountProvider;
  userEmail: string;
  /** Human-readable label (e.g. the OAuth account email) for UI display. */
  displayName?: string;
  /** Decrypted access token — only populated when explicitly fetched. */
  accessToken?: string;
  /** Decrypted refresh token — only populated when explicitly fetched. */
  refreshToken?: string;
  scopes: string;
  /** ISO 8601 timestamp of token expiry, or undefined if no expiry. */
  tokenExpiry?: string;
  revoked: boolean;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertConnectedAccountInput {
  provider: ConnectedAccountProvider;
  userEmail: string;
  displayName?: string;
  accessToken?: string;
  refreshToken?: string;
  scopes: string;
  tokenExpiry?: string;
}

export interface ConnectedAccountPublicView {
  id: string;
  provider: ConnectedAccountProvider;
  userEmail: string;
  displayName?: string;
  scopes: string;
  revoked: boolean;
  lastError?: string;
  connectedAt: string;
  updatedAt: string;
}
