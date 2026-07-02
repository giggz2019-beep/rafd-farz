const SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const adminPass  = process.env.ADMIN_PASSWORD;

  if (!serviceKey || !adminPass) {
    return res.status(503).json({ error: 'Server not configured' });
  }

  const body = req.body || {};

  if (body.password !== adminPass) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };

  const base = `${SUPABASE_URL}/rest/v1`;
  const { action, data = {} } = body;

  try {
    if (action === 'ping') return res.status(200).json({ ok: true });

    if (action === 'load') {
      const [pRes, aRes] = await Promise.all([
        fetch(`${base}/partners?select=*&order=created_at.desc`, { headers }),
        fetch(`${base}/applications?select=id`, {
          headers: { ...headers, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' },
        }),
      ]);
      const partners = await pRes.json();
      const appCount = parseInt(aRes.headers.get('content-range')?.split('/')[1] || '0');
      return res.status(200).json({ partners, appCount });
    }

    if (action === 'update_plan') {
      await fetch(`${base}/partners?id=eq.${data.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ plan: data.plan }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'update_status') {
      await fetch(`${base}/partners?id=eq.${data.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: data.status }),
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'delete_partner') {
      await fetch(`${base}/partners?id=eq.${data.id}`, { method: 'DELETE', headers });
      return res.status(200).json({ success: true });
    }

    if (action === 'insert_partner') {
      await fetch(`${base}/partners`, {
        method: 'POST', headers,
        body: JSON.stringify(data.partner),
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'update_notes') {
      await fetch(`${base}/partners?id=eq.${data.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ notes: data.notes }),
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('admin-data error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
