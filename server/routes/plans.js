const router = require('express').Router();
const { PLANS } = require('../lib/plans');
const { priceTable } = require('../lib/pricing');

// Public: list plans + the published per-1M price table.
router.get('/', (req, res) => {
  res.json({ plans: Object.values(PLANS), priceTable: priceTable() });
});

module.exports = router;
