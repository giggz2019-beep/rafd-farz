// Partner authentication — no Supabase client in browser needed
const crypto = require('crypto');
const { hash: hashPassword, verify: verifyPassword } = require('./_lib/password');
const { getOrder, classifyOrder } = require('./_lib/ngenius');
const { PAID_PLAN_PRICES } = require('./_lib/plans');

const SB_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';

// Fields a client is allowed to set when creating a partner row. status,
// plan, price, and payment_ref are always decided server-side below —
// never trust these from the request body.
const REGISTER_FIELDS = ['org_name', 'email', 'phone', 'org_type', 'cr_num', 'city', 'fname', 'lname', 'title', 'website', 'purpose', 'volume', 'notes', 'ref_num'];

function secret() {
  return process.env.PARTNER_SECRET || process.env.SUPABASE_SERVICE_KEY || 'rafd-fallback';
}

function makeToken(email) {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', secret()).update(`${email}|${ts}`).digest('hex');
  return Buffer.from(`${email}|${ts}|${sig}`).toString('base64url');
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(503).json({ error: 'not_configured' });

  const body = req.body || {};

  try {
    // ─── LOGIN ───────────────────────────────────────────────────────────────
    if (body.action === 'login') {
      const { email, password } = body;
      if (!email || !password) return res.status(400).json({ error: 'missing_fields' });

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

      return res.status(200).json({ token: makeToken(p.email), partner: p });
    }

    // ─── SEARCH ORG ──────────────────────────────────────────────────────────
    if (body.action === 'search_org') {
      const { orgName } = body;
      if (!orgName) return res.status(400).json({ error: 'missing_fields' });
      const rows = await sbGet(
        `/partners?org_name=ilike.*${encodeURIComponent(orgName)}*&select=email,org_name,ref_num&limit=5`, key
      );
      return res.status(200).json({ results: rows || [] });
    }

    // ─── NAFATH LOOKUP ───────────────────────────────────────────────────────
    if (body.action === 'nafath_lookup') {
      const { nid } = body;
      if (!nid) return res.status(400).json({ error: 'missing_fields' });
      const rows = await sbGet(
        `/partners?national_id=eq.${encodeURIComponent(nid)}&select=*&limit=1`, key
      );
      if (!rows?.length) return res.status(404).json({ error: 'not_found' });
      const p = rows[0];
      return res.status(200).json({ token: makeToken(p.email), partner: p });
    }

    // ─── LOOKUP BY EMAIL ─────────────────────────────────────────────────────
    if (body.action === 'lookup_email') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'missing_fields' });
      const rows = await sbGet(
        `/partners?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=id,email,org_name&limit=1`, key
      );
      if (!rows?.length) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ partner: rows[0] });
    }

    // ─── CHECK EMAIL (duplicate-signup check, server-side) ──────────────────
    if (body.action === 'check_email') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'missing_fields' });
      const rows = await sbGet(
        `/partners?email=eq.${encodeURIComponent(email.trim().toLowerCase())}&select=id&limit=1`, key
      );
      return res.status(200).json({ exists: !!rows?.length });
    }

    // ─── REGISTER AFTER PAYMENT (all plans require payment) ──────────────────
    if (body.action === 'register_after_payment') {
      const { orderRef, plan, partnerData, password } = body;
      if (!orderRef || !plan || !partnerData || !password) return res.status(400).json({ error: 'missing_fields' });

      const expectedPrice = PAID_PLAN_PRICES[plan];
      if (!expectedPrice) return res.status(400).json({ error: 'invalid_plan' });

      // Idempotency — a retried/refreshed payment-result page must not create a second account.
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

    // ─── RESET PASSWORD ──────────────────────────────────────────────────────
    if (body.action === 'reset_password') {
      const { partnerId, newPassword } = body;
      if (!partnerId || !newPassword) return res.status(400).json({ error: 'missing_fields' });
      await sbWrite('PATCH', `/partners?id=eq.${partnerId}`, { password: hashPassword(newPassword) }, key);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action' });

  } catch (err) {
    console.error('partner-auth error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

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
    <p style="color:#94a3b8;font-size:.8rem;line-height:1.7;margin:24px 0 0;text-align:center;font-family:'Cairo',sans-serif">
      سجّل الدخول بكلمة المرور التي اخترتها أثناء التسجيل.
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
