import type { Context, Next } from "hono";

/**
 * Simple in-memory token bucket, per IP.
 *
 * Known limitation (fine at current scale, worth remembering later): this
 * state lives in the process, so it's per-dyno. If you ever scale to more
 * than one web dyno, a client could get up to N x the limit by hitting
 * different instances. Fix at that point would be a shared store (Redis/Turso).
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

// Sweep old buckets periodically so this doesn't grow unbounded under abuse
// (e.g. an attacker cycling through spoofed IPs/headers).
const MAX_BUCKETS = 50_000;

export interface RateLimitOptions {
  capacity: number; // max tokens (burst size)
  refillPerSecond: number; // tokens added per second
}

function getClientKey(c: Context): string {
  // Trust standard proxy headers (Heroku router sets X-Forwarded-For).
  // Take the first IP in the chain (the original client).
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown"; // shouldn't normally happen behind Heroku's router
}

export function rateLimiter(options: RateLimitOptions) {
  return async (c: Context, next: Next) => {
    const key = getClientKey(c);
    const now = Date.now();

    if (buckets.size > MAX_BUCKETS) {
      buckets.clear(); // crude but effective safety valve
    }

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: options.capacity, lastRefill: now };
      buckets.set(key, bucket);
    }

    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(options.capacity, bucket.tokens + elapsedSeconds * options.refillPerSecond);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      const retryAfterSeconds = Math.ceil((1 - bucket.tokens) / options.refillPerSecond);
      c.header("Retry-After", String(retryAfterSeconds));
      c.header("X-RateLimit-Limit", String(options.capacity));
      c.header("X-RateLimit-Remaining", "0");
      return c.json(
        {
          error: "rate_limited",
          message: `Too many requests. Try again in ~${retryAfterSeconds}s.`,
        },
        429,
      );
    }

    bucket.tokens -= 1;
    c.header("X-RateLimit-Limit", String(options.capacity));
    c.header("X-RateLimit-Remaining", String(Math.floor(bucket.tokens)));

    await next();
  };
}
