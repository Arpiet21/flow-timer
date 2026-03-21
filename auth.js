// ─── Auth (Firebase-backed) ────────────────────────────────────────────────────

const DEVICE_LIMIT = 2;

const Auth = {
  _user: null,

  getUser()    { return this._user; },
  isLoggedIn() { return !!this._user; },

  // ── Device helpers ───────────────────────────────────────────────────────
  _getDeviceId() {
    let id = localStorage.getItem('flow-device-id');
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
      localStorage.setItem('flow-device-id', id);
    }
    return id;
  },

  _getDeviceName() {
    const ua = navigator.userAgent;
    const browser = ua.includes('Edg/')    ? 'Edge'
      : ua.includes('Chrome')  ? 'Chrome'
      : ua.includes('Firefox') ? 'Firefox'
      : ua.includes('Safari')  ? 'Safari'  : 'Browser';
    const os = ua.includes('Windows') ? 'Windows'
      : ua.includes('iPhone')  ? 'iPhone'
      : ua.includes('Android') ? 'Android'
      : ua.includes('Mac')     ? 'Mac'
      : ua.includes('Linux')   ? 'Linux'   : 'Device';
    return `${browser} on ${os}`;
  },

  // ── Device limit ─────────────────────────────────────────────────────────
  async _checkAndRegisterDevice(userId, email) {
    if (email === 'arpietmalpani@gmail.com') return { allowed: true };

    const deviceId   = this._getDeviceId();
    const deviceName = this._getDeviceName();
    const devicesRef = _db.collection('users').doc(userId).collection('devices');

    const snap = await devicesRef.get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const existing = list.find(d => d.device_id === deviceId);

    if (existing) {
      await devicesRef.doc(existing.id).update({ last_seen: new Date().toISOString(), device_name: deviceName });
      return { allowed: true };
    }

    if (list.length >= DEVICE_LIMIT) {
      await _auth.signOut();
      this._user = null;
      return {
        allowed: false,
        devices: list,
        message: `This account is already signed in on ${list.length} device${list.length > 1 ? 's' : ''}. Sign out from one of those devices first.`
      };
    }

    await devicesRef.add({ device_id: deviceId, device_name: deviceName, last_seen: new Date().toISOString() });
    return { allowed: true };
  },

  async _unregisterDevice(userId) {
    const deviceId   = this._getDeviceId();
    const devicesRef = _db.collection('users').doc(userId).collection('devices');
    const snap = await devicesRef.where('device_id', '==', deviceId).get();
    snap.forEach(doc => doc.ref.delete());
  },

  // ── Load session on page start ───────────────────────────────────────────
  async init() {
    await new Promise(resolve => {
      const unsub = _auth.onAuthStateChanged(async user => {
        unsub();
        try {
          if (user) {
            const deviceCheck = await this._checkAndRegisterDevice(user.uid, user.email);
            if (!deviceCheck.allowed) {
              window.location.href = 'login.html?device_limit=1';
              resolve(null); return;
            }
            const planData = await this._getOrCreatePlan(user.uid);
            this._user = this._normalize(user, planData);
            this._loadTimezone(user.uid);
          }
        } catch (err) {
          console.error('[Auth.init] error loading plan:', err);
          // Still set user even if plan fetch fails — fall back to free
          if (user) this._user = this._normalize(user, null);
        }
        resolve(this._user);
      });
    });

    _auth.onAuthStateChanged(async user => {
      try {
        if (user) {
          const planData = await this._getOrCreatePlan(user.uid);
          this._user = this._normalize(user, planData);
          this._loadTimezone(user.uid);
        } else {
          this._user = null;
        }
      } catch (err) {
        console.error('[Auth] onAuthStateChanged error:', err);
      }
    });

    return this._user;
  },

  // ── Sign up ──────────────────────────────────────────────────────────────
  async signUp(name, email, password) {
    try {
      const { user } = await _auth.createUserWithEmailAndPassword(email, password);
      await user.updateProfile({ displayName: name });

      await _db.collection('users').doc(user.uid).collection('devices').add({
        device_id:   this._getDeviceId(),
        device_name: this._getDeviceName(),
        last_seen:   new Date().toISOString()
      });

      const planData = await this._getOrCreatePlan(user.uid);
      this._user = this._normalize(user, planData);
      return { ok: true, user: this._user };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // ── Sign in ──────────────────────────────────────────────────────────────
  async signIn(email, password) {
    try {
      const { user } = await _auth.signInWithEmailAndPassword(email, password);
      const deviceCheck = await this._checkAndRegisterDevice(user.uid, user.email);
      if (!deviceCheck.allowed) {
        return { ok: false, error: deviceCheck.message, deviceLimit: true, devices: deviceCheck.devices };
      }
      const planData = await this._getOrCreatePlan(user.uid);
      this._user = this._normalize(user, planData);
      return { ok: true, user: this._user };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // ── Sign in with Google (popup — no redirect needed) ─────────────────────
  async signInWithGoogle() {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('email');
      const { user } = await _auth.signInWithPopup(provider);
      const deviceCheck = await this._checkAndRegisterDevice(user.uid, user.email);
      if (!deviceCheck.allowed) {
        return { ok: false, error: deviceCheck.message, deviceLimit: true };
      }
      const planData = await this._getOrCreatePlan(user.uid);
      this._user = this._normalize(user, planData);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // ── Sign out ─────────────────────────────────────────────────────────────
  async signOut() {
    try { if (this._user) await this._unregisterDevice(this._user.id); } catch (_) {}
    try { await _auth.signOut(); } catch (_) {}
    this._user = null;
    window.location.href = 'landing.html';
  },

  // ── Auth guard ───────────────────────────────────────────────────────────
  async requireAuth() {
    await this.init();
    if (!this._user) { window.location.href = 'login.html'; return false; }
    return true;
  },

  // ── Session history ──────────────────────────────────────────────────────
  async logSession(mode, durationMinutes, task = '') {
    if (!this._user) return;
    await _db.collection('users').doc(this._user.id).collection('sessions').add({
      mode,
      duration_minutes: durationMinutes,
      task: task || '',
      completed_at: new Date().toISOString()
    });
  },

  async getSessions() {
    if (!this._user) return [];
    try {
      const snap = await _db.collection('users').doc(this._user.id).collection('sessions')
        .orderBy('completed_at', 'desc').limit(50).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (_) { return []; }
  },

  // ── Focus streak ─────────────────────────────────────────────────────────
  async getStreak(mode = 'work') {
    if (!this._user) return 0;
    try {
      const snap = await _db.collection('users').doc(this._user.id).collection('sessions')
        .where('mode', '==', mode).orderBy('completed_at', 'desc').get();
      if (snap.empty) return 0;

      const days = new Set(snap.docs.map(d => d.data().completed_at.slice(0, 10)));
      const cur = new Date(); cur.setHours(0, 0, 0, 0);
      const todayStr = cur.toISOString().slice(0, 10);
      if (!days.has(todayStr)) cur.setDate(cur.getDate() - 1);

      let streak = 0;
      while (days.has(cur.toISOString().slice(0, 10))) {
        streak++;
        cur.setDate(cur.getDate() - 1);
      }
      return streak;
    } catch (_) { return 0; }
  },

  // ── Referral ──────────────────────────────────────────────────────────────
  getReferralCode() {
    if (!this._user) return null;
    return this._user.id.replace(/-/g, '').slice(0, 6).toUpperCase();
  },

  getReferralLink() {
    if (!this._user) return null;
    const base = location.protocol === 'file:' ? 'http://localhost:3000' : location.origin;
    return `${base}/signup.html?ref=${this.getReferralCode()}`;
  },

  async applyReferral(code) {
    if (!this._user || !code) return;
    await _db.collection('referrals').doc(this._user.id).set({
      referee_id:    this._user.id,
      referral_code: code.toUpperCase(),
      created_at:    new Date().toISOString()
    });

    const planRef  = _db.collection('users').doc(this._user.id).collection('plan').doc('current');
    const planSnap = await planRef.get();
    if (planSnap.exists) {
      const plan = planSnap.data();
      const base = plan.valid_until ? new Date(plan.valid_until) : new Date();
      if (base < new Date()) base.setTime(Date.now());
      base.setDate(base.getDate() + 15);
      await planRef.update({
        valid_until: base.toISOString(),
        plan: plan.plan === 'free' ? 'trial' : plan.plan,
        updated_at:  new Date().toISOString()
      });
    }

    await fetch('/api/apply-referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.toUpperCase(), refereeId: this._user.id })
    }).catch(() => {});
  },

  async getReferralCount() {
    if (!this._user) return 0;
    try {
      const myCode = this.getReferralCode();
      const snap = await _db.collection('referrals').where('referral_code', '==', myCode).get();
      return snap.size;
    } catch (_) { return 0; }
  },

  // ── Teams ─────────────────────────────────────────────────────────────────
  async createTeam(name) {
    if (!this._user) return { ok: false, error: 'Not logged in' };
    try {
      const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase();
      const teamRef = await _db.collection('teams').add({
        name, created_by: this._user.id, invite_code: inviteCode
      });
      await _db.collection('team_members').add({ team_id: teamRef.id, user_id: this._user.id, role: 'admin' });
      return { ok: true, team: { id: teamRef.id, name, invite_code: inviteCode } };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async joinTeam(code) {
    if (!this._user) return { ok: false, error: 'Not logged in' };
    try {
      const snap = await _db.collection('teams').where('invite_code', '==', code.toUpperCase()).limit(1).get();
      if (snap.empty) return { ok: false, error: 'Team not found — check the code.' };
      const team = { id: snap.docs[0].id, ...snap.docs[0].data() };
      await _db.collection('team_members').add({ team_id: team.id, user_id: this._user.id, role: 'member' });
      return { ok: true, team };
    } catch (e) { return { ok: false, error: e.message }; }
  },

  async getTeam() {
    if (!this._user) return null;
    try {
      const snap = await _db.collection('team_members').where('user_id', '==', this._user.id).limit(1).get();
      if (snap.empty) return null;
      const { team_id } = snap.docs[0].data();
      const teamSnap = await _db.collection('teams').doc(team_id).get();
      return teamSnap.exists ? { id: teamSnap.id, ...teamSnap.data() } : null;
    } catch (_) { return null; }
  },

  async getTeamActivity(teamId, mode = 'work', weeks = 15) {
    try {
      const since = new Date(); since.setDate(since.getDate() - weeks * 7);
      const membersSnap = await _db.collection('team_members').where('team_id', '==', teamId).get();
      const userIds = membersSnap.docs.map(d => d.data().user_id);
      const counts = {};
      await Promise.all(userIds.map(async uid => {
        const snap = await _db.collection('users').doc(uid).collection('sessions')
          .where('mode', '==', mode).where('completed_at', '>=', since.toISOString()).get();
        snap.forEach(d => {
          const day = d.data().completed_at.slice(0, 10);
          counts[day] = (counts[day] || 0) + 1;
        });
      }));
      return counts;
    } catch (_) { return {}; }
  },

  async getHeatmapData(mode, weeks = 15) {
    if (!this._user) return null;
    try {
      const since = new Date(); since.setDate(since.getDate() - weeks * 7);
      const snap = await _db.collection('users').doc(this._user.id).collection('sessions')
        .where('mode', '==', mode).where('completed_at', '>=', since.toISOString()).get();
      const counts = {};
      snap.forEach(d => {
        const day = d.data().completed_at.slice(0, 10);
        counts[day] = (counts[day] || 0) + 1;
      });
      return counts;
    } catch (_) { return null; }
  },

  // ── Timezone ──────────────────────────────────────────────────────────────
  getDetectedTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(_) { return 'UTC'; }
  },

  getTimezone() {
    return this._user?.timezone || this.getDetectedTimezone();
  },

  async saveTimezone(tz) {
    if (!this._user) return;
    await _db.collection('users').doc(this._user.id).collection('plan').doc('current')
      .update({ timezone: tz, updated_at: new Date().toISOString() }).catch(() => {});
    this._user.timezone = tz;
    try { localStorage.setItem('flow-timezone', tz); } catch(_) {}
  },

  async _loadTimezone(userId) {
    try {
      const snap = await _db.collection('users').doc(userId).collection('plan').doc('current').get();
      if (snap.exists && snap.data().timezone) {
        this._user.timezone = snap.data().timezone;
        try { localStorage.setItem('flow-timezone', snap.data().timezone); } catch(_) {}
        return snap.data().timezone;
      }
    } catch(_) {}
    const detected = this.getDetectedTimezone();
    await this.saveTimezone(detected);
    return detected;
  },

  // ── Plan: fetch or create 7-day trial ─────────────────────────────────────
  async _getOrCreatePlan(userId) {
    const planRef = _db.collection('users').doc(userId).collection('plan').doc('current');
    const snap = await planRef.get();

    if (snap.exists) {
      const data = snap.data();
      // Repair: if plan is 'trial' but valid_until is missing, backfill it
      if (data.plan === 'trial' && !data.valid_until) {
        const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const patch = { valid_until: trialEnd.toISOString(), updated_at: new Date().toISOString() };
        await planRef.update(patch).catch(() => {});
        return { ...data, ...patch };
      }
      // Repair: if plan is 'free' and no valid_until, treat as new user → give trial
      if (data.plan === 'free' && !data.valid_until) {
        const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const patch = { plan: 'trial', valid_until: trialEnd.toISOString(), updated_at: new Date().toISOString() };
        await planRef.update(patch).catch(() => {});
        return { ...data, ...patch };
      }
      return data;
    }

    // New user — create 7-day trial
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const planData = { plan: 'trial', valid_until: trialEnd.toISOString(), updated_at: new Date().toISOString() };
    await planRef.set(planData);
    return planData;
  },

  // ── Normalize Firebase user + plan into app user object ───────────────────
  _normalize(user, planData = null) {
    let plan = 'free';
    let trialDaysLeft = 0;

    if (planData) {
      const now        = new Date();
      const validUntil = planData.valid_until ? new Date(planData.valid_until) : null;

      if (planData.plan === 'pro' && (!validUntil || validUntil > now)) {
        plan = 'pro';
      } else if (planData.plan === 'trial' && validUntil && validUntil > now) {
        plan = 'trial';
        trialDaysLeft = Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24));
        if (trialDaysLeft < 1) trialDaysLeft = 1; // show at least "1 day" when < 24h remain
      }
    }

    return {
      id:           user.uid,
      email:        user.email,
      name:         user.displayName || user.email.split('@')[0],
      avatar:       user.photoURL || null,
      plan,
      trialDaysLeft,
      timezone:     localStorage.getItem('flow-timezone') || null
    };
  }
};

// Plan limits
const PLANS = {
  free:  { workMax: 25, label: 'Free',      maxSessions: 4 },
  trial: { workMax: 90, label: 'Pro Trial', maxSessions: 8 },
  pro:   { workMax: 90, label: 'Pro',       maxSessions: 8 }
};
