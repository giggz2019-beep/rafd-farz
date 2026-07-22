module.exports = async (req, res) => {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  if (origin !== '*') res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  const apiToken = process.env.TAMARA_API_TOKEN;
  const apiUrl = (process.env.TAMARA_API_URL || 'https://api.tamara.co').replace(/\/$/, '');
  if (!apiToken) return res.status(500).json({ error: 'Tamara not configured' });

  const orderId = req.query?.orderId;
  if (!orderId) return res.status(400).json({ error: 'missing_orderId' });

  try {
    const r = await fetch(`${apiUrl}/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!r.ok) {
      console.error('[tamara-verify] API error:', r.status);
      return res.status(200).json({ status: 'PENDING', state: 'api_error' });
    }
    const data = await r.json();
    const s = (data.status || '').toLowerCase();

    let status;
    if (['approved', 'fully_captured', 'partially_captured'].includes(s)) {
      status = 'SUCCESS';
    } else if (['declined', 'expired', 'cancelled', 'failed'].includes(s)) {
      status = 'FAILED';
    } else {
      status = 'PENDING';
    }

    return res.status(200).json({ status, state: s });
  } catch (err) {
    console.error('[tamara-verify] fetch error:', err.message);
    return res.status(200).json({ status: 'PENDING', state: 'error' });
  }
};
