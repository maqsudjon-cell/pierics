const router = require('express').Router();
const { requireAuth, loadUser } = require('../lib/auth');
const { rateLimit } = require('../lib/rateLimit');
const { calculateCost } = require('../lib/pricing');
const { supabase } = require('../lib/supabase');
const { stripe, stripeEnabled } = require('../lib/stripe');
const { PLANS } = require('../lib/plans');

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// ── The metering core ───────────────────────────────────────────────
// An API-gateway call lands here after a model responds with token counts.
// It prices the request, logs it, debits balance/allowance, and (PayG)
// fires auto top-up. Returns the cost breakdown.
router.post('/', requireAuth, loadUser, rateLimit, async (req, res) => {
  const user = req.dbUser;
  const { model, inputTokens = 0, outputTokens = 0 } = req.body || {};
  if (!model) return res.status(400).json({ error: 'model_required' });

  // Roll over the monthly usage window if it has elapsed.
  const periodStart = user.usage_period_start ? new Date(user.usage_period_start).getTime() : 0;
  if (Date.now() - periodStart > MONTH_MS) {
    await supabase.from('users')
      .update({ tokens_used_this_month: 0, usage_period_start: new Date().toISOString() })
      .eq('id', user.id);
    user.tokens_used_this_month = 0;
  }

  let cost;
  try {
    cost = calculateCost({
      plan: user.plan,
      model,
      inputTokens: Number(inputTokens),
      outputTokens: Number(outputTokens),
      tokensUsedThisMonth: Number(user.tokens_used_this_month || 0),
      tokenBalance: Number(user.token_balance || 0),
    });
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.code || 'pricing_error', message: e.message });
  }

  const totalTokens = Number(inputTokens) + Number(outputTokens);

  // Log the request.
  await supabase.from('usage_logs').insert({
    user_id: user.id,
    provider: cost.provider,
    model: cost.model,
    input_tokens: Number(inputTokens),
    output_tokens: Number(outputTokens),
    tier: cost.tier,
    markup_applied: cost.markupApplied,
    base_cost: cost.baseCost,
    final_cost: cost.finalCost,
    billed_from: cost.billedFrom,
  });

  // Update counters and (if charged) debit the prepaid balance.
  const updates = { tokens_used_this_month: Number(user.tokens_used_this_month || 0) + totalTokens };
  const charged = cost.finalCost > 0 && (cost.billedFrom === 'balance' || cost.billedFrom.startsWith('overage'));
  if (charged) {
    updates.token_balance = Number(user.token_balance || 0) - cost.finalCost;
  }
  await supabase.from('users').update(updates).eq('id', user.id);

  // PayG auto top-up: charge $10 when balance falls below $2.
  let autoTopUp = null;
  if (user.plan === 'payg') {
    const balanceAfter = updates.token_balance != null ? updates.token_balance : Number(user.token_balance || 0);
    const { thresholdUsd, amountUsd } = PLANS.payg.autoTopUp;
    if (balanceAfter < thresholdUsd && stripeEnabled && user.stripe_customer_id) {
      autoTopUp = await tryAutoTopUp(user, amountUsd).catch((e) => ({ error: e.message }));
    }
  }

  res.json({
    ok: true,
    cost,
    balanceAfter: updates.token_balance != null ? updates.token_balance : undefined,
    autoTopUp,
  });
});

// Off-session charge against the saved card; balance is credited by the webhook.
async function tryAutoTopUp(user, amountUsd) {
  const pms = await stripe.paymentMethods.list({ customer: user.stripe_customer_id, type: 'card' });
  if (!pms.data.length) return { skipped: 'no_card_on_file' };
  const pi = await stripe.paymentIntents.create({
    amount: Math.round(amountUsd * 100),
    currency: 'usd',
    customer: user.stripe_customer_id,
    payment_method: pms.data[0].id,
    off_session: true,
    confirm: true,
    metadata: { kind: 'auto_top_up', user_id: user.id, amount: String(amountUsd) },
  });
  return { status: pi.status, amount: amountUsd };
}

module.exports = router;
