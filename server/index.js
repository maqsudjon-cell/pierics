require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { handleWebhook } = require('./routes/webhook');
const { PRO_GUARD } = require('./lib/plans');

// Pro-tier loss-hole warning: in production, a Pro user on 10M GPT-4o output
// tokens costs ~$100 vs $50 paid (a $50 loss) unless the guard is on.
if (process.env.NODE_ENV === 'production' && PRO_GUARD.billPremiumSeparately === false) {
  console.warn('[pierics] WARNING: PRO_GUARD.billPremiumSeparately is OFF — Pro users can run GPT-4o at a loss. Set it true in server/lib/plans.js before real launch.');
}

const app = express();
app.use(cors());

// Stripe webhook needs the raw body for signature verification — mount it
// BEFORE the JSON body parser.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json({ limit: '1mb' })); // headroom for gateway chat prompts

app.get('/api/health', (req, res) =>
  res.json({ ok: true, name: 'pierics', time: new Date().toISOString() })
);

app.use('/api/plans', require('./routes/plans'));
app.use('/api/estimate', require('./routes/estimate'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/me', require('./routes/me'));
app.use('/api/usage', require('./routes/usage'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/keys', require('./routes/keys'));   // API-key management (JWT auth)
app.use('/api/v1', require('./routes/gateway'));   // the gateway (API-key auth)

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

module.exports = app;

// Local dev: start a listener. On Vercel the app is imported as a handler.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Pierics API → http://localhost:${port}`));
}
