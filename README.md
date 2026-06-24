# PIERICS — Payment & Pricing System

Payment, metering and pricing for **Pierics**, a unified AI API aggregator.
Node/Express backend (also runs as a Vercel function) · React/Vite frontend ·
Supabase (Postgres) · Stripe (test mode) · JWT auth. Design: Nothing.tech —
pure black, dot-matrix, JetBrains Mono headers, single accent red `#D71921`.

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

## Deploy (Vercel)

`vercel.json` routes `/api/*` to `api/index.js`. Set the same env vars in the
Vercel dashboard, point the Stripe webhook at
`https://<your-app>/api/billing/webhook`, and deploy `web/` as a static build
(`npm --prefix web run build` → `web/dist`).

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

## Notes & next steps

- Rate limiting is in-memory (per instance) — use Upstash/Redis in production.
- `incrementBalance` is read-modify-write; replace with an atomic Supabase RPC
  before going live to avoid races under concurrency.
- Add Supabase Row-Level Security policies before exposing the anon key anywhere.
