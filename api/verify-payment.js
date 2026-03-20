import crypto from 'crypto';
import { upsertPlan } from './_firebase-admin.js';

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

  try {
    await upsertPlan(userId, {
      plan:       'pro',
      plan_type:  plan,
      payment_id: razorpay_payment_id,
      valid_until: validUntil.toISOString(),
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[verify-payment] Firestore error:', err);
    res.status(500).json({ ok: false, error: 'DB update failed' });
  }
}
