# Hero Mode — adaptation notes

The "Game Layer / Hero Mode" spec was written for a React + TypeScript codebase
(`src/game/*.ts`, hooks, components, a build step). Flow Timer is a vanilla-JS,
no-build static site on the Firebase **compat** SDK. This note records every
place the implementation deviates from the literal spec, and why.

## Stack adaptation

- `src/game/*.ts` → two plain `<script>`-loaded files: `js/game.js` (engine —
  rules, levels, dayKey, ledger transactions, streak eval, CRUD for powerups/
  bad guys/rewards) and `js/game-ui.js` (all rendering — HUD, toasts, modals,
  quest board, panels, wizard). No hooks/components; DOM is built with
  template strings and `innerHTML`, the same pattern `js/certificate.js` uses.
  Containers are pre-declared in `index.html` with `display:none` and
  populated at render time (never created/destroyed dynamically for the
  top-level shells).
- Firestore is the **compat** namespaced API (`_db.collection(...).doc(...)`),
  not modular v9. `award()`/`revoke()`/`evaluateDay()`/`redeemReward()` use
  `_db.runTransaction()` — the one existing precedent for this was
  `Auth.claimTimerCompletion` (`js/auth.js`). There is no `FieldValue.increment()`
  or `writeBatch()` precedent anywhere in this codebase; transactions read the
  current value and write the new one directly instead of using `increment()`.

## Data model deviations from spec §5

- **xpLedger is *not* capped.** The spec's certificates/scan_history precedent
  (`Auth.createCertificate`/`createScanHistory`, fetch-all → slice(N) → delete)
  is a capped *recent-history gallery*. The XP ledger is different: each doc
  is the permanent idempotency record for one award. Deleting old ledger docs
  would let a task/session/goal re-award itself the next time it's toggled.
  So the ledger is left uncapped (small docs, bounded growth, fine for a
  single-user app). Revisit only if this needs GDPR-style export/cleanup.
- Each ledger doc additionally stores a `dayDelta` object (not in the spec's
  schema) — the exact `gameDays` patch that award applied (e.g.
  `{ focusMinutesXp: 15, quests: 1 }`). `revoke()` reverses precisely from
  this instead of re-deriving it (which would be impossible to do exactly for
  a focus session, where the minutes-XP and the ≥20-min bonus need to be
  un-applied separately from one ledger entry).
- `users/{uid}/tasks/{id}` gained two fields that didn't exist: `size`
  (`'small'|'medium'|'large'`, defaults to `'small'`) and `linked_goal_id`
  (nullable). Tasks previously only had `priority` (1–5 dots) +
  `estimated_minutes`.
- Goal completion didn't exist at all. `completed`/`completed_at` were written
  once at creation (`Auth.createGoal`) and never read or toggled anywhere.
  Added a complete/reopen button to each filled Goal Cascade row
  (`js/goals.js`) that flips the field and drives goal XP / Epic Win.
- No task↔goal link existed (there's a pre-existing comment to this effect in
  `js/certificate.js`). Added `linked_goal_id` (above) plus a "🎯 Link to
  goal" dropdown in the task form, shown only when a Current Challenge is
  pinned.

## Current Challenge multiplier — simplified linking rule

Spec: "Tasks linked to goals **under** that challenge get the ×1.5
multiplier." Strictly implementing "under" would mean walking `parent_id`
chains to confirm the linked goal is a depth-wise descendant of the pinned
Monthly/One-Year goal. Instead, `GameLayer.isTaskChallengeLinked()` checks
that the linked goal shares the same `cascade_id` as the pinned challenge
(i.e. same overall Someday→Right Now cascade). This is looser than "strict
descendant" but the challenge is always level 3 or 4 of a 7-level cascade, so
in practice almost everything else in that same cascade *is* a descendant.
Simpler to implement and reason about; flagged here in case the leniency
(e.g. linking a *sibling* Monthly goal from the same cascade) ever matters.

## Day boundaries use local time, not the rest of the app's UTC convention

