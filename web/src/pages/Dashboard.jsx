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

function CopyField({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copyfield">
      <code>{value}</code>
      <button className="btn" style={{ width: 'auto' }} onClick={() => {
        navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500);
      }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

function ApiKeys() {
  const [keys, setKeys] = useState(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState(null);

  function load() { api.keys().then((d) => setKeys(d.keys)).catch((e) => setErr(e.status === 503 ? 'Backend not configured.' : e.message)); }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true); setErr('');
    try { const r = await api.createKey(name || 'default'); setNewKey(r.key); setName(''); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function revoke(id) {
    if (!window.confirm('Revoke this key? Apps using it will stop working.')) return;
    try { await api.revokeKey(id); load(); } catch (e) { setErr(e.message); }
  }

  const base = (typeof window !== 'undefined' ? window.location.origin : '') + '/api/v1';

  return (
    <section style={{ borderTop: '1px solid var(--line-soft)', marginTop: 48, paddingTop: 48 }}>
      <span className="eyebrow"><span className="n">// 006</span> API KEYS</span>
      <h2 className="section-title">Your API keys</h2>
      <p className="muted" style={{ marginTop: 8, maxWidth: 560, lineHeight: 1.6 }}>
        Call AI models through the Pierics gateway with a key below. Usage is metered and billed to your plan.
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
        <input className="keyname" placeholder="key name (e.g. production)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" style={{ width: 'auto' }} disabled={busy} onClick={create}>{busy ? '···' : 'Create key'}</button>
      </div>

      {newKey && (
        <div className="note" style={{ marginTop: 18 }}>
          <b>Save this key now — you won’t see it again.</b>
          <div style={{ marginTop: 10 }}><CopyField value={newKey} /></div>
        </div>
      )}
      {err && <div className="out-error" style={{ fontSize: 13, marginTop: 14 }}>{err}</div>}

      {keys && keys.length > 0 && (
        <table className="ptable" style={{ marginTop: 28 }}>
          <thead><tr><th>Key</th><th>Name</th><th>Created</th><th>Last used</th><th></th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={k.revoked ? { opacity: 0.45 } : undefined}>
                <td className="model">{k.prefix}…{k.revoked && <span className="badge" style={{ marginLeft: 8 }}>revoked</span>}</td>
                <td className="num">{k.name}</td>
                <td className="num">{new Date(k.created_at).toLocaleDateString()}</td>
                <td className="num">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : '—'}</td>
                <td>{!k.revoked && <button className="btn" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => revoke(k.id)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {keys && keys.length === 0 && <p className="muted" style={{ marginTop: 18 }}>No keys yet. Create one to start calling the API.</p>}

      <h3 style={{ fontFamily: 'var(--mono)', fontSize: 14, marginTop: 36, letterSpacing: 1, color: 'var(--muted-2)' }}>// HOW TO USE</h3>
      <p className="muted" style={{ marginTop: 8 }}>Base URL <code>{base}</code> — OpenAI-compatible. Models: <code>cheap</code>, <code>fast</code>, <code>quality</code>.</p>
      <pre className="codeblock">{`curl ${base}/chat/completions \\
  -H "Authorization: Bearer $PIERICS_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"fast","messages":[{"role":"user","content":"Hello!"}]}'`}</pre>
      <pre className="codeblock">{`from openai import OpenAI
client = OpenAI(api_key="pk_live_...", base_url="${base}")
r = client.chat.completions.create(
    model="fast",   # cheap | fast | quality
    messages=[{"role": "user", "content": "Hello!"}],
)
print(r.choices[0].message.content)`}</pre>
    </section>
  );
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

        <ApiKeys />
      </section>
    </div></main>
  );
}
