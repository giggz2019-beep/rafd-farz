const { createClient } = require('@supabase/supabase-js');

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

  // Validate admin password server-side
  if (body.password !== adminPass) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Service key bypasses RLS automatically
  const sb = createClient(SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const { action, data = {} } = body;

    if (action === 'load') {
      const [{ data: partners, error: pErr }, { count }] = await Promise.all([
        sb.from('partners').select('*').order('created_at', { ascending: false }),
        sb.from('applications').select('*', { count: 'exact', head: true })
      ]);
      if (pErr) throw pErr;
      return ok({ partners, appCount: count || 0 });
    }

    if (action === 'update_plan') {
      const { error } = await sb.from('partners').update({ plan: data.plan }).eq('id', data.id);
      if (error) throw error;
      return ok({ success: true });
    }

    if (action === 'update_status') {
      const { error } = await sb.from('partners').update({ status: data.status }).eq('id', data.id);
      if (error) throw error;
      return ok({ success: true });
    }

    if (action === 'delete_partner') {
      const { error } = await sb.from('partners').delete().eq('id', data.id);
      if (error) throw error;
      return ok({ success: true });
    }

    if (action === 'insert_partner') {
      const { error } = await sb.from('partners').insert([data.partner]);
      if (error) throw error;
      return ok({ success: true });
    }

    if (action === 'update_notes') {
      const { error } = await sb.from('partners').update({ notes: data.notes }).eq('id', data.id);
      if (error) throw error;
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
