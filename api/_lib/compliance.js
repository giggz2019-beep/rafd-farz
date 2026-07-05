'use strict';

/**
 * GDPR & Data Protection Compliance
 * Handles user consent, data retention, and deletion
 */

const auditLog = [];

/**
 * Track user consent
 */
function trackConsent(userId, consentType, status, metadata = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    userId,
    consentType, // 'data_processing', 'cookies', 'marketing'
    status, // 'accepted', 'rejected', 'withdrawn'
    ...metadata,
  };
  
  auditLog.push(record);
  return record;
}

/**
 * Request data export (Right to Data Portability)
 */
function requestDataExport(userId) {
  return {
    requestId: `export-${userId}-${Date.now()}`,
    userId,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
  };
}

/**
 * Request data deletion (Right to be Forgotten)
 */
function requestDataDeletion(userId, reason = '') {
  return {
    requestId: `deletion-${userId}-${Date.now()}`,
    userId,
    reason,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    completionDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
  };
}

/**
 * Data retention policy
 */
const dataRetentionPolicy = {
  userProfiles: 365, // 1 year
  transactionLogs: 2555, // 7 years (legal requirement)
  auditLogs: 2555, // 7 years
  tempOtpData: 10, // 10 minutes (OTP tokens)
  sessionData: 1, // 1 day
};

function getRetentionPeriod(dataType) {
  return dataRetentionPolicy[dataType] || 90; // Default 90 days
}

module.exports = {
  trackConsent,
  requestDataExport,
  requestDataDeletion,
  dataRetentionPolicy,
  getRetentionPeriod,
};
