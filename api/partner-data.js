// All authenticated partner data operations
// Every request must include a valid { token }
const crypto = require('crypto');
const { hash: hashPassword, verify: verifyPassword } = require('./_lib/password');
const { getOrder, classifyOrder } = require('./_lib/ngenius');
const { PAID_PLAN_PRICES } = require('./_lib/plans');

const SB_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';

const ALLOWED_ADD_APP_FIELDS = [
  'full_name', 'fname', 'lname', 'email', 'phone',
  'gender', 'birth_date', 'nationality', 'city',
  'education', 'major', 'gpa', 'experience', 'experience_years',
  'position', 'skills', 'notes', 'national_id_num',
  'cv_url', 'id_doc_url', 'edu_doc_url', 'exp_doc_url', 'cert_doc_url', 'other_doc_url',
];

function secret() {
  const s = process.env.PARTNER_SECRET || process.env.SUPABASE_SERVICE_KEY;
  if (!s) throw new Error('PARTNER_SECRET not configured');
  return s;
}

function validateToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const lastBar = decoded.lastIndexOf('|');
    const secondBar = decoded.lastIndexOf('|', lastBar - 1);
    if (secondBar === -1 || lastBar === -1) return null;
    const email = decoded.slice(0, secondBar);
    const ts = decoded.slice(secondBar + 1, lastBar);
    const sig = decoded.slice(lastBar + 1);
    // 30-day expiry
    if (Date.now() - parseInt(ts) > 30 * 24 * 60 * 60 * 1000) return null;
    const expected = crypto.createHmac('sha256', secret()).update(`${email}|${ts}`).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    return email;
  } catch { return null; }
}

