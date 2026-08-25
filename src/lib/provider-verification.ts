/**
 * Upstream provider credential verification.
 *
 * Verification deliberately uses an explicit resolved secret rather than the
 * ambient DB/environment lookup. This keeps the health result aligned with the
 * credential runtime would use and prevents a successful test from a different
 * source being attributed to the credential under test.
 */

import { testProviderConnectionWithKey } from './services/model-discovery';

export type ProviderVerificationStatus = 'verified' | 'failed' | 'unavailable';
export type ProviderVerificationErrorCode =
  | 'MISSING_CREDENTIAL'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'REQUEST_FAILED';

export interface ProviderVerificationResult {
  ok: boolean;
  status: ProviderVerificationStatus;
  httpStatus: number | null;
  errorCode: ProviderVerificationErrorCode | null;
  message: string;
  modelCount?: number;
}

function classifyFailure(message: string): Pick<ProviderVerificationResult, 'httpStatus' | 'errorCode'> {
  const statusMatch = message.match(/\b([1-5]\d{2})\b/);
  const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
  const normalized = message.toLowerCase();

  if (httpStatus === 401 || normalized.includes('unauthorized') || normalized.includes('invalid api key')) {
    return { httpStatus: httpStatus ?? 401, errorCode: 'UNAUTHORIZED' };
  }
  if (httpStatus === 403 || normalized.includes('forbidden')) {
    return { httpStatus: httpStatus ?? 403, errorCode: 'FORBIDDEN' };
  }
  if (httpStatus === 429 || normalized.includes('rate limit')) {
    return { httpStatus: httpStatus ?? 429, errorCode: 'RATE_LIMITED' };
  }
  if ((httpStatus !== null && httpStatus >= 500) || normalized.includes('timeout') || normalized.includes('network')) {
    return { httpStatus, errorCode: 'UPSTREAM_UNAVAILABLE' };
  }
  return { httpStatus, errorCode: 'REQUEST_FAILED' };
}

/** Verify a resolved credential against its provider without persisting a secret. */
export async function verifyProviderCredential(input: {
  providerId: string;
  apiKey: string | null;
  apiBase: string | null;
}): Promise<ProviderVerificationResult> {
  const requiresBaseOnly = input.providerId === 'ollama' || input.providerId === 'azure-foundry';
  if ((requiresBaseOnly && !input.apiBase) || (!requiresBaseOnly && !input.apiKey)) {
    return {
      ok: false,
      status: 'unavailable',
      httpStatus: null,
      errorCode: 'MISSING_CREDENTIAL',
      message: 'Credential is unavailable or disabled',
    };
  }

  const result = await testProviderConnectionWithKey(
    input.providerId,
    input.apiKey ?? '',
    input.apiBase ?? undefined
  );
  if (result.success) {
    return {
      ok: true,
      status: 'verified',
      httpStatus: 200,
      errorCode: null,
      message: result.message,
      modelCount: result.modelCount,
    };
  }

  return {
    ok: false,
    status: 'failed',
    ...classifyFailure(result.message),
    message: result.message,
  };
}
