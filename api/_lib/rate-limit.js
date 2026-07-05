'use strict';
const crypto = require('crypto');

// In-memory rate limit store
// For production with multiple instances, use Redis
const _rateLimitStore = new Map();

// Clean expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of _rateLimitStore.entries()) {
    if (data.resetTime <= now) {
      _rateLimitStore.delete(key);
    }
  }
}, 60 * 1000);

/**
 * Rate limit check
 * @param {string} key - Unique identifier (e.g., "otp_send:192.168.1.1")
 * @param {number} maxRequests - Max requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {{limited: boolean, remaining: number, resetTime: number}}
 */
function rateLimit(key, maxRequests, windowMs) {
  const now = Date.now();
  let data = _rateLimitStore.get(key);

  // Initialize or reset if window expired
  if (!data || data.resetTime <= now) {
    data = {
      count: 0,
      resetTime: now + windowMs,
    };
    _rateLimitStore.set(key, data);
  }

  const limited = data.count >= maxRequests;
  const remaining = Math.max(0, maxRequests - data.count - 1);

  if (!limited) {
    data.count++;
  }

  return {
    limited,
    remaining,
    resetTime: data.resetTime,
  };
}

/**
 * Extract client IP from request
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
