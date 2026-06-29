// Gateway unit tests — `node server/gateway.test.js` (run via `npm test`).
// No real network: provider calls and the Supabase RPC are mocked.

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');

const { preflight, clampOutputTokens, calculateCost } = require('./lib/pricing');
const { sha256 } = require('./lib/apiKeyAuth');
const { resolveAlias, listModelsForPlan } = require('./lib/models');
const { meterAndBill } = require('./lib/metering');

let passed = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; });
}

console.log('\nKEY GEN + HASHING');
test('sha256 is deterministic & 64 hex chars', () => {
  const h = sha256('pk_live_abc');
  assert.strictEqual(h.length, 64);
  assert.strictEqual(h, sha256('pk_live_abc'));
  assert.notStrictEqual(h, sha256('pk_live_abd'));
});

console.log('\nMODEL ROUTING + PLAN GATING');
test('resolveAlias maps fast → groq llama3-70b-8192', () => {
  assert.deepStrictEqual(resolveAlias('fast'), { alias: 'fast', provider: 'groq', upstreamModel: 'llama3-70b-8192', label: 'Llama 3 70B' });
});
test('Free model list excludes quality; PayG includes it', () => {
  const free = listModelsForPlan('free').data.map((m) => m.id);
  const payg = listModelsForPlan('payg').data.map((m) => m.id);
  assert.deepStrictEqual(free, ['cheap', 'fast']);
  assert.ok(payg.includes('quality'));
});

console.log('\nPRE-FLIGHT GATE');
test('Free + quality → 403 model_not_available', () => {
  const r = preflight({ plan: 'free', model: 'quality', tokensUsedThisMonth: 0, tokenBalance: 0 });
  assert.deepStrictEqual(r, { ok: false, status: 403, error: 'model_not_available' });
});
test('Free allowance gone → 402 quota_exceeded', () => {
  const r = preflight({ plan: 'free', model: 'fast', tokensUsedThisMonth: 50000 });
  assert.strictEqual(r.error, 'quota_exceeded');
});
test('Free with allowance left → ok', () => {
  const r = preflight({ plan: 'free', model: 'fast', tokensUsedThisMonth: 0 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.provider, 'groq');
});
test('PayG zero balance → 402 insufficient_balance', () => {
  const r = preflight({ plan: 'payg', model: 'quality', tokenBalance: 0 });
  assert.strictEqual(r.error, 'insufficient_balance');
});
test('Pro: allowance left → ok even with $0 balance', () => {
  const r = preflight({ plan: 'pro', model: 'quality', tokensUsedThisMonth: 0, tokenBalance: 0 });
  assert.strictEqual(r.ok, true);
});
test('Pro: allowance gone AND no balance → 402 insufficient_balance', () => {
  const r = preflight({ plan: 'pro', model: 'quality', tokensUsedThisMonth: 10_000_000, tokenBalance: 0 });
  assert.strictEqual(r.error, 'insufficient_balance');
});

console.log('\nMAX_TOKENS CLAMP');
test('Free clamps 999999 → 1024; honors smaller; default when missing', () => {
  assert.strictEqual(clampOutputTokens('free', 999999), 1024);
  assert.strictEqual(clampOutputTokens('free', 100), 100);
  assert.strictEqual(clampOutputTokens('pro', undefined), 8192);
  assert.strictEqual(clampOutputTokens('payg', 0), 4096);
});

console.log('\nMETERING + ATOMIC RPC (mocked db)');
test('PayG meter → usage_logs insert + increment_usage_and_bill with balance debit', async () => {
  const calls = { insert: null, rpc: null };
  const mockDb = {
    from() { return { insert(row) { calls.insert = row; return Promise.resolve({ error: null }); } }; },
    rpc(name, params) { calls.rpc = { name, params }; return Promise.resolve({ data: [{ tokens_used_this_month: 2000, token_balance: 9.99 }], error: null }); },
  };
  const out = await meterAndBill({
    db: mockDb,
    user: { id: 'u1', plan: 'payg', tokens_used_this_month: 0, token_balance: 10 },
    alias: 'fast', inputTokens: 1000, outputTokens: 1000,
  });
  // fast: (0.59+0.79)/1e3 = 0.00138 base; ×1.3 = 0.001794 final
  assert.ok(approx(out.cost.baseCost, 0.00138), `base ${out.cost.baseCost}`);
  assert.ok(approx(out.cost.finalCost, 0.001794), `final ${out.cost.finalCost}`);
  assert.strictEqual(calls.rpc.name, 'increment_usage_and_bill');
  assert.strictEqual(calls.rpc.params.p_tokens, 2000);
  assert.strictEqual(calls.rpc.params.p_billed_from, 'balance');
  assert.ok(approx(calls.rpc.params.p_final_cost, 0.001794));
  assert.strictEqual(calls.insert.billed_from, 'balance');
});
test('Pro overage meter does not throw on $0 balance (bounded overshoot)', async () => {
  const mockDb = {
    from() { return { insert() { return Promise.resolve({ error: null }); } }; },
    rpc() { return Promise.resolve({ data: [{ tokens_used_this_month: 1, token_balance: -11 }], error: null }); },
  };
  // allowance fully used, output entirely overage, no balance → must still meter
  const out = await meterAndBill({
    db: mockDb,
    user: { id: 'u2', plan: 'pro', tokens_used_this_month: 10_000_000, token_balance: 0 },
    alias: 'quality', inputTokens: 0, outputTokens: 1_000_000,
  });
  assert.strictEqual(out.cost.billedFrom, 'overage');
  assert.ok(approx(out.cost.finalCost, 11.0), `final ${out.cost.finalCost}`); // 10 × 1.1
});

console.log('\nMETERING MATH (free/payg/pro via pricing.js)');
test('Free meter → $0, billed from allowance', () => {
  const r = calculateCost({ plan: 'free', model: 'cheap', inputTokens: 1000, outputTokens: 1000, enforce: false });
  assert.strictEqual(r.finalCost, 0);
  assert.strictEqual(r.billedFrom, 'allowance');
});

console.log('\nDEMO_BUDGET_MODE (isolated child process)');
test('DEMO_BUDGET_MODE=1 swaps quality model AND price together', () => {
  const plansPath = require.resolve('./lib/plans');
  const script = `const {MODELS}=require(${JSON.stringify(plansPath)});process.stdout.write(JSON.stringify(MODELS.quality))`;
  const off = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, DEMO_BUDGET_MODE: '0' } }).toString());
  const on = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, DEMO_BUDGET_MODE: '1' } }).toString());
  assert.strictEqual(off.model, 'gpt-4o');
  assert.strictEqual(off.input, 2.5);
  assert.strictEqual(on.model, 'gpt-4o-mini'); // model swapped
  assert.strictEqual(on.input, 0.15);          // …AND price swapped together
  assert.strictEqual(on.output, 0.6);
});

process.on('exit', () => {
  console.log(`\n${process.exitCode ? '❌ FAILURES' : '✅ ALL PASSED'} — ${passed} checks\n`);
});
