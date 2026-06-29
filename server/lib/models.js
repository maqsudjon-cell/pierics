// ════════════════════════════════════════════════════════════════════
// Model registry + provider routing — the ONE place that knows how to
// reach each upstream provider. Prices/aliases stay in plans.js; this only
// maps alias → { provider, upstreamModel } and dispatches the HTTP call.
// ════════════════════════════════════════════════════════════════════

const { MODELS, PLANS } = require('./plans');

// Provider transport. Both Groq and OpenAI are OpenAI-compatible, so no
// request/response translation is needed. To add Anthropic later: add an
// entry here + a translate() branch in callProvider — an isolated change.
const PROVIDERS = {
  groq:   { endpoint: 'https://api.groq.com/openai/v1/chat/completions', envKey: 'GROQ_API_KEY' },
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions',      envKey: 'OPENAI_API_KEY' },
};

class ProviderKeyError extends Error {
  constructor(provider) {
    super(`Provider "${provider}" is not configured`);
    this.name = 'ProviderKeyError';
    this.provider = provider;
    this.code = 'provider_unavailable';
    this.status = 503;
  }
}

// Public alias → upstream routing (derived from plans.js — no price dup).
function resolveAlias(alias) {
  const m = MODELS[alias];
  if (!m) return null;
  return { alias, provider: m.provider, upstreamModel: m.model, label: m.label };
}

// Models available to a plan, in OpenAI `GET /v1/models` list shape.
function listModelsForPlan(plan) {
  const planCfg = PLANS[plan];
  const aliases = (planCfg ? planCfg.models : []).filter((a) => MODELS[a]);
  return {
    object: 'list',
    data: aliases.map((alias) => ({
      id: alias,
      object: 'model',
      owned_by: 'pierics',
      provider: MODELS[alias].provider,
    })),
  };
}

/**
 * Call the upstream provider's chat/completions endpoint. Returns the raw
 * fetch Response so the caller can stream or read JSON. Never logs keys.
 * @throws {ProviderKeyError} when the provider's env key is missing.
 */
async function callProvider({ provider, upstreamModel, body, signal }) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new ProviderKeyError(provider);
  const key = process.env[cfg.envKey];
  if (!key) throw new ProviderKeyError(provider);

  // Swap the public alias for the real upstream model id.
  const payload = { ...body, model: upstreamModel };

  return fetch(cfg.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload),
    signal,
  });
}

module.exports = { PROVIDERS, ProviderKeyError, resolveAlias, listModelsForPlan, callProvider };
