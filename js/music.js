// ─── Shared Music Engine ──────────────────────────────────────────────────────

const MUSIC = {
  enabled: false,
  mode: 'beat',       // 'beat' | 'binaural' | 'file' | 'youtube'
  bpm: 140,
  binaural: 'focus',  // 'focus' | 'energy' | 'calm'
  volume: 0.7,        // 0.0 – 1.0
  muted: false,
};

// ─── File playlist ────────────────────────────────────────────────────────────
const _filePlaylist = [];    // [{ name, url }]
let   _fileIdx      = 0;

// ─── YouTube playlist ─────────────────────────────────────────────────────────
const _ytPlaylist = [];      // [{ videoId, title }]
let   _ytIdx      = 0;
let   _ytPlayer   = null;    // YT.Player instance

const BINAURAL_PRESETS = {
  focus:     { base: 200, beat: 10 },  // Alpha  — concentration
  energy:    { base: 200, beat: 20 },  // Beta   — high energy
  calm:      { base: 200, beat: 6  },  // Theta  — relaxation
  deepfocus: { base: 200, beat: 40 },  // Gamma  — peak cognition
  flow:      { base: 200, beat: 8  },  // Alpha  — creative flow
  sleep:     { base: 200, beat: 2  },  // Delta  — deep rest
  manifestation:{ base: 200, beat: 528  },  // Manifestation  — Magic
  solfeggio528: { base: 528, beat: 0   },  // 528 Hz Solfeggio — Love / DNA repair
  yognidra:     { base: 200, beat: 1.5 },  // Yoga Nidra — Delta 1.5Hz, deep rest
};

// ─── Master gain (beat + binaural) ────────────────────────────────────────────
let _masterGain = null;

function _getMasterGain(ctx) {
  if (!_masterGain || _masterGain.context !== ctx) {
    _masterGain = ctx.createGain();
    _masterGain.connect(ctx.destination);
    _masterGain.gain.value = MUSIC.muted ? 0 : MUSIC.volume;
  }
  return _masterGain;
}

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
  if (MUSIC.mode === 'youtube')  _startYoutube();
}

function musicPause() {
  _stopBeat();
  _suspendBinaural();
  const a = document.getElementById('music-audio');
  if (a) a.pause();
  _pauseYoutube();
}

