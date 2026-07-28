// Public endpoints for the apply page — no auth required
const SB_URL = 'https://ycnnawohrbbluawxzttt.supabase.co';
const { planLimit, trialExpired } = require('./_lib/plans');

// Count a partner's applications via PostgREST's exact count header.
async function countApplications(partnerId, key) {
  const r = await fetch(`${SB_URL}/rest/v1/applications?partner_id=eq.${encodeURIComponent(partnerId)}&select=id`, {
    method: 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' },
  });
  const cr = r.headers.get('content-range') || '';        // e.g. "0-0/42" or "* /0"
  const total = parseInt((cr.split('/')[1] || '').trim(), 10);
  return Number.isFinite(total) ? total : 0;
}

// Fields the applicant can submit — result, partner_id, status are always server-side
const ALLOWED_APP_FIELDS = [
  'name', 'email', 'phone', 'national_id', 'company', 'sector',
  'score', 'grade', 'ref_num', 'challenges', 'notes', 'docs',
  'criteria_breakdown',
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
        `/partners?ref_num=eq.${encodeURIComponent(ref.toUpperCase())}&select=id,org_name,org_type,city,plan,ref_num,status,created_at,form_config&limit=1`,
        undefined, key
      );
      if (!rows?.length) return res.status(404).json({ error: 'not_found' });
      const p = rows[0];
      // Tell the apply page up-front whether this org can still receive
      // applications (active + trial not expired + under the monthly cap).
      let accepting = p.status === 'approved';
      let reason = accepting ? null : 'partner_not_active';
      if (accepting && trialExpired(p.plan, p.created_at)) { accepting = false; reason = 'trial_expired'; }
      if (accepting) {
        const used = await countApplications(p.id, key);
        if (used >= planLimit(p.plan)) { accepting = false; reason = 'limit_reached'; }
      }
      return res.status(200).json({ partner: p, accepting, reason });
    }

    // ─── GET SIGNED STORAGE UPLOAD URL ──────────────────────────────────────
    if (body.action === 'get_upload_url') {
      const { filePath } = body;
      if (!filePath || typeof filePath !== 'string') return res.status(400).json({ error: 'missing_filePath' });
      // filePath is fully client-supplied and this endpoint is unauthenticated —
      // reject anything that could traverse out of / overwrite outside the intended
      // applicant-docs key space (path traversal, absolute paths, null bytes, etc.).
      // Expected shape: "<REF>/<APP-REF>/<docId>_<filename>" — 3 segments, safe chars.
      const badPath =
        filePath.length > 400 ||
        filePath.includes('..') ||
        filePath.includes('\\') ||
        filePath.includes('\0') ||
        filePath.includes('//') ||
        /^[/.]/.test(filePath) ||           // no leading slash or dot
        !/^[^/]+\/[^/]+\/[^/]+$/.test(filePath); // exactly 3 non-empty segments
      if (badPath) return res.status(400).json({ error: 'invalid_filePath' });
      const r = await fetch(`${SB_URL}/storage/v1/object/upload/sign/applicant-docs/${filePath}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      });
      if (!r.ok) {
        throw new Error(`Storage sign ${r.status}`);
      }
      const { url } = await r.json();
      const token = new URL(SB_URL + url).searchParams.get('token');
      const signedURL = `/storage/v1/object/upload/sign/applicant-docs/${filePath}?token=${token}`;
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
        `/partners?ref_num=eq.${encodeURIComponent(String(partnerRef).toUpperCase())}&select=id,ref_num,status,plan,created_at&limit=1`,
        undefined, key
      );
      if (!partners?.length) return res.status(404).json({ error: 'partner_not_found' });
      const partner = partners[0];
      if (partner.status !== 'approved') return res.status(403).json({ error: 'partner_not_active' });

      // Server-side quota enforcement — a trial that has expired, or any
      // plan that has hit its monthly cap, may not receive new applications.
      if (trialExpired(partner.plan, partner.created_at)) {
        return res.status(403).json({ error: 'trial_expired' });
      }
      const used = await countApplications(partner.id, key);
      if (used >= planLimit(partner.plan)) {
        return res.status(403).json({ error: 'limit_reached' });
      }

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
