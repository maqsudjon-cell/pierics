const router = require('express').Router();
const { stripe, stripeEnabled } = require('../lib/stripe');
const { supabase } = require('../lib/supabase');
const { requireAuth, loadUser } = require('../lib/auth');
const { PLANS } = require('../lib/plans');

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

async function ensureCustomer(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const c = await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } });
  await supabase.from('users').update({ stripe_customer_id: c.id }).eq('id', user.id);
  return c.id;
}

// Subscribe to Pro — $50/mo with a 7-day free trial (no charge until day 8).
router.post('/checkout', requireAuth, loadUser, async (req, res) => {
  if (!stripeEnabled) return res.status(503).json({ error: 'stripe_unavailable' });
  const priceId = process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) return res.status(500).json({ error: 'missing_pro_price_id' });
  try {
    const customer = await ensureCustomer(req.dbUser);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: PLANS.pro.trialDays,
        metadata: { user_id: req.dbUser.id },
      },
      success_url: `${APP_URL}/#/dashboard?checkout=success`,
      cancel_url: `${APP_URL}/#/pricing?checkout=cancel`,
      metadata: { user_id: req.dbUser.id, kind: 'pro_subscription' },
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(400).json({ error: 'checkout_failed', message: e.message });
  }
});

// Add funds to the prepaid balance (PayG). Saves the card for auto top-up.
router.post('/topup', requireAuth, loadUser, async (req, res) => {
  if (!stripeEnabled) return res.status(503).json({ error: 'stripe_unavailable' });
  const amount = Math.max(5, Number(req.body?.amount) || 10);
  try {
    const customer = await ensureCustomer(req.dbUser);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(amount * 100),
          product_data: { name: `Pierics balance top-up — $${amount}` },
        },
        quantity: 1,
      }],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: { user_id: req.dbUser.id, kind: 'top_up', amount: String(amount) },
      },
      success_url: `${APP_URL}/#/dashboard?topup=success`,
      cancel_url: `${APP_URL}/#/dashboard?topup=cancel`,
      metadata: { user_id: req.dbUser.id, kind: 'top_up', amount: String(amount) },
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(400).json({ error: 'topup_failed', message: e.message });
  }
});

module.exports = router;