function musicStop() {
  _stopBeat();
  _stopBinaural();
  const a = document.getElementById('music-audio');
  if (a) { a.pause(); a.currentTime = 0; }
  _stopYoutube();
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
  const beat   = n % 4;
  const master = _getMasterGain(ctx);

  // Kick on beats 0 and 2
  if (beat === 0 || beat === 2) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(master);
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
  src.connect(hpf); hpf.connect(hg); hg.connect(master);
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
  merger.connect(_getMasterGain(ac));

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

// ─── File playlist ────────────────────────────────────────────────────────────
function _startFile() {
  if (!_filePlaylist.length) return;
  const a = document.getElementById('music-audio');
  if (!a) return;
  a.src    = _filePlaylist[_fileIdx].url;
  a.volume = MUSIC.muted ? 0 : MUSIC.volume;
  a.play().catch(() => {});
}

function _renderFilePlaylist() {
  const el = document.getElementById('music-file-playlist');
  if (!el) return;
  el.innerHTML = _filePlaylist.map((f, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:0.75rem;${i === _fileIdx ? 'color:var(--accent);font-weight:700;' : 'color:var(--text-muted);'}">
        ${i === _fileIdx ? '▶' : '○'} ${f.name}
      </span>
      <button onclick="musicFileRemove(${i})" style="margin-left:auto;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.8rem;">✕</button>
    </div>`).join('');
}

function musicFileRemove(i) {
  _filePlaylist.splice(i, 1);
  if (_fileIdx >= _filePlaylist.length) _fileIdx = 0;
  _renderFilePlaylist();
}

// ─── YouTube playlist ─────────────────────────────────────────────────────────
function _ytExtractId(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('v') || (u.hostname === 'youtu.be' ? u.pathname.slice(1) : null);
  } catch (_) { return null; }
}

async function musicYtAdd() {
  const input = document.getElementById('music-yt-input');
  if (!input) return;
  const url     = input.value.trim();
  const videoId = _ytExtractId(url);
  if (!videoId) return;
  input.value = '';

  const idx = _ytPlaylist.length;
  _ytPlaylist.push({ videoId, title: '⏳ Loading…' });
  _renderYtPlaylist();

  // Fetch real title via oEmbed (no API key required)
  try {
    const res  = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    const data = await res.json();
    _ytPlaylist[idx].title = data.title || `Track ${idx + 1}`;
  } catch (_) {
    _ytPlaylist[idx].title = `Track ${idx + 1}`;
  }
  _renderYtPlaylist();
  _saveCurrentYtQueue();

  if (!window.YT) _loadYtApi();
  else if (_ytPlayer) _ytPlayer.cueVideoById(_ytPlaylist[_ytIdx].videoId);
}

function musicYtAddPreset(videoId, title) {
  const alreadyIn = _ytPlaylist.find(t => t.videoId === videoId);
  if (!alreadyIn) {
    _ytPlaylist.push({ videoId, title });
    _renderYtPlaylist();
    _saveCurrentYtQueue();
  }
  if (!window.YT) _loadYtApi();
  else if (!_ytPlayer) _initYtPlayer();
  else _ytPlayer.loadVideoById(videoId);  // load & autoplay directly
}

function musicYtNext() {
  if (!_ytPlaylist.length) return;
  _ytIdx = (_ytIdx + 1) % _ytPlaylist.length;
  _renderYtPlaylist();
  if (_ytPlayer) _ytPlayer.loadVideoById(_ytPlaylist[_ytIdx].videoId);
}

function musicYtPrev() {
  if (!_ytPlaylist.length) return;
  _ytIdx = (_ytIdx - 1 + _ytPlaylist.length) % _ytPlaylist.length;
  _renderYtPlaylist();
  if (_ytPlayer) _ytPlayer.loadVideoById(_ytPlaylist[_ytIdx].videoId);
}

function musicYtRemove(i) {
  _ytPlaylist.splice(i, 1);
  if (_ytIdx >= _ytPlaylist.length) _ytIdx = 0;
  _renderYtPlaylist();
  _saveCurrentYtQueue();
}

function _renderYtPlaylist() {
  const el = document.getElementById('music-yt-playlist');
  if (!el) return;
  el.innerHTML = _ytPlaylist.map((t, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:0.75rem;${i === _ytIdx ? 'color:var(--accent);font-weight:700;' : 'color:var(--text-muted);'}">
        ${i === _ytIdx ? '▶' : '○'} ${t.title}
      </span>
      <button onclick="musicYtRemove(${i})" style="margin-left:auto;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.8rem;">✕</button>
    </div>`).join('');
}

// ─── Persist current queue across page reloads ───────────────────────────────
function _saveCurrentYtQueue() {
  localStorage.setItem('flow-yt-current', JSON.stringify(_ytPlaylist));
}

function _restoreCurrentYtQueue() {
  try {
    const q = JSON.parse(localStorage.getItem('flow-yt-current') || '[]');
    if (q.length) {
      q.forEach(t => _ytPlaylist.push(t));
      _renderYtPlaylist();
    }
  } catch (_) {}
}

// ─── Save / Load YouTube playlists ───────────────────────────────────────────
function _ytLoadSaved() {
  try { return JSON.parse(localStorage.getItem('flow-yt-playlists') || '[]'); } catch (_) { return []; }
}

function musicYtSave() {
  const input = document.getElementById('music-yt-save-name');
  const name  = input?.value.trim();
  if (!name || !_ytPlaylist.length) { input?.focus(); return; }
  const saved = _ytLoadSaved();
  saved.push({ name, tracks: [..._ytPlaylist] });
  localStorage.setItem('flow-yt-playlists', JSON.stringify(saved));
  if (input) input.value = '';
  _renderYtSaved();
}

function _ytDeleteSaved(i) {
  const saved = _ytLoadSaved();
  saved.splice(i, 1);
  localStorage.setItem('flow-yt-playlists', JSON.stringify(saved));
  _renderYtSaved();
}

function _ytLoadPlaylist(i) {
  const saved = _ytLoadSaved();
  if (!saved[i]) return;
  _ytPlaylist.length = 0;
  saved[i].tracks.forEach(t => _ytPlaylist.push(t));
  _ytIdx = 0;
  _renderYtPlaylist();
  _saveCurrentYtQueue();
  if (!window.YT) _loadYtApi();
  else if (_ytPlayer) _ytPlayer.cueVideoById(_ytPlaylist[0].videoId);
}

function _renderYtSaved() {
  const el    = document.getElementById('music-yt-saved');
  const saved = _ytLoadSaved();
  if (!el) return;
  el.innerHTML = saved.length ? saved.map((s, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.8rem;">
      <span style="color:var(--text);">🎵 ${s.name} <span style="color:var(--text-muted);">(${s.tracks.length} tracks)</span></span>
      <div style="display:flex;gap:6px;">
        <button onclick="_ytLoadPlaylist(${i})" style="background:var(--accent);color:#000;border:none;border-radius:6px;padding:3px 10px;font-size:0.75rem;font-weight:700;cursor:pointer;">Load</button>
        <button onclick="_ytDeleteSaved(${i})" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.9rem;">✕</button>
      </div>
    </div>`).join('') : '<p style="font-size:0.75rem;color:var(--text-muted);text-align:center;margin:6px 0;">No saved playlists yet.</p>';
}

function _loadYtApi() {
  if (document.getElementById('yt-api-script')) return;
  const s  = document.createElement('script');
  s.id     = 'yt-api-script';
  s.src    = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}

// Called by YouTube IFrame API when ready
window.onYouTubeIframeAPIReady = function() { _initYtPlayer(); };

function _initYtPlayer() {
  const container = document.getElementById('music-yt-container');
  if (!container || !_ytPlaylist.length) return;
  container.innerHTML = '<div id="yt-player-div"></div>';
  _ytPlayer = new YT.Player('yt-player-div', {
    height: '120',
    width:  '100%',
    videoId: _ytPlaylist[_ytIdx]?.videoId || '',
    playerVars: { autoplay: 0, controls: 1 },
    events: {
      onStateChange: e => {
        if (e.data === YT.PlayerState.ENDED) musicYtNext();
      },
      onReady: e => {
        e.target.setVolume(Math.round(MUSIC.volume * 100));
        if (MUSIC.enabled && MUSIC.mode === 'youtube') e.target.playVideo();
      }
    }
  });
}

function _startYoutube() {
  if (!_ytPlaylist.length) return;
  if (!window.YT) { _loadYtApi(); return; }
  if (!_ytPlayer) { _initYtPlayer(); return; }
  _ytPlayer.setVolume(Math.round((MUSIC.muted ? 0 : MUSIC.volume) * 100));
  _ytPlayer.playVideo();
}

function _pauseYoutube() {
  if (_ytPlayer) _ytPlayer.pauseVideo();
}

function _stopYoutube() {
  if (_ytPlayer) {
    try { _ytPlayer.pauseVideo(); } catch (_) {}
    try { _ytPlayer.stopVideo(); } catch (_) {}
    try { _ytPlayer.seekTo(0); } catch (_) {}
  }
}

function _destroyYtPlayer() {
  if (_ytPlayer) {
    try { _ytPlayer.destroy(); } catch (_) {}
    _ytPlayer = null;
  }
  const container = document.getElementById('music-yt-container');
  if (container) container.innerHTML = '';
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function musicToggle(enabled) {
  MUSIC.enabled = enabled;
  const opts = document.getElementById('music-options');
  if (opts) opts.classList.toggle('hidden', !enabled);
  if (!enabled) { musicStop(); if (typeof syncPip === 'function') syncPip(); return; }
  // Auto-start if a timer is running
  const workRunning    = typeof state   !== 'undefined' && state.status   === 'running';
  const workoutRunning = typeof wo      !== 'undefined' && wo.status      === 'running';
  if (workRunning || workoutRunning) musicStart();
  if (typeof syncPip === 'function') syncPip();
}

function musicSetMode(mode) {
  if (MUSIC.mode === 'youtube' && mode !== 'youtube') _destroyYtPlayer();
  musicStop();
  MUSIC.mode = mode;
  document.querySelectorAll('[data-music-mode]').forEach(b =>
    b.classList.toggle('active', b.dataset.musicMode === mode)
  );
  document.getElementById('music-beat-section').classList.toggle('hidden', mode !== 'beat');
  document.getElementById('music-binaural-section').classList.toggle('hidden', mode !== 'binaural');
  document.getElementById('music-file-section').classList.toggle('hidden', mode !== 'file');
  document.getElementById('music-youtube-section').classList.toggle('hidden', mode !== 'youtube');
  // Always init YouTube player when switching to YouTube mode (so user can control it without a timer)
  if (mode === 'youtube' && _ytPlaylist.length) {
    if (!window.YT) _loadYtApi();
    else if (!_ytPlayer) _initYtPlayer();
  }
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

// ─── Volume ───────────────────────────────────────────────────────────────────
function musicSetVolume(val) {
  MUSIC.volume = parseInt(val) / 100;
  MUSIC.muted  = false;
  // Web Audio master gain
  if (_masterGain) _masterGain.gain.value = MUSIC.volume;
  // File audio
  const a = document.getElementById('music-audio');
  if (a) a.volume = MUSIC.volume;
  // YouTube player
  if (_ytPlayer?.setVolume) _ytPlayer.setVolume(parseInt(val));
  // Update UI
  const icon = document.getElementById('music-vol-icon');
  const valEl = document.getElementById('music-vol-val');
  if (icon) icon.textContent = MUSIC.volume === 0 ? '🔇' : MUSIC.volume < 0.4 ? '🔉' : '🔊';
  if (valEl) valEl.textContent = `${parseInt(val)}%`;
}

function musicToggleMute() {
  MUSIC.muted = !MUSIC.muted;
  const effective = MUSIC.muted ? 0 : MUSIC.volume;
  if (_masterGain) _masterGain.gain.value = effective;
  const a = document.getElementById('music-audio');
  if (a) a.volume = effective;
  if (_ytPlayer?.setVolume) _ytPlayer.setVolume(Math.round(effective * 100));
  const icon   = document.getElementById('music-vol-icon');
  const slider = document.getElementById('music-vol-slider');
  if (icon)   icon.textContent = MUSIC.muted ? '🔇' : MUSIC.volume < 0.4 ? '🔉' : '🔊';
  if (slider) slider.value     = MUSIC.muted ? 0 : MUSIC.volume * 100;
  const valEl = document.getElementById('music-vol-val');
  if (valEl)  valEl.textContent = MUSIC.muted ? '0%' : `${Math.round(MUSIC.volume * 100)}%`;
  if (typeof syncPip === 'function') syncPip();
}

// ─── Manifestation Alarm ──────────────────────────────────────────────────────
const _alarm = {
  enabled:       false,
  intervalHours: 1,
  totalHours:    6,
  musicType:     '528hz',
  alarmDuration: 90,
  _nextTimer:    null,
  _ctx:          null,
  _stopTimer:    null,
  _cdTimer:      null,
  _firesLeft:    0,
};

function manifestAlarmStart() {
  _alarm.enabled    = true;
  _alarm._firesLeft = _alarm.totalHours > 0
    ? Math.floor(_alarm.totalHours / _alarm.intervalHours)
    : Infinity;
  _scheduleManifest();
  _updateManifestUI();
  _saveManifestSettings();
}

function manifestAlarmStop() {
  _alarm.enabled = false;
  if (_alarm._nextTimer) { clearTimeout(_alarm._nextTimer); _alarm._nextTimer = null; }
  _stopAlarmAudio();
  _hideAlarmOverlay();
  _updateManifestUI();
}

function manifestAlarmPreview() {
  _playAlarmAudio(_alarm.musicType, 15);
  _showAlarmOverlay(15);
}

function manifestSetOpt(group, val, btn) {
  if (group === 'interval') _alarm.intervalHours = +val;
  if (group === 'total')    _alarm.totalHours    = +val;
  if (group === 'music')    _alarm.musicType     = val;
  if (group === 'dur')      _alarm.alarmDuration = +val;
  btn.closest('.manifest-pills').querySelectorAll('.mpill').forEach(b =>
    b.classList.toggle('active', b === btn));
  _saveManifestSettings();
}

function manifestDismiss() {
  _stopAlarmAudio();
  _hideAlarmOverlay();
}

function _scheduleManifest() {
  if (_alarm._nextTimer) { clearTimeout(_alarm._nextTimer); _alarm._nextTimer = null; }
  if (!_alarm.enabled) return;
  const ms     = _alarm.intervalHours * 3600000;
  const nextAt = new Date(Date.now() + ms);
  const label  = _alarm._firesLeft === Infinity ? '∞' : _alarm._firesLeft;
  _setStatusBar(
    'Active · next at ' + nextAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' · ' + label + ' alarm' + (label !== 1 ? 's' : '') + ' left',
    true
  );
  _alarm._nextTimer = setTimeout(() => {
    if (!_alarm.enabled) return;
    if (_alarm._firesLeft !== Infinity) _alarm._firesLeft--;
    _playAlarmAudio(_alarm.musicType, _alarm.alarmDuration);
    _showAlarmOverlay(_alarm.alarmDuration);
    if (_alarm._firesLeft > 0 || _alarm._firesLeft === Infinity) {
      _scheduleManifest();
    } else {
      manifestAlarmStop();
    }
  }, ms);
}

function _playAlarmAudio(type, seconds) {
  _stopAlarmAudio();
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    _alarm._ctx = ctx;
    const fade = Math.min(5, seconds * 0.12);
    const mkG = (peak) => {
      const g = ctx.createGain();
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(peak, ctx.currentTime + fade);
      g.gain.setValueAtTime(peak, ctx.currentTime + seconds - fade);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + seconds);
      return g;
    };
    if (type === '528hz') {
      const g = mkG(0.14);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 528;
      o.connect(g); o.start(); o.stop(ctx.currentTime + seconds);
    } else if (type === '432hz') {
      const g = mkG(1);
      [[432, 0.12], [864, 0.04]].forEach(function(pair) {
        var f = pair[0], v = pair[1];
        const o = ctx.createOscillator(); const gv = ctx.createGain(); gv.gain.value = v;
        o.type = 'sine'; o.frequency.value = f;
        o.connect(gv); gv.connect(g); o.start(); o.stop(ctx.currentTime + seconds);
      });
    } else if (type === 'binaural') {
      const merger = ctx.createChannelMerger(2);
      const g = ctx.createGain(); merger.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.13, ctx.currentTime + fade);
      g.gain.setValueAtTime(0.13, ctx.currentTime + seconds - fade);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + seconds);
      [[528, 0], [532, 1]].forEach(function(pair) {
        var f = pair[0], ch = pair[1];
        const o = ctx.createOscillator(); const gv = ctx.createGain(); gv.gain.value = 1;
        o.type = 'sine'; o.frequency.value = f;
        o.connect(gv); gv.connect(merger, 0, ch); o.start(); o.stop(ctx.currentTime + seconds);
      });
    } else if (type === 'bowl') {
      const master = ctx.createGain(); master.connect(ctx.destination);
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(1, ctx.currentTime + 1);
      master.gain.setValueAtTime(1, ctx.currentTime + seconds - 2);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + seconds);
      const ring = function(t) {
        [[528, 0.28], [1463, 0.09], [2619, 0.05]].forEach(function(pair) {
          var f = pair[0], v = pair[1];
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.04);
          g.gain.exponentialRampToValueAtTime(0.001, t + 9);
          o.connect(g); g.connect(master); o.start(t); o.stop(t + 9.1);
        });
      };
      for (var t = 0; t < seconds; t += 12) ring(ctx.currentTime + t + 0.3);
    } else if (type === 'om') {
      const o = ctx.createOscillator(); const lpf = ctx.createBiquadFilter();
      const g = mkG(0.1);
      o.type = 'sawtooth'; o.frequency.value = 136.1;
      lpf.type = 'lowpass'; lpf.frequency.value = 850;
      o.connect(lpf); lpf.connect(g); o.start(); o.stop(ctx.currentTime + seconds);
    } else if (type === 'rain528') {
      const bufSize = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0); var last = 0;
      for (var i = 0; i < bufSize; i++) {
        const w = Math.random() * 2 - 1;
        d[i] = (last + 0.02 * w) / 1.02; last = d[i]; d[i] *= 3.5;
      }
      const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      const lpf = ctx.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 500;
      const ng = mkG(0.14);
      noise.connect(lpf); lpf.connect(ng); noise.start(); noise.stop(ctx.currentTime + seconds);
      const o = ctx.createOscillator(); const og = mkG(0.06);
      o.type = 'sine'; o.frequency.value = 528; o.connect(og);
      o.start(); o.stop(ctx.currentTime + seconds);
    }
    _alarm._stopTimer = setTimeout(function() { _stopAlarmAudio(); _hideAlarmOverlay(); }, (seconds + 1) * 1000);
  } catch (e) {}
}

function _stopAlarmAudio() {
  if (_alarm._stopTimer) { clearTimeout(_alarm._stopTimer); _alarm._stopTimer = null; }
  if (_alarm._cdTimer)   { clearInterval(_alarm._cdTimer);  _alarm._cdTimer   = null; }
  if (_alarm._ctx) { try { _alarm._ctx.close(); } catch (e) {} _alarm._ctx = null; }
  if (_previewTimer) { clearTimeout(_previewTimer); _previewTimer = null; }
  document.querySelectorAll('.mpill-play').forEach(function(b) { b.textContent = '▶'; b.classList.remove('playing'); });
  _previewBtn = null;
}

function _showAlarmOverlay(seconds) {
  _hideAlarmOverlay();
  if (!document.getElementById('manifest-alarm-style')) {
    const s = document.createElement('style'); s.id = 'manifest-alarm-style';
    s.textContent = [
      '#manifest-alarm-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(8,8,24,0.88);backdrop-filter:blur(14px);}',
      '#manifest-alarm-card{text-align:center;padding:48px 36px;max-width:360px;width:90%;animation:manifest-in .65s cubic-bezier(.22,1,.36,1);}',
      '.m-icon{font-size:3rem;display:block;margin-bottom:16px;animation:manifest-pulse 3s ease-in-out infinite;}',
      '.m-title{font-size:1.45rem;font-weight:700;color:#fff;letter-spacing:.05em;margin-bottom:10px;}',
      '.m-sub{font-size:0.88rem;color:rgba(255,255,255,.6);line-height:1.65;margin-bottom:26px;}',
      '.m-cd{font-size:2.6rem;font-weight:700;color:#a78bfa;margin-bottom:26px;font-variant-numeric:tabular-nums;}',
      '.m-dismiss{background:none;border:1px solid rgba(255,255,255,.22);color:rgba(255,255,255,.5);border-radius:10px;padding:9px 26px;font-size:0.82rem;cursor:pointer;transition:all .2s;}',
      '.m-dismiss:hover{border-color:rgba(255,255,255,.6);color:#fff;}',
    ].join('');
    document.head.appendChild(s);
  }
  var remaining = seconds;
  const overlay = document.createElement('div');
  overlay.id = 'manifest-alarm-overlay';
  overlay.innerHTML =
    '<div id="manifest-alarm-card">' +
      '<span class="m-icon">✨</span>' +
      '<div class="m-title">Manifestation Moment</div>' +
      '<div class="m-sub">Close your eyes. Take a deep breath.<br>Feel your dream life as already yours.</div>' +
      '<div class="m-cd" id="manifest-cd">' + remaining + 's</div>' +
      '<button class="m-dismiss" onclick="manifestDismiss()">Dismiss</button>' +
    '</div>';
  document.body.appendChild(overlay);
  _alarm._cdTimer = setInterval(function() {
    remaining--;
    const el = document.getElementById('manifest-cd');
    if (el) el.textContent = remaining + 's';
    if (remaining <= 0) { clearInterval(_alarm._cdTimer); _alarm._cdTimer = null; }
  }, 1000);
}

function _hideAlarmOverlay() {
  if (_alarm._cdTimer) { clearInterval(_alarm._cdTimer); _alarm._cdTimer = null; }
  const ov = document.getElementById('manifest-alarm-overlay');
  if (ov) ov.remove();
}

function _updateManifestUI() {
  const start = document.getElementById('manifest-start-btn');
  const stop  = document.getElementById('manifest-stop-btn');
  if (start) start.style.display = _alarm.enabled ? 'none' : '';
  if (stop)  stop.style.display  = _alarm.enabled ? ''     : 'none';
  if (!_alarm.enabled) _setStatusBar('Not running', false);
}

function _setStatusBar(text, active) {
  const el = document.getElementById('manifest-status-bar');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('active', !!active);
}

function _saveManifestSettings() {
  localStorage.setItem('flow-manifest', JSON.stringify({
    intervalHours: _alarm.intervalHours,
    totalHours:    _alarm.totalHours,
    musicType:     _alarm.musicType,
    alarmDuration: _alarm.alarmDuration,
  }));
}

var _previewBtn   = null;
var _previewTimer = null;

function manifestPlaySound(type, btn) {
  _stopAlarmAudio();
  if (_previewTimer) { clearTimeout(_previewTimer); _previewTimer = null; }
  document.querySelectorAll('.mpill-play').forEach(function(b) { b.textContent = '▶'; b.classList.remove('playing'); });

  if (_previewBtn === btn) {
    _previewBtn = null;
    return;
  }

  _previewBtn = btn;
  btn.textContent = '■';
  btn.classList.add('playing');
  _playAlarmAudio(type, 20);
  _previewTimer = setTimeout(function() {
    btn.textContent = '▶';
    btn.classList.remove('playing');
    _previewBtn = null;
    _previewTimer = null;
  }, 20000);
}

function _loadManifestSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('flow-manifest') || '{}');
    if (s.intervalHours)            _alarm.intervalHours = s.intervalHours;
    if (s.totalHours !== undefined)  _alarm.totalHours    = s.totalHours;
    if (s.musicType)                _alarm.musicType     = s.musicType;
    if (s.alarmDuration)            _alarm.alarmDuration = s.alarmDuration;
    document.querySelectorAll('.mpill[data-group]').forEach(function(b) {
      var g = b.dataset.group, v = b.dataset.val;
      var active =
        g === 'interval' ? +v === _alarm.intervalHours :
        g === 'total'    ? +v === _alarm.totalHours    :
        g === 'music'    ?  v === _alarm.musicType     :
        g === 'dur'      ? +v === _alarm.alarmDuration : false;
      b.classList.toggle('active', active);
    });
  } catch (e) {}
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

  // File picker — multiple files
  document.getElementById('music-file-input')?.addEventListener('change', e => {
    Array.from(e.target.files).forEach(file => {
      _filePlaylist.push({ name: file.name, url: URL.createObjectURL(file) });
    });
    _renderFilePlaylist();
    // Auto-advance when track ends
    const audio = document.getElementById('music-audio');
    if (audio && !audio._playlistBound) {
      audio._playlistBound = true;
      audio.addEventListener('ended', () => {
        _fileIdx = (_fileIdx + 1) % _filePlaylist.length;
        _renderFilePlaylist();
        _startFile();
      });
    }
  });

  // YouTube URL — add on Enter
  document.getElementById('music-yt-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') musicYtAdd();
  });

  // Restore current queue and saved playlists on load
  _restoreCurrentYtQueue();
  _renderYtSaved();

  // Manifestation alarm — restore saved settings
  _loadManifestSettings();
});