The rest of the app computes "today" via `todayStr()` (`app.js`,
`new Date().toISOString().slice(0,10)` — UTC) and ignores the user's saved
timezone preference (`flow-timezone`) entirely; `Auth.getStreak()` does the
same. The spec wants local-calendar-day boundaries for the game layer.
Rather than touch the existing UTC-based session-streak/heatmap logic (risk
of silently shifting existing streak counts for every user), `GameLayer.dayKey()`
is a fresh helper using the **browser's local** `getFullYear/getMonth/getDate`,
scoped only to the game layer. The two day-boundary conventions now coexist
in this codebase; this is intentional, not an oversight.

## No scheduled daily reset anywhere in this app

Confirmed by searching the whole codebase — there's no midnight timer, no
service worker tick, no cron. All "today" logic in the existing app is lazy,
evaluated at read/render time (`loadFromStorage()` comparing `sessionDate` to
`todayStr()`). `GameLayer.evaluateDay()` follows the same convention: it runs
once at app boot (`GameLayer.init()`) and again after every `award()`,
comparing `profile.lastEvaluatedDayKey` to today's `dayKey()`. It's
idempotent — a no-op if already caught up — and backfills at most 14 days of
gap per call (freezes cap at 2, so a real streak can never survive a gap
bigger than that; capping the backfill loop avoids reading dozens of
`gameDays` docs for a long-absent user without changing the outcome).

## No onboarding/wizard pattern existed anywhere in the app

Repo-wide search for `wizard`/`onboard`/`first-time`/etc. turned up nothing.
The Hero Mode wizard (`#hero-wizard-modal`) is the first multi-step modal in
this codebase, built on the `.cert-modal` backdrop+dialog shell. Because
there was no existing "new user onboarding" flow to append steps to either,
the spec's "existing users see a dismissible card → wizard" and "new users
get the same 3 steps appended to onboarding" paths collapse into one: the
same wizard modal, shown once (gated by a `flow-hero-wizard-seen` localStorage
flag, same convention as `flow-pwa-dismissed`) regardless of account age.
Step 2 (power-up picking) only lets the user toggle the 6 seeded defaults —
"or add your own" from the spec is reachable afterward via the 🎮 Hero Mode
panel's Power-ups tab, not inline in the wizard, to keep the wizard short.

## No shared toast/modal/chart utility existed

