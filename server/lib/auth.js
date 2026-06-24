const jwt = require('jsonwebtoken');
const { supabase, supabaseEnabled } = require('./supabase');

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, SECRET, { expiresIn: '7d' });
}

// Verify the bearer token and attach { sub, email } to req.user.
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// Load the full user row from the DB → req.dbUser. Use after requireAuth.
async function loadUser(req, res, next) {
  if (!supabaseEnabled) return res.status(503).json({ error: 'db_unavailable' });
  const { data, error } = await supabase.from('users').select('*').eq('id', req.user.sub).single();
  if (error || !data) return res.status(401).json({ error: 'user_not_found' });
  req.dbUser = data;
  next();
}

function publicUser(u) {
  if (!u) return u;
  const { password_hash, ...rest } = u;
  return rest;
}

module.exports = { signToken, requireAuth, loadUser, publicUser, SECRET };
