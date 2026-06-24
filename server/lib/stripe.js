const Stripe = require('stripe');

const key = process.env.STRIPE_SECRET_KEY;
const stripeEnabled = Boolean(key);
const stripe = stripeEnabled ? new Stripe(key) : null;

if (!stripeEnabled) {
  console.warn('[pierics] STRIPE_SECRET_KEY not set — billing routes will return 503.');
}

module.exports = { stripe, stripeEnabled };
