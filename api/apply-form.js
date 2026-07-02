// Public endpoints for the apply page — no auth required
const SB_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';

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
    // ─── GET PARTNER FORM ────────────────────────────────────────────────────
    if (body.action === 'get_form') {
      const { ref } = body;
      if (!ref) return res.status(400).json({ error: 'missing_ref' });
      const rows = await sb('GET',
        `/partners?ref_num=eq.${encodeURIComponent(ref.toUpperCase())}&select=id,org_name,org_type,city,plan,ref_num,status,form_config&limit=1`,
        undefined, key
      );
      if (!rows?.length) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ partner: rows[0] });
    }

    // ─── GET SIGNED STORAGE UPLOAD URL ──────────────────────────────────────
    if (body.action === 'get_upload_url') {
      const { filePath } = body;
      if (!filePath) return res.status(400).json({ error: 'missing_filePath' });
      const r = await fetch(`${SB_URL}/storage/v1/object/sign/upload/applicant-docs/${filePath}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Storage sign ${r.status}: ${t}`);
      }
      const { signedURL } = await r.json();
      return res.status(200).json({ signedURL, storageUrl: SB_URL });
    }

    // ─── SUBMIT APPLICATION ──────────────────────────────────────────────────
    if (body.action === 'submit') {
      const { application } = body;
      if (!application) return res.status(400).json({ error: 'missing_application' });
      await sb('POST', '/applications', application, key);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action' });

  } catch (err) {
    console.error('apply-form error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
