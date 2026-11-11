/* ── Hero Mode — gamification engine (XP, levels, streaks, ledger) ──────────
   SuperBetter-style layer on top of existing focus/task/goal events. Pure
   data/Firestore module — js/hero-ui.js owns all rendering. (Files are named
   hero*.js, not game*.js — some corporate firewalls block asset URLs
   containing "game"; see GAME_LAYER_NOTES.md.)
   Firestore (compat SDK, matches firebase-client.js): users/{uid}/game/profile,
   xpLedger/{eventId}, gameDays/{dayKey}, powerups/{id}, badGuys/{id},
   battles/{id}, rewards/{id}, redemptions/{id}. See GAME_LAYER_NOTES.md for
   every place this deviates from the original spec. ── */
const GameLayer = (() => {

  // ── XP rules (single place to tune numbers) ──────────────────────────────
  const XP_RULES = {
    focusMinute: 1,
    focusMinuteDailyCap: 480,
    focusSessionBonus: 10,
    focusSessionMinMinutes: 20,
    taskSize: { small: 10, medium: 25, large: 50 },
    challengeMultiplier: 1.5,
    powerup: 5,
    powerupDailyMax: 8,
    badguy: 15,
    badguyDailyMax: 3,
    superbetterDay: 50,
    // Keyed by Goal Cascade level (CLAUDE.md #27: 1 Someday…7 Right Now).
    // Levels 1 (Someday) and 7 (Right Now) have no completion bonus in v1 —
    // see GAME_LAYER_NOTES.md.
    goal: { 6: 20, 5: 75, 4: 250, 3: 1000, 2: 3000 },
    epicWinLevels: [2, 3, 4],
    streakMilestone: { 7: 100, 30: 500, 100: 2000 },
    freezeCap: 2,
    // Boss HP — quests/power-ups passively chip away at whichever bad guy is
    // pinned "active"; the explicit Battled it button hits harder and always
    // targets the bad guy clicked, active or not. See GAME_LAYER_NOTES.md.
    badguyDefaultHp: 100,
    badguyDefeatBonusXp: 100,
    bossDamage: { powerup: 5, quest: 10, battle: 20 },
  };

  const TITLES = [
    { min: 1,  max: 4,        title: 'Apprentice' },
    { min: 5,  max: 9,        title: 'Focused' },
    { min: 10, max: 14,       title: 'Builder' },
    { min: 15, max: 19,       title: 'Craftsman' },
    { min: 20, max: 29,       title: 'Master' },
    { min: 30, max: Infinity, title: 'Legend' },
  ];

  let _cache = { profile: null };
  let _listeners = [];

  function nowIso() { return new Date().toISOString(); }

  function _uid() {
    return (typeof Auth !== 'undefined' && Auth.getUser()) ? Auth.getUser().id : null;
  }

  function _col(name) {
    const uid = _uid();
    if (!uid) return null;
    return _db.collection('users').doc(uid).collection(name);
  }

  function onChange(fn) { _listeners.push(fn); }
  function _notify(evt, data) { _listeners.forEach(fn => { try { fn(evt, data); } catch (_) {} }); }

  // ── Levels (pure functions — self-checked below, no test runner in this repo) ──
  function xpForLevel(L) { return 100 * (L - 1) + 25 * (L - 1) * (L - 2); }

  function levelFromXp(xp) {
    xp = Math.max(0, xp || 0);
    let L = 1;
    while (xpForLevel(L + 1) <= xp) L++;
    return L;
  }

  function xpForNextLevel(xp) {
    const level = levelFromXp(xp);
    return {
      level,
      currentLevelXp: xp - xpForLevel(level),
      neededXp: xpForLevel(level + 1) - xpForLevel(level),
      nextThreshold: xpForLevel(level + 1),
    };
  }

  function titleForLevel(L) {
    const t = TITLES.find(t => L >= t.min && L <= t.max);
    return t ? t.title : 'Legend';
  }

  (function _selfCheckLevels() {
    const checks = [[0, 1], [99, 1], [100, 2], [249, 2], [250, 3]];
    for (const [xp, expected] of checks) {
      const got = levelFromXp(xp);
      if (got !== expected) console.error(`[GameLayer] levelFromXp(${xp}) = ${got}, expected ${expected}`);
    }
  })();

  // ── Day boundary (local calendar day — see GAME_LAYER_NOTES.md re: rest of
  //    the app using UTC todayStr() instead) ───────────────────────────────
  function dayKey(d) {
    d = d || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function _addDays(dk, n) {
    const [y, m, d] = dk.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return dayKey(dt);
  }

  // A power-up with no recurring_days (or an empty array) is scheduled every
  // day — same "unset = always" convention as tasks' recurring_days.
  function isScheduledToday(recurringDays, d) {
    if (!recurringDays || !recurringDays.length) return true;
    return recurringDays.includes((d || new Date()).getDay());
  }

  // ── Defaults ──────────────────────────────────────────────────────────────
  function _defaultProfile() {
    return {
      enabled: true, heroName: 'Hero', inspiredBy: '', strength: '', onboarded: false,
      totalXp: 0, coins: 0, currentStreak: 0, longestStreak: 0, freezes: 0,
      lastEvaluatedDayKey: null, currentChallengeGoalId: null, activeBadGuyId: null,
      lifetimeFocusMinutes: 0,
      createdAt: nowIso(), updatedAt: nowIso(),
    };
  }

  // Hour-milestone card tier — escalates by order of magnitude and caps at
  // 1,000 (which then just recurs every further 1,000 hours rather than
  // growing a 5th+ tier). See GAME_LAYER_NOTES.md.
  function tierForHour(hour) {
    if (hour % 1000 === 0) return 4;
    if (hour % 100 === 0) return 3;
    if (hour % 10 === 0) return 2;
    return 1;
  }

  function _defaultDay() {
    return { focusMinutesXp: 0, powerupsDone: [], battles: 0, quests: 0, superbetterDay: false, frozen: false, xpTotal: 0 };
  }

  // ── Profile ───────────────────────────────────────────────────────────────
  // `onboarded` (and the rest of the Secret Identity) lives here in Firestore,
  // not localStorage — so the hero-mode wizard only ever shows once per
  // *account*, not once per browser/device. See GAME_LAYER_NOTES.md.
  async function getProfile(forceRefresh) {
    const uid = _uid();
    if (!uid) return null;
    if (_cache.profile && !forceRefresh) return _cache.profile;
    try {
      const ref = _col('game').doc('profile');
      const snap = await ref.get();
      if (snap.exists) {
        const data = snap.data();
        if (data.onboarded === undefined) {
          // Profile predates the `onboarded` field — it already existed, so
          // treat it as already onboarded rather than re-showing the wizard.
          data.onboarded = true;
          ref.set({ onboarded: true }, { merge: true }).catch(() => {});
        }
        _cache.profile = data;
      } else {
        _cache.profile = _defaultProfile();
        await ref.set(_cache.profile);
      }
    } catch (_) { /* keep whatever is cached, even if null */ }
    return _cache.profile;
  }

  async function markOnboarded() {
    const uid = _uid();
    if (!uid) return;
    const profile = await getProfile();
    _cache.profile = { ...(profile || _defaultProfile()), onboarded: true };
    await _col('game').doc('profile').set({ onboarded: true, updatedAt: nowIso() }, { merge: true });
  }

  async function init() {
    const uid = _uid();
    if (!uid) return null;
    await getProfile();
    await evaluateDay();
    _notify('ready', _cache.profile);
    return _cache.profile;
  }

  async function setEnabled(enabled) {
    const uid = _uid();
    if (!uid) return;
    const profile = await getProfile();
    _cache.profile = { ...(profile || _defaultProfile()), enabled };
    await _col('game').doc('profile').set({ enabled, updatedAt: nowIso() }, { merge: true });
    _notify('enabledChanged', _cache.profile);
  }

  async function setIdentity({ heroName, inspiredBy, strength }) {
    const uid = _uid();
    if (!uid) return null;
    const patch = {
      heroName: (heroName || 'Hero').toString().slice(0, 30),
      inspiredBy: (inspiredBy || '').toString().slice(0, 60),
      strength: (strength || '').toString().slice(0, 60),
      updatedAt: nowIso(),
    };
    const profile = await getProfile();
    _cache.profile = { ...(profile || _defaultProfile()), ...patch };
    await _col('game').doc('profile').set(patch, { merge: true });
    _notify('identityChanged', _cache.profile);
    return _cache.profile;
  }

  async function pinChallenge(goalId) {
    const uid = _uid();
    if (!uid) return;
    const profile = await getProfile();
    _cache.profile = { ...(profile || _defaultProfile()), currentChallengeGoalId: goalId || null };
    await _col('game').doc('profile').set({ currentChallengeGoalId: goalId || null, updatedAt: nowIso() }, { merge: true });
    _notify('challengeChanged', goalId || null);
  }

  // The "active" bad guy is whichever one passive task/session/power-up XP
  // chips away at (the explicit Battled it button always targets whichever
  // bad guy you clicked, active or not).
  async function pinActiveBadGuy(badGuyId) {
    const uid = _uid();
    if (!uid) return;
    const profile = await getProfile();
    _cache.profile = { ...(profile || _defaultProfile()), activeBadGuyId: badGuyId || null };
    await _col('game').doc('profile').set({ activeBadGuyId: badGuyId || null, updatedAt: nowIso() }, { merge: true });
    _notify('activeBadGuyChanged', badGuyId || null);
  }

  // Simplification vs. spec: "linked to a goal under that challenge" is
  // resolved as "shares the same cascade_id as the pinned challenge" rather
  // than walking parent_id to confirm strict depth — see GAME_LAYER_NOTES.md.
  async function isTaskChallengeLinked(linkedGoalId) {
    if (!linkedGoalId) return false;
    const uid = _uid();
    if (!uid) return false;
    const profile = await getProfile();
    const challengeId = profile && profile.currentChallengeGoalId;
    if (!challengeId) return false;
    if (linkedGoalId === challengeId) return true;
    try {
      const goalsRef = _db.collection('users').doc(uid).collection('goals');
      const [challengeSnap, linkedSnap] = await Promise.all([
        goalsRef.doc(challengeId).get(),
        goalsRef.doc(linkedGoalId).get(),
      ]);
      if (!challengeSnap.exists || !linkedSnap.exists) return false;
      const cCascade = challengeSnap.data().cascade_id || challengeId;
      const lCascade = linkedSnap.data().cascade_id;
      return !!lCascade && lCascade === cCascade;
    } catch (_) { return false; }
  }

  // ── Ledger event IDs (deterministic → idempotent awards/revokes) ─────────
  function _eventId(type, payload) {
    switch (type) {
      case 'task':             return `task_${payload.sourceId}`;
      case 'focus_session':    return `session_${payload.sourceId}`;
      case 'powerup':          return `powerup_${payload.sourceId}_${payload.dayKey || dayKey()}`;
      case 'badguy':           return `battle_${payload.sourceId}`;
      case 'superbetter_day':  return `sbday_${payload.dayKey || dayKey()}`;
      case 'goal':              return `goal_${payload.sourceId}`;
      case 'streak_milestone': return `streak_${payload.n}_${payload.dayKey || dayKey()}`;
      case 'boss_defeat':      return `defeat_${payload.sourceId}`;
      default: return null;
    }
  }

  // Computes XP + the exact gameDay delta for one event. The delta is stored
  // on the ledger doc itself so revoke() can reverse it precisely without
  // having to re-derive (e.g. split focus-minute XP back out from bonus XP).
  function _computeAward(type, payload, day) {
    const R = XP_RULES;
    const delta = {};
    let xp = 0;
    let meta = {};

    if (type === 'focus_session') {
      const minutes = Math.max(0, Math.floor(payload.minutes || 0));
      const remaining = Math.max(0, R.focusMinuteDailyCap - (day.focusMinutesXp || 0));
      const minutesXp = Math.min(minutes, remaining);
      const bonus = minutes >= R.focusSessionMinMinutes ? R.focusSessionBonus : 0;
      xp = minutesXp + bonus;
      if (minutesXp) delta.focusMinutesXp = minutesXp;
      if (bonus) { delta.quests = 1; meta.quest = true; }
    } else if (type === 'task') {
      const size = (payload.task && payload.task.size) || 'small';
      const base = R.taskSize[size] || R.taskSize.small;
      xp = payload.challengeLinked ? Math.round(base * R.challengeMultiplier) : base;
      delta.quests = 1;
      meta.quest = true;
    } else if (type === 'powerup') {
      if ((day.powerupsDone || []).length >= R.powerupDailyMax) return { xp: 0, coins: 0, delta: {}, meta: { capped: true } };
      xp = R.powerup;
      delta.powerupsDone = [payload.sourceId];
    } else if (type === 'badguy') {
      if ((day.battles || 0) >= R.badguyDailyMax) return { xp: 0, coins: 0, delta: {}, meta: { capped: true } };
      xp = R.badguy;
      delta.battles = 1;
    } else if (type === 'goal') {
      xp = R.goal[payload.level] || 0;
      if (xp <= 0) return { xp: 0, coins: 0, delta: {}, meta: { skip: true } };
      meta.epicWin = R.epicWinLevels.includes(payload.level);
    } else if (type === 'superbetter_day') {
      xp = R.superbetterDay;
      delta.superbetterDay = true;
    } else if (type === 'streak_milestone') {
      xp = R.streakMilestone[payload.n] || 0;
      if (xp <= 0) return { xp: 0, coins: 0, delta: {}, meta: { skip: true } };
    } else if (type === 'boss_defeat') {
      xp = R.badguyDefeatBonusXp;
    }

    if (xp) delta.xp = xp;
    return { xp, coins: xp, delta, meta }; // coins earned 1:1 with XP, per spec
  }

  function _applyDayDelta(day, delta) {
    const d = { ...day };
    if (delta.focusMinutesXp) d.focusMinutesXp = (day.focusMinutesXp || 0) + delta.focusMinutesXp;
    if (delta.quests)         d.quests = (day.quests || 0) + delta.quests;
    if (delta.battles)        d.battles = (day.battles || 0) + delta.battles;
    if (delta.powerupsDone)   d.powerupsDone = [...(day.powerupsDone || []), ...delta.powerupsDone];
    if (delta.superbetterDay) d.superbetterDay = true;
    d.xpTotal = (day.xpTotal || 0) + (delta.xp || 0);
    return d;
  }

  function _reverseDayDelta(day, delta) {
    const d = { ...day };
    if (delta.focusMinutesXp) d.focusMinutesXp = Math.max(0, (day.focusMinutesXp || 0) - delta.focusMinutesXp);
    if (delta.quests)         d.quests = Math.max(0, (day.quests || 0) - delta.quests);
    if (delta.battles)        d.battles = Math.max(0, (day.battles || 0) - delta.battles);
    if (delta.powerupsDone)   d.powerupsDone = (day.powerupsDone || []).filter(id => !delta.powerupsDone.includes(id));
    if (delta.superbetterDay) d.superbetterDay = false; // re-derived fresh next time conditions are met
    d.xpTotal = Math.max(0, (day.xpTotal || 0) - (delta.xp || 0));
    return d;
  }

  // ── Award / revoke (transactional, idempotent) ───────────────────────────
  async function award(type, payload) {
    payload = payload || {};
    const R = XP_RULES;
    const uid = _uid();
    if (!uid) return null;
    const eventId = _eventId(type, payload);
    if (!eventId) return null;
    const dk = payload.dayKey || dayKey();

    const ledgerRef  = _col('xpLedger').doc(eventId);
    const profileRef = _col('game').doc('profile');
    const dayRef      = _col('gameDays').doc(dk);

    let result = null;
    try {
      result = await _db.runTransaction(async (tx) => {
        const ledgerSnap = await tx.get(ledgerRef);
        if (ledgerSnap.exists) return null; // already awarded — no-op (double tap / refresh / offline retry safe)

        const [profileSnap, daySnap] = await Promise.all([tx.get(profileRef), tx.get(dayRef)]);
        const profile = profileSnap.exists ? profileSnap.data() : _defaultProfile();
        const day      = daySnap.exists ? daySnap.data() : _defaultDay();

        const { xp, coins, delta, meta } = _computeAward(type, payload, day);
        if (!xp && !coins) return null; // capped / zero-value event — nothing to record

        // Boss HP — battle always targets the bad guy clicked; passive
        // task/session/power-up XP chips away at whichever one is pinned
        // "active". Every read (incl. the bad guy doc) must happen before
        // any writes below, per Firestore transaction rules.
        let bossTargetId = null;
        if (type === 'badguy') bossTargetId = payload.badGuyId || null;
        else if ((type === 'task' || type === 'powerup' || (type === 'focus_session' && meta.quest)) && profile.activeBadGuyId) {
          bossTargetId = profile.activeBadGuyId;
        }
        let badGuyRef = null, badGuySnap = null;
        if (bossTargetId) {
          badGuyRef = _col('badGuys').doc(bossTargetId);
          badGuySnap = await tx.get(badGuyRef);
        }

        let boss = null;
        if (badGuySnap && badGuySnap.exists) {
          const bg = badGuySnap.data();
          const maxHp = bg.maxHp || R.badguyDefaultHp;
          const curHp = bg.currentHp != null ? bg.currentHp : maxHp;
          const damage = type === 'badguy' ? R.bossDamage.battle : (type === 'powerup' ? R.bossDamage.powerup : R.bossDamage.quest);
          const newHp = Math.max(0, curHp - damage);
          const defeated = newHp === 0 && curHp > 0;
          boss = { badGuyId: bossTargetId, name: bg.name, damage, oldHp: curHp, newHp, maxHp, defeated, defeatedCount: (bg.defeatedCount || 0) + (defeated ? 1 : 0) };
        }

        const newDay = _applyDayDelta(day, delta);
        const newProfile = {
          ...profile,
          totalXp: (profile.totalXp || 0) + xp,
          coins: Math.max(0, (profile.coins || 0) + coins),
          updatedAt: nowIso(),
        };

        // Hour-milestone cards — tracked off real session minutes (uncapped),
        // not the day-capped focusMinutesXp used for the XP economy, so a
        // heavy-use day doesn't under-count toward lifetime hours.
        let hourMilestones = [];
        if (type === 'focus_session') {
          const oldLifetimeMin = profile.lifetimeFocusMinutes || 0;
          const minutesAdded = Math.max(0, Math.floor(payload.minutes || 0));
          const newLifetimeMin = oldLifetimeMin + minutesAdded;
          const oldHour = Math.floor(oldLifetimeMin / 60);
          const newHour = Math.floor(newLifetimeMin / 60);
          for (let h = oldHour + 1; h <= newHour; h++) hourMilestones.push(h);
          newProfile.lifetimeFocusMinutes = newLifetimeMin;
        }

        tx.set(ledgerRef, {
          eventId, type, sourceId: payload.sourceId || null,
          xp, coins, dayKey: dk, dayDelta: delta, createdAt: nowIso(),
        });
        tx.set(profileRef, newProfile, { merge: true });
        tx.set(dayRef, newDay, { merge: true });
        if (boss) {
          // Defeat resets HP so the same bad guy can be fought again — see GAME_LAYER_NOTES.md.
          tx.set(badGuyRef, { currentHp: boss.defeated ? boss.maxHp : boss.newHp, defeatedCount: boss.defeatedCount }, { merge: true });
        }

        return { xp, coins, oldXp: profile.totalXp || 0, profile: newProfile, day: newDay, meta, dayKey: dk, boss, hourMilestones };
      });
    } catch (e) { console.error('[GameLayer] award failed', type, e); return null; }

    if (result) {
      _cache.profile = result.profile;
      result.oldLevel = levelFromXp(result.oldXp);
      result.newLevel = levelFromXp(result.profile.totalXp);
      _notify('award', { type, payload, result });
      if (result.boss && result.boss.defeated) {
        await award('boss_defeat', { sourceId: `${result.boss.badGuyId}_${result.boss.defeatedCount}`, badGuyId: result.boss.badGuyId, badGuyName: result.boss.name });
      }
      if (type !== 'superbetter_day') await _checkSuperBetterDay(result.dayKey);
      await evaluateDay();
    }
    return result;
  }

  async function revoke(eventId) {
    const uid = _uid();
    if (!uid || !eventId) return null;
    const ledgerRef  = _col('xpLedger').doc(eventId);
    const profileRef = _col('game').doc('profile');

    let result = null;
    try {
      result = await _db.runTransaction(async (tx) => {
        const ledgerSnap = await tx.get(ledgerRef);
        if (!ledgerSnap.exists) return null; // nothing recorded — no-op (safe to call freely)
        const ledger = ledgerSnap.data();
        const dayRef = _col('gameDays').doc(ledger.dayKey);

        const [profileSnap, daySnap] = await Promise.all([tx.get(profileRef), tx.get(dayRef)]);
        const profile = profileSnap.exists ? profileSnap.data() : _defaultProfile();
        const day      = daySnap.exists ? daySnap.data() : _defaultDay();

        const newDay = _reverseDayDelta(day, ledger.dayDelta || {});
        const newProfile = {
          ...profile,
          totalXp: Math.max(0, (profile.totalXp || 0) - (ledger.xp || 0)),
          coins: Math.max(0, (profile.coins || 0) - (ledger.coins || 0)),
          updatedAt: nowIso(),
        };

        tx.delete(ledgerRef);
        tx.set(profileRef, newProfile, { merge: true });
        tx.set(dayRef, newDay, { merge: true });

        return { profile: newProfile, day: newDay, ledger };
      });
    } catch (e) { console.error('[GameLayer] revoke failed', eventId, e); return null; }

    if (result) {
      _cache.profile = result.profile;
      _notify('revoke', { eventId, result });
    }
    return result;
  }

  async function _checkSuperBetterDay(dk) {
    try {
      const daySnap = await _col('gameDays').doc(dk).get();
      const day = daySnap.exists ? daySnap.data() : null;
      if (!day || day.superbetterDay) return;
      const powerups = (day.powerupsDone || []).length;
      if (powerups >= 3 && (day.battles || 0) >= 1 && (day.quests || 0) >= 1) {
        await award('superbetter_day', { sourceId: dk, dayKey: dk });
        _notify('superbetterDay', { dayKey: dk });
      }
    } catch (_) {}
  }

  // ── Streaks (lazy, idempotent — same convention as app.js's todayStr() checks) ──
  async function evaluateDay() {
    const uid = _uid();
    if (!uid) return null;
    const todayKey = dayKey();
    const yesterdayKey = _addDays(todayKey, -1);
    const profileRef = _col('game').doc('profile');

    let result = null;
    try {
      result = await _db.runTransaction(async (tx) => {
        const profileSnap = await tx.get(profileRef);
        const profile = profileSnap.exists ? profileSnap.data() : _defaultProfile();
        let { currentStreak = 0, longestStreak = 0, freezes = 0, lastEvaluatedDayKey } = profile;

        if (!lastEvaluatedDayKey) {
          tx.set(profileRef, { lastEvaluatedDayKey: todayKey }, { merge: true });
          return { ...profile, lastEvaluatedDayKey: todayKey, milestonesHit: [] };
        }
        if (lastEvaluatedDayKey >= yesterdayKey) return { ...profile, milestonesHit: [] }; // already caught up today

        let cursor = _addDays(lastEvaluatedDayKey, 1);
        let steps = 0;
        const MAX_STEPS = 14; // freezes (max 2) can't bridge a bigger gap anyway — see GAME_LAYER_NOTES.md
        const frozenDays = [];
        const milestonesHit = [];

        while (cursor <= yesterdayKey && steps < MAX_STEPS) {
          const daySnap = await tx.get(_col('gameDays').doc(cursor));
          const day = daySnap.exists ? daySnap.data() : null;
          if (day && day.superbetterDay) {
            currentStreak++;
          } else if (freezes > 0) {
            freezes--;
            frozenDays.push(cursor);
            currentStreak++;
          } else {
            currentStreak = 0;
          }
          if (currentStreak > 0 && currentStreak % 7 === 0) freezes = Math.min(XP_RULES.freezeCap, freezes + 1);
          if ([7, 30, 100].includes(currentStreak)) milestonesHit.push({ n: currentStreak, dayKey: cursor });
          longestStreak = Math.max(longestStreak, currentStreak);
          cursor = _addDays(cursor, 1);
          steps++;
        }
        if (steps >= MAX_STEPS && cursor <= yesterdayKey) currentStreak = 0; // large gap — already broken, stop reading

        const newProfile = { ...profile, currentStreak, longestStreak, freezes, lastEvaluatedDayKey: yesterdayKey, updatedAt: nowIso() };
        for (const fd of frozenDays) tx.set(_col('gameDays').doc(fd), { frozen: true }, { merge: true });
        tx.set(profileRef, newProfile, { merge: true });
        return { ...newProfile, milestonesHit };
      });
    } catch (e) { console.error('[GameLayer] evaluateDay failed', e); return null; }

    if (result) {
      _cache.profile = result;
      if (result.milestonesHit && result.milestonesHit.length) {
        for (const m of result.milestonesHit) {
          await award('streak_milestone', { n: m.n, sourceId: String(m.n), dayKey: m.dayKey });
        }
      }
      _notify('streakEvaluated', result);
    }
    return result;
  }

  async function getGameDay(dk) {
    const uid = _uid();
    if (!uid) return _defaultDay();
    try {
      const snap = await _col('gameDays').doc(dk || dayKey()).get();
      return snap.exists ? snap.data() : _defaultDay();
    } catch (_) { return _defaultDay(); }
  }

  // ── Rewards Shop ──────────────────────────────────────────────────────────
  async function redeemReward(rewardId) {
    const uid = _uid();
    if (!uid) return { ok: false, reason: 'not-signed-in' };
    const rewardRef = _col('rewards').doc(rewardId);
    const profileRef = _col('game').doc('profile');

    let result;
    try {
      result = await _db.runTransaction(async (tx) => {
        const [rewardSnap, profileSnap] = await Promise.all([tx.get(rewardRef), tx.get(profileRef)]);
        if (!rewardSnap.exists) return { ok: false, reason: 'not-found' };
        const reward = rewardSnap.data();
        const profile = profileSnap.exists ? profileSnap.data() : _defaultProfile();
        if ((profile.coins || 0) < reward.cost) return { ok: false, reason: 'insufficient' };

        const newCoins = profile.coins - reward.cost;
        tx.set(profileRef, { coins: newCoins, updatedAt: nowIso() }, { merge: true });
        const redemptionRef = _col('redemptions').doc();
        tx.set(redemptionRef, { rewardId, rewardName: reward.name, cost: reward.cost, createdAt: nowIso() });
        return { ok: true, coins: newCoins, redemptionId: redemptionRef.id };
      });
    } catch (e) { console.error('[GameLayer] redeemReward failed', e); return { ok: false, reason: 'error' }; }

    if (result && result.ok) {
      _cache.profile = { ..._cache.profile, coins: result.coins };
      _notify('redeemed', result);
    }
    return result;
  }

  // ── Thin CRUD for powerups / bad guys / rewards (mirrors tasks.js's
  //    _sbInsert/_sbUpdate/_sbDelete convention) ────────────────────────────
  function _crud(collectionName) {
    return {
      async list(includeArchived) {
        const col = _col(collectionName);
        if (!col) return [];
        try {
          const snap = await col.get();
          const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          return includeArchived ? rows : rows.filter(r => !r.archived);
        } catch (_) { return []; }
      },
      async create(data) {
        const col = _col(collectionName);
        if (!col) return null;
        const ref = await col.add({ ...data, archived: false, createdAt: nowIso() });
        return ref.id;
      },
      async update(id, patch) {
        const col = _col(collectionName);
        if (!col) return false;
        await col.doc(id).update(patch);
        return true;
      },
      async archive(id) {
        const col = _col(collectionName);
        if (!col) return false;
        await col.doc(id).update({ archived: true });
        return true;
      },
      async remove(id) {
        const col = _col(collectionName);
        if (!col) return false;
        await col.doc(id).delete();
        return true;
      },
    };
  }

  const Powerups = _crud('powerups');
  const BadGuys  = _crud('badGuys');
  const Rewards  = _crud('rewards');

  async function listRedemptions() {
    const col = _col('redemptions');
    if (!col) return [];
    try {
      const snap = await col.orderBy('createdAt', 'desc').limit(50).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (_) { return []; }
  }

  async function logBattle(badGuyId, note) {
    const uid = _uid();
    if (!uid) return null;
    const col = _col('battles');
    const ref = await col.add({ badGuyId, note: note || '', dayKey: dayKey(), createdAt: nowIso() });
    await award('badguy', { sourceId: ref.id, badGuyId });
    return ref.id;
  }

  async function listBattlesThisWeek() {
    return listBattles(7);
  }

  async function listBattles(days) {
    const col = _col('battles');
    if (!col) return [];
    try {
      const since = _addDays(dayKey(), -(days || 7));
      const snap = await col.where('dayKey', '>=', since).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (_) { return []; }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  async function listGameDays(days) {
    const uid = _uid();
    if (!uid) return [];
    const todayKey = dayKey();
    const keys = [];
    for (let i = (days || 7) - 1; i >= 0; i--) keys.push(_addDays(todayKey, -i));
    try {
      const docs = await Promise.all(keys.map(k => _col('gameDays').doc(k).get()));
      return keys.map((k, i) => ({ dayKey: k, ...(docs[i].exists ? docs[i].data() : _defaultDay()) }));
    } catch (_) { return keys.map(k => ({ dayKey: k, ..._defaultDay() })); }
  }

  return {
    rules: XP_RULES, titles: TITLES,
    levelFromXp, xpForNextLevel, titleForLevel, dayKey, isScheduledToday, tierForHour,
    init, getProfile, setEnabled, setIdentity, markOnboarded, pinChallenge, pinActiveBadGuy, isTaskChallengeLinked,
    award, revoke, evaluateDay, getGameDay, listGameDays,
    redeemReward, listRedemptions, logBattle, listBattlesThisWeek, listBattles,
    Powerups, BadGuys, Rewards,
    onChange,
  };
})();
