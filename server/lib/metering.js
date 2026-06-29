const { calculateCost } = require('./pricing');

// ════════════════════════════════════════════════════════════════════
// Meter a completed request from REAL usage, write the usage_logs row, and
// apply the balance/usage mutation atomically via the Postgres RPC. All DB
// access goes through the injected `db` (a Supabase client) so it's unit-
// testable with a mock. This is the ONLY place the gateway mutates usage/
// balance — via increment_usage_and_bill (see db/schema.sql).
// ════════════════════════════════════════════════════════════════════
async function meterAndBill({ db, user, alias, inputTokens, outputTokens, approximate = false }) {
  // enforce:false → price + classify this (already-served) request without
  // re-throwing the limit guards. Bounded overshoot is intentional: the RPC
  // applies the real debit, which may push balance/usage past the limit by at
  // most this one clamped request; the next request is then blocked up front.
  const cost = calculateCost({
    plan: user.plan,
    model: alias,
    inputTokens,
    outputTokens,
    tokensUsedThisMonth: Number(user.tokens_used_this_month || 0),
    tokenBalance: Number(user.token_balance || 0),
    enforce: false,
  });

  const totalTokens = inputTokens + outputTokens;

  await db.from('usage_logs').insert({
    user_id: user.id,
    provider: cost.provider,
    model: cost.model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    tier: cost.tier,
    markup_applied: cost.markupApplied,
    base_cost: cost.baseCost,
    final_cost: cost.finalCost,
    billed_from: cost.billedFrom,
    approximate,
  });

  const { data, error } = await db.rpc('increment_usage_and_bill', {
    p_user_id: user.id,
    p_tokens: totalTokens,
    p_final_cost: cost.finalCost,
    p_base_cost: cost.baseCost,
    p_billed_from: cost.billedFrom,
  });
  if (error) throw Object.assign(new Error('bill_failed'), { cause: error });

  const row = Array.isArray(data) ? data[0] : data;
  return {
    cost,
    tokensAfter: row ? Number(row.tokens_used_this_month) : undefined,
    balanceAfter: row ? Number(row.token_balance) : undefined,
  };
}

module.exports = { meterAndBill };
