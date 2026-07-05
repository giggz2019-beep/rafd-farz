'use strict';

function auditLog(event) {
  const entry = {
    ts: new Date().toISOString(),
    ...event,
  };
  // Use process.stdout.write to avoid console.log formatting
  process.stdout.write(JSON.stringify(entry) + '\n');
}

function getIpFromReq(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

module.exports = { auditLog, getIpFromReq };
