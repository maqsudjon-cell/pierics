// ════════════════════════════════════════════════════════════════════
// Pricing engine — the brain. Pure functions, no I/O, fully testable.
// Reproduces the published per-1M price tables exactly (see pricing.test.js).
// ════════════════════════════════════════════════════════════════════

const { MODELS, PLANS, PRO_GUARD } = require('./plans');

class PricingError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
    this.status = status;
  }
}

const round6 = (n) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
const round4 = (n) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

// Resolve a user-facing alias OR a raw provider model id to its config.
function resolveModel(model) {
  if (MODELS[model]) return { aliasKey: model, ...MODELS[model] };
  const aliasKey = Object.keys(MODELS).find((k) => MODELS[k].model === model);
  if (aliasKey) return { aliasKey, ...MODELS[aliasKey] };
  throw new PricingError(`Unknown model: ${model}`, 'unknown_model', 400);
}

// Raw provider cost (USD) for a token split, before any markup.
function providerCost(m, inputTokens, outputTokens) {
  return (inputTokens / 1e6) * m.input + (outputTokens / 1e6) * m.output;
}

function buildResult({ tier, m, base, markup, final, billedFrom, allowanceTokensUsed = 0, overageTokens = 0 }) {
  return {
    tier,
    provider: m.provider,
    model: m.model,
    alias: m.aliasKey,
    baseCost: round6(base),
    markupApplied: markup,
    finalCost: round6(final),
    billedFrom,                 // allowance | balance | included | overage | overage_premium
    allowanceTokensUsed,
    overageTokens,
  };
}

/**
 * Compute the cost of a single request and how it should be billed.
 *
 * @param {object} a
 * @param {'free'|'payg'|'pro'} a.plan
 * @param {string} a.model                alias (cheap/fast/quality) or provider model id
 * @param {number} a.inputTokens
 * @param {number} a.outputTokens
 * @param {number} [a.tokensUsedThisMonth] current monthly usage (for allowance plans)
 * @param {number} [a.tokenBalance]        prepaid USD balance (for payg / pro overage)
 * @returns {{tier,provider,model,alias,baseCost,markupApplied,finalCost,billedFrom,allowanceTokensUsed,overageTokens}}
 * @throws {PricingError} on access / allowance / balance violations
 */
function calculateCost({
  plan,
  model,
  inputTokens = 0,
  outputTokens = 0,
  tokensUsedThisMonth = 0,
  tokenBalance = 0,
  enforce = true,   // false at meter time: classify + price WITHOUT re-throwing limit guards
}) {
  const planCfg = PLANS[plan];
  if (!planCfg) throw new PricingError(`Unknown plan: ${plan}`, 'unknown_plan', 400);

  const m = resolveModel(model);

  // Model access gate.
  if (!planCfg.models.includes(m.aliasKey)) {
    throw new PricingError(
      `Model "${m.aliasKey}" is not available on the ${planCfg.name} plan`,
      'model_not_in_plan',
      403
    );
  }

  const totalTokens = inputTokens + outputTokens;
  const base = providerCost(m, inputTokens, outputTokens);

  // ── FREE: consume monthly allowance, no dollar charge ──────────────
  if (plan === 'free') {
    const remaining = planCfg.monthlyTokens - tokensUsedThisMonth;
    if (enforce && totalTokens > remaining) {
      throw new PricingError(
        'Monthly free token allowance exhausted',
        'allowance_exhausted',
        402
      );
    }
    return buildResult({ tier: 'free', m, base, markup: 1.0, final: 0, billedFrom: 'allowance', allowanceTokensUsed: totalTokens });
  }

  // ── PAYG: pure usage at 1.3x, charged to prepaid balance ───────────
  if (plan === 'payg') {
    const final = round6(base * planCfg.markup);
    if (enforce && final > tokenBalance) {
      throw new PricingError(
        'Insufficient balance — add funds or enable auto top-up',
        'insufficient_balance',
        402
      );
    }
    return buildResult({ tier: 'payg', m, base, markup: planCfg.markup, final, billedFrom: 'balance' });
  }

  // ── PRO: included allowance (covered by $50), then 1.1x overage ────
  if (plan === 'pro') {
    const isPremium = PRO_GUARD.premiumModels.includes(m.aliasKey);

    // Safeguard: bill premium models at overage rate even inside the allowance.
    if (PRO_GUARD.billPremiumSeparately && isPremium) {
      const final = round6(base * planCfg.overageMarkup);
      if (enforce && final > tokenBalance) {
        throw new PricingError('Insufficient balance for premium-model usage', 'insufficient_balance', 402);
      }
      return buildResult({ tier: 'pro', m, base, markup: planCfg.overageMarkup, final, billedFrom: 'overage_premium' });
    }

    const remaining = Math.max(0, planCfg.monthlyTokens - tokensUsedThisMonth);

    // Fully inside the included allowance → no marginal charge.
    if (totalTokens <= remaining) {
      return buildResult({ tier: 'pro', m, base, markup: planCfg.markup, final: 0, billedFrom: 'included', allowanceTokensUsed: totalTokens });
    }

    // Crosses the allowance boundary: split this request into included +
    // overage, prorating the base cost by token share.
    const overageTokens = totalTokens - remaining;
    const overageBase = totalTokens > 0 ? base * (overageTokens / totalTokens) : 0;
    const final = round6(overageBase * planCfg.overageMarkup);
    if (enforce && final > tokenBalance) {
      throw new PricingError('Insufficient balance for overage — add funds', 'insufficient_balance', 402);
    }
    return buildResult({
      tier: 'pro', m, base, markup: planCfg.overageMarkup, final,
      billedFrom: 'overage', allowanceTokensUsed: remaining, overageTokens,
    });
  }

  throw new PricingError(`Unhandled plan: ${plan}`, 'unhandled_plan', 400);
}

