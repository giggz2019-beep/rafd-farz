// Partner authentication — no Supabase client in browser needed
const crypto = require('crypto');
const { hash: hashPassword, verify: verifyPassword } = require('./_lib/password');
const { getOrder, classifyOrder } = require('./_lib/ngenius');
const { PAID_PLAN_PRICES } = require('./_lib/plans');
const { rateLimit, getIp } = require('./_lib/rate-limit');

const SB_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';

const REGISTER_FIELDS = ['org_name', 'email', 'phone', 'org_type', 'cr_num', 'city', 'fname', 'lname', 'title', 'website', 'purpose', 'volume', 'notes', 'ref_num'];

function secret() {
  const s = process.env.PARTNER_SECRET || process.env.SUPABASE_SERVICE_KEY;
  if (!s) throw new Error('PARTNER_SECRET not configured');
  return s;
}

// Cloudflare Turnstile server-side verification — optional, additive bot protection.
// If TURNSTILE_SECRET_KEY is not set (no Cloudflare account connected yet), this is a
// no-op and login proceeds exactly as before — mirrors the ANTHROPIC_API_KEY fallback
// pattern used in api/chat-khalid.js.
async function verifyTurnstile(token, ip) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    console.warn('TURNSTILE_SECRET_KEY not configured — skipping Turnstile verification (login unprotected)');
    return true;
  }
  if (!token) return false;
  try {
    const params = new URLSearchParams();
    params.append('secret', secretKey);
    params.append('response', token);
    if (ip) params.append('remoteip', ip);

    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await r.json();
    return !!data.success;
  } catch (err) {
    console.error('Turnstile verification error:', err.message);
    return false;
  }
}

function makeToken(email) {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', secret()).update(`${email}|${ts}`).digest('hex');
  return Buffer.from(`${email}|${ts}|${sig}`).toString('base64url');
}

// OTP challenge token — HMAC(otp|email|ts), valid for given maxMs
function makeOtpToken(email, otp) {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', secret()).update(`${otp}|${email}|${ts}`).digest('hex');
  return Buffer.from(`${email}|${ts}|${sig}`).toString('base64url');
}

function verifyOtpToken(token, otp, maxMs) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const lastBar = decoded.lastIndexOf('|');
    const firstBar = decoded.indexOf('|');
    if (firstBar === -1 || lastBar === -1 || firstBar === lastBar) return null;
    const email = decoded.slice(0, firstBar);
    const ts = decoded.slice(firstBar + 1, lastBar);
    const sig = decoded.slice(lastBar + 1);
    if (Date.now() - parseInt(ts) > maxMs) return null;
    const expected = crypto.createHmac('sha256', secret()).update(`${otp}|${email}|${ts}`).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    return email;
  } catch { return null; }
}

