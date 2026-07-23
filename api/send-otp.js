'use strict';
const crypto = require('crypto');
const { rateLimit, getIp } = require('./_lib/rate-limit');

function secret() {
  const s = process.env.PARTNER_SECRET || process.env.SUPABASE_SERVICE_KEY;
  if (!s) throw new Error('OTP_SECRET not configured');
  return s;
}

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

module.exports = async (req, res) => {
  const _ORIGIN = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', _ORIGIN);
  if (_ORIGIN !== '*') res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const ip = getIp(req);
  const body = req.body || {};

  // ─── VERIFY OTP ──────────────────────────────────────────────────────
  if (body.action === 'verify_otp') {
    const { challengeToken, otp } = body;
    if (!challengeToken || !otp) return res.status(400).json({ error: 'missing_fields' });
    if (!/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'invalid_otp_format' });

    const { limited } = await rateLimit(`otp_verify:${ip}`, 5, 10 * 60 * 1000);
    if (limited) return res.status(429).json({ error: 'too_many_attempts' });

    const email = verifyOtpToken(challengeToken, otp, 10 * 60 * 1000);
    if (!email) return res.status(401).json({ error: 'invalid_or_expired_otp' });

    return res.status(200).json({ ok: true, email });
  }

  // ─── SEND OTP ────────────────────────────────────────────────────────
  try {
    const { email, fname } = body;
    if (!email) return res.status(400).json({ error: 'missing_fields' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' });

    const { limited } = await rateLimit(`otp_send:${ip}`, 3, 10 * 60 * 1000);
    if (limited) return res.status(429).json({ error: 'too_many_attempts' });

    const safeName = String(fname || '').replace(/<[^>]*>/g, '').slice(0, 80);
    const otp = crypto.randomInt(100000, 1000000).toString();
    const challengeToken = makeOtpToken(email, otp);

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'RAFD Digital <noreply@rafd-digital.com>',
        to: [email],
        subject: `${otp} - رمز التفعيل في RAFD Digital`,
        text: `مرحباً ${safeName}،\n\nرمز التفعيل الخاص بك في RAFD Digital هو: ${otp}\n\nصالح لمدة 10 دقائق فقط. لا تشاركه مع أي أحد.\n\nإذا لم تطلب هذا الرمز، تجاهل هذا البريد.\n\nRAFD Digital — support@rafd-digital.com`,
        html: `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Cairo','Segoe UI',Arial,sans-serif;direction:rtl">

<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:40px 16px">
<tr><td align="center">
<table width="100%" style="max-width:580px" cellpadding="0" cellspacing="0">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#0d2233 0%,#1a3a4a 50%,#1e5c42 100%);border-radius:20px 20px 0 0;padding:32px 36px;text-align:center">
    <img src="https://rafd-digital.com/rafd-logo.png" alt="RAFD Digital" width="80" height="80"
      style="border-radius:14px;background:#fff;padding:6px;box-shadow:0 4px 20px rgba(0,0,0,.3);margin-bottom:14px;display:block;margin-left:auto;margin-right:auto">
    <div style="font-size:1.55rem;font-weight:900;color:#fff;letter-spacing:-.5px;font-family:'Cairo',sans-serif">RAFD Digital</div>
    <div style="font-size:.8rem;color:rgba(255,255,255,.6);margin-top:5px;letter-spacing:.5px">منصة التقييم الذكي للمتقدمين</div>
  </td></tr>

  <!-- ACCENT LINE -->
  <tr><td style="height:4px;background:linear-gradient(90deg,#1a3a4a,#4a9d6f,#38bdf8)"></td></tr>

  <!-- BODY -->
  <tr><td style="background:#ffffff;padding:40px 36px">

    <p style="color:#0d2233;font-size:1.05rem;margin:0 0 8px;font-weight:700;font-family:'Cairo',sans-serif">مرحباً ${safeName}،</p>
    <p style="color:#5a6a7e;font-size:.9rem;margin:0 0 30px;line-height:1.85;font-family:'Cairo',sans-serif">
      تلقّينا طلب تحقق من هويتك على منصة <strong style="color:#1a3a4a">RAFD Digital</strong>.<br>
      استخدم الرمز أدناه لإتمام التسجيل:
    </p>

    <!-- OTP BOX -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:30px">
      <tr><td style="background:linear-gradient(135deg,#f0f7ff,#e8f5ee);border:2px solid #c8dfe8;border-radius:16px;padding:30px 20px;text-align:center">
        <div style="font-size:.7rem;color:#8fa3b1;margin-bottom:12px;letter-spacing:2px;text-transform:uppercase;font-family:'Cairo',sans-serif">رمز التحقق الخاص بك</div>
        <div style="font-size:3.2rem;font-weight:900;letter-spacing:16px;color:#0d2233;font-family:'Courier New',monospace;text-shadow:0 2px 4px rgba(13,34,51,.1)">${otp}</div>
        <div style="margin-top:14px;display:inline-block;background:#fff3cd;border:1px solid #f0c040;border-radius:20px;padding:5px 16px">
          <span style="font-size:.75rem;color:#856404;font-family:'Cairo',sans-serif">⏱ صالح لمدة <strong>10 دقائق</strong> فقط</span>
        </div>
      </td></tr>
    </table>

    <!-- SECURITY NOTE -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      <tr><td style="background:#fff8f0;border-right:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:14px 16px">
        <p style="margin:0;color:#7c4a03;font-size:.82rem;line-height:1.8;font-family:'Cairo',sans-serif">
          <strong>تنبيه أمني:</strong> لا تشارك هذا الرمز مع أي شخص. فريق RAFD Digital لن يطلبه منك أبداً.
          إذا لم تطلب هذا الرمز، تجاهل هذا البريد.
        </p>
      </td></tr>
    </table>

    <p style="color:#94a3b8;font-size:.8rem;line-height:1.7;margin:0;font-family:'Cairo',sans-serif">
      تواصل معنا عبر
      <a href="mailto:support@rafd-digital.com" style="color:#1a3a4a;font-weight:700;text-decoration:none">support@rafd-digital.com</a>
    </p>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:linear-gradient(135deg,#0d2233,#1a3a4a);border-radius:0 0 20px 20px;padding:24px 36px;text-align:center">
    <p style="margin:0 0 10px;color:rgba(255,255,255,.5);font-size:.78rem;font-family:'Cairo',sans-serif">
      © 2026 <a href="https://rafd-digital.com" style="color:#4a9d6f;font-weight:700;text-decoration:none">RAFD Digital</a> — جميع الحقوق محفوظة
    </p>
    <p style="margin:0;color:rgba(255,255,255,.3);font-size:.72rem;font-family:'Cairo',sans-serif">
      تلقيت هذا البريد لأن بريدك الإلكتروني استُخدم للتسجيل في منصتنا
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`
      })
    });

    if (!response.ok) return res.status(500).json({ error: 'email_send_failed' });
    return res.status(200).json({ success: true, challengeToken });

  } catch (err) {
    console.error('send-otp error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};
