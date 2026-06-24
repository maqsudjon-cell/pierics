// Plain-node test (no deps): `node server/pricing.test.js` or `npm test`.
// Verifies the engine reproduces the published price tables and bills correctly.

const assert = require('node:assert');
const { calculateCost, priceTable, PricingError } = require('./lib/pricing');

let passed = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

console.log('\nPRICE TABLE (per 1M tokens) matches spec');
const t = priceTable();
test('PayG GPT-4o = $3.25 in / $13.00 out', () => {
  assert.ok(approx(t.quality.payg.input, 3.25));
  assert.ok(approx(t.quality.payg.output, 13.0));
});
test('PayG Llama 70B = $0.767 in / $1.027 out', () => {
  assert.ok(approx(t.fast.payg.input, 0.767));
  assert.ok(approx(t.fast.payg.output, 1.027));
});
test('PayG Llama 8B = $0.065 in / $0.104 out', () => {
  assert.ok(approx(t.cheap.payg.input, 0.065));
  assert.ok(approx(t.cheap.payg.output, 0.104));
});
test('Pro within allowance = provider cost (1.0x)', () => {
  assert.ok(approx(t.quality.proIncluded.input, 2.5));
  assert.ok(approx(t.quality.proIncluded.output, 10.0));
});
test('Pro overage = $2.75 in / $11.00 out (GPT-4o, 1.1x)', () => {
  assert.ok(approx(t.quality.proOverage.input, 2.75));
  assert.ok(approx(t.quality.proOverage.output, 11.0));
});
test('Pro overage Llama 70B = $0.649 in / $0.869 out', () => {
  assert.ok(approx(t.fast.proOverage.input, 0.649));
  assert.ok(approx(t.fast.proOverage.output, 0.869));
});

console.log('\nPER-REQUEST BILLING');
test('PayG: 1M in + 1M out GPT-4o → $16.25 from balance', () => {
  const r = calculateCost({ plan: 'payg', model: 'quality', inputTokens: 1e6, outputTokens: 1e6, tokenBalance: 100 });
  assert.ok(approx(r.finalCost, 3.25 + 13.0), `got ${r.finalCost}`);
  assert.strictEqual(r.billedFrom, 'balance');
  assert.strictEqual(r.markupApplied, 1.3);
});
test('Free: small request consumes allowance, $0 charge', () => {
  const r = calculateCost({ plan: 'free', model: 'fast', inputTokens: 1000, outputTokens: 1000, tokensUsedThisMonth: 0 });
  assert.strictEqual(r.finalCost, 0);
  assert.strictEqual(r.billedFrom, 'allowance');
  assert.strictEqual(r.allowanceTokensUsed, 2000);
});
test('Free: blocks request over 50k allowance (402)', () => {
  assert.throws(
    () => calculateCost({ plan: 'free', model: 'fast', inputTokens: 30000, outputTokens: 30000, tokensUsedThisMonth: 0 }),
    (e) => e instanceof PricingError && e.code === 'allowance_exhausted' && e.status === 402
  );
});
test('Free: blocks `quality` model (403)', () => {
  assert.throws(
    () => calculateCost({ plan: 'free', model: 'quality', inputTokens: 10, outputTokens: 10 }),
    (e) => e.code === 'model_not_in_plan' && e.status === 403
  );
});
test('PayG: blocks on insufficient balance (402)', () => {
  assert.throws(
    () => calculateCost({ plan: 'payg', model: 'quality', inputTokens: 1e6, outputTokens: 1e6, tokenBalance: 1 }),
    (e) => e.code === 'insufficient_balance' && e.status === 402
  );
});
test('Pro: within allowance → included, $0 marginal', () => {
  const r = calculateCost({ plan: 'pro', model: 'quality', inputTokens: 1e6, outputTokens: 1e6, tokensUsedThisMonth: 0 });
  assert.strictEqual(r.finalCost, 0);
  assert.strictEqual(r.billedFrom, 'included');
});
test('Pro: pure overage GPT-4o output billed at 1.1x', () => {
  // allowance fully used; 1M output tokens entirely overage
  const r = calculateCost({ plan: 'pro', model: 'quality', inputTokens: 0, outputTokens: 1e6, tokensUsedThisMonth: 10e6, tokenBalance: 100 });
  assert.ok(approx(r.finalCost, 11.0), `got ${r.finalCost}`);
  assert.strictEqual(r.billedFrom, 'overage');
});

console.log(`\n${process.exitCode ? '❌ FAILURES' : '✅ ALL PASSED'} — ${passed} checks\n`);
