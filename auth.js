// ─── Auth (Supabase-backed) ───────────────────────────────────────────────────

const Auth = {
  _user: null,

  // ── Get current cached user ──────────────────────────────────────────────
  getUser() { return this._user; },
  isLoggedIn() { return !!this._user; },

  // ── Load session on page start (call before rendering anything) ──────────
  async init() {
    const { data } = await _sb.auth.getSession();
    if (data?.session?.user) {
      this._user = this._normalize(data.session.user);
    }
    // Listen for auth state changes (login/logout in other tabs)
    _sb.auth.onAuthStateChange((_event, session) => {
      this._user = session?.user ? this._normalize(session.user) : null;
    });
    return this._user;
  },

  // ── Sign up with email + password ────────────────────────────────────────
  async signUp(name, email, password) {
    const { data, error } = await _sb.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } }
    });
    if (error) return { ok: false, error: error.message };
    this._user = data.user ? this._normalize(data.user) : null;
    return { ok: true, user: this._user };
  },

  // ── Sign in with email + password ────────────────────────────────────────
  async signIn(email, password) {
    const { data, error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    this._user = this._normalize(data.user);
    return { ok: true, user: this._user };
  },

  // ── Sign in with Google ──────────────────────────────────────────────────
  async signInWithGoogle() {
    // Handle file:// (opened directly) vs http:// (served via server)
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
    return { ok: true }; // Browser redirects to Google
  },

  // ── Sign out ─────────────────────────────────────────────────────────────
  async signOut() {
    await _sb.auth.signOut();
    this._user = null;
    window.location.href = 'landing.html';
  },

  // ── Auth guard — redirect to login if not authenticated ──────────────────
  async requireAuth() {
    await this.init();
    if (!this._user) {
      window.location.href = 'login.html';
      return false;
    }
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

  // ── Normalize Supabase user object ───────────────────────────────────────
  _normalize(user) {
    return {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name
        || user.user_metadata?.name
        || user.email.split('@')[0],
      avatar: user.user_metadata?.avatar_url || null,
      plan: 'free'
    };
  }
};

// Plan limits
const PLANS = {
  free: { workMax: 25, label: 'Free', maxSessions: 4 },
  pro:  { workMax: 90, label: 'Pro',  maxSessions: 8 }
};
