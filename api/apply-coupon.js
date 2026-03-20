import { upsertPlan } from './_firebase-admin.js';

// Coupon definitions
const COUPONS = {
  'FAMILYLIFE': { discount: 100, plan: 'lifetime', description: 'Family — Lifetime Pro access' },
  'FAMILY100':  { discount: 100, plan: 'yearly',   description: 'Family — 1 year free' },
  'TRIAL30':    { discount: 100, plan: 'trial30',  description: '30-day free Pro trial' },
  'WELCOME50':  { discount: 50,  plan: 'monthly',  description: '50% off first month' },
  'LAUNCH30':   { discount: 30,  plan: 'monthly',  description: '30% off' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { code, userId } = req.body;
  if (!code || !userId) return res.status(400).json({ ok: false, error: 'Missing code or userId' });

  const coupon = COUPONS[code.toUpperCase().trim()];
  if (!coupon) return res.status(400).json({ ok: false, error: 'Invalid coupon code' });

  // 100% discount — grant Pro/Trial directly, no payment needed
  if (coupon.discount === 100) {
    try {
      const now = new Date();
      let validUntil;

      if (coupon.plan === 'lifetime') {
        validUntil = new Date('2099-12-31T23:59:59Z');
      } else if (coupon.plan === 'yearly') {
        validUntil = new Date(now);
        validUntil.setFullYear(validUntil.getFullYear() + 1);
      } else if (coupon.plan === 'trial30') {
        validUntil = new Date(now);
        validUntil.setDate(validUntil.getDate() + 30);
      } else {
        validUntil = new Date(now);
        validUntil.setMonth(validUntil.getMonth() + 1);
      }

      await upsertPlan(userId, {
        plan:       coupon.plan === 'trial30' ? 'trial' : 'pro',
        plan_type:  coupon.plan,
        payment_id: `coupon_${code.toUpperCase()}`,
        valid_until: validUntil.toISOString(),
      });

      return res.status(200).json({
        ok: true,
        free: true,
        description: coupon.description,
        validUntil: validUntil.toISOString(),
      });
    } catch (err) {
      console.error('[apply-coupon] Firestore error:', err);
      return res.status(500).json({ ok: false, error: 'DB update failed' });
    }
  }

  // Partial discount — return discount % so frontend applies it to payment amount
  return res.status(200).json({
    ok: true,
    free: false,
    discount: coupon.discount,
    description: coupon.description,
  });
}
