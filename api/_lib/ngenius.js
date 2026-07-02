// N-Genius payment gateway helpers — shared by api/create-payment.js,
// api/verify-payment.js, and the register_after_payment action in
// api/partner-auth.js (which re-verifies a payment server-side before
// activating an account, rather than trusting the browser's word for it).
const NGENIUS_BASE = 'https://api-gateway.ksa.ngenius-payments.com';

async function getAccessToken() {
  const apiKey = process.env.NGENIUS_API_KEY;
  if (!apiKey) throw new Error('NGENIUS_API_KEY not configured');
  const r = await fetch(`${NGENIUS_BASE}/identity/auth/access-token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${apiKey}`,
      'Content-Type': 'application/vnd.ni-identity.v1+json',
    },
  });
  if (!r.ok) throw new Error(`NGenius token error: ${await r.text()}`);
  const { access_token } = await r.json();
  return access_token;
}

async function createOrder({ amountMinor, currencyCode, merchantOrderId, redirectUrl, cancelUrl, email, description }) {
  const outletId = process.env.NGENIUS_OUTLET_ID;
  if (!outletId) throw new Error('NGENIUS_OUTLET_ID not configured');
  const accessToken = await getAccessToken();
  const r = await fetch(`${NGENIUS_BASE}/transactions/outlets/${outletId}/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/vnd.ni-payment.v2+json',
      Accept: 'application/vnd.ni-payment.v2+json',
    },
    body: JSON.stringify({
      action: 'PURCHASE',
      amount: { currencyCode, value: amountMinor },
      merchantAttributes: { redirectUrl, cancelUrl, skipConfirmationPage: true },
      emailAddress: email || undefined,
      description,
      merchantOrderId,
    }),
  });
  if (!r.ok) throw new Error(`NGenius order create error: ${await r.text()}`);
  return r.json();
}

async function getOrder(ref) {
  const outletId = process.env.NGENIUS_OUTLET_ID;
  if (!outletId) throw new Error('NGENIUS_OUTLET_ID not configured');
  const accessToken = await getAccessToken();
  const r = await fetch(`${NGENIUS_BASE}/transactions/outlets/${outletId}/orders/${encodeURIComponent(ref)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.ni-payment.v2+json',
    },
  });
  if (!r.ok) throw new Error(`NGenius order fetch failed: ${r.status}`);
  return r.json();
}

const FAIL_SIGNALS = ['FAILED', 'CANCELLED', 'REJECTED', 'DECLINED', 'VOIDED', 'REVERSED', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED'];
const SUCCESS_SIGNALS = ['CAPTURED', 'AUTHORISED', 'PURCHASED', 'APPROVED', 'PAYMENT_CAPTURED', 'PAYMENT_AUTHORISED'];

// Classifies a raw N-Genius order into SUCCESS / FAILED / PENDING and
// extracts the paid amount in major units (e.g. SAR) for server-side
// amount verification — callers must never trust a client-supplied price.
function classifyOrder(order) {
  const payments = order._embedded?.payment;
  const paymentState = ((Array.isArray(payments) ? payments[0]?.state : payments?.state) || '').toUpperCase();
  const orderStatus = (order.status || '').toUpperCase();
  const combined = `${paymentState} ${orderStatus}`;

  let status = 'PENDING';
  if (FAIL_SIGNALS.some(s => combined.includes(s))) status = 'FAILED';
  else if (SUCCESS_SIGNALS.some(s => combined.includes(s))) status = 'SUCCESS';

  const amountMinor = order.amount?.value;
  const amount = typeof amountMinor === 'number' ? amountMinor / 100 : null;

  return { status, state: paymentState || orderStatus, amount, currency: order.amount?.currencyCode || null };
}

module.exports = { getAccessToken, createOrder, getOrder, classifyOrder };
