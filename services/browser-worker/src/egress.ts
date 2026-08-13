/**
 * Outbound egress guard for the browser worker.
 *
 * Every request issued by a page is validated against a domain allowlist and a
 * hard blocklist of localhost/private/metadata ranges before it is allowed to
 * leave the worker. This is defense-in-depth on top of the container network
 * isolation described in the Dockerfile/compose configuration.
 */

import type { Route, Request } from 'playwright';

/** Normalize an allowlist entry to a bare host (optionally with `*.` prefix). */
function normalizeEntry(entry: string): string {
  return entry
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0];
}

/** Match a hostname against an allowlist entry (`*.example.com` matches subdomains). */
export function hostMatches(host: string, entry: string): boolean {
  const pattern = normalizeEntry(entry);
  const h = host.toLowerCase();
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return h === base || h.endsWith('.' + base);
  }
  return h === pattern;
}

/** Hard-block localhost, private ranges, link-local, and cloud metadata IPs. */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();

  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '169.254.169.254') return true; // AWS/GCP/Azure metadata

  // IPv4 literal checks
  if (/^127\./.test(h)) return true; // loopback
  if (/^10\./.test(h)) return true; // RFC1918
  if (/^192\.168\./.test(h)) return true; // RFC1918
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true; // RFC1918
  if (/^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./.test(h)) return true; // CGNAT
  if (/^0\./.test(h)) return true; // "this network"
  if (/^169\.254\./.test(h)) return true; // link-local

  // IPv6 literal checks
  if (h === '::1' || h === '::') return true; // loopback/unspecified
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // ULA

  return false;
}

/** Decide whether a URL is allowed to leave the worker. */
export function isAllowed(url: URL, allowlist: string[]): boolean {
  if (isBlockedHost(url.hostname)) return false;
  // Deny by default: an empty allowlist allows nothing.
  if (allowlist.length === 0) return false;
  return allowlist.some((entry) => hostMatches(url.hostname, entry));
}

/**
 * Build a Playwright route handler that enforces the egress guard.
 * Attach to a context via `context.route('**', handler)`.
 */
export function createEgressGuard(allowlist: string[]) {
  return async (route: Route, request: Request): Promise<void> => {
    let url: URL;
    try {
      url = new URL(request.url());
    } catch {
      await route.abort('blockedbyclient');
      return;
    }
    if (!isAllowed(url, allowlist)) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  };
}
