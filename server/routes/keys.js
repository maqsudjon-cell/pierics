const router = require('express').Router();
const crypto = require('crypto');
const { requireAuth, loadUser } = require('../lib/auth');
const { sha256 } = require('../lib/apiKeyAuth');
const { supabase } = require('../lib/supabase');

// pk_live_ + url-safe entropy. We store only the sha256 hash + a display
// prefix; the full key is shown to the user exactly once, at creation.
function generateKey() {
  const raw = crypto.randomBytes(24).toString('base64url');
  const key = `pk_live_${raw}`;
  return { key, prefix: key.slice(0, 12), key_hash: sha256(key) };
}

router.use(requireAuth, loadUser);

// POST /api/keys — create a key, return the FULL key once.
router.post('/', async (req, res) => {
  const name = (req.body && req.body.name ? String(req.body.name) : 'default').slice(0, 60);
  const { key, prefix, key_hash } = generateKey();
  const { data, error } = await supabase.from('api_keys')
    .insert({ user_id: req.dbUser.id, key_prefix: prefix, key_hash, name, revoked: false })
    .select('id, key_prefix, name, created_at')
    .single();
  if (error) return res.status(400).json({ error: 'key_create_failed', message: error.message });
  // The only response that ever contains the plaintext key.
  res.json({ id: data.id, key, prefix: data.key_prefix, name: data.name, created_at: data.created_at });
});

// GET /api/keys — list the caller's keys (never the full key).
router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('api_keys')
    .select('id, key_prefix, name, created_at, last_used_at, revoked')
    .eq('user_id', req.dbUser.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: 'key_list_failed', message: error.message });
  res.json({
    keys: (data || []).map((k) => ({
      id: k.id, prefix: k.key_prefix, name: k.name,
      created_at: k.created_at, last_used_at: k.last_used_at, revoked: k.revoked,
    })),
  });
});

// DELETE /api/keys/:id — revoke (scoped to the caller).
router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('api_keys')
    .update({ revoked: true })
    .eq('id', req.params.id).eq('user_id', req.dbUser.id);
  if (error) return res.status(400).json({ error: 'key_revoke_failed', message: error.message });
  res.json({ ok: true });
});

module.exports = router;
