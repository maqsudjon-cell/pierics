const { stripe, stripeEnabled } = require('../lib/stripe');
const { supabase, supabaseEnabled } = require('../lib/supabase');

// Stripe webhook. Mounted with express.raw() so the signature can be verified.
async function handleWebhook(req, res) {
  if (!stripeEnabled || !supabaseEnabled) return res.status(503).end();

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = secret
      ? stripe.webhooks.constructEvent(req.body, sig, secret)
      : JSON.parse(req.body); // dev fallback if no signing secret configured
  } catch (e) {
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const userId = s.metadata?.user_id;
        if (!userId) break;
        if (s.mode === 'subscription') {
          await supabase.from('users')
            .update({ plan: 'pro', subscription_status: 'active' })
            .eq('id', userId);
          await supabase.from('transactions').insert({
            user_id: userId, amount: 50, type: 'subscription', status: 'succeeded',
            stripe_invoice_id: s.invoice, description: 'Pro subscription',
          });
        } else if (s.mode === 'payment') {
          const amount = Number(s.metadata?.amount || (s.amount_total || 0) / 100);
          await incrementBalance(userId, amount);
          await supabase.from('transactions').insert({
            user_id: userId, amount, type: 'top_up', status: 'succeeded',
            stripe_payment_intent_id: s.payment_intent, description: 'Balance top-up',
          });
        }
        break;
      }

      case 'invoice.paid': {
        const inv = event.data.object;
        const userId = inv.lines?.data?.[0]?.metadata?.user_id;
        if (userId) {
          await supabase.from('users').update({ subscription_status: 'active' }).eq('id', userId);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = sub.metadata?.user_id;
        if (userId) {
          await supabase.from('users')
            .update({ plan: 'payg', subscription_status: 'canceled' })
            .eq('id', userId);
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        if (pi.metadata?.kind === 'auto_top_up' && pi.metadata?.user_id) {
          const amount = Number(pi.metadata.amount || 10);
          await incrementBalance(pi.metadata.user_id, amount);
          await supabase.from('transactions').insert({
            user_id: pi.metadata.user_id, amount, type: 'top_up', status: 'succeeded',
            stripe_payment_intent_id: pi.id, description: 'Auto top-up',
          });
        }
        break;
      }

      default:
        break;
    }
  } catch (e) {
    console.error('[pierics] webhook handler error:', e.message);
  }

  res.json({ received: true });
}

// Read-modify-write. For production prefer an atomic SQL RPC to avoid races.
async function incrementBalance(userId, amount) {
  const { data } = await supabase.from('users').select('token_balance').eq('id', userId).single();
  const next = Number(data?.token_balance || 0) + Number(amount);
  await supabase.from('users').update({ token_balance: next }).eq('id', userId);
}

module.exports = { handleWebhook };
