// Canonical plan definitions — single source of truth for pricing,
// payment (create-payment.js, tamara-checkout.js) and registration
// (partner-auth.js). Server code must always look values up from here
// and never trust a client-supplied amount.
//
// Model: a one-time setup/operation fee charged up-front at registration,
// plus a monthly maintenance & updates subscription billed separately.
// All amounts are in SAR and are VAT-inclusive (15%).
//
// Internal plan keys stay `basic` (= بلس / Plus) and `advanced` (= برو /
// Pro) for backward compatibility with existing accounts and the payment
// plumbing — only the labels/prices changed. "trial" is a free 7-day plan
// (Plus features, 50 requests) handled by register_free; it has no setup
// fee and never hits the payment gateway.
const PLANS = {
  basic:    { key: 'basic',    label: 'بلس', setup: 989,  monthly: 79, requests: 500 },
  advanced: { key: 'advanced', label: 'برو', setup: 1499, monthly: 99, requests: 1000 },
};

const TRIAL = { days: 7, requests: 50 };

// The amount charged up-front at checkout for each paid plan = its
// one-time setup fee. Used by create-payment.js, tamara-checkout.js and
// the amount-verification in partner-auth.js.
const PAID_PLAN_PRICES = {
  basic: PLANS.basic.setup,
  advanced: PLANS.advanced.setup,
};

// Monthly request caps enforced server-side at application-creation time.
// Unknown/legacy plan keys fall back to the trial cap.
const PLAN_LIMITS = {
  trial: TRIAL.requests,      // 50
  basic49: PLANS.basic.requests,
  basic: PLANS.basic.requests,       // 500 (Plus)
  advanced: PLANS.advanced.requests, // 1000 (Pro)
};

function planLimit(plan) {
  return Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan) ? PLAN_LIMITS[plan] : TRIAL.requests;
}

// A trial account is only usable for TRIAL.days after it was created.
function trialExpired(plan, createdAt) {
  if (plan !== 'trial') return false;
  if (!createdAt) return false;
  const created = new Date(createdAt).getTime();
  if (!created) return false;
  return Date.now() > created + TRIAL.days * 24 * 3600 * 1000;
}

module.exports = { PLANS, TRIAL, PAID_PLAN_PRICES, PLAN_LIMITS, planLimit, trialExpired };
