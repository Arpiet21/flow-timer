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

function musicYtAdd() {
  const input = document.getElementById('music-yt-input');
  if (!input) return;
  const url     = input.value.trim();
  const videoId = _ytExtractId(url);
  if (!videoId) return;
  _ytPlaylist.push({ videoId, title: `Track ${_ytPlaylist.length + 1}` });
  input.value = '';
  _renderYtPlaylist();
  // Load YouTube API if not loaded
  if (!window.YT) _loadYtApi();
  else if (_ytPlayer) _ytPlayer.cueVideoById(_ytPlaylist[_ytIdx].videoId);
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
window.onYouTubeIframeAPIReady = function() {
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
        // Auto-advance to next track when current ends
        if (e.data === YT.PlayerState.ENDED) musicYtNext();
      },
      onReady: e => {
        e.target.setVolume(Math.round(MUSIC.volume * 100));
        if (MUSIC.enabled && MUSIC.mode === 'youtube') e.target.playVideo();
      }
    }
  });
};

function _startYoutube() {
  if (!_ytPlaylist.length) return;
  if (!window.YT || !_ytPlayer) { _loadYtApi(); return; }
  _ytPlayer.setVolume(Math.round((MUSIC.muted ? 0 : MUSIC.volume) * 100));
  _ytPlayer.playVideo();
}

function _pauseYoutube() {
  if (_ytPlayer) _ytPlayer.pauseVideo();
}

function _stopYoutube() {
  if (_ytPlayer) { _ytPlayer.stopVideo(); _ytPlayer.seekTo(0); }
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
  document.getElementById('music-youtube-section').classList.toggle('hidden', mode !== 'youtube');
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

  // Render saved YT playlists on load
  _renderYtSaved();
});
