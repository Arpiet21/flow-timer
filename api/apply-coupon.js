import { createClient } from '@supabase/supabase-js';

// Coupon definitions
const COUPONS = {
  'FAMILY100': { discount: 100, plan: 'yearly', description: 'Family — 1 year free' },
  'WELCOME50':  { discount: 50,  plan: 'monthly', description: '50% off first month' },
  'LAUNCH30':   { discount: 30,  plan: 'monthly', description: '30% off' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { code, userId } = req.body;
  if (!code || !userId) return res.status(400).json({ ok: false, error: 'Missing code or userId' });

  const coupon = COUPONS[code.toUpperCase().trim()];
  if (!coupon) return res.status(400).json({ ok: false, error: 'Invalid coupon code' });

  // 100% discount — grant Pro directly, no payment needed
  if (coupon.discount === 100) {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const now = new Date();
    const validUntil = new Date(now);
    if (coupon.plan === 'yearly') {
      validUntil.setFullYear(validUntil.getFullYear() + 1);
    } else {
      validUntil.setMonth(validUntil.getMonth() + 1);
    }

    const { error } = await supabase.from('user_plans').upsert({
      user_id: userId,
      plan: 'pro',
      plan_type: coupon.plan,
      payment_id: `coupon_${code.toUpperCase()}`,
      valid_until: validUntil.toISOString(),
      updated_at: now.toISOString()
    }, { onConflict: 'user_id' });

    if (error) return res.status(500).json({ ok: false, error: 'DB update failed' });

    return res.status(200).json({
      ok: true,
      free: true,
      description: coupon.description,
      validUntil: validUntil.toISOString()
    });
  }

  // Partial discount — return discount % so frontend applies it to payment amount
  return res.status(200).json({
    ok: true,
    free: false,
    discount: coupon.discount,
    description: coupon.description
  });
}
