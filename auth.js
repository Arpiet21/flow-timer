// ─── Auth (Supabase-backed) ───────────────────────────────────────────────────

const DEVICE_LIMIT = 2; // max simultaneous devices per account

const Auth = {
  _user: null,

  getUser() { return this._user; },
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
    const browser = ua.includes('Edg/') ? 'Edge'
      : ua.includes('Chrome')  ? 'Chrome'
      : ua.includes('Firefox')  ? 'Firefox'
      : ua.includes('Safari')   ? 'Safari'
      : 'Browser';
    const os = ua.includes('Windows') ? 'Windows'
      : ua.includes('iPhone')  ? 'iPhone'
      : ua.includes('Android') ? 'Android'
      : ua.includes('Mac')     ? 'Mac'
      : ua.includes('Linux')   ? 'Linux'
      : 'Device';
    return `${browser} on ${os}`;
  },

  // Returns { allowed: true } or { allowed: false, message, devices }
  async _checkAndRegisterDevice(userId, email) {
    // Admin is never restricted
    if (email === 'arpietmalpani@gmail.com') return { allowed: true };

    const deviceId   = this._getDeviceId();
    const deviceName = this._getDeviceName();

    // Fetch all registered devices for this user
    const { data: devices } = await _sb.from('user_devices')
      .select('device_id, device_name, last_seen')
      .eq('user_id', userId);

    const list = devices || [];
    const existing = list.find(d => d.device_id === deviceId);

    if (existing) {
      // Refresh last_seen — this device is already registered
      await _sb.from('user_devices')
        .update({ last_seen: new Date().toISOString(), device_name: deviceName })
        .eq('user_id', userId)
        .eq('device_id', deviceId);
      return { allowed: true };
    }

    if (list.length >= DEVICE_LIMIT) {
      // Too many active devices — sign out and reject
      await _sb.auth.signOut();
      this._user = null;
      return {
        allowed: false,
        devices: list,
        message: `This account is already signed in on ${list.length} device${list.length > 1 ? 's' : ''}. `
               + `Sign out from one of those devices first, then try again.`
      };
    }

    // Register new device (DB INSERT policy is safety-net enforcement too)
    await _sb.from('user_devices').insert({
      user_id:     userId,
      device_id:   deviceId,
      device_name: deviceName,
      last_seen:   new Date().toISOString()
    });
    return { allowed: true };
  },

  async _unregisterDevice(userId) {
    const deviceId = this._getDeviceId();
    await _sb.from('user_devices')
      .delete()
      .eq('user_id', userId)
      .eq('device_id', deviceId);
  },

  // ── Load session on page start ───────────────────────────────────────────
  async init() {
    const { data } = await _sb.auth.getSession();
    if (data?.session?.user) {
      const userId = data.session.user.id;

      // Check device limit on every page load
      const deviceCheck = await this._checkAndRegisterDevice(userId, data.session.user.email);
      if (!deviceCheck.allowed) {
        // Redirect to login with device-limit flag so the page can show a message
        window.location.href = 'login.html?device_limit=1';
        return null;
      }

      const planData = await this._getOrCreateTrial(userId);
      this._user = this._normalize(data.session.user, planData);
      this._loadTimezone(userId); // async, don't await — non-blocking
    }

    _sb.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const planData = await this._getOrCreateTrial(session.user.id);
        this._user = this._normalize(session.user, planData);
        this._loadTimezone(session.user.id);
      } else {
        this._user = null;
      }
    });

    return this._user;
  },

  // ── Sign up — auto-creates 7-day trial ──────────────────────────────────
  async signUp(name, email, password) {
    const { data, error } = await _sb.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } }
    });
    if (error) return { ok: false, error: error.message };

    if (data.user) {
      // Register this device (fresh account — limit can't be hit yet)
      await _sb.from('user_devices').insert({
        user_id:     data.user.id,
        device_id:   this._getDeviceId(),
        device_name: this._getDeviceName(),
        last_seen:   new Date().toISOString()
      }).select(); // ignore duplicate error silently

      const planData = await this._getOrCreateTrial(data.user.id);
      this._user = this._normalize(data.user, planData);
    }

    return { ok: true, user: this._user };
  },

  // ── Sign in ──────────────────────────────────────────────────────────────
  async signIn(email, password) {
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };

    // Check device limit before completing login
    const deviceCheck = await this._checkAndRegisterDevice(data.user.id, data.user.email);
    if (!deviceCheck.allowed) {
      return { ok: false, error: deviceCheck.message, deviceLimit: true, devices: deviceCheck.devices };
    }

    const planData = await this._getOrCreateTrial(data.user.id);
    this._user = this._normalize(data.user, planData);
    return { ok: true, user: this._user };
  },

  // ── Sign in with Google ──────────────────────────────────────────────────
  async signInWithGoogle() {
    const origin = location.protocol === 'file:'
      ? 'http://localhost:3000'
      : location.origin;

    const { error } = await _sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/auth-callback.html`,
        queryParams: { access_type: 'offline', prompt: 'consent' }
      }
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
    // Device check for Google OAuth happens in requireAuth() after redirect
  },

  // ── Sign out ─────────────────────────────────────────────────────────────
  async signOut() {
    if (this._user) await this._unregisterDevice(this._user.id);
    await _sb.auth.signOut();
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
  async logSession(mode, durationMinutes) {
    if (!this._user) return;
    await _sb.from('sessions').insert({
      user_id: this._user.id,
      mode,
      duration_minutes: durationMinutes
    });
  },

  async getSessions() {
    if (!this._user) return [];
    const { data } = await _sb.from('sessions')
      .select('*')
      .eq('user_id', this._user.id)
      .order('completed_at', { ascending: false })
      .limit(50);
    return data || [];
  },

  // ── Focus streak ─────────────────────────────────────────────────────────
  async getStreak(mode = 'work') {
    if (!this._user) return 0;
    const { data } = await _sb.from('sessions')
      .select('completed_at')
      .eq('user_id', this._user.id)
      .eq('mode', mode)
      .order('completed_at', { ascending: false });
    if (!data || data.length === 0) return 0;

    const days = new Set(data.map(r => r.completed_at.slice(0, 10)));
    const cur = new Date();
    cur.setHours(0, 0, 0, 0);

    // If no session today, start counting from yesterday
    const todayStr = cur.toISOString().slice(0, 10);
    if (!days.has(todayStr)) cur.setDate(cur.getDate() - 1);

    let streak = 0;
    while (days.has(cur.toISOString().slice(0, 10))) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    }
    return streak;
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

    // Record the referral
    await _sb.from('referrals').upsert({
      referee_id: this._user.id,
      referral_code: code.toUpperCase(),
      created_at: new Date().toISOString()
    }, { onConflict: 'referee_id' });

    // Extend this user's plan by 15 days
    const { data: plan } = await _sb.from('user_plans')
      .select('valid_until, plan')
      .eq('user_id', this._user.id)
      .single();

    if (plan) {
      const base = plan.valid_until ? new Date(plan.valid_until) : new Date();
      if (base < new Date()) base.setTime(Date.now()); // if expired, start from now
      base.setDate(base.getDate() + 15);
      await _sb.from('user_plans').update({
        valid_until: base.toISOString(),
        plan: plan.plan === 'free' ? 'trial' : plan.plan,
        updated_at: new Date().toISOString()
      }).eq('user_id', this._user.id);
    }

    // Reward the referrer +15 days via server-side API (needs service role to find them)
    await fetch('/api/apply-referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.toUpperCase(), refereeId: this._user.id })
    }).catch(() => {});
  },

  async getReferralCount() {
    if (!this._user) return 0;
    const myCode = this.getReferralCode();
    const { count } = await _sb.from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('referral_code', myCode);
    return count || 0;
  },

  // ── Teams ─────────────────────────────────────────────────────────────────
  async createTeam(name) {
    if (!this._user) return { ok: false, error: 'Not logged in' };
    const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    const { data, error } = await _sb.from('teams').insert({
      name,
      created_by: this._user.id,
      invite_code: inviteCode
    }).select().single();
    if (error) return { ok: false, error: error.message };
    await _sb.from('team_members').insert({ team_id: data.id, user_id: this._user.id, role: 'admin' });
    return { ok: true, team: data };
  },

  async joinTeam(code) {
    if (!this._user) return { ok: false, error: 'Not logged in' };
    const { data: team, error } = await _sb.from('teams')
      .select('id, name, invite_code')
      .eq('invite_code', code.toUpperCase())
      .single();
    if (error || !team) return { ok: false, error: 'Team not found — check the code.' };
    const { error: e2 } = await _sb.from('team_members').upsert(
      { team_id: team.id, user_id: this._user.id, role: 'member' },
      { onConflict: 'team_id,user_id' }
    );
    if (e2) return { ok: false, error: e2.message };
    return { ok: true, team };
  },

  async getTeam() {
    if (!this._user) return null;
    const { data } = await _sb.from('team_members')
      .select('teams(id, name, invite_code)')
      .eq('user_id', this._user.id)
      .limit(1)
      .single();
    return data?.teams || null;
  },

  async getTeamActivity(teamId, mode = 'work', weeks = 15) {
    const since = new Date();
    since.setDate(since.getDate() - weeks * 7);
    const { data: members } = await _sb.from('team_members').select('user_id').eq('team_id', teamId);
    if (!members || members.length === 0) return {};
    const userIds = members.map(m => m.user_id);
    const { data } = await _sb.from('sessions')
      .select('completed_at')
      .in('user_id', userIds)
      .eq('mode', mode)
      .gte('completed_at', since.toISOString());
    const counts = {};
    (data || []).forEach(r => {
      const d = r.completed_at.slice(0, 10);
      counts[d] = (counts[d] || 0) + 1;
    });
    return counts;
  },

  // Returns { 'YYYY-MM-DD': count } for the heatmap (last `weeks` weeks)
  async getHeatmapData(mode, weeks = 15) {
    if (!this._user) return null; // null = fall back to localStorage
    const since = new Date();
    since.setDate(since.getDate() - weeks * 7);
    const { data } = await _sb.from('sessions')
      .select('completed_at')
      .eq('user_id', this._user.id)
      .eq('mode', mode)
      .gte('completed_at', since.toISOString());
    if (!data) return null;
    const counts = {};
    data.forEach(row => {
      const day = row.completed_at.slice(0, 10);
      counts[day] = (counts[day] || 0) + 1;
    });
    return counts;
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
    await _sb.from('user_plans')
      .update({ timezone: tz, updated_at: new Date().toISOString() })
      .eq('user_id', this._user.id);
    this._user.timezone = tz;
    try { localStorage.setItem('flow-timezone', tz); } catch(_) {}
  },

  async _loadTimezone(userId) {
    try {
      const { data } = await _sb.from('user_plans')
        .select('timezone')
        .eq('user_id', userId)
        .single();
      if (data?.timezone) {
        this._user.timezone = data.timezone;
        try { localStorage.setItem('flow-timezone', data.timezone); } catch(_) {}
        return data.timezone;
      }
    } catch(_) {}
    // No saved timezone — detect and save
    const detected = this.getDetectedTimezone();
    await this.saveTimezone(detected);
    return detected;
  },

  // ── Fetch plan; create 7-day trial if none exists ────────────────────────
  async _getOrCreateTrial(userId) {
    const { data } = await _sb.from('user_plans')
      .select('plan, valid_until')
      .eq('user_id', userId)
      .single();

    if (data) return data;

    // New user — start 7-day trial (no card required)
    const trialEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await _sb.from('user_plans').insert({
      user_id: userId,
      plan: 'trial',
      plan_type: 'trial',
      valid_until: trialEnd.toISOString(),
      updated_at: new Date().toISOString()
    });

    return { plan: 'trial', valid_until: trialEnd.toISOString() };
  },

  // ── Normalize Supabase user + plan into app user object ──────────────────
  _normalize(user, planData = null) {
    let plan = 'free';
    let trialDaysLeft = 0;

    if (planData) {
      const now = new Date();
      const validUntil = planData.valid_until ? new Date(planData.valid_until) : null;

      if (planData.plan === 'pro' && (!validUntil || validUntil > now)) {
        plan = 'pro';
      } else if (planData.plan === 'trial' && validUntil && validUntil > now) {
        plan = 'trial';
        trialDaysLeft = Math.max(1, Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24)));
      }
    }

    return {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name
        || user.user_metadata?.name
        || user.email.split('@')[0],
      avatar: user.user_metadata?.avatar_url || null,
      plan,
      trialDaysLeft,
      timezone: localStorage.getItem('flow-timezone') || null
    };
  }
};

// Plan limits — trial gets full Pro features
const PLANS = {
  free:  { workMax: 25, label: 'Free',       maxSessions: 4 },
  trial: { workMax: 90, label: 'Pro Trial',  maxSessions: 8 },
  pro:   { workMax: 90, label: 'Pro',        maxSessions: 8 }
};
