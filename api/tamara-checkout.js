const { PAID_PLAN_PRICES } = require('./_lib/plans');

const PLAN_LABELS = {
  basic49: 'الأساسية',
  basic: 'بلس',
  advanced: 'المتقدمة',
};

function toSaudiPhone(phone) {
  let d = (phone || '').replace(/\D/g, '');
  if (d.startsWith('966')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  if (!/^5\d{8}$/.test(d)) throw new Error('رقم الجوال غير صالح — يجب أن يبدأ بـ 5 ويكون 9 أرقام');
  return d;
}

module.exports = async (req, res) => {
  const origin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  if (origin !== '*') res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const apiToken = process.env.TAMARA_API_TOKEN;
  const apiUrl = (process.env.TAMARA_API_URL || 'https://api.tamara.co').replace(/\/$/, '');
  if (!apiToken) return res.status(500).json({ error: 'Tamara not configured' });

  const { plan, email, firstName, lastName, phone, org } = req.body || {};

  const price = PAID_PLAN_PRICES[plan];
  if (!price) return res.status(400).json({ error: 'invalid_plan' });
  if (!email || !firstName || !lastName || !phone) return res.status(400).json({ error: 'missing_fields' });

  let phoneNational;
  try {
    phoneNational = toSaudiPhone(phone);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const orderRefId = `RAFD-TMR-${Date.now()}`;
  const siteUrl = 'https://rafd-digital.com';
  const amountStr = price.toFixed(2);
  const label = `RAFD Digital — ${PLAN_LABELS[plan] || plan}`;

  const payload = {
    order_reference_id: orderRefId,
    total_amount: { amount: amountStr, currency: 'SAR' },
    description: label,
    country_code: 'SA',
    payment_type: 'PAY_BY_INSTALMENTS',
    instalments: 3,
    locale: 'ar_SA',
    items: [{
      reference_id: plan,
      type: 'digital',
      name: label,
      sku: plan,
      quantity: 1,
      total_amount: { amount: amountStr, currency: 'SAR' },
      unit_price: { amount: amountStr, currency: 'SAR' },
      discount_amount: { amount: '0.00', currency: 'SAR' },
      tax_amount: { amount: '0.00', currency: 'SAR' },
    }],
    consumer: {
      first_name: firstName,
      last_name: lastName,
      phone_number: phoneNational,
      email,
    },
    billing_address: { line1: 'الرياض', city: 'الرياض', country_code: 'SA' },
    shipping_address: { line1: 'الرياض', city: 'الرياض', country_code: 'SA' },
    merchant_url: {
      success: `${siteUrl}/payment-result.html?provider=tamara`,
      failure: `${siteUrl}/payment-result.html?provider=tamara&status=failed`,
      cancel: `${siteUrl}/pricing.html`,
      notification: `${siteUrl}/api/tamara-webhook`,
    },
    shipping_amount: { amount: '0.00', currency: 'SAR' },
    tax_amount: { amount: '0.00', currency: 'SAR' },
    discount_amount: { amount: '0.00', currency: 'SAR' },
    platform: 'web',
  };

  try {
    const r = await fetch(`${apiUrl}/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok) {
      const msg = data?.message || data?.error || `Tamara error ${r.status}`;
      console.error('[tamara-checkout] API error:', r.status, JSON.stringify(data));
      return res.status(502).json({ error: msg });
    }

    return res.status(200).json({
      checkoutUrl: data.checkout_url,
      orderId: data.order_id,
      orderRef: orderRefId,
    });
  } catch (err) {
    console.error('[tamara-checkout] fetch error:', err.message);
    return res.status(500).json({ error: 'payment_service_error' });
  }
};
