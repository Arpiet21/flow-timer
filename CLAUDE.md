# Flow Timer — Project State

1. **Stack**: Vanilla JS + HTML/CSS, hosted on Vercel free, Supabase (PostgreSQL) for storage, auth via `auth.js`.
2. **Task Manager**: Full CRUD — add/delete/complete tasks with categories, priorities, estimated time, scheduled dates, recurring days. All writes use direct REST fetch (not Supabase JS client) to avoid hangs.
3. **Storage**: Supabase-only (no localStorage for tasks). Client generates UUID on add — same UUID sent to Supabase so delete/update always match. localStorage used only as a read cache (`flow-tasks-cache`).
4. **Sync**: Optimistic UI (instant updates), Supabase syncs in background via `_sbInsert/_sbUpdate/_sbDelete` helpers. `_load()` and `_refreshFromCloud()` use direct `fetch()` with `AbortController` timeout.
5. **Auth token**: Read directly from localStorage (`sb-*-auth-token` key) — never calls `_sb.auth.getSession()` which was causing hangs.
6. **Task UI**: Tasks grouped by Today / Tomorrow / Day-after / Upcoming. Recurring tasks respect `scheduled_date` as start date. `🔄 Refresh from Cloud` button at bottom of list.
7. **Weekly Planner + Calendar**: WeekPlanner renders tasks per day; TaskCalendar shows monthly activity. Both re-render on task add/delete/complete via `WeekPlanner._render()`.
8. **Service Worker**: Removed — was caching old JS and blocking all updates. `registerServiceWorker()` now unregisters any existing SW on load.
9. **Supabase keep-alive**: cron-job.org pings Supabase every 5 minutes to prevent free-tier cold starts.
10. **Landing page**: Updated with Task Manager, Weekly Planner, Brain Dump, Cloud Sync features + visual mockup. Blog exists (`blog.html/blog-admin.html`) but not yet wired to Supabase.
