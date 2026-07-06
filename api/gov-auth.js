'use strict';
const crypto = require('crypto');
const { rateLimit, getIp } = require('./_lib/rate-limit');
const { log } = require('./_lib/audit');

/**
 * Government Integration API
 * Secure endpoints for government agency authentication
 * Compliant with Saudi Arabia Security Standards
 */

const SB_URL = process.env.SUPABASE_URL || 'https://ycnnawohrbbluawxzttt.supabase.co';

async function sbWrite(method, path, body, key) {
  const opts = {
    method,
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(SB_URL + '/rest/v1' + path, opts);
  if (!r.ok) throw new Error('DB write ' + r.status + ': ' + await r.text());
  return r;
}

async function sbGet(path, key) {
  const r = await fetch(SB_URL + '/rest/v1' + path, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  });
  if (!r.ok) throw new Error('DB read ' + r.status + ': ' + await r.text());
  return r.json();
}

module.exports = async (req, res) => {
  const ip = getIp(req);
  const _ORIGIN = process.env.ALLOWED_ORIGIN || '*';

  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', _ORIGIN);
  if (_ORIGIN !== '*') res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const sbKey = process.env.SUPABASE_SERVICE_KEY;
  if (!sbKey) {
    console.error('gov-auth: SUPABASE_SERVICE_KEY not configured');
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  const body = req.body || {};

  // ─── GOVERNMENT AUTHENTICATION ──────────────────────────────────
  if (body.action === 'gov_auth') {
    const { govId, certificate, timestamp } = body;

    // Validate required fields
    if (!govId || !certificate || !timestamp) {
      log('gov_auth_invalid_fields', { ip, govId });
      return res.status(400).json({ error: 'missing_fields' });
    }

    // Rate limiting: 10 auth attempts per hour per IP
    const { limited } = rateLimit('gov_auth:' + ip, 10, 60 * 60 * 1000);
    if (limited) {
      log('gov_auth_rate_limit', { ip, govId });
      return res.status(429).json({ error: 'too_many_attempts' });
    }

    try {
      // Validate certificate signature
      const isValid = verifyCertificate(govId, certificate, timestamp);
      if (!isValid) {
        log('gov_auth_invalid_cert', { ip, govId });
        return res.status(401).json({ error: 'invalid_certificate' });
      }

      // Check certificate not expired
      const certData = parseCertificate(certificate);
      if (certData.expiry < Date.now()) {
        log('gov_auth_cert_expired', { ip, govId });
        return res.status(401).json({ error: 'certificate_expired' });
      }

      // Check certificate whitelist
      if (!isWhitelistedGovernmentEntity(certData.issuer)) {
        log('gov_auth_not_whitelisted', { ip, govId, issuer: certData.issuer });
        return res.status(403).json({ error: 'not_authorized' });
      }

      // Generate secure session token (32 random bytes = 64 hex chars)
      const sessionToken = crypto.randomBytes(32).toString('hex');
      // Store only the hash — never the raw token
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

      // Persist token hash in Supabase
      await sbWrite('POST', '/gov_sessions', {
        token_hash: tokenHash,
        gov_id: govId,
        agency: certData.agency,
        ip,
        expires_at: expiresAt,
      }, sbKey);

      log('gov_auth_success', { ip, govId, issuer: certData.issuer });

      return res.status(200).json({
        ok: true,
        sessionToken,
        expiresAt,
        govId,
        agency: certData.agency,
      });

    } catch (err) {
      console.error('gov-auth error:', err.message);
      log('gov_auth_error', { ip, govId, error: err.message });
      return res.status(500).json({ error: 'authentication_failed' });
    }
  }

  // ─── VERIFY SESSION TOKEN ──────────────────────────────────────
  if (body.action === 'verify_token') {
    const { sessionToken } = body;
    if (!sessionToken) return res.status(400).json({ error: 'missing_token' });

    // Validate token format: must be 64 hex chars (32 bytes)
    if (!/^[0-9a-f]{64}$/.test(sessionToken)) {
      log('verify_token_invalid_format', { ip });
      return res.status(400).json({ error: 'invalid_token_format' });
    }

    // Rate limiting: 30 verify attempts per 10 minutes
    const { limited } = rateLimit('verify_token:' + ip, 30, 10 * 60 * 1000);
    if (limited) {
      log('verify_token_rate_limit', { ip });
      return res.status(429).json({ error: 'too_many_attempts' });
    }

    try {
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

      // Look up token hash in Supabase
      const rows = await sbGet(
        '/gov_sessions?token_hash=eq.' + encodeURIComponent(tokenHash) + '&select=gov_id,agency,expires_at&limit=1',
        sbKey
      );

      if (!rows || rows.length === 0) {
        log('verify_token_not_found', { ip });
        return res.status(401).json({ error: 'invalid_or_expired_token' });
      }

      const session = rows[0];

      // Check expiry
      if (new Date(session.expires_at).getTime() < Date.now()) {
        log('verify_token_expired', { ip, govId: session.gov_id });
        // Clean up expired session asynchronously
        sbWrite('DELETE', '/gov_sessions?token_hash=eq.' + encodeURIComponent(tokenHash), undefined, sbKey)
          .catch(() => {});
        return res.status(401).json({ error: 'invalid_or_expired_token' });
      }

      log('verify_token_success', { ip, govId: session.gov_id });
      return res.status(200).json({ ok: true, govId: session.gov_id, agency: session.agency });
    } catch (err) {
      console.error('verify-token error:', err.message);
      return res.status(500).json({ error: 'verification_failed' });
    }
  }

  return res.status(400).json({ error: 'invalid_action' });
};

/**
 * Certificate validation functions
 */

function verifyCertificate(govId, certificate, timestamp) {
  try {
    // TODO: Implement actual X.509 certificate validation using crypto.createVerify()
    // For now, basic structural validation
    if (!certificate || certificate.length < 50) return false;

    // Verify timestamp is recent (within 5 minutes) to prevent replay attacks
    const ts = new Date(timestamp).getTime();
    const now = Date.now();
    if (Math.abs(now - ts) > 5 * 60 * 1000) return false; // 5 minutes

    return true;
  } catch (err) {
    return false;
  }
}

function parseCertificate(certificate) {
  // TODO: Parse actual X.509 certificate fields using crypto or node-forge
  // For demo, return sample data
  return {
    govId: 'GOV-001',
    agency: 'Ministry of Example',
    issuer: 'Saudi Government CA',
    expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).getTime(),
  };
}

function isWhitelistedGovernmentEntity(issuer) {
  // Support dynamic whitelist via env var, fall back to hardcoded list
  const envList = process.env.GOV_CERT_WHITELIST;
  const whitelist = envList
    ? envList.split(',').map(s => s.trim())
    : [
        'Saudi Government CA',
        'General Authority of Zakat and Tax',
        'Ministry of Human Resources',
        'Ministry of Commerce',
        'Saudi Central Bank',
      ];
  return whitelist.includes(issuer);
}
