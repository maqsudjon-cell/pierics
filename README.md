# PIERICS — Payment & Pricing System

Payment, metering and pricing for **Pierics**, a unified AI API aggregator.
Node/Express backend (also runs as a Vercel function) · React/Vite frontend ·
Supabase (Postgres) · Stripe (test mode) · JWT auth. Design: Nothing.tech —
pure black, dot-matrix, JetBrains Mono headers, single accent red `#D71921`.

**Live (frontend only, GitHub Pages):** https://maqsudjon-cell.github.io/pierics/
— pricing page + calculator work standalone; dashboard/billing need the backend.

**Full stack (frontend + backend, one domain):** one-click deploy to Vercel →

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmaqsudjon-cell%2Fpierics)

```
pierics/
├── db/schema.sql          # Supabase schema (idempotent — safe to re-run)
├── server/                # Express API (local dev + Vercel)
│   ├── lib/
│   │   ├── plans.js       # ★ central pricing config (single source of truth)
│   │   ├── pricing.js     # ★ the pricing engine (pure, tested)
│   │   ├── auth.js  rateLimit.js  supabase.js  stripe.js
│   │   └── …
│   ├── routes/            # plans · estimate · auth · me · usage · billing · webhook
│   ├── index.js           # Express entry (npm run dev)
│   └── pricing.test.js    # 13 checks proving the published tables
├── api/index.js           # Vercel serverless wrapper
└── web/                   # React/Vite frontend
    └── src/pages/Pricing.jsx  Dashboard.jsx
```

---

## The tier decision

Three tiers, each a different job in the funnel:

| Tier | Price | Included | Markup | Role |
|------|-------|----------|--------|------|
| **Free** | $0 | 50K tokens/mo, cheap+fast only | — (allowance) | Acquisition hook |
| **Pay-as-you-go** | $0 + usage | — | **1.3×** | Primary revenue (safe margin) |
| **Pro** | $50/mo | 10M tokens, all models | 1.0× / **1.1× overage** | Predictable bill |

**Recommendation:** lead with **Free + Pay-as-you-go**. Free drives adoption,
PayG is clean guaranteed margin. Pro is good but has an economic trap 👇

### ⚠️ Pro-tier safeguard (built in, off by default)

The $50 Pro plan breaks even only if a user's **blended provider cost stays
under $5 / 1M tokens**. 10M GPT-4o *output* tokens cost us $100 — but the user
paid $50, a **$50 loss**. The engine ships with a one-line guard in
[`server/lib/plans.js`](server/lib/plans.js):

```js
const PRO_GUARD = {
  billPremiumSeparately: false,   // ← set true to bill GPT-4o on Pro at 1.1× overage
  premiumModels: ['quality'],     //    even inside the allowance (closes the hole)
};
```

Default `false` = behaves exactly as the original spec. Flip to `true` before
launch if you expect GPT-4o-heavy Pro users. (Alternatively, lower
`PLANS.pro.monthlyTokens`.)

---

## Setup

### 1. Install
```bash
npm install            # backend
npm --prefix web install   # frontend
```

### 2. Database (Supabase)
Open the Supabase SQL editor and run [`db/schema.sql`](db/schema.sql). It creates
`plans`, `transactions`, `api_keys`, adds the new `users` / `usage_logs` columns,
and seeds the three plans. Idempotent — safe to re-run.

### 3. Environment
```bash
cp .env.example .env    # then fill in the values
```
| Var | Where |
|-----|-------|
| `JWT_SECRET` | any long random string |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe → Developers (test mode) |
| `STRIPE_PRO_PRICE_ID` | Stripe → Products → create a $50/mo recurring price |

### 4. Stripe webhook (local)
```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```
Put the printed `whsec_…` into `STRIPE_WEBHOOK_SECRET`.

---

## Run

```bash
npm run dev                # API on http://localhost:3000
npm --prefix web run dev   # UI  on http://localhost:5173  (proxies /api → :3000)
npm test                   # 13 pricing-engine checks
```

The **Pricing page + calculator work with zero config** (pure pricing engine).
Auth / usage / billing need Supabase + Stripe — without them those routes return
`503` and the UI shows a friendly "backend not configured" state.

## Deploy — both halves, one domain (Vercel)

This repo is a single full-stack deploy: Vercel builds the React app to static
files **and** runs the Express API as serverless functions under `/api`, all on
one URL. Config lives in [`vercel.json`](vercel.json):

```jsonc
{
  "buildCommand": "npm --prefix web install && npm --prefix web run build",
  "outputDirectory": "web/dist",                       // ← frontend
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api/index.js" }] // ← backend
}
```

**Steps:**
1. Go to **https://vercel.com/new** → "Log in with GitHub" → import `pierics`
   (or click the **Deploy with Vercel** button up top). Hit Deploy.
2. The site is live at `https://<your-app>.vercel.app`. The frontend, plus
   `/api/health`, `/api/plans`, `/api/estimate` work **immediately, no config**.
3. To enable accounts + billing, add these in Vercel → Settings → Environment
   Variables, then redeploy:

   | Variable | From |
   |----------|------|
   | `JWT_SECRET` | any long random string |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
   | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID` | Stripe (test mode) |
   | `APP_URL` | your `https://<your-app>.vercel.app` |

