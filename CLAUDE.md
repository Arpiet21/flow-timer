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
10. **API routes** (Vercel serverless): Firebase Admin SDK. Shared init in `api/_firebase-admin.js`. Routes: `apply-coupon`, `apply-referral`, `verify-payment`, `stripe-webhook`, `weekly-report`, `generate-script`. Vercel env vars: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `GROK_API_KEY`.
11. **Activity Heatmap**: Focus timer and workout sessions stored in Firestore only (`users/{uid}/sessions`). `Auth.logSession(mode, minutes, task)` writes on each session complete. Heatmap reads via `Auth.getHeatmapData(mode)`. No localStorage fallback.
12. **Session History**: `loadHistory()` reads from Firestore via `Auth.getSessions()`. Fields: `mode`, `duration_minutes`, `task`, `completed_at`.
13. **Tabs**: 5 tabs across 2 rows — Row 1: ⏱ Work Timer, 💪 Workout Timer, ✅ Tasks, 🎬 Video. Row 2: 🧘 Meditation (separated by `.mode-tabs-divider`). Mobile: 2×2 grid at ≤640px. `switchTimerType(mode)` handles show/hide of all sections.
14. **Video Creation Tab** (`#video-section`): New tab housing Script Copier. `ScriptCopier.init()` called when switching to Video tab.
15. **Script Copier** (`scripts.js`): Scripts stored at `users/{uid}/scripts/{id}`. Each script has multiple clips (`clips[]` array). Features:
    - Scripts show as collapsed folders — click to expand clips inside
    - Multi-select checkboxes + bulk delete bar (delete multiple scripts at once)
    - Add/edit/delete scripts and individual clips
    - **Import from ChatGPT**: paste JSON → auto-splits into clips. Supports `scenes→clips`, `shots`, `clips`, `frames` array formats.
    - JSON import: `global_style` added as first clip + embedded in every scene/shot clip JSON when copied.
    - Each clip copies as structured JSON: `{ shot_id, duration, motion, mood, prompt, global_style }`.
    - **Float button**: opens Document PiP sticky floating window — stays on top across all tabs.
    - `_uid = user.uid || user.id` (Auth returns `.id` not `.uid`)
16. **Grok Script Generation** (`api/generate-script.js`): Vercel API route that calls `https://api.x.ai/v1/chat/completions` with `grok-3` model. Takes `{ projectName, description, style, duration, shots, model }` and returns structured JSON script. Needs `GROK_API_KEY` in Vercel env vars. UI not yet wired.
17. **Video Generation (planned)**: Phase roadmap:
    - Phase 1: Grok generates script → clips auto-created ✅ (API route built)
    - Phase 2: Generate video per clip via Runway Gen-3 / Kling API (~$1–3/film)
    - Phase 3: Timeline editor to arrange clips in browser
    - Phase 4: Add voiceover (ElevenLabs/MiniMax) + music
    - Phase 5: FFmpeg server-side stitching → export MP4
18. **Firebase Storage (planned)**: Upgrade Firebase to Blaze plan (pay-as-you-go) for video storage. Free tier: 5GB storage + 1GB/day downloads. Cost after free: $0.026/GB/month. Needed for Phase 2+ video generation. Add credit card to Firebase Console → Usage and billing → Blaze.
19. **Hosting strategy**: Stay on Vercel free (better bandwidth: 100GB/month vs Firebase's 360MB/day). Firebase for DB + Auth + Storage only.
20. **Service Worker**: Removed — was caching old JS. Auto-unregisters any existing SW on load.
21. **Meditation Timer** (`js/meditation.js`): 4-4-6-2 breathing cycle (inhale/hold/exhale/hold) with animated ring. Duration presets: 5/10/15/20/30 min. Ambient sounds: None/Rain/Singing Bowl/Om (selector exists, audio not yet wired). Logs to Firebase via `Auth.logSession('meditation', mins)` on complete.
22. **WeekPlanner enhancements**: Each task shows estimated time badge (e.g. `60m`) next to title. Daily total shown at bottom of each day column. Edit button (✏) opens task edit form via `switchTimerType('tasks')` + `TaskManager.showEditForm(id)`. Tasks draggable between day columns.
23. **Subtask enhancements**: Each subtask has a minutes input — sums to main task `estimated_minutes`. Double-click subtask title to edit inline (saves on Enter/blur, Escape cancels). Title text is selectable.
24. **Landing page**: No fake stats or testimonials. Features: Timer, Tasks, HIIT, Meditation, Binaural Beats, Weekly Planner, Floating Widget. Supabase fully removed — all references updated to Firebase.
25. **Blog**: `blog.html` / `blog-admin.html` exist. Firestore `blog_posts` collection. Admin-only at `arpietmalpani@gmail.com`. Not yet actively used.