Three independent toast implementations already exist in this codebase
(`certificate.js`, `tasks.js`, and `voice-assistant.js` delegating to
`tasks.js`'s). Rather than add a 4th divergent copy, `js/game-ui.js` has its
own tiny `_toastEl()`/`_showXpToast()`/`_showPlainToast()` using a single
cached node — same pattern as `certificate.js`'s `_toast()` — scoped to Hero
Mode UI only. This is not a refactor of the existing three; they're untouched.
No chart library exists or was added for the Stats tab — the 7-day XP bars
are hand-rolled divs sized by inline `height:%`, matching how
`renderActivityHeatmap()` (`app.js`) already hand-rolls its own heatmap.

## HUD placement

`switchTimerType()` (inline `<script>` in `index.html`) hides/shows 8 tab
section containers. Anything placed **outside** those containers — like the
existing voice-assistant mic button (`position:fixed`, sibling of `<main>`)
— stays visible on every tab automatically, with zero tab-switch wiring. The
HUD bar (`#hero-hud`) is a static (non-fixed) block placed between
`</header>` and `<main>`, width-matched to the app's centered 480px column.
Quest Board / power-up chips / Current Challenge banner are tied specifically
to the Work Timer tab (`#flow-section`), per the spec's "below the timer" /
break-time-prompt framing — they are not duplicated into the other 7 tabs.
The Power-ups/Bad Guys/Shop/Stats/Identity management UI lives behind a new
🎮 header icon opening a tabbed modal, rather than a 9th main tab — the
existing tab bar is already 8 buttons across 2 rows and adding a 9th risked
overflow at the spec's own 360px mobile-width requirement.

## XP scope for v1

Only full work-session completions through `_processTimerEnd()`'s work
branch (`app.js`) earn focus-minute/session XP — the exact point where
`Auth.logSession('work', …)` and `Certificate.onSessionComplete(…)` already
hook in. The separate `pagehide` partial-credit path (`{partial:true}`,
fired when a tab is closed mid-session) is deliberately **not** wired to
GameLayer, matching the spec's "paused or abandoned time doesn't count."
Workout and Meditation sessions do not earn XP in v1 — the spec only ever
speaks of "focus minutes."

`Auth.logSession()` was changed to `return ref.id` (previously returned
`undefined`) so the focus-session award can build its deterministic
`session_{id}` ledger key. This is additive — no existing caller used the
return value.

## No `firestore.rules` file exists in this repo for *any* collection

Security rules for `game/profile`, `xpLedger`, `gameDays`, `powerups`,
`badGuys`, `battles`, `rewards`, and `redemptions` need to be added directly
in the Firebase Console, under the same per-user ownership rule already used
for every other `users/{uid}/**` subcollection:

```
match /users/{uid}/{collection}/{docId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

Since this is a free, single-player feature with no leaderboards, the spec's
"client-side transactions are acceptable for v1" note applies as-is —
leaderboards or any future cross-user visibility would need the awards moved
to a Cloud Function instead.

## v1.1 addition — scheduled power-ups + Boss HP

Added after the initial v1 build, per user request: power-ups follow a
"regular habit calendar," and points can be allocated toward "facing the
demon."

- **Power-up scheduling**: `users/{uid}/powerups/{id}` gained `recurring_days`
  (same `0=Sun…6=Sat` convention as tasks' `recurring_days`; unset/empty =
  every day, matching the "unset = always" convention used elsewhere).
  `GameLayer.isScheduledToday()` filters the Work Timer tab's chip row so
  only today's scheduled power-ups show; the Hero Panel always lists all of
  them (with a 📅 editor) regardless of today's schedule.
- **Streak strip**: each power-up row in the Hero Panel shows a 14-day dot
  strip (filled = done, hollow = scheduled-but-missed, faint = not
  scheduled that day), built from `GameLayer.listGameDays(14)` — no new
  Firestore reads beyond what Stats already does, no chart library.
- **Boss HP pool**: `users/{uid}/badGuys/{id}` gained `maxHp` (default 100),
  `currentHp`, and `defeatedCount`. One bad guy can be pinned "active"
  (`profile.activeBadGuyId`, mirrors `currentChallengeGoalId`'s pattern).
  Every completed task and qualifying focus session (the ones that count as
  a Quest) and every power-up deals damage to the **active** bad guy;
  the explicit "Battled it" button always damages whichever bad guy was
  clicked, active or not, and hits harder. Damage amounts live in
  `XP_RULES.bossDamage` (`{ powerup: 5, quest: 10, battle: 20 }`).
  Reaching 0 HP awards a one-time `badguyDefeatBonusXp` (100, its own
  idempotent ledger entry `defeat_{badGuyId}_{defeatedCount}`), then resets
  `currentHp` to `maxHp` so the same bad guy can be fought again rather than
  being removed — "retire" was the spec's other option but adds a
  delete-vs-keep-history decision that didn't seem worth it for v1.
- **Deliberately not reversible**: unlike XP/coins (which `revoke()` always
  reverses exactly), boss HP damage is **not** restored when a task/session/
  power-up is un-completed. Making it reversible would mean storing and
  reversing a third mutation (on a `badGuys/{id}` doc neither the ledger nor
  `gameDays` owns) inside the same transaction, and the HP pool is a cosmetic
  flourish, not part of the core XP/coins economy the acceptance criteria
  care about. Net effect: undo a completion and the XP/coins/quest counters
  are exactly right, but a demon that took damage from it stays damaged.
- **Daily battle cap still gates boss damage from the Battled it button**:
  once `badguyDailyMax` (3) manual battles are logged for the day, further
  battles earn no XP *and* deal no further boss damage that day (passive
  quest/power-up damage to the active bad guy is unaffected — it has its own
  separate day counters). Kept this coupling rather than decoupling
  HP-dealing from XP-earning to avoid a second, parallel cap system.

## Known v1 limitations (acceptable, not bugs)

- Streak-freeze "frozen" flag is shown on the Stats tab's day bars (❄️), not
  in the compact HUD — the spec only requires it be visible "on that day,"
  and the HUD has no per-day granularity to show it in.
- Someday (level 1) and Right Now (level 7) goal completions award no XP —
  the spec's goal-XP table only lists Daily/Weekly/Monthly/One-Year/Five-Year.
  Right Now items are meant to be sent to Tasks anyway (existing feature);
  Someday goals realistically are never "completed."
