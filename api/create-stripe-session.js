import Stripe from 'stripe';
import { getLifetimeCount, LIFETIME_LIMIT } from './_firebase-admin.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  monthly:  { amount: 799,   label: '$7.99/month' },
  yearly:   { amount: 7999,  label: '$79.99/year' },
  lifetime: { amount: 10000, label: '$100 one-time' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { plan, userId, userEmail } = req.body;
  if (!plan || !userId) return res.status(400).json({ ok: false, error: 'Missing plan or userId' });

  const price = PRICES[plan];
  if (!price) return res.status(400).json({ ok: false, error: 'Invalid plan' });

  if (plan === 'lifetime') {
    const count = await getLifetimeCount();
    if (count >= LIFETIME_LIMIT) {
      return res.status(409).json({ ok: false, error: 'Lifetime plan is sold out — only the first 100 customers get it.' });
    }
  }

  const origin = req.headers.origin || 'https://flow-timer-rho.vercel.app';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: userEmail,
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: {
          name: 'Flow Timer Pro',
          description: plan === 'yearly' ? 'Pro Plan — Yearly' : 'Pro Plan — Monthly',
        },
        unit_amount: price.amount,
      },
      quantity: 1,
    }],
    metadata: { userId, plan },
    success_url: `${origin}/index.html?upgraded=true`,
    cancel_url:  `${origin}/upgrade.html`,
  });

  res.status(200).json({ ok: true, url: session.url });
}
