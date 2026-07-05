'use strict';
const crypto = require('crypto');

/**
 * Audit log events for security tracking
 * Logs authentication, data access, and policy violations
 */

const auditLog = [];
const MAX_LOCAL_LOGS = 1000; // Keep last 1000 locally

function log(event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...details,
  };

  auditLog.push(entry);
  if (auditLog.length > MAX_LOCAL_LOGS) {
    auditLog.shift();
  }

  // Send to audit log webhook if configured
  if (process.env.AUDIT_LOG_WEBHOOK) {
    fetch(process.env.AUDIT_LOG_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(err => {
      console.error('audit log webhook failed:', err.message);
    });
  }

  return entry;
}

function getLog(filter = {}) {
  return auditLog.filter(entry => {
    if (filter.event && entry.event !== filter.event) return false;
    if (filter.ip && entry.ip !== filter.ip) return false;
    return true;
  });
}

module.exports = { log, getLog };
