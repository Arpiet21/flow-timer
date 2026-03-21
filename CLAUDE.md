# Flow Timer — Project State

1. **Stack**: Vanilla JS + HTML/CSS, hosted on Vercel free, Firebase (Firestore + Auth) for backend, auth via `auth.js`.
2. **Database**: Migrated from Supabase → Firebase Firestore. Tasks stored at `users/{uid}/tasks/{taskId}`. Plan at `users/{uid}/plan/current`. Sessions at `users/{uid}/sessions/{id}`. Devices at `users/{uid}/devices/{id}`.
3. **Auth**: Firebase Auth — email/password + Google (signInWithPopup). `firebase-client.js` initializes Firebase app, `_db`, `_auth`. Auth token read from Firebase Auth state, never from localStorage.
4. **Task Manager**: Full CRUD — add/edit/delete/complete tasks with categories, priorities (5 dots), estimated time (up to 2h), scheduled dates, recurring days, subtasks. Optimistic UI with Firestore sync via `_sbInsert/_sbUpdate/_sbDelete`.
5. **Task UI**: Tasks grouped by Today / Tomorrow / Day-after / Upcoming. Each section shows estimated time total. Edit button uses custom pencil SVG icon (`icons/edit.svg`). No "Refresh from Cloud" button — Firestore is always live.
6. **Weekly Planner**: Drag-and-drop tasks between days. Drop updates `scheduled_date` in Firestore and re-renders both TaskManager and WeekPlanner.
7. **Categories**: Dynamic reasons per category (unlimited add/delete rows).
8. **Trial/Plan system**: New users get 7-day trial (plan doc created in Firestore on first login). `_normalize()` computes `trialDaysLeft` from `valid_until - now`. `init()` wrapped in try/catch so app never hangs if Firestore fails. Plan repair logic: missing `valid_until` is backfilled on next login.
9. **Coupons**: `TRIAL30` (30-day trial), `FAMILYLIFE` (lifetime pro), `FAMILY100` (1yr pro), `WELCOME50` (50% off), `LAUNCH30` (30% off). All 100% coupons write to Firestore via `api/apply-coupon.js`.
10. **API routes** (Vercel serverless): All migrated from Supabase to Firebase Admin SDK. Shared init in `api/_firebase-admin.js`. Routes: `apply-coupon`, `apply-referral`, `verify-payment`, `stripe-webhook`, `weekly-report`. Requires Vercel env vars: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
11. **Service Worker**: Removed — was caching old JS. Auto-unregisters any existing SW on load.
12. **Blog**: `blog.html` / `blog-admin.html` exist but not yet wired to Firestore.
