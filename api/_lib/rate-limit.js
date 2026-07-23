'use strict';

// Rate limiting with a shared store when available, in-memory fallback otherwise.
//
// On Vercel, each serverless invocation may run in a fresh instance, so a purely
// in-memory limiter is trivially bypassed. If an Upstash Redis (or Vercel KV,
// which exposes the same REST API) is configured via env vars, counters are kept
// there instead — shared across all instances and regions:
//   UPSTASH_REDIS_REST_URL   + UPSTASH_REDIS_REST_TOKEN   (Upstash direct)
//   KV_REST_API_URL          + KV_REST_API_TOKEN           (Vercel KV integration)
// If neither is set, falls back to the previous in-memory behavior (best effort).

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const HAS_REDIS = !!(REDIS_URL && REDIS_TOKEN);

// ── In-memory fallback store ────────────────────────────────────────────────
const _rateLimitStore = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of _rateLimitStore.entries()) {
    if (data.resetTime <= now) {
      _rateLimitStore.delete(key);
    }
  }
}, 60 * 1000).unref?.();

function memoryRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let data = _rateLimitStore.get(key);

  if (!data || data.resetTime <= now) {
    data = { count: 0, resetTime: now + windowMs };
    _rateLimitStore.set(key, data);
  }

  const limited = data.count >= maxRequests;
  const remaining = Math.max(0, maxRequests - data.count - 1);
  if (!limited) data.count++;

  return { limited, remaining, resetTime: data.resetTime };
}

// ── Shared Redis store (Upstash/Vercel KV REST) ─────────────────────────────
// Fixed-window counter: INCR + set expiry on first hit — one pipelined call.
async function redisRateLimit(key, maxRequests, windowMs) {
  const windowSec = Math.ceil(windowMs / 1000);
  const redisKey = `rl:${key}`;
  const r = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      ['INCR', redisKey],
      ['EXPIRE', redisKey, String(windowSec), 'NX'],
      ['PTTL', redisKey],
    ]),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  const results = await r.json();
  const count = Number(results?.[0]?.result ?? 1);
  const pttl = Number(results?.[2]?.result ?? windowMs);
  const resetTime = Date.now() + (pttl > 0 ? pttl : windowMs);
  return {
    limited: count > maxRequests,
    remaining: Math.max(0, maxRequests - count),
    resetTime,
  };
}

/**
 * Rate limit check.
 * Async-transparent: returns a plain object when using the in-memory store, or a
 * Promise when the shared store is active. All call sites `await` (or can await)
 * the result, so both modes work with `const { limited } = await rateLimit(...)`
 * as well as the existing synchronous destructuring (a resolved object).
 *
 * Fails OPEN on store errors: an outage of the rate-limit store must not take
 * authentication down with it.
 */
function rateLimit(key, maxRequests, windowMs) {
  if (!HAS_REDIS) return memoryRateLimit(key, maxRequests, windowMs);
  return redisRateLimit(key, maxRequests, windowMs).catch((err) => {
    console.error('rate-limit store error (failing open to memory):', err.message);
    return memoryRateLimit(key, maxRequests, windowMs);
  });
}

/**
 * Extract client IP from request.
 * Handles proxies (Vercel, Cloudflare, etc.)
 */
function getIp(req) {
  return (
    req.headers['cf-connecting-ip'] || // Cloudflare
    req.headers['x-forwarded-for']?.split(',')[0] || // Proxy
    req.headers['x-real-ip'] || // Nginx
    req.socket?.remoteAddress || // Direct connection
    '127.0.0.1'
  );
}

module.exports = { rateLimit, getIp };
