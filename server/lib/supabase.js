const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseEnabled = Boolean(url && key);
const supabase = supabaseEnabled
  ? createClient(url, key, { auth: { persistSession: false } })
  : null;

if (!supabaseEnabled) {
  console.warn('[pierics] SUPABASE_URL / SERVICE_ROLE_KEY not set — auth, usage & billing routes will return 503.');
}

module.exports = { supabase, supabaseEnabled };
