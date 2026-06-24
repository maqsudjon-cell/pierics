require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { handleWebhook } = require('./routes/webhook');

const app = express();
app.use(cors());

// Stripe webhook needs the raw body for signature verification — mount it
// BEFORE the JSON body parser.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleWebhook);

app.use(express.json());

app.get('/api/health', (req, res) =>
  res.json({ ok: true, name: 'pierics', time: new Date().toISOString() })
);

app.use('/api/plans', require('./routes/plans'));
app.use('/api/estimate', require('./routes/estimate'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/me', require('./routes/me'));
app.use('/api/usage', require('./routes/usage'));
app.use('/api/billing', require('./routes/billing'));

app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

module.exports = app;

// Local dev: start a listener. On Vercel the app is imported as a handler.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Pierics API → http://localhost:${port}`));
}
