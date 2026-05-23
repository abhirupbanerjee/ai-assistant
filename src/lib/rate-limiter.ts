/**
 * Simple in-memory rate limiter for API endpoints.
 *
 * Uses a sliding window approach per user/identity.
 * Resets on server restart — for production deployments with multiple
 * replicas, replace with a Redis-based implementation.
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 60 seconds
const CLEANUP_INTERVAL_MS = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    // Remove entries with no recent activity (older than 10 minutes)
    const recent = entry.timestamps.filter((t) => now - t < 600_000);
    if (recent.length === 0) {
      store.delete(key);
    } else {
      entry.timestamps = recent;
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxRequests: 30,   // 30 requests
  windowMs: 60_000,  // per 60 seconds
};

/**
 * Check whether a request should be rate-limited.
 *
 * @param key - Unique identifier for the requester (e.g., user ID, IP address)
 * @param config - Optional custom rate limit configuration
 * @returns Object with `allowed` boolean and metadata
 */
export function checkRateLimit(
  key: string,
  config: Partial<RateLimitConfig> = {}
): { allowed: boolean; remaining: number; resetInMs: number } {
  const { maxRequests, windowMs } = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the current window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0];
    const resetInMs = oldest + windowMs - now;
    return { allowed: false, remaining: 0, resetInMs: Math.max(resetInMs, 1000) };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetInMs: windowMs,
  };
}

/**
 * Express/Next.js middleware-style helper: extracts a rate-limit key from
 * a NextRequest and returns a 429 response if the limit is exceeded.
 *
 * @param request - The incoming NextRequest
 * @param config - Optional custom rate limit configuration
 * @returns A Response (429) if rate-limited, or null if allowed
 */
export function rateLimitMiddleware(
  request: Request,
  config?: Partial<RateLimitConfig>
): Response | null {
  // Use x-forwarded-for or x-real-ip for IP; fall back to a known header
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  const ip = forwarded?.split(',')[0]?.trim() || realIp || 'unknown';
  const result = checkRateLimit(`ip:${ip}`, config);

  if (!result.allowed) {
    return new Response(
      JSON.stringify({ error: 'Too many requests', code: 'RATE_LIMITED', retryAfterMs: result.resetInMs }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(result.resetInMs / 1000)),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  return null;
}