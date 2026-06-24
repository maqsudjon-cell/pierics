const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { supabase, supabaseEnabled } = require('../lib/supabase');
const { signToken, publicUser } = require('../lib/auth');

router.post('/register', async (req, res) => {
  if (!supabaseEnabled) return res.status(503).json({ error: 'db_unavailable' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'password_too_short' });

  const password_hash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ email: String(email).toLowerCase(), password_hash, plan: 'free' })
    .select()
    .single();

  if (error) {
    const dup = error.code === '23505';
    return res.status(dup ? 409 : 400).json({ error: dup ? 'email_taken' : 'register_failed', message: error.message });
  }
  res.json({ token: signToken(data), user: publicUser(data) });
});

router.post('/login', async (req, res) => {
  if (!supabaseEnabled) return res.status(503).json({ error: 'db_unavailable' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_password_required' });

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', String(email).toLowerCase())
    .single();

  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

module.exports = router;
