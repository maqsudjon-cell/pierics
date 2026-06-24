// Client-side mirror of server/lib/pricing.js so the calculator and price
// table render instantly and work even if the API is offline. Keep the
// numbers identical to the backend.

export const MODELS = {
  cheap:   { provider: 'groq',   model: 'llama3-8b-8192',  input: 0.05, output: 0.08,  label: 'Llama 3 8B'  },
  fast:    { provider: 'groq',   model: 'llama3-70b-8192', input: 0.59, output: 0.79,  label: 'Llama 3 70B' },
  quality: { provider: 'openai', model: 'gpt-4o',          input: 2.50, output: 10.00, label: 'GPT-4o'      },
};

export const PLANS = {
  free: { name: 'Free',          markup: 1.0,  monthlyTokens: 50_000,     models: ['cheap', 'fast'] },
  payg: { name: 'Pay-as-you-go', markup: 1.3,  monthlyTokens: null,       models: ['cheap', 'fast', 'quality'] },
  pro:  { name: 'Pro',           markup: 1.0,  overageMarkup: 1.1, monthlyTokens: 10_000_000, models: ['cheap', 'fast', 'quality'] },
};

const r6 = (n) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
const r4 = (n) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

export function providerCost(m, inT, outT) {
  return (inT / 1e6) * m.input + (outT / 1e6) * m.output;
}

// Returns a cost breakdown, or { error, message } for blocked requests.
export function estimate({ plan, model, inputTokens, outputTokens, tokensUsedThisMonth = 0 }) {
  const p = PLANS[plan];
  const m = MODELS[model];
  if (!p || !m) return { error: 'bad_input', message: 'Unknown plan or model' };
  if (!p.models.includes(model)) {
    return { error: 'model_not_in_plan', message: `${m.label} isn’t available on the ${p.name} plan` };
  }
  const total = inputTokens + outputTokens;
  const base = providerCost(m, inputTokens, outputTokens);

  if (plan === 'free') {
    const remaining = p.monthlyTokens - tokensUsedThisMonth;
    if (total > remaining) return { error: 'allowance_exhausted', message: 'Exceeds the 50K monthly free allowance' };
    return { baseCost: r6(base), markupApplied: 1.0, finalCost: 0, billedFrom: 'allowance' };
  }
  if (plan === 'payg') {
    return { baseCost: r6(base), markupApplied: p.markup, finalCost: r6(base * p.markup), billedFrom: 'balance' };
  }
  // pro
  const remaining = Math.max(0, p.monthlyTokens - tokensUsedThisMonth);
  if (total <= remaining) {
    return { baseCost: r6(base), markupApplied: 1.0, finalCost: 0, billedFrom: 'included' };
  }
  const overage = total - remaining;
  const overageBase = total > 0 ? base * (overage / total) : 0;
  return { baseCost: r6(base), markupApplied: p.overageMarkup, finalCost: r6(overageBase * p.overageMarkup), billedFrom: 'overage', overageTokens: overage };
}

export function priceTable() {
  const rows = {};
  for (const [alias, m] of Object.entries(MODELS)) {
    rows[alias] = {
      label: m.label,
      provider: m.provider,
      base:        { input: m.input,               output: m.output },
      payg:        { input: r4(m.input * 1.3),     output: r4(m.output * 1.3) },
      proIncluded: { input: m.input,               output: m.output },
      proOverage:  { input: r4(m.input * 1.1),     output: r4(m.output * 1.1) },
    };
  }
  return rows;
}