async function sb(method, path, body, key) {
  const r = await fetch(`${SB_URL}/rest/v1${path}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`DB ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
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

  // ─── ADMIN PREVIEW (admin password required) ─────────────────────────────
  if (body.action === 'admin_preview') {
    const adminPass = process.env.ADMIN_PASSWORD;
    if (!adminPass || body.adminPassword !== adminPass) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const { refNum } = body;
    const rows = await sb('GET', `/partners?ref_num=eq.${encodeURIComponent(refNum)}&select=*&limit=1`, undefined, key);
    if (!rows?.length) return res.status(404).json({ error: 'not_found' });
    const partner = rows[0];
    const apps = await sb('GET', `/applications?partner_id=eq.${partner.id}&order=created_at.desc&limit=500`, undefined, key);
    return res.status(200).json({ partner, applications: apps || [] });
  }

  // ─── TOKEN VALIDATION ─────────────────────────────────────────────────────
  const email = validateToken(body.token);
  if (!email) return res.status(401).json({ error: 'invalid_session' });

  try {
    const action = body.action;

    // LOAD PARTNER
    if (action === 'load') {
      const rows = await sb('GET', `/partners?email=eq.${encodeURIComponent(email)}&select=*&limit=1`, undefined, key);
      if (!rows?.length) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ partner: rows[0] });
    }

    // UPDATE FORM CONFIG
    if (action === 'update_config') {
      const { form_config } = body;
      await sb('PATCH', `/partners?email=eq.${encodeURIComponent(email)}`, { form_config }, key);
      return res.status(200).json({ ok: true });
    }

    // UPDATE PROFILE
    if (action === 'update_profile') {
      const allowed = ['org_name','org_type','city','website','fname','lname','title','phone'];
      const patch = {};
      const profile = body.profile || {};
      allowed.forEach(k => { if (profile[k] !== undefined) patch[k] = profile[k]; });
      await sb('PATCH', `/partners?email=eq.${encodeURIComponent(email)}`, patch, key);
      return res.status(200).json({ ok: true });
    }

    // UPDATE PASSWORD
    if (action === 'update_password') {
      const { newPassword } = body;
      if (!newPassword) return res.status(400).json({ error: 'missing_fields' });
      await sb('PATCH', `/partners?email=eq.${encodeURIComponent(email)}`, { password: hashPassword(newPassword) }, key);
      return res.status(200).json({ ok: true });
    }

    // DELETE ACCOUNT — requires current password, removes applications then the partner row
    if (action === 'delete_account') {
      const { password } = body;
      if (!password) return res.status(400).json({ error: 'missing_password' });
      const rows = await sb('GET', `/partners?email=eq.${encodeURIComponent(email)}&select=id,password&limit=1`, undefined, key);
      if (!rows?.length) return res.status(404).json({ error: 'not_found' });
      const { valid } = verifyPassword(password, rows[0].password);
      if (!valid) return res.status(401).json({ error: 'wrong_password' });
      const partnerId = rows[0].id;
      await sb('DELETE', `/applications?partner_id=eq.${partnerId}`, undefined, key);
      await sb('DELETE', `/partners?id=eq.${partnerId}`, undefined, key);
      return res.status(200).json({ ok: true });
    }

    // UPDATE REF NUM
    if (action === 'update_ref') {
      const { ref_num } = body;
      await sb('PATCH', `/partners?email=eq.${encodeURIComponent(email)}`, { ref_num }, key);
      return res.status(200).json({ ok: true });
    }

    // LOAD APPLICATIONS
    if (action === 'load_apps') {
      const rows = await sb('GET', `/partners?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, undefined, key);
      if (!rows?.length) return res.status(404).json({ error: 'not_found' });
      const partnerId = rows[0].id;
      const apps = await sb('GET', `/applications?partner_id=eq.${partnerId}&order=created_at.desc&limit=500`, undefined, key);
      return res.status(200).json({ applications: apps || [] });
    }

    // UPDATE APPLICATION STATUS — with ownership check
    if (action === 'update_app') {
      const { appId, status } = body;
      if (!appId) return res.status(400).json({ error: 'missing_fields' });
      const pRows = await sb('GET', `/partners?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, undefined, key);
      if (!pRows?.length) return res.status(404).json({ error: 'not_found' });
      const appRows = await sb('GET', `/applications?id=eq.${appId}&partner_id=eq.${pRows[0].id}&select=id&limit=1`, undefined, key);
      if (!appRows?.length) return res.status(403).json({ error: 'forbidden' });
      await sb('PATCH', `/applications?id=eq.${appId}`, { result: status }, key);
      return res.status(200).json({ ok: true });
    }

    // DELETE APPLICATION — with ownership check
    if (action === 'delete_app') {
      const { appId } = body;
      if (!appId) return res.status(400).json({ error: 'missing_fields' });
      const pRows = await sb('GET', `/partners?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, undefined, key);
      if (!pRows?.length) return res.status(404).json({ error: 'not_found' });
      const appRows = await sb('GET', `/applications?id=eq.${appId}&partner_id=eq.${pRows[0].id}&select=id&limit=1`, undefined, key);
      if (!appRows?.length) return res.status(403).json({ error: 'forbidden' });
      await sb('DELETE', `/applications?id=eq.${appId}`, undefined, key);
      return res.status(200).json({ ok: true });
    }

    // ADD MANUAL APPLICATION — field allowlist prevents mass assignment
    if (action === 'add_app') {
      const { app } = body;
      if (!app) return res.status(400).json({ error: 'missing_fields' });
      const rows = await sb('GET', `/partners?email=eq.${encodeURIComponent(email)}&select=id,ref_num&limit=1`, undefined, key);
      if (!rows?.length) return res.status(404).json({ error: 'not_found' });
      const row = {};
      for (const k of ALLOWED_ADD_APP_FIELDS) {
        if (app[k] !== undefined) row[k] = app[k];
      }
      row.partner_id = rows[0].id;
      row.partner_ref = rows[0].ref_num;
      row.result = null;
      await sb('POST', '/applications', row, key);
      return res.status(200).json({ ok: true });
    }

    // UPGRADE PLAN
    if (action === 'upgrade_plan') {
      const { orderRef, plan } = body;
      if (!orderRef || !plan) return res.status(400).json({ error: 'missing_fields' });
      const expectedPrice = PAID_PLAN_PRICES[plan];
      if (!expectedPrice) return res.status(400).json({ error: 'invalid_plan' });

      const existing = await sb('GET', `/partners?email=eq.${encodeURIComponent(email)}&select=*&limit=1`, undefined, key);
      if (!existing?.length) return res.status(404).json({ error: 'not_found' });
      if (existing[0].payment_ref === orderRef) return res.status(200).json({ ok: true, partner: existing[0] });

      const order = await getOrder(orderRef);
      const { status, amount } = classifyOrder(order);
      if (status !== 'SUCCESS') return res.status(402).json({ error: 'payment_not_confirmed', status });
      if (amount !== expectedPrice) return res.status(400).json({ error: 'amount_mismatch' });

      const rows = await sb('PATCH', `/partners?email=eq.${encodeURIComponent(email)}`,
        { plan, price: expectedPrice, payment_ref: orderRef, status: 'approved' }, key);
      const updated = Array.isArray(rows) ? rows[0] : existing[0];
      return res.status(200).json({ ok: true, partner: updated });
    }

    return res.status(400).json({ error: 'unknown_action' });

  } catch (err) {
    console.error('partner-data error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};
