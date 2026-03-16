// ─── Shared Music Engine ──────────────────────────────────────────────────────

const MUSIC = {
  enabled: false,
  mode: 'beat',       // 'beat' | 'binaural' | 'file'
  bpm: 140,
  binaural: 'focus',  // 'focus' | 'energy' | 'calm'
};

const BINAURAL_PRESETS = {
  focus:  { base: 200, beat: 10 },
  energy: { base: 200, beat: 20 },
  calm:   { base: 200, beat: 6  },
};

// ─── Beat state ───────────────────────────────────────────────────────────────
let _beatCtx       = null;
let _beatScheduler = null;
let _beatNext      = 0;
let _beatNum       = 0;

// ─── Binaural state ───────────────────────────────────────────────────────────
let _binCtx   = null;
let _binNodes = null;

// ─── Public API ───────────────────────────────────────────────────────────────
function musicStart() {
  if (!MUSIC.enabled) return;
  if (MUSIC.mode === 'beat')     _startBeat();
  if (MUSIC.mode === 'binaural') _startBinaural();
  if (MUSIC.mode === 'file')     _startFile();
}

function musicPause() {
  _stopBeat();
  _suspendBinaural();
  const a = document.getElementById('music-audio');
  if (a) a.pause();
}

function musicStop() {
  _stopBeat();
  _stopBinaural();
  const a = document.getElementById('music-audio');
  if (a) { a.pause(); a.currentTime = 0; }
}

// ─── Beat ─────────────────────────────────────────────────────────────────────
function _startBeat() {
  if (!_beatCtx) _beatCtx = new (window.AudioContext || window.webkitAudioContext)();
  _beatCtx.resume();
  _beatNext = _beatCtx.currentTime;
  _beatNum  = 0;
  _scheduleBeat();
}

function _stopBeat() {
  if (_beatScheduler) { clearTimeout(_beatScheduler); _beatScheduler = null; }
  if (_beatCtx) _beatCtx.suspend();
}

function _scheduleBeat() {
  if (!_beatCtx || !MUSIC.enabled || MUSIC.mode !== 'beat') return;
  const ahead    = 0.1;
  const interval = 60 / MUSIC.bpm;
  while (_beatNext < _beatCtx.currentTime + ahead) {
    _playBeatStep(_beatCtx, _beatNext, _beatNum);
    _beatNum++;
    _beatNext += interval;
  }
  _beatScheduler = setTimeout(_scheduleBeat, 25);
}

function _playBeatStep(ctx, t, n) {
  const beat = n % 4;

  // Kick on beats 0 and 2
  if (beat === 0 || beat === 2) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(0.001, t + 0.35);
    gain.gain.setValueAtTime(0.8, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc.start(t); osc.stop(t + 0.35);
  }

  // Hi-hat on every beat
  const bufSize = Math.floor(ctx.sampleRate * 0.04);
  const buf     = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data    = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src  = ctx.createBufferSource();
  src.buffer = buf;
  const hpf  = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = 7000;
  const hg = ctx.createGain();
  src.connect(hpf); hpf.connect(hg); hg.connect(ctx.destination);
  hg.gain.setValueAtTime((beat === 0 || beat === 2) ? 0.2 : 0.12, t);
  hg.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  src.start(t); src.stop(t + 0.04);
}

// ─── Binaural ─────────────────────────────────────────────────────────────────
function _startBinaural() {
  _stopBinaural();
  const p = BINAURAL_PRESETS[MUSIC.binaural] || BINAURAL_PRESETS.focus;
  if (!_binCtx) _binCtx = new (window.AudioContext || window.webkitAudioContext)();
  _binCtx.resume();

  const ac      = _binCtx;
  const merger  = ac.createChannelMerger(2);
  merger.connect(ac.destination);

  const makeOsc = (freq, ch) => {
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.value = 0.12;
    osc.connect(gain);
    gain.connect(merger, 0, ch);
    osc.start();
    return osc;
  };

  const oscL = makeOsc(p.base, 0);
  const oscR = makeOsc(p.base + p.beat, 1);
  _binNodes = { oscL, oscR };
}

function _suspendBinaural() {
  if (_binCtx) _binCtx.suspend();
}

function _stopBinaural() {
  if (_binNodes) {
    try { _binNodes.oscL.stop(); _binNodes.oscR.stop(); } catch (_) {}
    _binNodes = null;
  }
  if (_binCtx) _binCtx.suspend();
}

// ─── File ─────────────────────────────────────────────────────────────────────
function _startFile() {
  const a = document.getElementById('music-audio');
  if (a?.src) a.play().catch(() => {});
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function musicToggle(enabled) {
  MUSIC.enabled = enabled;
  const opts = document.getElementById('music-options');
  if (opts) opts.classList.toggle('hidden', !enabled);
  if (!enabled) { musicStop(); return; }
  // Auto-start if a timer is running
  const workRunning    = typeof state   !== 'undefined' && state.status   === 'running';
  const workoutRunning = typeof wo      !== 'undefined' && wo.status      === 'running';
  if (workRunning || workoutRunning) musicStart();
}

function musicSetMode(mode) {
  musicStop();
  MUSIC.mode = mode;
  document.querySelectorAll('[data-music-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.musicMode === mode)
  );
  document.getElementById('music-beat-section').classList.toggle('hidden', mode !== 'beat');
  document.getElementById('music-binaural-section').classList.toggle('hidden', mode !== 'binaural');
  document.getElementById('music-file-section').classList.toggle('hidden', mode !== 'file');
  const workRunning    = typeof state !== 'undefined' && state.status === 'running';
  const workoutRunning = typeof wo    !== 'undefined' && wo.status    === 'running';
  if (MUSIC.enabled && (workRunning || workoutRunning)) musicStart();
}

function musicBpmAdj(delta) {
  MUSIC.bpm = Math.max(60, Math.min(220, MUSIC.bpm + delta));
  const el = document.getElementById('music-bpm-val');
  if (el) el.textContent = MUSIC.bpm;
  if (MUSIC.enabled && MUSIC.mode === 'beat') { _stopBeat(); _startBeat(); }
}

function musicSetBinaural(preset) {
  MUSIC.binaural = preset;
  document.querySelectorAll('[data-binaural]').forEach(b =>
    b.classList.toggle('active', b.dataset.binaural === preset)
  );
  if (MUSIC.enabled && MUSIC.mode === 'binaural') { _stopBinaural(); _startBinaural(); }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Toggle on/off
  document.getElementById('music-toggle')?.addEventListener('change', e => {
    musicToggle(e.target.checked);
  });

  // Mode buttons
  document.querySelectorAll('[data-music-mode]').forEach(btn => {
    btn.addEventListener('click', () => musicSetMode(btn.dataset.musicMode));
  });

  // Binaural preset buttons
  document.querySelectorAll('[data-binaural]').forEach(btn => {
    btn.addEventListener('click', () => musicSetBinaural(btn.dataset.binaural));
  });

  // File picker
  document.getElementById('music-file-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const audio = document.getElementById('music-audio');
    audio.src = URL.createObjectURL(file);
    const nameEl = document.getElementById('music-filename');
    if (nameEl) nameEl.textContent = file.name;
  });
});
