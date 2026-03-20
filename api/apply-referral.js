// ── Referral Reward ───────────────────────────────────────────────────────────
// Called after a new user signs up with a referral code.
// Extends the referrer's plan by 15 days.

import { getAdminDb, getAdminAuth } from './_firebase-admin.js';

const BONUS_DAYS = 15;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { code, refereeId } = req.body;
  if (!code || !refereeId) return res.status(400).json({ error: 'Missing params' });

  const db   = getAdminDb();
  const auth = getAdminAuth();

  // Find referrer — their code is first 6 chars of Firebase UID (no dashes, uppercase)
  let pageToken;
  let referrer = null;
  do {
    const result = await auth.listUsers(1000, pageToken);
    referrer = result.users.find(u =>
      u.uid.replace(/-/g, '').slice(0, 6).toUpperCase() === code.toUpperCase()
    );
    pageToken = result.pageToken;
  } while (!referrer && pageToken);

  if (!referrer || referrer.uid === refereeId) {
    return res.json({ ok: false, reason: 'referrer not found or self-referral' });
  }

  // Prevent double-rewarding
  const referralRef = db.collection('referrals').doc(refereeId);
  const referralSnap = await referralRef.get();
  if (referralSnap.exists && referralSnap.data().rewarded) {
    return res.json({ ok: false, reason: 'already rewarded' });
  }

  // Extend referrer's plan by BONUS_DAYS
  const planRef  = db.collection('users').doc(referrer.uid).collection('plan').doc('current');
  const planSnap = await planRef.get();

  if (planSnap.exists) {
    const plan = planSnap.data();
    const base = plan.valid_until ? new Date(plan.valid_until) : new Date();
    if (base < new Date()) base.setTime(Date.now());
    base.setDate(base.getDate() + BONUS_DAYS);
    await planRef.update({
      valid_until: base.toISOString(),
      plan: plan.plan === 'free' ? 'trial' : plan.plan,
      updated_at:  new Date().toISOString(),
    });
  }

  // Mark referral as rewarded
  await referralRef.set({ rewarded: true, referral_code: code.toUpperCase(), rewarded_at: new Date().toISOString() }, { merge: true });

  return res.json({ ok: true, referrerId: referrer.uid });
}
