import React, { useEffect, useState } from 'react';
import { api, isAuthed, setToken, clearToken } from '../lib/api.js';

const fmtUsd = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtTok = (n) => Number(n || 0).toLocaleString('en-US');

function AuthBox({ onAuthed }) {
  const [mode, setMode] = useState('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const fn = mode === 'register' ? api.register : api.login;
      const { token } = await fn({ email, password });
      setToken(token);
      onAuthed();
    } catch (e) {
      setErr(e.status === 503 ? 'Backend not configured — add Supabase keys to enable accounts.' : e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="auth-box">
      <div className="seg accent" style={{ marginBottom: 22 }}>
        <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Register</button>
        <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Log in</button>
      </div>
      <form onSubmit={submit}>
        <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="password (8+ chars)" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="btn primary" disabled={busy}>{busy ? '···' : mode === 'register' ? 'Create account' : 'Log in'}</button>
      </form>
      {err && <div className="out-error" style={{ fontSize: 13, marginTop: 16 }}>{err}</div>}
    </div>
  );
}

function Stat({ k, v, sub, children }) {
  return <div className="stat"><div className="k">{k}</div><div className="v">{v}</div>{sub && <div className="sub">{sub}</div>}{children}</div>;
}

export default function Dashboard() {
  const [authed, setAuthed] = useState(isAuthed());
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  function load() {
    api.me().then(setData).catch((e) => setErr(e.status === 503 ? '503' : e.message));
  }
  useEffect(() => { if (authed) load(); }, [authed]);

  if (!authed) {
    return (
      <main><div className="wrap"><section style={{ borderBottom: 'none' }}>
        <span className="eyebrow"><span className="n">//</span> ACCOUNT</span>
        <h2 className="section-title">Sign in to Pierics</h2>
        <AuthBox onAuthed={() => setAuthed(true)} />
        <div className="note"><b>Preview note:</b> accounts, usage metering and billing need Supabase + Stripe env vars. The Pricing page and calculator run fully without them.</div>
      </section></div></main>
    );
  }

  if (err === '503') {
    return (
      <main><div className="wrap"><section style={{ borderBottom: 'none' }}>
        <span className="eyebrow"><span className="n">//</span> DASHBOARD</span>
        <h2 className="section-title">Backend not configured</h2>
        <div className="note">The API is running but <b>Supabase isn’t connected</b>. Add <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_ROLE_KEY</code> to <code>.env</code>, run <code>db/schema.sql</code>, and restart. <button className="btn" style={{ width: 'auto', margintop: 14, marginTop: 16 }} onClick={() => { clearToken(); setAuthed(false); }}>Sign out</button></div>
      </section></div></main>
    );
  }

  if (!data) {
    return <main><div className="wrap"><section><div className="muted">Loading…{err && ` ${err}`}</div></section></div></main>;
  }

  const { user, plan, usage } = data;
  const pct = usage.monthlyAllowance ? Math.min(100, (usage.tokensUsedThisMonth / usage.monthlyAllowance) * 100) : null;

  return (
    <main><div className="wrap">
      <section style={{ borderBottom: 'none' }}>
        <span className="eyebrow"><span className="n">//</span> DASHBOARD</span>
        <h2 className="section-title">{user.email}</h2>
        <div className="muted" style={{ marginTop: 8, fontFamily: 'var(--mono)', fontSize: 13 }}>
          PLAN: {plan.name.toUpperCase()} · STATUS: {(usage.subscriptionStatus || 'active').toUpperCase()}
        </div>

        <div className="stat-grid">
          <Stat k="Tokens this month" v={fmtTok(usage.tokensUsedThisMonth)} sub={usage.monthlyAllowance ? `of ${fmtTok(usage.monthlyAllowance)} included` : 'pay-as-you-go'}>
            {pct != null && <div className="bar"><i style={{ width: `${pct}%` }} /></div>}
          </Stat>
          <Stat k="Prepaid balance" v={fmtUsd(usage.tokenBalance)} sub="available" />
          <Stat k="Requests logged" v={fmtTok(usage.requestCount)} sub="last 20 shown below" />
          <Stat k="Recent spend" v={fmtUsd(usage.recentSpend)} sub="across recent requests" />
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
          {plan.id !== 'pro' && <button className="btn primary" style={{ width: 'auto' }} onClick={() => api.checkout().then(({ url }) => (window.location.href = url)).catch((e) => alert(e.message))}>Upgrade to Pro</button>}
          <button className="btn" style={{ width: 'auto' }} onClick={() => api.topup(10).then(({ url }) => (window.location.href = url)).catch((e) => alert(e.message))}>Add $10 balance</button>
          <button className="btn" style={{ width: 'auto' }} onClick={() => { clearToken(); setAuthed(false); }}>Sign out</button>
        </div>

        {data.recentLogs?.length > 0 && (
          <table className="ptable" style={{ marginTop: 36 }}>
            <thead><tr><th>Model</th><th>In / Out</th><th>Markup</th><th>Cost</th><th>Billed</th></tr></thead>
            <tbody>
              {data.recentLogs.map((l) => (
                <tr key={l.id}>
                  <td className="model">{l.model}</td>
                  <td className="num">{fmtTok(l.input_tokens)} / {fmtTok(l.output_tokens)}</td>
                  <td className="num">{Number(l.markup_applied).toFixed(2)}×</td>
                  <td className="num">{fmtUsd(l.final_cost)}</td>
                  <td><span className={`badge ${l.billed_from}`}>{l.billed_from}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div></main>
  );
}
