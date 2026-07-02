// Canonical plan price list (SAR/month) — single source of truth for
// api/create-payment.js and the register_after_payment action in
// api/partner-auth.js. Must stay in sync with the prices shown on
// pricing.html. Server code must always look prices up from here and never
// trust a client-supplied price.
//
// "basic" (بلس) is intentionally not a "paid plan" here — it registers for
// free (7-day trial) through the register_free action instead of payment.
const PAID_PLAN_PRICES = {
  basic49: 99,
  basic: 249,
  advanced: 499,
};

module.exports = { PAID_PLAN_PRICES };
