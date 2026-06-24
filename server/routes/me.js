const router = require('express').Router();
const { requireAuth, loadUser, publicUser } = require('../lib/auth');
const { supabase } = require('../lib/supabase');
const { PLANS } = require('../lib/plans');
const { round6 } = require('../lib/pricing');

// Authenticated: current user + plan + usage summary for the dashboard.
router.get('/', requireAuth, loadUser, async (req, res) => {
  const u = req.dbUser;

  const [{ data: logs }, { data: txns }] = await Promise.all([
    supabase.from('usage_logs').select('*').eq('user_id', u.id).order('created_at', { ascending: false }).limit(20),
    supabase.from('transactions').select('*').eq('user_id', u.id).order('created_at', { ascending: false }).limit(20),
  ]);

  const planCfg = PLANS[u.plan] || PLANS.free;
  const recentSpend = (logs || []).reduce((s, l) => s + Number(l.final_cost || 0), 0);

  res.json({
    user: publicUser(u),
    plan: planCfg,
    usage: {
      tokensUsedThisMonth: Number(u.tokens_used_this_month || 0),
      monthlyAllowance: planCfg.monthlyTokens,
      tokenBalance: Number(u.token_balance || 0),
      recentSpend: round6(recentSpend),
      requestCount: (logs || []).length,
      subscriptionStatus: u.subscription_status,
      trialEndsAt: u.trial_ends_at,
    },
    recentLogs: logs || [],
    transactions: txns || [],
  });
});

module.exports = router;
