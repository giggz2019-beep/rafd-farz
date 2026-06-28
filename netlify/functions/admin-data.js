const SUPABASE_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const adminPass  = process.env.ADMIN_PASSWORD;

  if (!serviceKey || !adminPass) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  if (body.password !== adminPass) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  const base = `${SUPABASE_URL}/rest/v1`;
  const { action, data = {} } = body;

  try {
    if (action === 'ping') return ok({ ok: true });

    if (action === 'load') {
      const [pRes, aRes] = await Promise.all([
        fetch(`${base}/partners?select=*&order=created_at.desc`, { headers }),
        fetch(`${base}/applications?select=id`, { headers: { ...headers, 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } })
      ]);
      const partners = await pRes.json();
      const appCount = parseInt(aRes.headers.get('content-range')?.split('/')[1] || '0');
      return ok({ partners, appCount });
    }

    if (action === 'update_plan') {
      await fetch(`${base}/partners?id=eq.${data.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ plan: data.plan })
      });
      return ok({ success: true });
    }

    if (action === 'update_status') {
      await fetch(`${base}/partners?id=eq.${data.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: data.status })
      });
      return ok({ success: true });
    }

    if (action === 'delete_partner') {
      await fetch(`${base}/partners?id=eq.${data.id}`, { method: 'DELETE', headers });
      return ok({ success: true });
    }

    if (action === 'insert_partner') {
      await fetch(`${base}/partners`, {
        method: 'POST', headers,
        body: JSON.stringify(data.partner)
      });
      return ok({ success: true });
    }

    if (action === 'update_notes') {
      await fetch(`${base}/partners?id=eq.${data.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ notes: data.notes })
      });
      return ok({ success: true });
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('admin-data error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function ok(data) {
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}
