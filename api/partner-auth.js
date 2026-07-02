// Partner authentication — no Supabase client in browser needed
const crypto = require('crypto');

const SB_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';

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
      const encoded = Buffer.from(password).toString('base64');
      if (p.password !== encoded && p.password !== password) {
        return res.status(401).json({ error: 'invalid' });
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

    // ─── REGISTER ────────────────────────────────────────────────────────────
    if (body.action === 'register') {
      const { partnerData } = body;
      if (!partnerData) return res.status(400).json({ error: 'missing_fields' });
      const result = await sbWrite('POST', '/partners', partnerData, key);
      const p = Array.isArray(result) ? result[0] : result;
      return res.status(200).json({ ok: true, partner: p, token: p ? makeToken(p.email) : null });
    }

    // ─── RESET PASSWORD ──────────────────────────────────────────────────────
    if (body.action === 'reset_password') {
      const { partnerId, newPassword } = body;
      if (!partnerId || !newPassword) return res.status(400).json({ error: 'missing_fields' });
      const encoded = Buffer.from(newPassword).toString('base64');
      await sbWrite('PATCH', `/partners?id=eq.${partnerId}`, { password: encoded }, key);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action' });

  } catch (err) {
    console.error('partner-auth error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
