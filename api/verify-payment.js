const { getOrder, classifyOrder } = require('./_lib/ngenius');

module.exports = async (req, res) => {
  const _ORIGIN = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', _ORIGIN);
  if (_ORIGIN !== '*') res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ref = (req.query.ref || '').toString().trim();
  if (!ref) return res.status(400).json({ error: 'missing ref' });

  if (!process.env.NGENIUS_API_KEY || !process.env.NGENIUS_OUTLET_ID) {
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  try {
    const order = await getOrder(ref);
    const { status, state } = classifyOrder(order);
    return res.status(200).json({ status, state });
  } catch (err) {
    console.error('verify-payment error:', err.message);
    return res.status(500).json({ error: 'verification_error' });
  }
};
