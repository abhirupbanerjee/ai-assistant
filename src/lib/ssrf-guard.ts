/**
 * SSRF (Server-Side Request Forgery) Guard
 *
 * Validates that URLs point to public internet addresses only,
 * blocking requests to private, loopback, link-local, and multicast IP ranges.
 */
import { resolve4 } from 'dns/promises';
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
  if (isIP(hostname) !== 0) {
    if (isPrivateIPv4(hostname)) {
      throw new Error(`SSRF guard: URL points to private/reserved IP range (${hostname})`);
    }
    return;
  }

  // Resolve hostname to IP addresses
  let addresses: string[];
  try {
    addresses = await resolve4(hostname);
  } catch {
    throw new Error(`SSRF guard: Could not resolve hostname: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new Error(`SSRF guard: No IP addresses resolved for: ${hostname}`);
  }

  for (const addr of addresses) {
    if (isPrivateIPv4(addr)) {
      throw new Error(
        `SSRF guard: Hostname ${hostname} resolves to private/reserved IP range (${addr})`
      );
    }
  }
}