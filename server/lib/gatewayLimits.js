// Request/budget/rate limit helpers for the gateway. Stateless &
// serverless-safe: daily count + budget read from Postgres; per-minute uses
// Upstash Redis if configured (a correct per-minute window isn't possible on
// stateless serverless without an external store).

const { supabase } = require('./supabase');

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const upstashEnabled = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

let warnedNoRedis = false;

// Today's request count (UTC) for a user, from usage_logs.
async function dailyRequestCount(userId) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('usage_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', start.toISOString());
  return count || 0;
}

// Month-to-date platform base_cost — a cheap counter row, not a table scan.
async function monthSpendUsd() {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const { data } = await supabase
    .from('platform_spend').select('base_cost_total').eq('month', month).single();
  return data ? Number(data.base_cost_total) : 0;
}

// Per-minute sliding window via Upstash REST. Returns true if allowed.
// Fails open (allows) on limiter outage; skips gracefully without Upstash.
async function allowPerMinute(userId, limitPerMinute) {
  if (!limitPerMinute) return true;
  if (!upstashEnabled) {
    if (!warnedNoRedis) {
      console.warn('[pierics] TODO: per-minute rate limit skipped — set UPSTASH_REDIS_REST_URL/TOKEN to enable it on serverless.');
      warnedNoRedis = true;
    }
    return true;
  }
  const bucket = Math.floor(Date.now() / 60000);
  const k = `rl:${userId}:${bucket}`;
  try {
    const res = await fetch(`${UPSTASH_URL}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', k], ['EXPIRE', k, 60]]),
    });
    if (!res.ok) return true;
    const out = await res.json();
    const count = Array.isArray(out) ? Number(out[0] && out[0].result) : 0;
    return count <= limitPerMinute;
  } catch {
    return true; // fail open
  }
}

module.exports = { dailyRequestCount, monthSpendUsd, allowPerMinute, upstashEnabled };
