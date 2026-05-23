/**
 * SSRF (Server-Side Request Forgery) Guard
 *
 * Validates that URLs point to public internet addresses only,
 * blocking requests to private, loopback, link-local, and multicast IP ranges.
 */
import { resolve4, resolve6 } from 'dns/promises';
import { isIP } from 'net';

// Private and reserved IPv4 CIDR ranges to block
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  // 127.0.0.0/8 — Loopback
  if (parts[0] === 127) return true;
  // 10.0.0.0/8 — Private
  if (parts[0] === 10) return true;
  // 172.16.0.0/12 — Private
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16 — Private
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16 — Link-local (cloud metadata)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0/8 — Current network
  if (parts[0] === 0) return true;
  // 100.64.0.0/10 — Carrier-grade NAT
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  // 198.18.0.0/15 — Benchmarking
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
  // 240.0.0.0/4 — Reserved
  if (parts[0] >= 240) return true;

  return false;
}

// Private and reserved IPv6 ranges to block
function isPrivateIPv6(ip: string): boolean {
  if (ip.includes('.') && ip.includes(':')) {
    const lastSegment = ip.split(':').pop();
    if (lastSegment && isPrivateIPv4(lastSegment)) {
      return true;
    }
  }

  const normalized = expandIPv6(ip);
  if (!normalized) return true;

  const value = ipv6ToBigInt(normalized);
  if (value === null) return true;

  const ranges: Array<[bigint, bigint]> = [
    // ::/128 (unspecified)
    [BigInt(0), BigInt(0)],
    // ::1/128 (loopback)
    [BigInt(1), BigInt(1)],
    // fc00::/7 (unique local)
    [BigInt('0xfc000000000000000000000000000000'), BigInt('0xfdffffffffffffffffffffffffffffff')],
    // fe80::/10 (link-local)
    [BigInt('0xfe800000000000000000000000000000'), BigInt('0xfebfffffffffffffffffffffffffffff')],
    // fec0::/10 (site-local, deprecated)
    [BigInt('0xfec00000000000000000000000000000'), BigInt('0xfeffffffffffffffffffffffffffffff')],
    // ff00::/8 (multicast)
    [BigInt('0xff000000000000000000000000000000'), BigInt('0xffffffffffffffffffffffffffffffff')],
    // 2001:db8::/32 (documentation)
    [BigInt('0x20010db8000000000000000000000000'), BigInt('0x20010db8ffffffffffffffffffffffff')],
  ];

  return ranges.some(([start, end]) => value >= start && value <= end);
}

function expandIPv6(ip: string): string[] | null {
  if (!ip.includes(':')) return null;

  const parts = ip.split('::');
  if (parts.length > 2) return null;

  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts[1] ? parts[1].split(':') : [];

  const convertIPv4 = (segment: string): string[] | null => {
    if (!segment.includes('.')) return [segment];
    const nums = segment.split('.').map(Number);
    if (nums.length !== 4 || nums.some(n => Number.isNaN(n) || n < 0 || n > 255)) return null;
    const high = ((nums[0] << 8) | nums[1]).toString(16);
    const low = ((nums[2] << 8) | nums[3]).toString(16);
    return [high, low];
  };

  const headParts: string[] = [];
  for (const segment of head) {
    const converted = convertIPv4(segment);
    if (!converted) return null;
    headParts.push(...converted);
  }

  const tailParts: string[] = [];
  for (const segment of tail) {
    const converted = convertIPv4(segment);
    if (!converted) return null;
    tailParts.push(...converted);
  }

  if (parts.length === 1) {
    if (headParts.length !== 8) return null;
    return headParts.map(part => part.padStart(4, '0'));
  }

  const missing = 8 - (headParts.length + tailParts.length);
  if (missing < 0) return null;

  return [
    ...headParts.map(part => part.padStart(4, '0')),
    ...Array(missing).fill('0000'),
    ...tailParts.map(part => part.padStart(4, '0')),
  ];
}

function ipv6ToBigInt(parts: string[]): bigint | null {
  if (parts.length !== 8) return null;
  let value = BigInt(0);
  for (const part of parts) {
    const parsed = Number.parseInt(part, 16);
    if (Number.isNaN(parsed)) return null;
    value = (value << BigInt(16)) + BigInt(parsed);
  }
  return value;
}

function normalizeRedirectRequest(init: RequestInit, status: number): RequestInit {
  const method = (init.method || 'GET').toUpperCase();
  if ([301, 302, 303].includes(status) && method !== 'GET' && method !== 'HEAD') {
    const nextInit = { ...init, method: 'GET' };
    delete nextInit.body;
    return nextInit;
  }
  return init;
}

/**
 * Validates that a URL points to a public internet address.
 * Resolves the hostname to IP addresses and checks all resolved IPs
 * against private/reserved ranges.
 *
 * @param urlString - The URL to validate
 * @throws Error if the URL points to a private/reserved IP or cannot be resolved
 */
export async function validateUrlIsPublic(urlString: string): Promise<void> {
  const url = new URL(urlString);
  const hostname = url.hostname;

  // If hostname is already an IP literal, check it directly
  const ipType = isIP(hostname);
  if (ipType !== 0) {
    if (ipType === 4 && isPrivateIPv4(hostname)) {
      throw new Error(`SSRF guard: URL points to private/reserved IP range (${hostname})`);
    }
    if (ipType === 6 && isPrivateIPv6(hostname)) {
      throw new Error(`SSRF guard: URL points to private/reserved IP range (${hostname})`);
    }
    return;
  }

  // Resolve hostname to IP addresses
  const [ipv4Result, ipv6Result] = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ]);

  const addresses: string[] = [];
  if (ipv4Result.status === 'fulfilled') {
    addresses.push(...ipv4Result.value);
  }
  if (ipv6Result.status === 'fulfilled') {
    addresses.push(...ipv6Result.value);
  }

  if (addresses.length === 0) {
    throw new Error(`SSRF guard: No IP addresses resolved for: ${hostname}`);
  }

  for (const addr of addresses) {
    const resolvedType = isIP(addr);
    if (resolvedType === 4 && isPrivateIPv4(addr)) {
      throw new Error(
        `SSRF guard: Hostname ${hostname} resolves to private/reserved IP range (${addr})`
      );
    }
    if (resolvedType === 6 && isPrivateIPv6(addr)) {
      throw new Error(
        `SSRF guard: Hostname ${hostname} resolves to private/reserved IP range (${addr})`
      );
    }
  }
}

export interface FetchWithSsrfGuardOptions {
  maxRedirects?: number;
  followRedirects?: boolean;
}

export async function fetchWithSsrfGuard(
  url: string,
  init: RequestInit = {},
  options: FetchWithSsrfGuardOptions = {}
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? 5;
  const followRedirects = options.followRedirects ?? true;

  await validateUrlIsPublic(url);

  if (!followRedirects) {
    const response = await fetch(url, { ...init, redirect: 'manual' });
    return { response, finalUrl: url };
  }

  let currentUrl = url;
  let currentInit: RequestInit = { ...init };

  for (let i = 0; i <= maxRedirects; i++) {
    const response = await fetch(currentUrl, { ...currentInit, redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      if (i === maxRedirects) {
        throw new Error('SSRF guard: Too many redirects');
      }

      const nextUrl = new URL(location, currentUrl).toString();
      await validateUrlIsPublic(nextUrl);
      currentInit = normalizeRedirectRequest(currentInit, response.status);
      currentUrl = nextUrl;
      continue;
    }

    return { response, finalUrl: currentUrl };
  }

  throw new Error('SSRF guard: Redirect validation failed');
}