async function sbGet(path, key) {
  const r = await fetch(`${SB_URL}/rest/v1${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`DB ${r.status}`);
  return r.json();
}

async function sbWrite(method, path, body, key) {
  const r = await fetch(`${SB_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

function buildPartnerRow(partnerData) {
  const row = {};
  for (const k of REGISTER_FIELDS) {
    if (partnerData && partnerData[k] !== undefined) row[k] = partnerData[k];
  }
  return row;
}

module.exports = async (req, res) => {
  const _ORIGIN = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', _ORIGIN);
  if (_ORIGIN !== '*') res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(503).json({ error: 'not_configured' });

  const body = req.body || {};
  const ip = getIp(req);

  try {
    // ─── LOGIN — validate credentials, send OTP server-side ──────────────────
    if (body.action === 'login') {
      const { email, password, turnstileToken } = body;
      if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

      const turnstileOk = await verifyTurnstile(turnstileToken, ip);
      if (!turnstileOk) return res.status(400).json({ error: 'turnstile_failed' });

      const { limited } = await rateLimit(`login:${ip}`, 10, 15 * 60 * 1000);
      if (limited) return res.status(429).json({ error: 'too_many_attempts' });

      const isRef = /^(RAFD|MAN)-/i.test(email.trim());
      const field = isRef ? 'ref_num' : 'email';
      const val = isRef ? email.trim().toUpperCase() : email.trim().toLowerCase();

      const rows = await sbGet(
        `/partners?${field}=eq.${encodeURIComponent(val)}&select=*&limit=1`, key
      );
      if (!rows?.length) return res.status(401).json({ error: 'invalid' });

      const p = rows[0];
      const { valid, needsRehash } = verifyPassword(password, p.password);
      if (!valid) return res.status(401).json({ error: 'invalid' });

      if (needsRehash) {
        sbWrite('PATCH', `/partners?id=eq.${p.id}`, { password: hashPassword(password) }, key).catch(() => {});
      }

      if (p.status === 'rejected') {
        return res.status(200).json({ rejected: true });
      }

      // Generate and send login OTP server-side — never returned to browser
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const challengeToken = makeOtpToken(p.email, otp);

      if (process.env.RESEND_API_KEY) {
        await sendLoginOtpEmail(p.email, otp, p.fname || p.org_name).catch(() => {});
      }

      return res.status(200).json({ ok: true, challengeToken, partnerEmail: p.email });
    }

    // ─── VERIFY LOGIN OTP — returns real session token after OTP confirmed ────
    if (body.action === 'verify_login_otp') {
      const { challengeToken, otp } = body;
      if (!challengeToken || !otp) return res.status(400).json({ error: 'missing_fields' });

      const { limited } = await rateLimit(`otp:${ip}`, 10, 5 * 60 * 1000);
      if (limited) return res.status(429).json({ error: 'too_many_attempts' });

      const email = verifyOtpToken(challengeToken, otp, 5 * 60 * 1000);
      if (!email) return res.status(401).json({ error: 'invalid_or_expired_otp' });

      const rows = await sbGet(
        `/partners?email=eq.${encodeURIComponent(email)}&select=*&limit=1`, key
      );
      if (!rows?.length) return res.status(404).json({ error: 'not_found' });

      const p = rows[0];
      return res.status(200).json({ token: makeToken(p.email), partner: p });
    }

    // ─── RESEND LOGIN OTP ─────────────────────────────────────────────────────
    if (body.action === 'resend_login_otp') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'missing_fields' });

      const { limited } = await rateLimit(`resend:${ip}`, 5, 5 * 60 * 1000);
      if (limited) return res.status(429).json({ error: 'too_many_attempts' });

      const emailNorm = email.trim().toLowerCase();

      const rows = await sbGet(
        `/partners?email=eq.${encodeURIComponent(emailNorm)}&select=id,email,fname,org_name&limit=1`, key
      );
      if (!rows?.length) return res.status(200).json({ ok: true }); // silent — no enumeration

      const p = rows[0];
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const challengeToken = makeOtpToken(p.email, otp);

      if (process.env.RESEND_API_KEY) {
        await sendLoginOtpEmail(p.email, otp, p.fname || p.org_name).catch(() => {});
      }

      return res.status(200).json({ ok: true, challengeToken });
    }

    // ─── SEARCH ORG ──────────────────────────────────────────────────────────
    // Unauthenticated helper for the "forgot email / forgot username" flows.
    // Returns MASKED identifiers only — the full email and ref_num must never
    // leave the server for an unauthenticated caller (enumeration/phishing risk).
    if (body.action === 'search_org') {
      const { orgName } = body;
      if (!orgName) return res.status(400).json({ error: 'missing_fields' });

      const { limited } = await rateLimit(`search_org:${ip}`, 5, 15 * 60 * 1000);
      if (limited) return res.status(429).json({ error: 'too_many_attempts' });

      const rows = await sbGet(
        `/partners?org_name=ilike.*${encodeURIComponent(orgName)}*&select=email,org_name,ref_num&limit=5`, key
      );
      const results = (rows || []).map(p => {
        const [u, d] = String(p.email || '').split('@');
        const maskedEmail = u && d ? `${u.slice(0, 2)}***@${d}` : null;
        const ref = String(p.ref_num || '');
        const maskedRef = ref ? `${ref.slice(0, ref.indexOf('-') + 2)}***${ref.slice(-2)}` : null;
        return { org_name: p.org_name, masked_email: maskedEmail, masked_ref: maskedRef };
      });
      return res.status(200).json({ results });
    }

    // ─── NAFATH LOOKUP (محاكاة تجريبية — الربط مع سدايا قيد التطوير) ─────────
    if (body.action === 'nafath_lookup') {
      return res.status(200).json({ simulation: true, message: 'nafath_pending_sdaia' });
    }

    // ─── CHECK EMAIL (registration duplicate check — boolean only) ───────────
    if (body.action === 'check_email') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'missing_fields' });

      const { limited } = await rateLimit(`check_email:${ip}`, 15, 15 * 60 * 1000);
      if (limited) return res.status(429).json({ error: 'too_many_attempts' });

      const rows = await sbGet(
        `/partners?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=id&limit=1`, key
      );
      return res.status(200).json({ exists: !!rows?.length });
    }

    // ─── REGISTER AFTER PAYMENT ──────────────────────────────────────────────
    if (body.action === 'register_after_payment') {
      const { orderRef, plan, partnerData, password } = body;
      if (!orderRef || !plan || !partnerData || !password) return res.status(400).json({ error: 'missing_fields' });

      const expectedPrice = PAID_PLAN_PRICES[plan];
      if (!expectedPrice) return res.status(400).json({ error: 'invalid_plan' });

      const existing = await sbGet(
        `/partners?payment_ref=eq.${encodeURIComponent(orderRef)}&select=*&limit=1`, key
      );
      if (existing?.length) {
        const p = existing[0];
        return res.status(200).json({ ok: true, partner: p, token: makeToken(p.email), alreadyProcessed: true });
      }

      let order;
      try {
        order = await getOrder(orderRef);
      } catch (err) {
        console.error('register_after_payment: order fetch failed', err.message);
        return res.status(502).json({ error: 'payment_verification_failed' });
      }
      const { status, amount } = classifyOrder(order);

      if (status !== 'SUCCESS') {
        return res.status(402).json({ error: 'payment_not_confirmed', status });
      }
      if (amount !== expectedPrice) {
        console.error(`register_after_payment: amount mismatch — expected ${expectedPrice}, got ${amount} (ref ${orderRef})`);
        return res.status(402).json({ error: 'amount_mismatch' });
      }

      const row = buildPartnerRow(partnerData);
      row.password = hashPassword(password);
      row.status = 'approved';
      row.plan = plan;
      row.price = expectedPrice;
      row.payment_ref = orderRef;

      const result = await sbWrite('POST', '/partners', row, key);
      const partner = Array.isArray(result) ? result[0] : result;

      let emailSent = false;
      if (process.env.RESEND_API_KEY && partner) {
        emailSent = await sendActivationEmail(partner).then(() => true).catch(() => false);
      }

      return res.status(200).json({ ok: true, partner, token: partner ? makeToken(partner.email) : null, emailSent });
    }

    // ─── REGISTER AFTER TAMARA PAYMENT ───────────────────────────────────────
    if (body.action === 'register_after_tamara_payment') {
      const { orderId, plan, partnerData, password } = body;
      if (!orderId || !plan || !partnerData || !password) return res.status(400).json({ error: 'missing_fields' });

      const expectedPrice = PAID_PLAN_PRICES[plan];
      if (!expectedPrice) return res.status(400).json({ error: 'invalid_plan' });

      const existing = await sbGet(
        `/partners?payment_ref=eq.${encodeURIComponent(orderId)}&select=*&limit=1`, key
      );
      if (existing?.length) {
        const p = existing[0];
        return res.status(200).json({ ok: true, partner: p, token: makeToken(p.email), alreadyProcessed: true });
      }

      const tamaraToken = process.env.TAMARA_API_TOKEN;
      const tamaraUrl = (process.env.TAMARA_API_URL || 'https://api.tamara.co').replace(/\/$/, '');
      if (!tamaraToken) return res.status(500).json({ error: 'Tamara not configured' });

      let tamaraOrder;
      try {
        const r = await fetch(`${tamaraUrl}/orders/${encodeURIComponent(orderId)}`, {
          headers: { Authorization: `Bearer ${tamaraToken}` },
        });
        if (!r.ok) {
          console.error('register_after_tamara_payment: Tamara API error', r.status);
          return res.status(502).json({ error: 'payment_verification_failed' });
        }
        tamaraOrder = await r.json();
      } catch (err) {
        console.error('register_after_tamara_payment: fetch error', err.message);
        return res.status(502).json({ error: 'payment_verification_failed' });
      }

      const tamaraStatus = (tamaraOrder.status || '').toLowerCase();
      if (!['approved', 'fully_captured', 'partially_captured'].includes(tamaraStatus)) {
        return res.status(402).json({ error: 'payment_not_confirmed', status: tamaraStatus });
      }

      const tamaraAmount = parseFloat(tamaraOrder.total_amount?.amount || '0');
      if (Math.abs(tamaraAmount - expectedPrice) > 0.01) {
        console.error(`register_after_tamara_payment: amount mismatch — expected ${expectedPrice}, got ${tamaraAmount} (orderId ${orderId})`);
        return res.status(402).json({ error: 'amount_mismatch' });
      }

      const row = buildPartnerRow(partnerData);
      row.password = hashPassword(password);
      row.status = 'approved';
      row.plan = plan;
      row.price = expectedPrice;
      row.payment_ref = orderId;

      const result = await sbWrite('POST', '/partners', row, key);
      const partner = Array.isArray(result) ? result[0] : result;

      let emailSent = false;
      if (process.env.RESEND_API_KEY && partner) {
        emailSent = await sendActivationEmail(partner).then(() => true).catch(() => false);
      }

      return res.status(200).json({ ok: true, partner, token: partner ? makeToken(partner.email) : null, emailSent });
    }

    // ─── SEND RESET OTP (server-side — OTP never leaves server) ─────────────
    if (body.action === 'send_reset_otp') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'missing_fields' });

      const { limited } = await rateLimit(`reset:${ip}`, 3, 15 * 60 * 1000);
      if (limited) return res.status(429).json({ error: 'too_many_attempts' });

      const emailNorm = email.trim().toLowerCase();

      const rows = await sbGet(
        `/partners?email=eq.${encodeURIComponent(emailNorm)}&select=id,email,fname,org_name&limit=1`, key
      );
      // Always return ok to prevent email enumeration
      if (!rows?.length) return res.status(200).json({ ok: true });

      const p = rows[0];
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const resetToken = makeOtpToken(emailNorm, otp);

      if (process.env.RESEND_API_KEY) {
        await sendResetEmail(emailNorm, otp, p.fname || p.org_name).catch(() => {});
      }

      return res.status(200).json({ ok: true, resetToken });
    }

    // ─── RESET PASSWORD (requires server-issued resetToken + entered OTP) ────
    if (body.action === 'reset_password') {
      const { resetToken, otp, newPassword } = body;
      if (!resetToken || !otp || !newPassword) return res.status(400).json({ error: 'missing_fields' });

      const email = verifyOtpToken(resetToken, otp, 10 * 60 * 1000);
      if (!email) return res.status(401).json({ error: 'invalid_or_expired_token' });

      if (newPassword.length < 8) return res.status(400).json({ error: 'password_too_short' });

      await sbWrite('PATCH', `/partners?email=eq.${encodeURIComponent(email)}`,
        { password: hashPassword(newPassword) }, key);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action' });

  } catch (err) {
    console.error('partner-auth error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};

async function sendLoginOtpEmail(email, otp, name) {
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Cairo','Segoe UI',Arial,sans-serif;direction:rtl">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:40px 16px">
<tr><td align="center">
<table width="100%" style="max-width:580px" cellpadding="0" cellspacing="0">
  <tr><td style="background:linear-gradient(135deg,#0d2233 0%,#1a3a4a 50%,#1e5c42 100%);border-radius:20px 20px 0 0;padding:32px 36px;text-align:center">
    <img src="https://rafd-digital.com/rafd-logo.png" alt="RAFD Digital" width="70" height="70"
      style="border-radius:14px;background:#fff;padding:6px;box-shadow:0 4px 20px rgba(0,0,0,.3);display:block;margin:0 auto 12px">
    <div style="font-size:1.4rem;font-weight:900;color:#fff;font-family:'Cairo',sans-serif">رمز تسجيل الدخول 🔐</div>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#1a3a4a,#4a9d6f,#38bdf8)"></td></tr>
  <tr><td style="background:#fff;padding:36px 32px;text-align:center">
    <p style="color:#0d2233;font-size:1rem;font-weight:700;margin:0 0 8px;font-family:'Cairo',sans-serif">مرحباً ${name || ''}،</p>
    <p style="color:#5a6a7e;font-size:.9rem;margin:0 0 24px;line-height:1.8;font-family:'Cairo',sans-serif">
      تلقّينا طلب دخول لحسابك في RAFD Digital.<br>
      استخدم الرمز أدناه — صالح لمدة <strong>5 دقائق</strong> فقط.
    </p>
    <div style="font-size:3rem;font-weight:900;letter-spacing:.4em;color:#0d2233;background:#f0f7ff;border:2px solid #c8dfe8;border-radius:16px;padding:1.25rem 2rem;display:inline-block;direction:ltr;margin-bottom:20px;font-family:monospace">${otp}</div>
    <div style="background:#fff8f0;border-right:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:12px 16px;text-align:right;margin-bottom:0">
      <p style="margin:0;color:#7c4a03;font-size:.82rem;font-family:'Cairo',sans-serif">لا تشارك هذا الرمز مع أي أحد. إذا لم تحاول تسجيل الدخول، تجاهل هذه الرسالة.</p>
    </div>
  </td></tr>
  <tr><td style="background:linear-gradient(135deg,#0d2233,#1a3a4a);border-radius:0 0 20px 20px;padding:20px 32px;text-align:center">
    <p style="margin:0;color:rgba(255,255,255,.5);font-size:.76rem;font-family:'Cairo',sans-serif">© 2026 RAFD Digital</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'RAFD Digital <noreply@rafd-digital.com>',
      to: [email],
      subject: `${otp} — رمز تسجيل الدخول في RAFD Digital`,
      html,
    }),
  });
  if (!r.ok) throw new Error(`login OTP email failed: ${r.status}`);
}

