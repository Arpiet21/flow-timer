// ─── Auth (Supabase-backed) ───────────────────────────────────────────────────

const Auth = {
  _user: null,

  getUser() { return this._user; },
  isLoggedIn() { return !!this._user; },

  // ── Load session on page start ───────────────────────────────────────────
  async init() {
    const { data } = await _sb.auth.getSession();
    if (data?.session?.user) {
      const planData = await this._getOrCreateTrial(data.session.user.id);
      this._user = this._normalize(data.session.user, planData);
    }

    _sb.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const planData = await this._getOrCreateTrial(session.user.id);
        this._user = this._normalize(session.user, planData);
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
      const planData = await this._getOrCreateTrial(data.user.id);
      this._user = this._normalize(data.user, planData);
    }

    return { ok: true, user: this._user };
  },

  // ── Sign in ──────────────────────────────────────────────────────────────
  async signIn(email, password) {
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
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
  },

  // ── Sign out ─────────────────────────────────────────────────────────────
  async signOut() {
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
      trialDaysLeft
    };
  }
};

// Plan limits — trial gets full Pro features
const PLANS = {
  free:  { workMax: 25, label: 'Free',       maxSessions: 4 },
  trial: { workMax: 90, label: 'Pro Trial',  maxSessions: 8 },
  pro:   { workMax: 90, label: 'Pro',        maxSessions: 8 }
};
