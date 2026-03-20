import Stripe from 'stripe';
import { upsertPlan } from './_firebase-admin.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, plan } = session.metadata;

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
        payment_id: session.payment_intent,
        valid_until: validUntil.toISOString(),
      });
    } catch (err) {
      console.error('[stripe-webhook] Firestore error:', err);
    }
  }

  res.status(200).json({ received: true });
}
