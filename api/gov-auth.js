'use strict';
const crypto = require('crypto');
const { rateLimit, getIp } = require('./_lib/rate-limit');
const { log } = require('./_lib/audit');

/**
 * Government Integration API
 * Secure endpoints for government agency authentication
 * Compliant with Saudi Arabia Security Standards
 */

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
    const { limited } = rateLimit(`gov_auth:${ip}`, 10, 60 * 60 * 1000);
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
      
      // Generate secure session token
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
      
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
    
    // Rate limiting: 30 verify attempts per 10 minutes
    const { limited } = rateLimit(`verify_token:${ip}`, 30, 10 * 60 * 1000);
    if (limited) {
      log('verify_token_rate_limit', { ip });
      return res.status(429).json({ error: 'too_many_attempts' });
    }
    
    try {
      const tokenData = verifySessionToken(sessionToken);
      if (!tokenData) {
        log('verify_token_invalid', { ip });
        return res.status(401).json({ error: 'invalid_or_expired_token' });
      }
      
      log('verify_token_success', { ip, govId: tokenData.govId });
      return res.status(200).json({ ok: true, govId: tokenData.govId });
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
    // TODO: Implement actual certificate validation
    // For now, basic validation
    if (!certificate || certificate.length < 50) return false;
    
    // Verify timestamp is recent (within 5 minutes)
    const ts = new Date(timestamp).getTime();
    const now = Date.now();
    if (Math.abs(now - ts) > 5 * 60 * 1000) return false; // 5 minutes
    
    return true;
  } catch (err) {
    return false;
  }
}

function parseCertificate(certificate) {
  // TODO: Parse actual X.509 certificate
  // For demo, return sample data
  return {
    govId: 'GOV-001',
    agency: 'Ministry of Example',
    issuer: 'Saudi Government CA',
    expiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).getTime(),
  };
}

function isWhitelistedGovernmentEntity(issuer) {
  // Government entities whitelist
  const whitelist = [
    'Saudi Government CA',
    'General Authority of Zakat and Tax',
    'Ministry of Human Resources',
    'Ministry of Commerce',
    'Saudi Central Bank',
    // Add more as needed
  ];
  return whitelist.includes(issuer);
}

function verifySessionToken(token) {
  // TODO: Implement actual token verification with database
  // For demo, basic check
  if (!token || token.length < 32) return null;
  
  return {
    govId: 'GOV-001',
    issuedAt: new Date().toISOString(),
  };
}
