import React, { useMemo, useState } from 'react';
import { estimate, priceTable, MODELS } from '../lib/pricing.js';
import { api, isAuthed } from '../lib/api.js';

const fmtUsd = (n) => {
  if (n === 0) return '$0.00';
  if (n < 0.01) return '$' + n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
};
const fmtTok = (n) => n.toLocaleString('en-US');

const PLAN_CARDS = [
  {
    id: 'free', num: '// 001', name: 'Free', price: '$0', per: '/month',
    blurb: 'Kick the tires. No credit card.',
    feats: [
      ['50,000', ' tokens / month'],
      ['cheap + fast', ' models (Llama 3 8B / 70B)'],
      ['10 req/min', ' · 200 req/day'],
      ['Email', ' support · 48h'],
      ['Basic', ' dashboard'],
    ],
    cta: 'Start free', primary: false,
  },
  {
    id: 'payg', num: '// 002', name: 'Pay-as-you-go', price: '$0', per: '+ usage',
    blurb: 'Pay only for what you use, at 1.3× provider cost.',
    feats: [
      ['1.3×', ' provider cost — no minimum'],
      ['All models', ' (incl. GPT-4o)'],
      ['60 req/min', ' · 10,000 req/day'],
      ['Prepaid balance', ' + auto top-up'],
      ['Full', ' dashboard & cost breakdown'],
    ],
    cta: 'Add a card', primary: false,
  },
  {
    id: 'pro', num: '// 003', name: 'Pro', price: '$50', per: '/month',
    blurb: '10M tokens included. For production workloads.',
    feats: [
      ['10,000,000', ' tokens / month included'],
      ['All models', ' + early access'],
      ['300 req/min', ' · unlimited / day'],
      ['Priority', ' email 4h + Discord'],
      ['Caching', ', CSV export, 3 seats'],
      ['1.1×', ' overage · 7-day free trial'],
    ],
    cta: 'Start 7-day trial', primary: true, featured: true,
  },
];

function PlanCard({ c }) {
  async function onCta() {
    if (!isAuthed()) { window.location.hash = '#/dashboard'; return; }
    try {
      if (c.id === 'pro') { const { url } = await api.checkout(); window.location.href = url; }
      else if (c.id === 'payg') { const { url } = await api.topup(10); window.location.href = url; }
      else window.location.hash = '#/dashboard';
    } catch (e) {
      alert(`${c.cta}: ${e.message}\n(Configure Stripe + Supabase to enable checkout.)`);
    }
  }
  return (
    <div className={`card ${c.featured ? 'featured' : ''}`}>
      {c.featured && <span className="tag">Most popular</span>}
      <span className="cnum">{c.num}</span>
      <h3>{c.name}</h3>
      <div className="price"><span className="amt">{c.price}</span><span className="per">{c.per}</span></div>
      <div className="blurb">{c.blurb}</div>
      <ul className="feat">
        {c.feats.map(([b, rest], i) => (
          <li key={i}><span className="mk">+</span><span><b>{b}</b>{rest}</span></li>
        ))}
      </ul>
      <button className={`btn ${c.primary ? 'primary' : ''}`} onClick={onCta}>{c.cta}</button>
    </div>
  );
}

