const router = require('express').Router();
const { calculateCost } = require('../lib/pricing');

// Public: estimate the cost of a hypothetical request (no DB, no auth).
// Powers the pricing-page calculator. Balance defaults high so it just prices.
router.post('/', (req, res) => {
  const {
    plan = 'payg',
    model = 'quality',
    inputTokens = 0,
    outputTokens = 0,
    tokensUsedThisMonth = 0,
    tokenBalance = 1e9,
  } = req.body || {};

  try {
    const result = calculateCost({
      plan,
      model,
      inputTokens: Number(inputTokens),
      outputTokens: Number(outputTokens),
      tokensUsedThisMonth: Number(tokensUsedThisMonth),
      tokenBalance: Number(tokenBalance),
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.code || 'pricing_error', message: e.message });
  }
});

module.exports = router;
