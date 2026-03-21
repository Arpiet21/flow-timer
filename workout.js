// ─── Workout (HIIT) Timer ─────────────────────────────────────────────────────

const WORKOUT_PRESETS = {
  tabata:    { workSecs: 20,  restSecs: 10, rounds: 8,  prepareSecs: 5  },
  sprint:    { workSecs: 40,  restSecs: 20, rounds: 10, prepareSecs: 5  },
  endurance: { workSecs: 45,  restSecs: 15, rounds: 6,  prepareSecs: 5  },
  custom:    { workSecs: 30,  restSecs: 15, rounds: 5,  prepareSecs: 5  }
};

const WO_DEFAULT = { workSecs: 20, restSecs: 10, rounds: 8, prepareSecs: 5 };

let wo = {
  phase: 'idle',    // 'idle' | 'prepare' | 'work' | 'rest' | 'done'
  round: 1,
  timeLeft: 0,
  totalTime: 0,
  status: 'idle',   // 'idle' | 'running' | 'paused'
  preset: 'tabata',
  settings: { ...WO_DEFAULT }
};

let woInterval = null;

// ─── Storage ──────────────────────────────────────────────────────────────────
function woLoad() {
  try {
    const s = JSON.parse(localStorage.getItem('flow-workout-state') || '{}');
    if (s.settings) wo.settings = { ...WO_DEFAULT, ...s.settings };
    if (s.preset)   wo.preset   = s.preset;
  } catch (_) {}
}

function woSave() {
  localStorage.setItem('flow-workout-state', JSON.stringify({ settings: wo.settings, preset: wo.preset }));
}

// ─── Saved Custom Workouts ────────────────────────────────────────────────────
function woLoadSaved() {
  try { return JSON.parse(localStorage.getItem('flow-workout-saved') || '[]'); } catch (_) { return []; }
}

function woSaveCustom() {
  const input = document.getElementById('wo-save-name');
  const name  = input?.value.trim();
  if (!name) { input?.focus(); return; }
  const saved = woLoadSaved();
  saved.push({ name, settings: { ...wo.settings } });
  localStorage.setItem('flow-workout-saved', JSON.stringify(saved));
  if (input) input.value = '';
  woRenderSavedList();
  woRenderSavedPills();
}

function woDeleteSaved(i) {
  const saved = woLoadSaved();
  saved.splice(i, 1);
  localStorage.setItem('flow-workout-saved', JSON.stringify(saved));
  woRenderSavedList();
  woRenderSavedPills();
}

function woLoadSavedWorkout(i) {
  const saved = woLoadSaved();
  if (!saved[i]) return;
  wo.settings = { ...WO_DEFAULT, ...saved[i].settings };
  wo.preset   = 'custom';
  woSave();
  woUpdateBadges();
  woUpdateCustomSetupUI();
  woReset();
  // Switch to workout card view
  document.getElementById('workout-card').classList.remove('hidden');
  document.getElementById('wo-custom-setup').classList.add('hidden');
  document.getElementById('wo-settings-row').classList.remove('hidden');
}

