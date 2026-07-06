'use strict';

/**
 * Data Protection & Encryption utilities
 * Handles sensitive government data
 */

const crypto = require('crypto');

if (!process.env.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY environment variable is required but not set. Generate a 32-byte hex key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}
const ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
if (ENCRYPTION_KEY.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes / 256 bits)');
}
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt sensitive data
 */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, ENCRYPTION_KEY, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    iv: iv.toString('hex'),
    encrypted,
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypt sensitive data
 */
function decrypt(encryptedData) {
  try {
    const decipher = crypto.createDecipheriv(
      ENCRYPTION_ALGORITHM,
      ENCRYPTION_KEY,
      Buffer.from(encryptedData.iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
    
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    console.error('Decryption failed:', err.message);
    return null;
  }
}

/**
 * Hash sensitive data (one-way)
 */
function hash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate secure random token
 */
function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

module.exports = { encrypt, decrypt, hash, generateToken };
