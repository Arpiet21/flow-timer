# Firebase Migration POC — Flow Timer

## What You Need from Google

1. **Google Account** (you already have one)
2. **Firebase Project** — free at console.firebase.google.com
3. **Enable these Firebase services:**
   - Firestore Database (replaces Supabase PostgreSQL)
   - Firebase Authentication (replaces Supabase Auth)
4. **Firebase SDK** — loaded via CDN, no install needed

---

## Cost Comparison

| | Supabase Free | Firebase Free (Spark Plan) |
|---|---|---|
| Database | 500MB | 1GB |
| Auth users | Unlimited | Unlimited |
| Reads/day | Unlimited | 50,000/day |
| Writes/day | Unlimited | 20,000/day |
| Cold starts | Yes (pauses after 1 week) | **No — always on** |
| Realtime | Extra setup | **Built in** |

**Firebase free tier never pauses. No cron job needed.**

---

## Data Structure Change

### Supabase (SQL Table)
```sql
tasks (
  id               uuid PRIMARY KEY,
  user_id          uuid,
  title            text,
  category         text,
  estimated_minutes integer,
  priority         integer,
  tags             text[],
  scheduled_date   text,
  recurring_days   integer[],
  completed        boolean,
  completed_at     timestamptz,
  created_at       timestamptz
)
```

### Firebase (Firestore Collections)
```
users/
  {userId}/
    tasks/
      {taskId}/
        title: "50 X Replies"
        category: "Social Mastery"
        estimated_minutes: 25
        priority: 2
        tags: ["#work"]
        scheduled_date: "2026-03-20"
        recurring_days: [1, 2, 3, 4, 5, 6, 0]
        completed: false
        completed_at: null
        created_at: Timestamp
```

No schema to define. Just write the object and Firestore creates it.

---

## Code Changes Required

### 1. Replace supabase-client.js → firebase-client.js

**Before (Supabase):**
```javascript
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
```

**After (Firebase):**
```javascript
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID"
};

const _app  = initializeApp(firebaseConfig);
const _db   = getFirestore(_app);
const _auth = getAuth(_app);
```

---

### 2. Replace auth.js core methods

**Before (Supabase Auth):**
```javascript
// Sign in
const { data, error } = await _sb.auth.signInWithPassword({ email, password });

// Google OAuth
const { data, error } = await _sb.auth.signInWithOAuth({ provider: 'google' });

// Sign out
await _sb.auth.signOut();

// Get current user
const { data: { session } } = await _sb.auth.getSession();
```

**After (Firebase Auth):**
```javascript
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

// Sign in
await signInWithEmailAndPassword(_auth, email, password);

// Google OAuth
const provider = new GoogleAuthProvider();
await signInWithPopup(_auth, provider);

// Sign out
await signOut(_auth);

// Get current user (reactive — no hanging)
onAuthStateChanged(_auth, user => {
  if (user) { /* logged in */ }
  else      { /* logged out */ }
});
```

---

### 3. Replace task operations in tasks.js

**Before (Supabase direct fetch):**
```javascript
// Read
const resp = await fetch(`${SUPABASE_URL}/rest/v1/tasks?user_id=eq.${uid}`, {
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }
});

// Insert
await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
  method: 'POST',
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(task)
});

// Delete
await fetch(`${SUPABASE_URL}/rest/v1/tasks?id=eq.${id}`, {
  method: 'DELETE',
  headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }
});
```

**After (Firestore SDK):**
```javascript
import { collection, getDocs, addDoc, deleteDoc, updateDoc, doc } from 'firebase/firestore';

const tasksRef = () => collection(_db, 'users', _auth.currentUser.uid, 'tasks');

// Read — no cold starts, instant
const snap = await getDocs(tasksRef());
const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

// Insert
const docRef = await addDoc(tasksRef(), { ...task, created_at: serverTimestamp() });
// docRef.id is the real ID — no UUID mismatch problem

// Delete
await deleteDoc(doc(_db, 'users', _auth.currentUser.uid, 'tasks', taskId));

// Update
await updateDoc(doc(_db, 'users', _auth.currentUser.uid, 'tasks', taskId), {
  completed: true,
  completed_at: serverTimestamp()
});
```

---

### 4. Replace Security Rules (replaces Supabase RLS)

**Firestore Security Rules:**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/tasks/{taskId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Paste this in Firebase Console → Firestore → Rules. Done.

---

## Migration Steps (in order)

1. **Create Firebase project** at console.firebase.google.com
2. **Enable Firestore** (start in production mode)
3. **Enable Authentication** → Email/Password + Google
4. **Get Firebase config object** from Project Settings
5. **Replace `supabase-client.js`** with `firebase-client.js`
6. **Rewrite `auth.js`** — swap Supabase auth calls for Firebase auth calls
7. **Rewrite task operations in `tasks.js`** — swap fetch calls for Firestore SDK calls
8. **Add Firestore Security Rules**
9. **Remove** the cron-job.org keep-alive (no longer needed)
10. **Test** add / delete / complete / reload
11. **Migrate existing data** — export from Supabase, import to Firestore (one-time script)

---

## What Stays the Same

- All HTML files — no changes
- All CSS — no changes
- Task object structure — same fields
- Optimistic UI pattern — same approach
- UUID generation on client — same (or use Firestore auto-ID)
- WeekPlanner / TaskCalendar — no changes
- Vercel deployment — no changes

---

## Biggest Benefit After Migration

| Problem now | After Firebase |
|---|---|
| Supabase JS client hangs | Gone — Firebase SDK never hangs |
| Cold start timeouts | Gone — Firestore always on |
| Refresh from Cloud stuck | Gone — reads are instant |
| Need cron-job.org keep-alive | Not needed |
| Delete not syncing | Gone — Firestore uses its own IDs, no UUID mismatch |

---

## Effort Estimate

| File | Work needed |
|---|---|
| `supabase-client.js` | Replace entirely (5 lines → 10 lines) |
| `auth.js` | Rewrite auth calls (~50 lines changed) |
| `tasks.js` | Rewrite 5 methods (_load, _sbInsert, _sbUpdate, _sbDelete, _refreshFromCloud) |
| HTML files | Replace CDN script tag (1 line each) |
| **Total** | **~2–3 hours** |