async function sendResetEmail(email, otp, name) {
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Cairo','Segoe UI',Arial,sans-serif;direction:rtl">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:40px 16px">
<tr><td align="center">
<table width="100%" style="max-width:540px" cellpadding="0" cellspacing="0">
  <tr><td style="background:linear-gradient(135deg,#0d2233,#1a3a4a);border-radius:20px 20px 0 0;padding:28px 32px;text-align:center">
    <div style="font-size:1.4rem;font-weight:900;color:#fff;font-family:'Cairo',sans-serif">إعادة تعيين كلمة المرور 🔑</div>
  </td></tr>
  <tr><td style="background:#fff;padding:36px 32px;text-align:center">
    <p style="color:#0d2233;font-size:1rem;font-weight:700;margin:0 0 8px;font-family:'Cairo',sans-serif">مرحباً ${name || ''}،</p>
    <p style="color:#5a6a7e;font-size:.9rem;margin:0 0 24px;line-height:1.8;font-family:'Cairo',sans-serif">
      استخدم الرمز أدناه لإعادة تعيين كلمة المرور. صالح لمدة <strong>10 دقائق</strong> فقط.
    </p>
    <div style="font-size:2.4rem;font-weight:900;letter-spacing:.4em;color:#1a3a4a;background:#f0f7ff;border:2px solid #c8dfe8;border-radius:16px;padding:1rem 2rem;display:inline-block;direction:ltr;margin-bottom:24px;font-family:monospace">${otp}</div>
    <p style="color:#94a3b8;font-size:.8rem;margin:0;font-family:'Cairo',sans-serif">إذا لم تطلب إعادة التعيين، تجاهل هذه الرسالة.</p>
  </td></tr>
  <tr><td style="background:linear-gradient(135deg,#0d2233,#1a3a4a);border-radius:0 0 20px 20px;padding:20px 32px;text-align:center">
    <p style="margin:0;color:rgba(255,255,255,.5);font-size:.76rem;font-family:'Cairo',sans-serif">© 2026 RAFD Digital</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'RAFD Digital <noreply@rafd-digital.com>',
      to: [email],
      subject: 'رمز إعادة تعيين كلمة المرور — RAFD Digital',
      html,
    }),
  });
  if (!r.ok) throw new Error(`reset email failed: ${r.status}`);
}

