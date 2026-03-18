// ── Referral Reward ───────────────────────────────────────────────────────────
// Called after a new user signs up with a referral code.
// Extends the referrer's plan by 15 days (requires service role to find referrer).

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BONUS_DAYS = 15;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { code, refereeId } = req.body;
  if (!code || !refereeId) return res.status(400).json({ error: 'Missing params' });

  // Find referrer — their code is first 6 chars of UUID (no dashes, uppercase)
  const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const referrer = users?.find(u =>
    u.id.replace(/-/g, '').slice(0, 6).toUpperCase() === code.toUpperCase()
  );

  if (!referrer || referrer.id === refereeId) {
    return res.json({ ok: false, reason: 'referrer not found or self-referral' });
  }

  // Prevent double-rewarding
  const { data: existing } = await sb.from('referrals')
    .select('rewarded')
    .eq('referee_id', refereeId)
    .single();

  if (existing?.rewarded) return res.json({ ok: false, reason: 'already rewarded' });

  // Extend referrer's plan by 15 days
  const { data: plan } = await sb.from('user_plans')
    .select('valid_until, plan')
    .eq('user_id', referrer.id)
    .single();

  if (plan) {
    const base = plan.valid_until ? new Date(plan.valid_until) : new Date();
    if (base < new Date()) base.setTime(Date.now());
    base.setDate(base.getDate() + BONUS_DAYS);
    await sb.from('user_plans').update({
      valid_until: base.toISOString(),
      plan: plan.plan === 'free' ? 'trial' : plan.plan,
      updated_at: new Date().toISOString()
    }).eq('user_id', referrer.id);
  }

  // Mark referral as rewarded
  await sb.from('referrals')
    .update({ rewarded: true })
    .eq('referee_id', refereeId);

  return res.json({ ok: true, referrerId: referrer.id });
}