function woRenderSavedList() {
  const el    = document.getElementById('wo-saved-list');
  const saved = woLoadSaved();
  if (!el) return;
  el.innerHTML = saved.length ? saved.map((s, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:0.8rem;">
      <span style="color:var(--text);">📋 ${s.name}</span>
      <div style="display:flex;gap:6px;">
        <button onclick="woLoadSavedWorkout(${i})" style="background:var(--accent);color:#000;border:none;border-radius:6px;padding:3px 10px;font-size:0.75rem;font-weight:700;cursor:pointer;">Load</button>
        <button onclick="woDeleteSaved(${i})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.9rem;">✕</button>
      </div>
    </div>`).join('') : '<p style="font-size:0.75rem;color:var(--text-muted);text-align:center;margin:6px 0;">No saved workouts yet.</p>';
}

function woRenderSavedPills() {
  const el    = document.getElementById('wo-saved-pills');
  const saved = woLoadSaved();
  if (!el) return;
  if (!saved.length) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = `<span style="font-size:0.72rem;color:var(--text-muted);align-self:center;margin-right:2px;">Saved:</span>` +
    saved.map((s, i) => `
      <button onclick="woLoadSavedWorkout(${i})"
        style="background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:20px;padding:4px 12px;font-size:0.72rem;font-weight:600;cursor:pointer;">
        ${s.name}
      </button>`).join('');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function woInit() {
  woLoad();
  woUpdateSettingsUI();
  woUpdateBadges();
  woUpdatePresetUI();
  woReset();
  woBindEvents();
  woRenderSavedList();
  woRenderSavedPills();
}

// ─── Preset ───────────────────────────────────────────────────────────────────
function woSelectPreset(btn, key) {
  if (wo.status === 'running') woPause();
  const preset = WORKOUT_PRESETS[key];
  if (!preset) return;
  wo.preset   = key;
  wo.settings = { ...WO_DEFAULT, ...preset };
  woSave();
  woUpdatePresetUI();

  if (key === 'custom') {
    document.getElementById('workout-card').classList.add('hidden');
    document.getElementById('wo-custom-setup').classList.remove('hidden');
    document.getElementById('wo-settings-row').classList.add('hidden');
    document.getElementById('wo-settings-card')?.classList.add('hidden');
    woUpdateCustomSetupUI();
  } else {
    document.getElementById('workout-card').classList.remove('hidden');
    document.getElementById('wo-custom-setup').classList.add('hidden');
    document.getElementById('wo-settings-row').classList.remove('hidden');
    woUpdateBadges();
    woReset();
  }
}

// ─── Inline Rounds Adjuster (visible on all presets) ──────────────────────────
function woAdjRounds(delta) {
  if (wo.status === 'running') return;
  wo.settings.rounds = Math.max(1, Math.min(30, wo.settings.rounds + delta));
  woSave();
  woUpdateBadges();
  woReset();
}

// ─── Custom Setup ─────────────────────────────────────────────────────────────
function woFormatTime(secs) {
  return String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
}

function woAdj(field, delta) {
  const limits = {
    prepareSecs: { min: 0,  max: 120 },
    workSecs:    { min: 5,  max: 300 },
    restSecs:    { min: 5,  max: 300 },
    rounds:      { min: 1,  max: 30  }
  };
  const lim = limits[field];
  if (!lim) return;
  wo.settings[field] = Math.max(lim.min, Math.min(lim.max, wo.settings[field] + delta));
  woSave();
  woUpdateCustomSetupUI();
}

function woUpdateCustomSetupUI() {
  const s = wo.settings;
  const p   = document.getElementById('wo-adj-prepare'); if (p)   p.textContent   = s.prepareSecs === 0 ? 'Off' : woFormatTime(s.prepareSecs);
  const w   = document.getElementById('wo-adj-work');    if (w)   w.textContent   = woFormatTime(s.workSecs);
  const r   = document.getElementById('wo-adj-rest');    if (r)   r.textContent   = woFormatTime(s.restSecs);
  const rnd = document.getElementById('wo-adj-rounds');  if (rnd) rnd.textContent = s.rounds;
  const total = (s.prepareSecs || 0) + (s.workSecs + s.restSecs) * s.rounds;
  const t   = document.getElementById('wo-adj-total');   if (t)   t.textContent   = woFormatTime(total);
}

function woUpdatePresetUI() {
  document.querySelectorAll('[data-preset]').forEach(b =>
    b.classList.toggle('active', b.dataset.preset === wo.preset)
  );
}

// ─── Timer Logic ──────────────────────────────────────────────────────────────
function woReset() {
  clearInterval(woInterval);
  woInterval = null;
  wo.status = 'idle';
  wo.round  = 1;
  wo.phase  = wo.settings.prepareSecs > 0 ? 'prepare' : 'work';
  wo.totalTime = wo.settings.prepareSecs > 0 ? wo.settings.prepareSecs : wo.settings.workSecs;
  wo.timeLeft  = wo.totalTime;
  woUpdateStartBtn();
  woRender();
  if (typeof musicStop === 'function') musicStop();
}

function woStart() {
  if (wo.status === 'running') return;
  wo.status = 'running';
  woUpdateStartBtn();
  woInterval = setInterval(woTick, 1000);
  if (typeof musicStart === 'function') musicStart();
}

function woPause() {
  if (wo.status !== 'running') return;
  clearInterval(woInterval);
  woInterval = null;
  wo.status = 'paused';
  woUpdateStartBtn();
  if (typeof musicPause === 'function') musicPause();
}

function woToggle() {
  if (wo.status === 'running') woPause();
  else woStart();
}

function woTick() {
  // Speak countdown at 4, 3, 2 seconds remaining so voice lands on 3, 2, 1
  if (wo.timeLeft === 4) woSpeak('3');
  else if (wo.timeLeft === 3) woSpeak('2');
  else if (wo.timeLeft === 2) woSpeak('1');
  wo.timeLeft--;
  woRender();
  if (wo.timeLeft <= 0) woAdvance();
}

function woAdvance() {
  woSpeak('Change');
  woBeep('transition');

  if (wo.phase === 'prepare') {
    wo.phase     = 'work';
    wo.round     = 1;
    wo.totalTime = wo.settings.workSecs;
    wo.timeLeft  = wo.totalTime;

  } else if (wo.phase === 'work') {
    if (wo.round >= wo.settings.rounds) {
      // All rounds done
      clearInterval(woInterval);
      woInterval   = null;
      wo.status    = 'idle';
      wo.phase     = 'done';
      wo.timeLeft  = 0;
      wo.totalTime = 1;
      woBeep('complete');
      woNotify();
      woUpdateStartBtn();
      woRender();
      // Log workout completion to history
      woLogCompletion();
      if (typeof renderActivityHeatmap === 'function') renderActivityHeatmap();
      return;
    }
    wo.phase     = 'rest';
    wo.totalTime = wo.settings.restSecs;
    wo.timeLeft  = wo.totalTime;

  } else if (wo.phase === 'rest') {
    wo.round++;
    wo.phase     = 'work';
    wo.totalTime = wo.settings.workSecs;
    wo.timeLeft  = wo.totalTime;
  }

  woRender();
}

function woSkip() {
  if (wo.phase === 'idle' || wo.phase === 'done') return;
  const wasRunning = wo.status === 'running';
  clearInterval(woInterval);
  woInterval = null;
  wo.timeLeft = 0;
  woAdvance();
  if (wasRunning && wo.phase !== 'done') {
    wo.status  = 'running';
    woInterval = setInterval(woTick, 1000);
    woUpdateStartBtn();
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
const PHASE_LABELS = {
  idle:    'GET READY',
  prepare: 'GET READY',
  work:    'WORK!',
  rest:    'REST',
  done:    'DONE! 💪'
};

function woRender() {
  const canvas = document.getElementById('wo-clock');
  if (!canvas) return;

  woDrawRing(canvas);

  // Phase label
  const phaseEl = document.getElementById('wo-phase-label');
  if (phaseEl) {
    phaseEl.textContent = PHASE_LABELS[wo.phase] || '';
    phaseEl.className   = 'wo-phase-label wo-phase-' + wo.phase;
  }

  // Round text
  const roundEl = document.getElementById('wo-round-text');
  if (roundEl) {
    if      (wo.phase === 'done')                          roundEl.textContent = `All ${wo.settings.rounds} rounds complete!`;
    else if (wo.phase === 'prepare' || wo.phase === 'idle') roundEl.textContent = `${wo.settings.rounds} rounds`;
    else                                                   roundEl.textContent = `Round ${wo.round} / ${wo.settings.rounds}`;
  }

  // Round dots
  woRenderDots();

  // Page title (only when workout tab is active)
  if (window.activeTimerMode === 'workout' && wo.phase !== 'idle') {
    const m = String(Math.floor(wo.timeLeft / 60)).padStart(2, '0');
    const s = String(wo.timeLeft % 60).padStart(2, '0');
    const short = { prepare: 'PREP', work: 'WORK', rest: 'REST', done: 'DONE' };
    document.title = `${m}:${s} ${short[wo.phase] || ''} — Flow Timer`;
  }
  // Keep floating widget in sync
  if (typeof syncPip === 'function' && typeof pipWindow !== 'undefined' && pipWindow) syncPip();
}

function woPhaseColor() {
  if (wo.phase === 'prepare') return '#ffd60a';
  if (wo.phase === 'work')    return (typeof state !== 'undefined' ? state.settings.accentColor : '#39ff14');
  if (wo.phase === 'rest')    return '#30d158';
  if (wo.phase === 'done')    return '#30d158';
  return '#444';
}

function woDrawRing(canvas) {
  const ctx  = canvas.getContext('2d');
  const W    = canvas.width, H = canvas.height;
  const cx   = W / 2, cy = H / 2;
  const R    = Math.min(cx, cy) - 16;
  const ringW = 18;
  const isDark   = typeof state !== 'undefined' ? state.theme === 'dark' : true;
  const color    = woPhaseColor();
  const progress = wo.totalTime > 0 ? wo.timeLeft / wo.totalTime : 0;

  ctx.clearRect(0, 0, W, H);

  // Background fill inside ring
  ctx.beginPath();
  ctx.arc(cx, cy, R - ringW / 2, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? '#12122a' : '#f0f0f0';
  ctx.fill();

  // Track ring
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = isDark ? '#2a2a4a' : '#d8d8d8';
  ctx.lineWidth   = ringW;
  ctx.stroke();

  // Progress arc
  if (wo.phase === 'done') {
    // Full green ring when done
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#30d158';
    ctx.lineWidth   = ringW;
    ctx.stroke();
    // Glow
    ctx.shadowBlur  = 20;
    ctx.shadowColor = '#30d158';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = '#30d158';
    ctx.lineWidth   = ringW;
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (progress > 0.002) {
    const start = -Math.PI / 2;
    const end   = start + Math.PI * 2 * progress;
    // Glow
    ctx.shadowBlur  = wo.phase === 'work' ? 18 : 10;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.arc(cx, cy, R, start, end);
    ctx.strokeStyle = color;
    ctx.lineWidth   = ringW;
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Center time text
  const m = String(Math.floor(wo.timeLeft / 60)).padStart(2, '0');
  const s = String(wo.timeLeft % 60).padStart(2, '0');
  const timeStr   = wo.phase === 'done' ? '✓' : `${m}:${s}`;
  const textColor = isDark ? '#eaeaea' : '#1a1a2e';

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font         = `800 ${Math.round(W * 0.17)}px 'Segoe UI', system-ui, sans-serif`;
  ctx.fillStyle    = wo.phase === 'done' ? '#30d158' : textColor;
  ctx.fillText(timeStr, cx, cy);
}

function woRenderDots() {
  const el = document.getElementById('wo-dots');
  if (!el) return;
  el.innerHTML = '';
  const max = Math.min(wo.settings.rounds, 20);
  for (let i = 1; i <= max; i++) {
    const dot = document.createElement('span');
    let cls = 'dot';
    if (wo.phase === 'done' || i < wo.round)                cls += ' done';
    else if (i === wo.round && wo.phase === 'work')          cls += ' active';
    else if (i === wo.round && wo.phase === 'rest')          cls += ' wo-resting';
    el.appendChild(Object.assign(dot, { className: cls }));
  }
}

// ─── Badges + Settings UI ─────────────────────────────────────────────────────
function woUpdateBadges() {
  const w = document.getElementById('wo-work-badge');
  const r = document.getElementById('wo-rest-badge');
  const t = document.getElementById('wo-total-label');
  const rn = document.getElementById('wo-rounds-inline');
  if (w) w.textContent = `💪 ${wo.settings.workSecs}s work`;
  if (r) r.textContent = `😮‍💨 ${wo.settings.restSecs}s rest`;
  if (rn) rn.textContent = wo.settings.rounds;
  if (t) {
    const s = wo.settings;
    const total = (s.prepareSecs || 0) + (s.workSecs + s.restSecs) * s.rounds;
    t.textContent = woFormatTime(total);
  }
}

function woUpdateSettingsUI() {
  const s = wo.settings;
  const set = (id, vid, v, f) => {
    const el = document.getElementById(id); if (el) el.value = v;
    const ve = document.getElementById(vid); if (ve) ve.textContent = f(v);
  };
  set('wo-work-slider',    'wo-work-val',    s.workSecs,    v => `${v}s`);
  set('wo-rest-slider',    'wo-rest-val',    s.restSecs,    v => `${v}s`);
  set('wo-rounds-slider',  'wo-rounds-val',  s.rounds,      v => `${v}`);
  set('wo-prepare-slider', 'wo-prepare-val', s.prepareSecs, v => v === 0 ? 'Off' : `${v}s`);
}

function woUpdateStartBtn() {
  const btn = document.getElementById('wo-start-btn');
  if (!btn) return;
  if (wo.phase === 'done') {
    btn.textContent = 'Restart';
  } else {
    btn.textContent = wo.status === 'running' ? 'Pause' : wo.status === 'paused' ? 'Resume' : 'Start';
  }
}

// ─── Speech ───────────────────────────────────────────────────────────────────
function woSpeak(text) {
  if (typeof state !== 'undefined' && !state.settings.soundEnabled) return;
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate   = 1.1;
  u.pitch  = 1.0;
  u.volume = 1.0;
  speechSynthesis.speak(u);
}

// ─── Sound ────────────────────────────────────────────────────────────────────
function woBeep(type) {
  if (typeof state !== 'undefined' && !state.settings.soundEnabled) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();

    const tone = (freq, startT, dur, vol = 0.4, wave = 'sine') => {
      const osc = ac.createOscillator();
      const g   = ac.createGain();
      osc.connect(g); g.connect(ac.destination);
      osc.type = wave; osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, ac.currentTime + startT);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + startT + dur);
      osc.start(ac.currentTime + startT);
      osc.stop(ac.currentTime + startT + dur);
    };

    if (type === 'countdown')  tone(1100, 0, 0.1, 0.3);
    if (type === 'transition') { tone(880, 0, 0.18, 0.5); tone(880, 0.22, 0.18, 0.5); }
    if (type === 'complete')   { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.15, 0.4, 0.4)); }
  } catch (_) {}
}

// ─── Notification ─────────────────────────────────────────────────────────────
function woNotify() {
  if (typeof state !== 'undefined' && !state.settings.notificationsEnabled) return;
  if (Notification.permission !== 'granted') return;
  new Notification('Workout Complete! 💪', {
    body: `${wo.settings.rounds} rounds done. Amazing work!`,
    icon: 'assets/icon-192.png'
  });
}

// ─── Events ───────────────────────────────────────────────────────────────────
function woBindEvents() {
  document.getElementById('wo-start-btn')?.addEventListener('click', () => {
    if (wo.phase === 'done') { woReset(); return; }
    woToggle();
  });

  document.getElementById('wo-skip-btn')?.addEventListener('click', woSkip);
  document.getElementById('wo-reset-btn')?.addEventListener('click', woReset);

  document.getElementById('wo-settings-btn')?.addEventListener('click', () => {
    document.getElementById('wo-settings-card')?.classList.toggle('hidden');
  });

  document.getElementById('wo-go-btn')?.addEventListener('click', () => {
    document.getElementById('workout-card').classList.remove('hidden');
    document.getElementById('wo-custom-setup').classList.add('hidden');
    document.getElementById('wo-settings-row').classList.remove('hidden');
    woUpdateBadges();
    woReset();
    woStart();
  });

  const bindSlider = (id, vid, setter, fmt) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseInt(el.value);
      const ve = document.getElementById(vid); if (ve) ve.textContent = fmt(v);
      setter(v);
      // Mark as custom preset
      wo.preset = 'custom';
      woUpdatePresetUI();
      woUpdateBadges();
      if (wo.status !== 'running') woReset();
      woSave();
    });
  };

  bindSlider('wo-work-slider',    'wo-work-val',    v => wo.settings.workSecs    = v, v => `${v}s`);
  bindSlider('wo-rest-slider',    'wo-rest-val',    v => wo.settings.restSecs    = v, v => `${v}s`);
  bindSlider('wo-rounds-slider',  'wo-rounds-val',  v => wo.settings.rounds      = v, v => `${v}`);
  bindSlider('wo-prepare-slider', 'wo-prepare-val', v => wo.settings.prepareSecs = v, v => v === 0 ? 'Off' : `${v}s`);

  // Keyboard shortcuts (only when workout tab is active)
  document.addEventListener('keydown', e => {
    if (window.activeTimerMode !== 'workout') return;
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); if (wo.phase === 'done') woReset(); else woToggle(); }
    if (e.code === 'KeyR')  woReset();
  });
}

function woLogCompletion() {
  // Total workout duration in minutes
  const totalMins = Math.round(
    (wo.settings.rounds * (wo.settings.workSecs + wo.settings.restSecs) + wo.settings.prepareSecs) / 60
  ) || 1;

  // Log to Firebase Firestore only
  if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
    Auth.logSession('workout', totalMins);
  }
}

window.addEventListener('DOMContentLoaded', woInit);
