const { PLANS } = require('./plans');

// In-memory fixed-window limiter. NOTE: per serverless instance only —
// for production use a shared store (Upstash/Redis). Fine for dev/test.
const minuteBuckets = new Map();
const dayBuckets = new Map();

function hit(map, key, windowMs, limit) {
  const now = Date.now();
  let b = map.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    map.set(key, b);
  }
  b.count += 1;
  const ok = limit == null || b.count <= limit;
  const remaining = limit == null ? Infinity : Math.max(0, limit - b.count);
  return { ok, remaining, resetAt: b.resetAt };
}

// Enforce the plan's per-minute and per-day request limits. Use after loadUser.
function rateLimit(req, res, next) {
  const plan = req.dbUser?.plan || 'free';
  const cfg = PLANS[plan] || PLANS.free;
  const id = req.dbUser?.id || req.user?.sub || req.ip;

  const m = hit(minuteBuckets, `m:${id}`, 60_000, cfg.rateLimitPerMinute);
  const d = hit(dayBuckets, `d:${id}`, 86_400_000, cfg.dailyRequestLimit);

  res.set('X-RateLimit-Limit', String(cfg.rateLimitPerMinute));
  res.set('X-RateLimit-Remaining', String(m.remaining));

  if (!m.ok) return res.status(429).json({ error: 'rate_limited', scope: 'minute', retryAt: m.resetAt });
  if (!d.ok) return res.status(429).json({ error: 'rate_limited', scope: 'day', retryAt: d.resetAt });
  next();
}

module.exports = { rateLimit };
