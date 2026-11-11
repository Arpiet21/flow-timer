// api/lifetime-status.js — public read of Lifetime-plan availability (capped at first 100 customers)
import { getLifetimeCount, LIFETIME_LIMIT } from './_firebase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const count = await getLifetimeCount();
    const remaining = Math.max(0, LIFETIME_LIMIT - count);
    res.status(200).json({ count, limit: LIFETIME_LIMIT, remaining, available: remaining > 0 });
  } catch (err) {
    // Fail open — don't block the pricing page if this lookup errors
    res.status(200).json({ count: 0, limit: LIFETIME_LIMIT, remaining: LIFETIME_LIMIT, available: true });
  }
}
