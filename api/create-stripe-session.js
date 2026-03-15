import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  monthly: { amount: 599,   label: '$5.99/month' },
  yearly:  { amount: 5799,  label: '$57.99/year' },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { plan, userId, userEmail } = req.body;
  if (!plan || !userId) return res.status(400).json({ ok: false, error: 'Missing plan or userId' });

  const price = PRICES[plan];
  if (!price) return res.status(400).json({ ok: false, error: 'Invalid plan' });

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
