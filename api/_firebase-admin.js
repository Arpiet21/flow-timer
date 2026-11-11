// Shared Firebase Admin SDK initializer for Vercel API routes
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

let _db, _adminAuth;

export function getAdminDb() {
  if (!_db) {
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId:   process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }
    _db = getFirestore();
  }
  return _db;
}

export function getAdminAuth() {
  if (!_adminAuth) {
    getAdminDb(); // ensures app is initialized
    _adminAuth = getAuth();
  }
  return _adminAuth;
}

/** Upsert a user's plan document */
export async function upsertPlan(userId, fields) {
  const db = getAdminDb();
  const ref = db.collection('users').doc(userId).collection('plan').doc('current');
  await ref.set({ ...fields, updated_at: new Date().toISOString() }, { merge: true });
}

/** Lifetime plan is capped to the first LIFETIME_LIMIT customers */
export const LIFETIME_LIMIT = 100;

function lifetimeCounterRef() {
  return getAdminDb().collection('meta').doc('lifetime_counter');
}

export async function getLifetimeCount() {
  const snap = await lifetimeCounterRef().get();
  return snap.exists ? (snap.data().count || 0) : 0;
}

/** Called once a lifetime payment is confirmed — always grants (payment already succeeded),
 *  just keeps the counter accurate for the "first 100" display/gate on new checkouts. */
export async function incrementLifetimeCount() {
  const db = getAdminDb();
  const ref = lifetimeCounterRef();
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    tx.set(ref, { count: current + 1, updated_at: new Date().toISOString() }, { merge: true });
  });
}