async function sendActivationEmail(partner) {
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Cairo','Segoe UI',Arial,sans-serif;direction:rtl">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:40px 16px">
<tr><td align="center">
<table width="100%" style="max-width:580px" cellpadding="0" cellspacing="0">
  <tr><td style="background:linear-gradient(135deg,#0d2233 0%,#1a3a4a 50%,#1e5c42 100%);border-radius:20px 20px 0 0;padding:32px 36px;text-align:center">
    <img src="https://rafd-digital.com/rafd-logo.png" alt="RAFD Digital" width="80" height="80"
      style="border-radius:14px;background:#fff;padding:6px;box-shadow:0 4px 20px rgba(0,0,0,.3);margin-bottom:14px;display:block;margin-left:auto;margin-right:auto">
    <div style="font-size:1.55rem;font-weight:900;color:#fff;font-family:'Cairo',sans-serif">تم تفعيل حسابك 🎉</div>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#1a3a4a,#4a9d6f,#38bdf8)"></td></tr>
  <tr><td style="background:#ffffff;padding:40px 36px">
    <p style="color:#0d2233;font-size:1.05rem;margin:0 0 8px;font-weight:700;font-family:'Cairo',sans-serif">مرحباً ${partner.fname || ''}،</p>
    <p style="color:#5a6a7e;font-size:.9rem;margin:0 0 24px;line-height:1.85;font-family:'Cairo',sans-serif">
      تم تأكيد دفعتك وتفعيل حساب <strong style="color:#1a3a4a">${partner.org_name || ''}</strong> على منصة RAFD Digital بنجاح.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      <tr><td style="background:linear-gradient(135deg,#f0f7ff,#e8f5ee);border:2px solid #c8dfe8;border-radius:16px;padding:24px 20px">
        <p style="margin:0 0 10px;font-size:.85rem;color:#5a6a7e;font-family:'Cairo',sans-serif">الرقم المرجعي: <strong style="color:#0d2233">${partner.ref_num || ''}</strong></p>
        <p style="margin:0;font-size:.85rem;color:#5a6a7e;font-family:'Cairo',sans-serif">إيميل الدخول: <strong style="color:#0d2233">${partner.email || ''}</strong></p>
      </td></tr>
    </table>
    <p style="text-align:center;margin:0 0 8px">
      <a href="https://rafd-digital.com/partner-login.html" style="display:inline-block;background:linear-gradient(135deg,#1a3a4a,#2d5a6e);color:#fff;text-decoration:none;font-weight:700;padding:14px 36px;border-radius:12px;font-family:'Cairo',sans-serif">تسجيل الدخول ←</a>
    </p>
  </td></tr>
  <tr><td style="background:linear-gradient(135deg,#0d2233,#1a3a4a);border-radius:0 0 20px 20px;padding:24px 36px;text-align:center">
    <p style="margin:0;color:rgba(255,255,255,.5);font-size:.78rem;font-family:'Cairo',sans-serif">
      © 2026 <a href="https://rafd-digital.com" style="color:#4a9d6f;font-weight:700;text-decoration:none">RAFD Digital</a> — جميع الحقوق محفوظة
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'RAFD Digital <noreply@rafd-digital.com>',
      to: [partner.email],
      subject: 'تم تفعيل حسابك في RAFD Digital 🎉',
      html,
    }),
  });
  if (!r.ok) throw new Error(`activation email failed: ${r.status}`);
}
