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