function Calculator() {
  const [plan, setPlan] = useState('payg');
  const [model, setModel] = useState('quality');
  const [inT, setInT] = useState(500_000);
  const [outT, setOutT] = useState(500_000);

  const result = useMemo(
    () => estimate({ plan, model, inputTokens: Number(inT) || 0, outputTokens: Number(outT) || 0 }),
    [plan, model, inT, outT]
  );

  const presets = [
    ['1K', 1_000], ['100K', 100_000], ['1M', 1_000_000], ['10M', 10_000_000],
  ];

  return (
    <div className="calc">
      <div className="calc-controls">
        <div className="field">
          <label>Tier</label>
          <div className="seg accent">
            {['free', 'payg', 'pro'].map((p) => (
              <button key={p} className={plan === p ? 'on' : ''} onClick={() => setPlan(p)}>
                {p === 'payg' ? 'PayG' : p[0].toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Model</label>
          <div className="seg">
            {Object.entries(MODELS).map(([k, m]) => (
              <button key={k} className={model === k ? 'on' : ''} onClick={() => setModel(k)}>{m.label}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Input tokens</label>
          <div className="tokrow"><input type="number" min="0" value={inT} onChange={(e) => setInT(e.target.value)} /></div>
          <div className="presets">{presets.map(([l, v]) => <button key={l} onClick={() => setInT(v)}>{l}</button>)}</div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Output tokens</label>
          <div className="tokrow"><input type="number" min="0" value={outT} onChange={(e) => setOutT(e.target.value)} /></div>
          <div className="presets">{presets.map(([l, v]) => <button key={l} onClick={() => setOutT(v)}>{l}</button>)}</div>
        </div>
      </div>

      <div className="calc-out">
        <span className="out-label">Estimated cost · this request</span>
        {result.error ? (
          <>
            <div className="out-error">⃠ {result.message}</div>
            <div className="out-sub">Switch tier or model to price this request.</div>
            <div className="out-rows">
              <div className="r"><span>Tokens</span><span>{fmtTok((Number(inT) || 0) + (Number(outT) || 0))}</span></div>
            </div>
          </>
        ) : (
          <>
            <div className={`out-cost ${result.finalCost === 0 ? 'zero' : ''}`}>
              {result.finalCost === 0 ? 'Included' : fmtUsd(result.finalCost)}
            </div>
            <div className="out-sub">
              {result.billedFrom === 'allowance' && 'Drawn from your free monthly allowance.'}
              {result.billedFrom === 'included' && 'Covered by your Pro monthly allowance.'}
              {result.billedFrom === 'balance' && 'Charged to your prepaid balance.'}
              {result.billedFrom === 'overage' && 'Allowance exceeded — billed as overage.'}
            </div>
            <div className="out-rows">
              <div className="r"><span>Provider cost</span><span>{fmtUsd(result.baseCost)}</span></div>
              <div className="r"><span>Markup</span><span>{result.markupApplied.toFixed(2)}×</span></div>
              <div className="r"><span>Tokens</span><span>{fmtTok((Number(inT) || 0) + (Number(outT) || 0))}</span></div>
              <div className="r"><span>Billed from</span><span className={`badge ${result.billedFrom}`}>{result.billedFrom}</span></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PriceTable() {
  const rows = priceTable();
  return (
    <>
      <table className="ptable">
        <thead>
          <tr>
            <th>Model</th>
            <th>PayG in / out</th>
            <th>Pro incl. in / out</th>
            <th>Pro overage in / out</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(rows).map(([alias, r]) => (
            <tr key={alias}>
              <td>
                <div className="model">{r.label}</div>
                <div className="prov">{r.provider} · {alias}</div>
              </td>
              <td className="num">${r.payg.input} / ${r.payg.output}</td>
              <td className="num">${r.proIncluded.input} / ${r.proIncluded.output}</td>
              <td className="num">${r.proOverage.input} / ${r.proOverage.output}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="caption">Prices per 1,000,000 tokens, USD. Free tier draws from a 50K monthly allowance.</div>
    </>
  );
}

export default function Pricing() {
  return (
    <main>
      <div className="wrap">
        <header className="hero">
          <span className="eyebrow"><span className="n">//</span> PRICING</span>
          <h1>One key.<br />Every model.<br />Honest pricing.</h1>
          <p>Pierics aggregates the best AI providers behind a single API. Start free, pay only for what you use, or go Pro for predictable monthly billing.</p>
        </header>
      </div>

      <section>
        <div className="wrap">
          <span className="eyebrow"><span className="n">// 001–003</span> PLANS</span>
          <h2 className="section-title">Choose your tier</h2>
          <div className="cards">
            {PLAN_CARDS.map((c) => <PlanCard key={c.id} c={c} />)}
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <span className="eyebrow"><span className="n">// 004</span> COST CALCULATOR</span>
          <h2 className="section-title">Estimate any request</h2>
          <Calculator />
        </div>
      </section>

      <section style={{ borderBottom: 'none' }}>
        <div className="wrap">
          <span className="eyebrow"><span className="n">// 005</span> RATE CARD</span>
          <h2 className="section-title">Per-model pricing</h2>
          <PriceTable />
        </div>
      </section>
    </main>
  );
}
