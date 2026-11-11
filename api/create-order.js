import { getLifetimeCount, LIFETIME_LIMIT } from './_firebase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { plan } = req.body;

  if (plan === 'lifetime') {
    const count = await getLifetimeCount();
    if (count >= LIFETIME_LIMIT) {
      return res.status(409).json({ error: 'Lifetime plan is sold out — only the first 100 customers get it.' });
    }
  }

  const amount = plan === 'yearly' ? 399900 : plan === 'lifetime' ? 1000000 : 49900; // paise (INR)

  const auth = Buffer.from(
    `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
  ).toString('base64');

  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount,
      currency: 'INR',
      receipt: `ft_${Date.now()}`,
      notes: { plan }
    })
  });

  const order = await response.json();
  res.status(200).json(order);
}
