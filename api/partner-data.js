// All authenticated partner data operations
// Every request must include a valid { token }
const crypto = require('crypto');

const SB_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';

function secret() {
  return process.env.PARTNER_SECRET || process.env.SUPABASE_SERVICE_KEY || 'rafd-fallback';
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
    if (sig !== expected) return null;
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
  res.setHeader('Access-Control-Allow-Origin', '*');
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
      const encoded = Buffer.from(newPassword).toString('base64');
      await sb('PATCH', `/partners?email=eq.${encodeURIComponent(email)}`, { password: encoded }, key);
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

    // UPDATE APPLICATION STATUS
    if (action === 'update_app') {
      const { appId, status } = body;
      if (!appId) return res.status(400).json({ error: 'missing_fields' });
      await sb('PATCH', `/applications?id=eq.${appId}`, { result: status }, key);
      return res.status(200).json({ ok: true });
    }

    // DELETE APPLICATION
    if (action === 'delete_app') {
      const { appId } = body;
      if (!appId) return res.status(400).json({ error: 'missing_fields' });
      await sb('DELETE', `/applications?id=eq.${appId}`, undefined, key);
      return res.status(200).json({ ok: true });
    }

    // ADD MANUAL APPLICATION
    if (action === 'add_app') {
      const { app } = body;
      if (!app) return res.status(400).json({ error: 'missing_fields' });
      const rows = await sb('GET', `/partners?email=eq.${encodeURIComponent(email)}&select=id,ref_num&limit=1`, undefined, key);
      if (!rows?.length) return res.status(404).json({ error: 'not_found' });
      app.partner_id = rows[0].id;
      app.partner_ref = rows[0].ref_num;
      await sb('POST', '/applications', app, key);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action' });

  } catch (err) {
    console.error('partner-data error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
