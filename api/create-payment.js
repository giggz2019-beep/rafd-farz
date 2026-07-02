const { createOrder } = require('./_lib/ngenius');
const { PAID_PLAN_PRICES } = require('./_lib/plans');

const PLAN_LABELS = { basic49: 'الأساسية', advanced: 'المتقدمة' };

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  if (!process.env.NGENIUS_API_KEY || !process.env.NGENIUS_OUTLET_ID) {
    return res.status(500).json({ error: 'Payment gateway not configured' });
  }

  const { plan, email, name, phone, org } = req.body || {};

  // Price is always looked up server-side from the canonical plan list —
  // the client never gets to say how much it's paying.
  const price = PAID_PLAN_PRICES[plan];
  if (!price) return res.status(400).json({ error: 'invalid_plan' });
  if (!email) return res.status(400).json({ error: 'missing_fields' });

  const merchantOrderId = `RAFDPAY-${Date.now()}`;

  try {
    const order = await createOrder({
      amountMinor: Math.round(price * 100),
      currencyCode: 'SAR',
      merchantOrderId,
      redirectUrl: 'https://rafd-digital.com/payment-result.html',
      cancelUrl: 'https://rafd-digital.com/pricing.html',
      email,
      description: `RAFD Digital — ${PLAN_LABELS[plan] || plan}`,
    });

    const paymentUrl = order._links?.payment?.href;
    if (!paymentUrl) return res.status(500).json({ error: 'No payment URL in response' });

    notifyAdmin({ plan, price, email, name, phone, org, merchantOrderId, orderRef: order.reference }).catch(() => {});

    return res.status(200).json({ paymentUrl, orderId: order.reference });
  } catch (err) {
    console.error('create-payment error:', err.message);
    return res.status(500).json({ error: 'payment_service_error' });
  }
};

// Fire-and-forget notice to the RAFD team so there's a record of the
// attempt even if the customer's browser never makes it back from N-Genius.
async function notifyAdmin({ plan, price, email, name, phone, org, merchantOrderId, orderRef }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return;

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Cairo','Segoe UI',Arial,sans-serif;direction:rtl">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:40px 16px">
<tr><td align="center">
<table width="100%" style="max-width:580px" cellpadding="0" cellspacing="0">
  <tr><td style="background:linear-gradient(135deg,#0d2233 0%,#1a3a4a 50%,#1e5c42 100%);border-radius:20px 20px 0 0;padding:28px 36px;text-align:center">
    <div style="font-size:1.35rem;font-weight:900;color:#fff;font-family:'Cairo',sans-serif">طلب دفع جديد 🎉</div>
  </td></tr>
  <tr><td style="height:4px;background:linear-gradient(90deg,#1a3a4a,#4a9d6f,#38bdf8)"></td></tr>
  <tr><td style="background:#ffffff;padding:32px 36px">
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:.9rem;font-family:'Cairo',sans-serif">
      <tr><td style="padding:8px 0;color:#1a3a4a;font-weight:700;width:130px">الباقة:</td><td>${plan} (${price} ر.س)</td></tr>
      <tr><td style="padding:8px 0;color:#1a3a4a;font-weight:700">الاسم:</td><td>${name || '-'}</td></tr>
      <tr><td style="padding:8px 0;color:#1a3a4a;font-weight:700">الجهة:</td><td>${org || '-'}</td></tr>
      <tr><td style="padding:8px 0;color:#1a3a4a;font-weight:700">الإيميل:</td><td>${email}</td></tr>
      <tr><td style="padding:8px 0;color:#1a3a4a;font-weight:700">الجوال:</td><td>${phone || '-'}</td></tr>
      <tr><td style="padding:8px 0;color:#1a3a4a;font-weight:700">رقم الطلب:</td><td>${merchantOrderId}</td></tr>
      <tr><td style="padding:8px 0;color:#1a3a4a;font-weight:700">مرجع N-Genius:</td><td>${orderRef}</td></tr>
    </table>
    <p style="margin-top:20px;font-size:.8rem;color:#94a3b8;font-family:'Cairo',sans-serif">هذه رسالة أولية — الحساب لن يُفعّل إلا بعد تأكيد نجاح الدفع فعلياً.</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'RAFD Digital <noreply@rafd-digital.com>',
      to: ['info@rafd-digital.com'],
      subject: `طلب دفع جديد — ${org || email} (${plan})`,
      html,
    }),
  });
}
