'use strict';

const _store = new Map();

// Purge expired entries every 5 minutes (keeps memory bounded in long-lived Express processes)
const _gc = setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _store) {
    if (now > v.resetAt) _store.delete(k);
  }
}, 5 * 60 * 1000);
if (_gc.unref) _gc.unref();

/**
 * rateLimit(key, maxRequests, windowMs)
 * Returns { limited: true, retryAfter: <seconds> } or { limited: false }
 */
function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let e = _store.get(key);
  if (!e || now > e.resetAt) {
    e = { count: 0, resetAt: now + windowMs };
    _store.set(key, e);
  }
  e.count += 1;
  if (e.count > maxRequests) {
    return { limited: true, retryAfter: Math.ceil((e.resetAt - now) / 1000) };
  }
  return { limited: false };
}

/**
 * getIp(req) — handles X-Forwarded-For from reverse proxies
 */
function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

module.exports = { rateLimit, getIp };
