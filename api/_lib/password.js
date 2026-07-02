// Password hashing helper — underscore-prefixed folder so Vercel does not
// treat this as a route. No external dependency: uses Node's built-in
// crypto.scrypt (salted, timing-safe compare).
const crypto = require('crypto');

const PREFIX = 'scrypt';
const KEY_LEN = 64;

function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
  return `${PREFIX}:${salt}:${derived}`;
}

// Returns { valid, needsRehash }. Supports the new scrypt format and the
// legacy base64-encoded (or raw plaintext) format used before this change —
// on a successful legacy match, the caller should re-hash and persist the
// new format (needsRehash: true) so accounts migrate transparently on login.
function verify(password, stored) {
  if (!stored) return { valid: false, needsRehash: false };

  if (stored.startsWith(`${PREFIX}:`)) {
    const parts = stored.split(':');
    if (parts.length !== 3) return { valid: false, needsRehash: false };
    const [, salt, hex] = parts;
    const derived = crypto.scryptSync(password, salt, KEY_LEN).toString('hex');
    const a = Buffer.from(derived, 'hex');
    const b = Buffer.from(hex, 'hex');
    const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { valid, needsRehash: false };
  }

  const legacyEncoded = Buffer.from(password).toString('base64');
  const valid = legacyEncoded === stored || password === stored;
  return { valid, needsRehash: valid };
}

module.exports = { hash, verify };
