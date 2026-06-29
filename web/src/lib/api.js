const BASE = '/api';

const getToken = () => localStorage.getItem('pierics_token');
export const setToken = (t) => localStorage.setItem('pierics_token', t);
export const clearToken = () => localStorage.removeItem('pierics_token');
export const isAuthed = () => Boolean(getToken());

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error(body.message || body.error || 'request_failed'), { status: res.status, body });
  }
  return res.json();
}

export const api = {
  health: () => req('/health'),
  plans: () => req('/plans'),
  estimate: (b) => req('/estimate', { method: 'POST', body: JSON.stringify(b) }),
  me: () => req('/me'),
  register: (b) => req('/auth/register', { method: 'POST', body: JSON.stringify(b) }),
  login: (b) => req('/auth/login', { method: 'POST', body: JSON.stringify(b) }),
  checkout: () => req('/billing/checkout', { method: 'POST', body: '{}' }),
  topup: (amount) => req('/billing/topup', { method: 'POST', body: JSON.stringify({ amount }) }),
  keys: () => req('/keys'),
  createKey: (name) => req('/keys', { method: 'POST', body: JSON.stringify({ name }) }),
  revokeKey: (id) => req(`/keys/${id}`, { method: 'DELETE' }),
};
