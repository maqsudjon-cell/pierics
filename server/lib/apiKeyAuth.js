const crypto = require('crypto');
const { supabase, supabaseEnabled } = require('./supabase');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Authenticate /api/v1/* with a Pierics API key (Bearer pk_live_...). This is
// SEPARATE from the dashboard JWT auth. Attaches req.apiUser (full user row)
// and req.apiKeyId. Never stores or logs the plaintext key — only its hash.
async function apiKeyAuth(req, res, next) {
  if (!supabaseEnabled) return res.status(503).json({ error: 'service_unavailable' });

  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  if (!token || !token.startsWith('pk_live_')) {
    return res.status(401).json({ error: 'invalid_api_key' });
  }

  const key_hash = sha256(token);
  const { data: key, error } = await supabase
    .from('api_keys')
    .select('id, user_id, revoked')
    .eq('key_hash', key_hash)
    .eq('revoked', false)
    .single();
  if (error || !key) return res.status(401).json({ error: 'invalid_api_key' });

  const { data: user, error: uErr } = await supabase
    .from('users').select('*').eq('id', key.user_id).single();
  if (uErr || !user) return res.status(401).json({ error: 'invalid_api_key' });

  req.apiUser = user;
  req.apiKeyId = key.id;

  // Best-effort last_used_at — never block the request on it.
  supabase.from('api_keys').update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id).then(() => {}, () => {});

  next();
}

module.exports = { apiKeyAuth, sha256 };
