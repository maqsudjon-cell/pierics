// ════════════════════════════════════════════════════════════════════
// The gateway — OpenAI-compatible, authenticated by API key (NOT JWT),
// with the strict pre-flight gate + clamp + meter lifecycle of Phase 5.
// Mounted at /api/v1.
// ════════════════════════════════════════════════════════════════════

const router = require('express').Router();
const { apiKeyAuth } = require('../lib/apiKeyAuth');
const { PLANS } = require('../lib/plans');
const { preflight, clampOutputTokens } = require('../lib/pricing');
const { listModelsForPlan, callProvider, ProviderKeyError } = require('../lib/models');
const { meterAndBill } = require('../lib/metering');
const { dailyRequestCount, monthSpendUsd, allowPerMinute } = require('../lib/gatewayLimits');
const { supabase } = require('../lib/supabase');

const GATEWAY_TIMEOUT_MS = 60_000;
const BUDGET = process.env.GATEWAY_MONTHLY_BUDGET_USD ? Number(process.env.GATEWAY_MONTHLY_BUDGET_USD) : null;

router.use(apiKeyAuth);

// GET /api/v1/models — models available to this key's plan.
router.get('/models', (req, res) => {
  res.json(listModelsForPlan(req.apiUser.plan));
});

// POST /api/v1/chat/completions — metered, strictly gated, OpenAI-compatible.
router.post('/chat/completions', async (req, res) => {
  const user = req.apiUser;
  const plan = user.plan;
  const body = req.body || {};
  const alias = body.model;

  if (!alias) return res.status(400).json({ error: 'model_required' });
  if (!Array.isArray(body.messages)) return res.status(400).json({ error: 'messages_required' });

  // Effective monthly usage for the gate (the RPC also resets authoritatively
  // at bill time if the usage period rolled into a new month).
  const tokensUsedThisMonth = isPreviousMonth(user.usage_period_start) ? 0 : Number(user.tokens_used_this_month || 0);
  const tokenBalance = Number(user.token_balance || 0);
  const planCfg = PLANS[plan] || {};

  // ── 5.1 pre-flight gate (model access + allowance/balance) ──────────
  const gate = preflight({ plan, model: alias, tokensUsedThisMonth, tokenBalance });
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

  // ── 5.1 daily request limit ─────────────────────────────────────────
  if (planCfg.dailyRequestLimit != null) {
    const used = await dailyRequestCount(user.id);
    if (used >= planCfg.dailyRequestLimit) return res.status(429).json({ error: 'daily_limit_exceeded' });
  }

  // ── 5.1 global budget kill-switch ───────────────────────────────────
  if (BUDGET != null) {
    const spend = await monthSpendUsd();
    if (spend >= BUDGET) return res.status(503).json({ error: 'budget_exceeded' });
  }

  // ── Phase 6 per-minute rate limit (Upstash if configured) ───────────
  if (!(await allowPerMinute(user.id, planCfg.rateLimitPerMinute))) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  // ── 5.2 clamp max_tokens to the plan ceiling (bounds worst-case cost) ─
  const max_tokens = clampOutputTokens(plan, body.max_tokens);
  const stream = body.stream === true;

  // ── 5.3 call upstream safely (hard timeout, no key leakage) ─────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);

  try {
    const upstreamBody = { ...body, max_tokens };
    if (stream) upstreamBody.stream_options = { ...(body.stream_options || {}), include_usage: true };

    let upstream;
    try {
      upstream = await callProvider({
        provider: gate.provider, upstreamModel: gate.upstreamModel,
        body: upstreamBody, signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof ProviderKeyError) {
        return res.status(503).json({ error: 'provider_unavailable', provider: e.provider });
      }
      throw e;
    }

    // Upstream error → relay sanitized status. DO NOT bill failed requests.
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      clearTimeout(timer);
      return res.status(upstream.status).json({ error: 'upstream_error', status: upstream.status, message: safeMsg(detail) });
    }

    if (stream) {
      await handleStream({ res, upstream, user, alias });
      clearTimeout(timer);
      return;
    }

    const data = await upstream.json();
    clearTimeout(timer);

    // ── 5.4 meter from REAL returned usage ────────────────────────────
    const usage = data.usage || {};
    await safeMeter({
      user, alias,
      inputTokens: Number(usage.prompt_tokens || 0),
      outputTokens: Number(usage.completion_tokens || 0),
    });

    data.model = alias; // present the public alias, not the upstream id
    return res.json(data);
  } catch (e) {
    clearTimeout(timer);
    const aborted = e.name === 'AbortError';
    return res.status(aborted ? 504 : 502).json({ error: aborted ? 'upstream_timeout' : 'gateway_error' });
  }
});

// Pass the upstream SSE straight through (both providers are OpenAI-format)
// while accumulating usage from the final chunk for metering.
async function handleStream({ res, upstream, user, alias }) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  let inputTokens = 0, outputTokens = 0, sawUsage = false, contentChars = 0;
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = upstream.body.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    res.write(text); // pass-through

    buffer += text;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const obj = JSON.parse(payload);
        if (obj.usage) {
          inputTokens = Number(obj.usage.prompt_tokens || 0);
          outputTokens = Number(obj.usage.completion_tokens || 0);
          sawUsage = true;
        }
        const delta = obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content;
        if (typeof delta === 'string') contentChars += delta.length;
      } catch { /* ignore partial JSON across chunk boundaries */ }
    }
  }
  res.end();

  // If the provider didn't emit usage, estimate (~4 chars/token) + flag approximate.
  let approximate = false;
  if (!sawUsage) { outputTokens = Math.max(1, Math.ceil(contentChars / 4)); approximate = true; }
  await safeMeter({ user, alias, inputTokens, outputTokens, approximate });
}

// Metering must never crash the response path; log and move on.
async function safeMeter(args) {
  try { await meterAndBill({ db: supabase, ...args }); }
  catch (e) { console.error('[pierics] metering failed:', e.message); }
}

function isPreviousMonth(ts) {
  if (!ts) return false;
  const d = new Date(ts), now = new Date();
  return d.getUTCFullYear() < now.getUTCFullYear()
    || (d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() < now.getUTCMonth());
}

// Redact anything that looks like a provider key; cap length.
function safeMsg(s) {
  return String(s || '').replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]').slice(0, 300);
}

module.exports = router;