4. Run [`db/schema.sql`](db/schema.sql) in Supabase, and point the Stripe webhook
   at `https://<your-app>.vercel.app/api/billing/webhook`.

> **Why not GitHub Pages for the whole thing?** Pages only serves static files —
> it can't run the Node backend. That's why the Pages link above is frontend-only.
> Vercel runs both. (To refresh the Pages build: `DEPLOY_TARGET=pages npm --prefix web run build`.)

---

## How billing works

`POST /api/usage` is the metering core. After a model responds with token counts,
the gateway calls it; the engine prices the request, logs it to `usage_logs`,
debits the right bucket, and (PayG) fires auto top-up:

- **Free** → consumes monthly allowance, `$0` charge, 402 when exhausted.
- **PayG** → `base × 1.3`, debited from prepaid balance; auto-charges $10 when
  balance drops below $2.
- **Pro** → first 10M tokens included ($0 marginal); beyond that `base × 1.1`
  from balance. Premium-model guard optional (above).

### API reference

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/plans` | — | Plans + per-1M price table |
| POST | `/api/estimate` | — | Price a hypothetical request |
| POST | `/api/auth/register` · `/login` | — | JWT auth |
| GET | `/api/me` | JWT | User + usage summary |
| POST | `/api/usage` | JWT | Meter a request (the core) |
| POST | `/api/billing/checkout` | JWT | Stripe Checkout — Pro ($50, 7-day trial) |
| POST | `/api/billing/topup` | JWT | Stripe Checkout — balance top-up |
| POST | `/api/billing/webhook` | Stripe sig | Subscription / payment events |
| GET/POST/DELETE | `/api/keys` | JWT | Create / list / revoke API keys |
| POST | `/api/v1/chat/completions` | API key | **The gateway** — OpenAI-compatible (streaming) |
| GET | `/api/v1/models` | API key | Models available to the key's plan |

## The gateway (core product)

An **OpenAI-compatible** endpoint at `/api/v1`, authenticated by a Pierics API
key (`pk_live_…`, separate from the dashboard JWT). Create a key in the
dashboard's **// 006 API KEYS** section (shown once), then:

```bash
curl https://<your-app>.vercel.app/api/v1/chat/completions \
  -H "Authorization: Bearer pk_live_..." -H "Content-Type: application/json" \
  -d '{"model":"fast","messages":[{"role":"user","content":"Hello!"}]}'
```

Models: `cheap` (Llama 3 8B) · `fast` (Llama 3 70B) · `quality` (GPT-4o).
Works with the OpenAI SDK by setting `base_url` to `/api/v1`.

**Strict cost control (every request).** All money/limit decisions come from
`server/lib/pricing.js` + `plans.js`:
1. **Pre-flight gate** — model access (Free is blocked from `quality`), Free
   `quota_exceeded`, PayG/Pro `insufficient_balance`, `daily_limit_exceeded`,
   and a global `budget_exceeded` kill-switch (`GATEWAY_MONTHLY_BUDGET_USD`).
2. **`max_tokens` clamp** to a per-plan ceiling (Free 1024 / PayG 4096 / Pro
   8192) — bounds the worst-case cost of any single request.
3. **60s timeout**; failed/upstream-error requests are **never billed**.
4. **Meter from real usage** → one `usage_logs` row, then an **atomic**
   `increment_usage_and_bill` RPC (no read-modify-write race). Bounded overshoot
   is intentional: a user may exceed a limit by at most one clamped request.
5. **Provider keys** (`GROQ_API_KEY`, `OPENAI_API_KEY`) are server-side only and
   never logged; a missing key 503s **only that provider**.

**Demo budget mode.** Set `DEMO_BUDGET_MODE=1` to serve the `quality` tier from
`gpt-4o-mini` (~16× cheaper) **at its real price** for cheap testing; remove it
(and redeploy) before launch to restore GPT-4o.

### Launch checklist (gateway)
1. Add `GROQ_API_KEY` + `OPENAI_API_KEY` to Vercel env (fund the OpenAI account).
2. Re-run [`db/schema.sql`](db/schema.sql) in Supabase (adds the RPC + `platform_spend`).
3. Set `PRO_GUARD.billPremiumSeparately = true` in `server/lib/plans.js` and a
   sensible `GATEWAY_MONTHLY_BUDGET_USD`.
4. (Optional) Add `UPSTASH_REDIS_REST_URL` / `_TOKEN` to enable per-minute limits.
5. Remove `DEMO_BUDGET_MODE` and redeploy. Test: Free→`quota_exceeded`,
   out-of-balance→`insufficient_balance`.

## Notes & next steps

- The **gateway** bills via the atomic `increment_usage_and_bill` RPC (race-safe).
  The legacy `/api/usage` dashboard route still does an app-side update — fine for
  manual metering, but the gateway path is the authoritative one.
- Gateway per-minute rate limiting needs Upstash (set the two `UPSTASH_*` vars);
  without it, that limit is skipped (logged) — daily limits + budget still apply.
- Webhook `incrementBalance` (Stripe top-ups) is still read-modify-write — low
  contention, but could move to an RPC too.
- Add Supabase Row-Level Security policies before exposing the anon key anywhere.