/**
 * Cheap pre-flight gate for the gateway — decide BEFORE any upstream call,
 * using only the user's current plan/usage/balance. Mirrors calculateCost's
 * access + allowance + balance semantics, but returns gateway-shaped codes
 * instead of throwing. Tier rules live here (single source of truth).
 * @returns {{ok:true, alias, provider, upstreamModel} | {ok:false, status, error}}
 */
function preflight({ plan, model, tokensUsedThisMonth = 0, tokenBalance = 0 }) {
  const planCfg = PLANS[plan];
  if (!planCfg) return { ok: false, status: 400, error: 'unknown_plan' };

  let m;
  try { m = resolveModel(model); }
  catch { return { ok: false, status: 400, error: 'unknown_model' }; }

  if (!planCfg.models.includes(m.aliasKey)) {
    return { ok: false, status: 403, error: 'model_not_available' };
  }

  if (plan === 'free') {
    if (tokensUsedThisMonth >= planCfg.monthlyTokens) {
      return { ok: false, status: 402, error: 'quota_exceeded' };
    }
  } else if (plan === 'payg') {
    if (tokenBalance <= 0) return { ok: false, status: 402, error: 'insufficient_balance' };
  } else if (plan === 'pro') {
    const allowanceLeft = (planCfg.monthlyTokens || 0) - tokensUsedThisMonth;
    if (allowanceLeft <= 0 && tokenBalance <= 0) {
      return { ok: false, status: 402, error: 'insufficient_balance' };
    }
  }

  return { ok: true, alias: m.aliasKey, provider: m.provider, upstreamModel: m.model };
}

/** Clamp a requested max_tokens down to the plan's per-request ceiling. */
function clampOutputTokens(plan, requested) {
  const ceiling = (PLANS[plan] && PLANS[plan].maxOutputTokensPerRequest) || 1024;
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return ceiling; // no / invalid request → use ceiling
  return Math.min(Math.floor(n), ceiling);
}

/**
 * Published per-1M price table for every model & tier (drives the UI table
 * and lets the frontend estimate costs without hitting the engine per-request).
 */
function priceTable() {
  const rows = {};
  for (const [alias, m] of Object.entries(MODELS)) {
    rows[alias] = {
      provider: m.provider,
      model: m.model,
      label: m.label,
      base:        { input: m.input,                  output: m.output },
      payg:        { input: round4(m.input * 1.3),    output: round4(m.output * 1.3) },
      proIncluded: { input: m.input,                  output: m.output },
      proOverage:  { input: round4(m.input * 1.1),    output: round4(m.output * 1.1) },
    };
  }
  return rows;
}

module.exports = { calculateCost, preflight, clampOutputTokens, priceTable, providerCost, resolveModel, round6, round4, PricingError };
