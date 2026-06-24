// ════════════════════════════════════════════════════════════════════
// Central pricing configuration — single source of truth.
// All money math derives from these numbers. Keep in sync with db/schema.sql.
// ════════════════════════════════════════════════════════════════════

// Model alias → provider + base price (USD per 1,000,000 tokens).
// Aliases (cheap/fast/quality) are what users select; the provider model
// is what we actually call. Prices are the raw provider cost.
const MODELS = {
  cheap:   { provider: 'groq',   model: 'llama3-8b-8192',  input: 0.05, output: 0.08,  label: 'Llama 3 8B'   },
  fast:    { provider: 'groq',   model: 'llama3-70b-8192', input: 0.59, output: 0.79,  label: 'Llama 3 70B'  },
  quality: { provider: 'openai', model: 'gpt-4o',          input: 2.50, output: 10.00, label: 'GPT-4o'       },
  // Listed in the provider price sheet; available as an extra, not a tier default.
  'gpt-4o-mini': { provider: 'openai', model: 'gpt-4o-mini', input: 0.15, output: 0.60, label: 'GPT-4o mini' },
};

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    monthlyTokens: 50_000,
    markup: 1.0,                       // billed from allowance, no $ charge
    models: ['cheap', 'fast'],
    rateLimitPerMinute: 10,
    dailyRequestLimit: 200,
    support: 'email_48h',
    features: { dashboard: 'basic', caching: false, csvExport: false, teamMembers: 1 },
    requiresCard: false,
  },
  payg: {
    id: 'payg',
    name: 'Pay-as-you-go',
    priceMonthly: 0,
    monthlyTokens: null,              // no included allowance
    markup: 1.3,
    models: ['cheap', 'fast', 'quality'],
    rateLimitPerMinute: 60,
    dailyRequestLimit: 10_000,
    support: 'email_24h',
    features: { dashboard: 'full', caching: false, csvExport: false, teamMembers: 1 },
    requiresCard: true,
    autoTopUp: { thresholdUsd: 2, amountUsd: 10 },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 50,
    monthlyTokens: 10_000_000,
    markup: 1.0,                      // within allowance (covered by $50)
    overageMarkup: 1.1,              // beyond allowance
    models: ['cheap', 'fast', 'quality', 'early_access'],
    rateLimitPerMinute: 300,
    dailyRequestLimit: null,         // unlimited
    support: 'priority_4h_discord',
    features: { dashboard: 'full', caching: true, csvExport: true, teamMembers: 3 },
    requiresCard: true,
    trialDays: 7,
  },
};

// ── Pro-tier safeguard ──────────────────────────────────────────────
// The $50 Pro plan breaks even only if a user's blended provider cost
// stays under $5 / 1M tokens. 10M GPT-4o *output* tokens cost us $100 but
// the user paid $50 → a $50 loss. Flip `billPremiumSeparately` to true to
// bill premium models (GPT-4o) at the 1.1x overage rate from the prepaid
// balance even while inside the included allowance — closing that hole.
// Default false = behaves exactly as the spec describes.
const PRO_GUARD = {
  billPremiumSeparately: false,
  premiumModels: ['quality'],
};

module.exports = { MODELS, PLANS, PRO_GUARD };
