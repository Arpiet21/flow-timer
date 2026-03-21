# Flow Timer — Project State

1. **Stack**: Vanilla JS + HTML/CSS, hosted on Vercel free, Firebase (Firestore + Auth) for backend, auth via `auth.js`.
2. **Database**: Firebase Firestore only. Tasks at `users/{uid}/tasks/{taskId}`. Plan at `users/{uid}/plan/current`. Sessions at `users/{uid}/sessions/{id}`. Devices at `users/{uid}/devices/{id}`. Scripts at `users/{uid}/scripts/{id}`.
3. **Auth**: Firebase Auth — email/password + Google (signInWithPopup). `firebase-client.js` initializes Firebase app, `_db`, `_auth`. Auth token read from Firebase Auth state, never from localStorage.
4. **Task Manager**: Full CRUD — add/edit/delete/complete tasks with categories, priorities (5 dots), estimated time (up to 2h), scheduled dates, recurring days, subtasks. Optimistic UI with Firestore sync via `_sbInsert/_sbUpdate/_sbDelete`.
5. **Task UI**: Tasks grouped by Today / Tomorrow / Day-after / Upcoming. Each section shows estimated time total. No "Refresh from Cloud" button — Firestore is always live.
6. **Weekly Planner**: Drag-and-drop tasks between days. Drop updates `scheduled_date` in Firestore and re-renders both TaskManager and WeekPlanner.
7. **Categories**: Dynamic reasons per category (unlimited add/delete rows).
8. **Trial/Plan system**: New users get 7-day trial (plan doc created in Firestore on first login). `_normalize()` computes `trialDaysLeft` from `valid_until - now`. Plan repair logic: missing `valid_until` is backfilled on next login.
9. **Coupons**: `TRIAL30` (30-day trial), `FAMILYLIFE` (lifetime pro), `FAMILY100` (1yr pro), `WELCOME50` (50% off), `LAUNCH30` (30% off). All write to Firestore via `api/apply-coupon.js`.
10. **API routes** (Vercel serverless): Firebase Admin SDK. Shared init in `api/_firebase-admin.js`. Routes: `apply-coupon`, `apply-referral`, `verify-payment`, `stripe-webhook`, `weekly-report`. Vercel env vars: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
11. **Activity Heatmap**: Focus timer and workout sessions stored in Firestore only (`users/{uid}/sessions`). `Auth.logSession(mode, minutes, task)` writes on each session complete. Heatmap reads via `Auth.getHeatmapData(mode)`. No localStorage fallback.
12. **Session History**: `loadHistory()` reads from Firestore via `Auth.getSessions()`. Fields: `mode`, `duration_minutes`, `task`, `completed_at`.
13. **Script Copier** (`scripts.js`): New section in Tasks tab below Week Planner. Scripts stored at `users/{uid}/scripts/{id}`. Each script has multiple clips (`clips[]` array). Features:
    - Add/edit/delete scripts and individual clips
    - **Import from ChatGPT**: paste JSON → auto-splits into clips. Supports `scenes→clips`, `shots`, `clips`, `frames` array formats.
    - JSON import: `global_style` added as first clip + embedded in every scene/shot clip JSON when copied.
    - Each clip copies as structured JSON: `{ shot_id, duration, motion, mood, prompt, global_style }`.
    - **Float button**: opens Document PiP sticky floating window (same as timer) — stays on top across all tabs.
14. **Service Worker**: Removed — was caching old JS. Auto-unregisters any existing SW on load.
15. **Blog**: `blog.html` / `blog-admin.html` exist but not yet wired to Firestore.
16. **Voiceover (planned)**: Next feature — Script Copier → Voiceover button using ElevenLabs or MiniMax T2A API. API key needed.
