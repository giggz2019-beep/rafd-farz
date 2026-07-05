'use strict';

const SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';
const ADMIN_EMAILS = ['giggz.2019@gmail.com'];
const VALID_STATUSES = ['approved', 'rejected', 'pending'];
const VALID_PLANS = ['trial', 'basic', 'pro'];

const { rateLimit, getIp } = require('./_lib/rate-limit');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const ip = getIp(req);
  const rl = rateLimit(`admin:${ip}`, 10, 15 * 60 * 1000);
  if (rl.limited) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'too_many_attempts' });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    return res.status(503).json({ error: 'server_not_configured' });
  }

  const body = req.body || {};

  // Authenticate: Supabase token (preferred) or legacy ADMIN_PASSWORD
  let authenticated = false;

  if (body.supabase_token) {
    try {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${body.supabase_token}`,
        },
      });
      if (userRes.ok) {
        const user = await userRes.json();
        if (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase())) {
          authenticated = true;
        }
      }
    } catch (_) {}
  } else if (body.password && process.env.ADMIN_PASSWORD) {
    if (body.password === process.env.ADMIN_PASSWORD) {
      authenticated = true;
    }
  }

  if (!authenticated) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const sbHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  const base = `${SUPABASE_URL}/rest/v1`;
  const { action, data = {} } = body;

  function validId(id) {
    return Number.isInteger(id) && id > 0;
  }

  try {
    if (action === 'ping') return res.status(200).json({ ok: true });

    if (action === 'load') {
      const [pRes, aRes] = await Promise.all([
        fetch(`${base}/partners?select=*&order=created_at.desc`, { headers: sbHeaders }),
        fetch(`${base}/applications?select=id`, {
          headers: { ...sbHeaders, Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' },
        }),
      ]);
      const partners = await pRes.json();
      const appCount = parseInt(aRes.headers.get('content-range')?.split('/')[1] || '0');
      return res.status(200).json({ partners, appCount });
    }

    if (action === 'update_plan') {
      if (!VALID_PLANS.includes(data.plan)) return res.status(400).json({ error: 'invalid_plan' });
      if (!validId(data.id)) return res.status(400).json({ error: 'invalid_id' });
      await fetch(`${base}/partners?id=eq.${data.id}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ plan: data.plan }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'update_status') {
      if (!VALID_STATUSES.includes(data.status)) return res.status(400).json({ error: 'invalid_status' });
      if (!validId(data.id)) return res.status(400).json({ error: 'invalid_id' });
      await fetch(`${base}/partners?id=eq.${data.id}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ status: data.status }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete_partner') {
      if (!validId(data.id)) return res.status(400).json({ error: 'invalid_id' });
      await fetch(`${base}/partners?id=eq.${data.id}`, { method: 'DELETE', headers: sbHeaders });
      return res.status(200).json({ success: true });
    }

    if (action === 'insert_partner') {
      const ALLOWED = [
        'fname', 'lname', 'email', 'phone', 'org_name', 'org_type',
        'city', 'plan', 'status', 'ref_num', 'purpose', 'notes', 'title', 'website',
      ];
      if (!data.partner || typeof data.partner !== 'object') {
        return res.status(400).json({ error: 'invalid_partner' });
      }
      const row = {};
      for (const k of ALLOWED) {
        if (data.partner[k] !== undefined) row[k] = data.partner[k];
      }
      await fetch(`${base}/partners`, {
        method: 'POST', headers: sbHeaders,
        body: JSON.stringify(row),
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'update_notes') {
      if (!validId(data.id)) return res.status(400).json({ error: 'invalid_id' });
      if (typeof data.notes !== 'string' || data.notes.length > 2000) {
        return res.status(400).json({ error: 'invalid_notes' });
      }
      await fetch(`${base}/partners?id=eq.${data.id}`, {
        method: 'PATCH', headers: sbHeaders,
        body: JSON.stringify({ notes: data.notes }),
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'unknown_action' });

  } catch (err) {
    console.error('admin-data error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};
