import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    plan,
    userId
  } = req.body;

  // Verify Razorpay signature
  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ ok: false, error: 'Invalid signature' });
  }

  // Calculate expiry
  const now = new Date();
  let validUntil;
  if (plan === 'lifetime') {
    validUntil = new Date('2099-12-31T23:59:59Z');
  } else if (plan === 'yearly') {
    validUntil = new Date(now);
    validUntil.setFullYear(validUntil.getFullYear() + 1);
  } else {
    validUntil = new Date(now);
    validUntil.setMonth(validUntil.getMonth() + 1);
  }

  // Update Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { error } = await supabase.from('user_plans').upsert({
    user_id: userId,
    plan: 'pro',
    plan_type: plan,
    payment_id: razorpay_payment_id,
    valid_until: validUntil.toISOString(),
    updated_at: now.toISOString()
  }, { onConflict: 'user_id' });

  if (error) {
    console.error('Supabase error:', error);
    return res.status(500).json({ ok: false, error: 'DB update failed' });
  }

  res.status(200).json({ ok: true });
}
