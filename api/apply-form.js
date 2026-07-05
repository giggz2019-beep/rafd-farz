// Public endpoints for the apply page — no auth required
const SB_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';

// Fields the applicant can submit — result, partner_id, status are always server-side
const ALLOWED_APP_FIELDS = [
  'full_name', 'fname', 'lname', 'email', 'phone',
  'gender', 'birth_date', 'nationality', 'city',
  'education', 'major', 'gpa',
  'experience', 'experience_years',
  'position', 'skills', 'notes',
  'national_id_num',
  'cv_url', 'id_doc_url', 'edu_doc_url', 'exp_doc_url', 'cert_doc_url', 'other_doc_url',
  'nafath_verified', 'nafath_pending',
  'ai_result', 'doc_results', 'read_id_result',
];

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
  const _ORIGIN = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', _ORIGIN);
  if (_ORIGIN !== '*') res.setHeader('Vary', 'Origin');
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
        throw new Error(`Storage sign ${r.status}`);
      }
      const { signedURL } = await r.json();
      return res.status(200).json({ signedURL, storageUrl: SB_URL });
    }

    // ─── SUBMIT APPLICATION ──────────────────────────────────────────────────
    if (body.action === 'submit') {
      const { application } = body;
      if (!application) return res.status(400).json({ error: 'missing_application' });

      // Derive partner_id server-side — never trust partner_id from client
      const partnerRef = application.partner_ref;
      if (!partnerRef) return res.status(400).json({ error: 'missing_partner_ref' });

      const partners = await sb('GET',
        `/partners?ref_num=eq.${encodeURIComponent(String(partnerRef).toUpperCase())}&select=id,ref_num,status&limit=1`,
        undefined, key
      );
      if (!partners?.length) return res.status(404).json({ error: 'partner_not_found' });
      if (partners[0].status !== 'approved') return res.status(403).json({ error: 'partner_not_active' });

      // Apply field allowlist — strip any field not explicitly permitted
      const row = {};
      for (const field of ALLOWED_APP_FIELDS) {
        if (application[field] !== undefined) row[field] = application[field];
      }

      // Server-side authoritative fields — cannot be overridden by client
      row.partner_id = partners[0].id;
      row.partner_ref = partners[0].ref_num;
      row.result = null;

      await sb('POST', '/applications', row, key);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action' });

  } catch (err) {
    console.error('apply-form error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
};
