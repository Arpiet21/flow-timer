// ─── State ────────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  work: 25,
  short: 5,
  long: 15,
  sessionsBeforeLong: 4,
  soundEnabled: true,
  soundType: 'bell',
  notificationsEnabled: true,
  autoStart: false,
  clockType: 'analog',
  accentColor: '#39ff14'
};

let state = {
  mode: 'work',
  status: 'idle',
  timeLeft: 0,
  totalTime: 0,
  session: 1,
  theme: 'dark',
  task: '',
  settings: { ...DEFAULT_SETTINGS }
};

let tickInterval = null;
let pipWindow = null;

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  loadFromStorage();
  applyTheme();
  applyAccentColor();
  applyClockType();
  resetTimer();
  renderSessionDots();
  bindEvents();
  registerServiceWorker();
  updateSettingsUI();
  updatePresetUI();
  loadHistory();
}

function loadFromStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem('flow-timer-state') || '{}');
    if (saved.settings) state.settings = { ...DEFAULT_SETTINGS, ...saved.settings };
    if (saved.theme)   state.theme = saved.theme;
    if (saved.session) state.session = saved.session;
    if (saved.task)    state.task = saved.task;
  } catch (_) {}
}

function saveToStorage() {
  localStorage.setItem('flow-timer-state', JSON.stringify({
    settings: state.settings,
    theme: state.theme,
    session: state.session,
    task: state.task
  }));
}

// ─── Timer Logic ──────────────────────────────────────────────────────────────
function getDuration(mode) {
  return (mode === 'work' ? state.settings.work
    : mode === 'short' ? state.settings.short
    : state.settings.long) * 60;
}

function resetTimer() {
  clearInterval(tickInterval);
  tickInterval = null;
  state.status = 'idle';
  state.totalTime = getDuration(state.mode);
  state.timeLeft = state.totalTime;
  renderTimer();
  updateStartBtn();
  if (typeof musicStop === 'function') musicStop();
}

function setFocusAssist(on) {
  if (window.electronAPI && localStorage.getItem('blockNotifications') === 'true') {
    window.electronAPI.focusAssist(on);
  }
}

function startTimer() {
  if (state.status === 'running') return;
  state.status = 'running';
  updateStartBtn();
  tickInterval = setInterval(tick, 1000);
  setFocusAssist(true);
  if (typeof musicStart === 'function') musicStart();
}

function pauseTimer() {
  if (state.status !== 'running') return;
  clearInterval(tickInterval);
  state.status = 'paused';
  updateStartBtn();
  setFocusAssist(false);
  if (typeof musicPause === 'function') musicPause();
}

function tick() {
  state.timeLeft--;
  renderTimer();
  syncPip();
  if (state.timeLeft <= 0) {
    clearInterval(tickInterval);
    onTimerEnd();
  }
}

function onTimerEnd() {
  state.status = 'idle';
  playAlarm();
  sendNotification();

  if (state.mode === 'work') {
    // Log to Supabase
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      Auth.logSession(state.mode, state.settings.work);
    }
    // Save to local history
    addLocalHistory(state.mode, state.settings.work, state.task);

    state.session++;
    if (state.session > state.settings.sessionsBeforeLong) state.session = 1;
    saveToStorage();
    renderSessionDots();
    loadHistory();

    const nextMode = state.session === 1 ? 'long' : 'short';
    switchMode(nextMode, state.settings.autoStart);
  } else {
    switchMode('work', state.settings.autoStart);
  }
}

// ─── Mode ─────────────────────────────────────────────────────────────────────
function switchMode(mode, auto = false) {
  state.mode = mode;
  document.querySelectorAll('#flow-section .mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  resetTimer();
  updatePresetUI();
  if (auto) startTimer();
}

// ─── Clock Type ───────────────────────────────────────────────────────────────
function applyClockType() {
  const type = state.settings.clockType;
  document.getElementById('analog-wrap').classList.toggle('hidden', type !== 'analog');
  document.getElementById('digital-wrap').classList.toggle('hidden', type !== 'digital');
  document.querySelectorAll('.clock-type-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.clock === type)
  );
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderTimer() {
  const mins = Math.floor(state.timeLeft / 60).toString().padStart(2, '0');
  const secs = (state.timeLeft % 60).toString().padStart(2, '0');
  const timeStr = `${mins}:${secs}`;

  document.getElementById('time-display-analog').textContent = timeStr;
  document.getElementById('time-display-digital').textContent = timeStr;

  // Update page title
  document.title = `${timeStr} — Flow Timer`;

  // Analog clock
  drawAnalogClock(document.getElementById('main-clock'), state.timeLeft, state.totalTime);

  // Digital progress bar
  const pct = state.totalTime > 0 ? (state.timeLeft / state.totalTime) * 100 : 100;
  const fill = document.getElementById('digital-progress-fill');
  if (fill) fill.style.width = `${pct}%`;
}

function drawAnalogClock(canvas, timeLeft, totalTime) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const r = Math.min(cx, cy) - 6;
  const isDark = state.theme === 'dark';
  const color = modeColor();
  const faceR = r - 12;
  const progress = totalTime > 0 ? timeLeft / totalTime : 0;

  ctx.clearRect(0, 0, W, H);

  // ── Outer metallic ring ────────────────────────────────────────────────────
  const ringGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ringGrad.addColorStop(0,   isDark ? '#606070' : '#d8d8d8');
  ringGrad.addColorStop(0.5, isDark ? '#252530' : '#909090');
  ringGrad.addColorStop(1,   isDark ? '#505060' : '#c0c0c0');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = ringGrad;
  ctx.fill();

  // ── White clock face ───────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? '#dde0e8' : '#f8f8f8';
  ctx.fill();

  // ── Filled sector (remaining time) ────────────────────────────────────────
  if (progress > 0.002) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, faceR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.88;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ── Face inner border ─────────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.strokeStyle = isDark ? '#aaa' : '#bbb';
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Scale: 12 evenly-spaced labels, values depend on duration ────────────
  const totalMins = totalTime / 60;
  const labels = totalMins > 60
    ? [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80]   // 90-min scale
    : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];  // 60-min scale

  // ── Tick marks (60 evenly spaced, major every 5) ──────────────────────────
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const isMajor = i % 5 === 0;
    const outerR = faceR - 2;
    const innerR = faceR - (isMajor ? 14 : 7);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
    ctx.lineTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
    ctx.strokeStyle = '#333';
    ctx.lineWidth = isMajor ? 2 : 1;
    ctx.stroke();
  }

  // ── Numbers (12 evenly spaced) ────────────────────────────────────────────
  const fontSize = Math.max(10, Math.round(r * 0.115));
  ctx.font = `700 ${fontSize}px 'Segoe UI', system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#111';
  labels.forEach((num, i) => {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const nr = faceR - 24;
    ctx.fillText(num.toString(), cx + Math.cos(angle) * nr, cy + Math.sin(angle) * nr);
  });

  // ── Center knob ───────────────────────────────────────────────────────────
  // Drop shadow
  ctx.beginPath();
  ctx.arc(cx + 2, cy + 3, 20, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();
  // Knob body
  const knobGrad = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 20);
  knobGrad.addColorStop(0, '#f0f0f0');
  knobGrad.addColorStop(0.6, '#c0c0c0');
  knobGrad.addColorStop(1, '#888');
  ctx.beginPath();
  ctx.arc(cx, cy, 20, 0, Math.PI * 2);
  ctx.fillStyle = knobGrad;
  ctx.fill();
  // Knob rim
  ctx.beginPath();
  ctx.arc(cx, cy, 20, 0, Math.PI * 2);
  ctx.strokeStyle = '#777';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Highlight
  ctx.beginPath();
  ctx.arc(cx - 5, cy - 5, 6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
}

function updatePresetUI() {
  const presets = document.getElementById('duration-presets');
  if (!presets) return;
  presets.classList.toggle('hidden', state.mode !== 'work');
  document.querySelectorAll('.preset-btn').forEach(btn =>
    btn.classList.toggle('active', parseInt(btn.dataset.mins) === state.settings.work)
  );
}

function modeColor() {
  return state.mode === 'work' ? state.settings.accentColor : state.mode === 'short' ? '#0f9b8e' : '#4a90d9';
}

function renderSessionDots() {
  const container = document.getElementById('session-dots');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 1; i <= state.settings.sessionsBeforeLong; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot' + (i < state.session ? ' done' : i === state.session ? ' active' : '');
    container.appendChild(dot);
  }
}

function updateStartBtn() {
  const btn = document.getElementById('start-btn');
  if (!btn) return;
  btn.textContent = state.status === 'running' ? 'Pause'
    : state.status === 'paused' ? 'Resume' : 'Start';
  btn.dataset.action = state.status === 'running' ? 'pause' : 'start';
}

function updateSettingsUI() {
  const s = state.settings;
  setSlider('work-slider', 'work-val', s.work, v => `${v} min`);
  setSlider('short-slider', 'short-val', s.short, v => `${v} min`);
  setSlider('long-slider', 'long-val', s.long, v => `${v} min`);
  setSlider('sessions-slider', 'sessions-val', s.sessionsBeforeLong, v => `${v}`);
  document.getElementById('sound-toggle').checked = s.soundEnabled;
  document.getElementById('notif-toggle').checked = s.notificationsEnabled;
  document.getElementById('autostart-toggle').checked = s.autoStart;
  document.querySelectorAll('.sound-opt').forEach(b =>
    b.classList.toggle('active', b.dataset.sound === s.soundType)
  );
  document.getElementById('sound-val').textContent = s.soundType.charAt(0).toUpperCase() + s.soundType.slice(1);
  // Color swatches
  document.querySelectorAll('.color-swatch').forEach(b =>
    b.classList.toggle('active', b.dataset.color === s.accentColor)
  );
  // Task input
  const taskInput = document.getElementById('task-input');
  if (taskInput) taskInput.value = state.task || '';
}

function setSlider(sliderId, valId, value, format) {
  const slider = document.getElementById(sliderId);
  const val = document.getElementById(valId);
  if (slider) slider.value = value;
  if (val) val.textContent = format(value);
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyAccentColor() {
  const color = state.settings.accentColor;
  document.documentElement.style.setProperty('--accent', color);
  // Update pip window too
  if (pipWindow) {
    const doc = pipWindow._popup ? pipWindow._popup.document : pipWindow.document;
    doc?.documentElement?.style.setProperty('--accent', color);
  }
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = state.theme === 'dark' ? '☀' : '☾';
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  saveToStorage();
  renderTimer();
}

// ─── History ──────────────────────────────────────────────────────────────────
function addLocalHistory(mode, minutes, task) {
  const history = getLocalHistory();
  history.unshift({
    mode, minutes, task: task || '',
    completedAt: new Date().toISOString()
  });
  localStorage.setItem('flow-timer-history', JSON.stringify(history.slice(0, 100)));
}

function getLocalHistory() {
  try { return JSON.parse(localStorage.getItem('flow-timer-history') || '[]'); }
  catch (_) { return []; }
}

function loadHistory() {
  const list = document.getElementById('history-list');
  if (!list) return;
  const history = getLocalHistory();

  if (!history.length) {
    list.innerHTML = '<p class="history-empty">No sessions yet. Start your first session!</p>';
    return;
  }

  // Group by date
  const grouped = {};
  history.forEach(h => {
    const date = new Date(h.completedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(h);
  });

  list.innerHTML = Object.entries(grouped).map(([date, items]) => `
    <div class="history-date-group">
      <div class="history-date">${date} <span>${items.filter(i => i.mode === 'work').length} 🍅</span></div>
      ${items.map(h => `
        <div class="history-item history-${h.mode}">
          <div class="history-item-left">
            <span class="history-mode-dot"></span>
            <span class="history-mode-label">${h.mode === 'work' ? 'Focus' : h.mode === 'short' ? 'Short Break' : 'Long Break'}</span>
            ${h.task ? `<span class="history-task">"${h.task}"</span>` : ''}
          </div>
          <div class="history-item-right">
            <span class="history-duration">${h.minutes}m</span>
            <span class="history-time">${new Date(h.completedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ─── PiP Widget ───────────────────────────────────────────────────────────────
async function openPip() {
  if ('documentPictureInPicture' in window) {
    try {
      const isDigital = state.settings.clockType === 'digital';
      pipWindow = await window.documentPictureInPicture.requestWindow({
        width:  isDigital ? 160 : 220,
        height: isDigital ? 160 : 280
      });
      // Inline styles — no fetch needed (works with file:// too)
      const style = pipWindow.document.createElement('style');
      style.textContent = PIP_STYLES;
      pipWindow.document.head.appendChild(style);
      pipWindow.document.body.innerHTML = PIP_HTML;
      pipWindow.document.body.setAttribute('data-theme', state.theme);
      initPipControls(pipWindow);
      syncPip();
      pipWindow.addEventListener('pagehide', () => { pipWindow = null; updatePipBtn(); });
      updatePipBtn();
    } catch (_) { fallbackPopup(); }
  } else {
    fallbackPopup();
  }
}

const PIP_HTML = `
  <span id="pip-mode">Focus</span>
  <div id="pip-analog-wrap">
    <canvas id="pip-clock" width="150" height="150"></canvas>
  </div>
  <div id="pip-digital-wrap" style="display:none">
    <span id="pip-time-big">25:00</span>
  </div>
  <span id="pip-task"></span>
  <div class="pip-controls">
    <button class="pip-btn" id="pip-clock-toggle" title="Toggle analog/digital">⏱</button>
    <button class="pip-btn" id="pip-play" title="Play/Pause">▶</button>
    <button class="pip-btn" id="pip-reset" title="Reset">↺</button>
  </div>`;

const PIP_STYLES = `
  :root{--bg:#1a1a2e;--surface:#16213e;--text:#eaeaea;--text-muted:#888;--border:#2a2a4a}
  [data-theme="light"]{--bg:#f5f5f5;--surface:#fff;--text:#1a1a2e;--text-muted:#666;--border:#ddd}
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);
    width:100vw;height:100vh;min-width:120px;overflow:hidden;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:4px;user-select:none}
  #pip-mode{font-size:.65rem;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-muted)}
  #pip-analog-wrap{display:flex;align-items:center;justify-content:center}
  #pip-clock{display:block;width:min(150px,80vmin);height:min(150px,80vmin)}
  #pip-digital-wrap{display:flex;align-items:center;justify-content:center;padding:6px 0}
  #pip-time-big{font-size:clamp(1.6rem,14vw,2.2rem);font-weight:800;letter-spacing:1px;font-variant-numeric:tabular-nums;color:var(--text)}
  #pip-task{font-size:.6rem;color:#888;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
  .pip-controls{display:flex;gap:6px}
  .pip-btn{width:30px;height:30px;border-radius:50%;border:1px solid var(--border);
    background:var(--surface);color:var(--text);font-size:.8rem;cursor:pointer;
    display:flex;align-items:center;justify-content:center;transition:background .2s,transform .1s}
  .pip-btn:hover{transform:scale(1.1);background:var(--border)}`;

function fallbackPopup() {
  const popup = window.open('', 'flow-timer-pip',
    `width=${state.settings.clockType === 'digital' ? 160 : 220},height=${state.settings.clockType === 'digital' ? 160 : 280},resizable=no,scrollbars=no,toolbar=no,menubar=no,location=no,status=no`
  );
  if (!popup) return;
  // Write content directly — no file load needed
  const style = popup.document.createElement('style');
  style.textContent = PIP_STYLES;
  popup.document.head.appendChild(style);
  popup.document.body.innerHTML = PIP_HTML;
  popup.document.body.setAttribute('data-theme', state.theme);
  pipWindow = { _popup: popup };
  initPipControls(pipWindow);
  syncPip();
  popup.addEventListener('beforeunload', () => { pipWindow = null; updatePipBtn(); });
  updatePipBtn();
}

function closePip() {
  if (!pipWindow) return;
  if (pipWindow._popup) pipWindow._popup.close();
  else if (pipWindow.close) pipWindow.close();
  pipWindow = null;
  updatePipBtn();
}

function updatePipBtn() {
  const btn = document.getElementById('pip-btn');
  if (btn) btn.textContent = pipWindow ? 'Close Widget' : 'Float Widget';
}

function initPipControls(win) {
  const doc = win._popup ? win._popup.document : win.document;
  const wnd = win._popup || win;
  doc.getElementById('pip-play')?.addEventListener('click', () => { toggleStartPause(); syncPip(); });
  doc.getElementById('pip-reset')?.addEventListener('click', () => { resetTimer(); syncPip(); });
  doc.getElementById('pip-clock-toggle')?.addEventListener('click', () => {
    state.settings.clockType = state.settings.clockType === 'analog' ? 'digital' : 'analog';
    saveToStorage();
    applyClockType();
    syncPip();
  });
  // Auto-switch to digital when widget is resized small
  wnd.addEventListener('resize', () => syncPip());
}

function syncPip() {
  if (!pipWindow) return;
  const doc = pipWindow._popup ? pipWindow._popup.document : pipWindow.document;
  const wnd = pipWindow._popup || pipWindow;
  const mins = Math.floor(state.timeLeft / 60).toString().padStart(2, '0');
  const secs = (state.timeLeft % 60).toString().padStart(2, '0');
  // Auto-switch: if pip window is too small to show analog, force digital
  const pipW = wnd.innerWidth  || 220;
  const pipH = wnd.innerHeight || 280;
  const isAnalog = state.settings.clockType === 'analog' && pipW >= 150 && pipH >= 150;

  const modeEl    = doc.getElementById('pip-mode');
  const taskEl    = doc.getElementById('pip-task');
  const playBtn   = doc.getElementById('pip-play');
  const toggleBtn = doc.getElementById('pip-clock-toggle');
  const analogWrap  = doc.getElementById('pip-analog-wrap');
  const digitalWrap = doc.getElementById('pip-digital-wrap');
  const timeBigEl   = doc.getElementById('pip-time-big');
  const canvas      = doc.getElementById('pip-clock');

  if (modeEl)    modeEl.textContent = state.mode === 'work' ? 'Focus' : state.mode === 'short' ? 'Short Break' : 'Long Break';
  if (taskEl)    taskEl.textContent = state.task || '';
  if (playBtn)   playBtn.textContent = state.status === 'running' ? '⏸' : '▶';
  if (toggleBtn) toggleBtn.textContent = isAnalog ? '⏱' : '🕐';
  if (timeBigEl) timeBigEl.textContent = `${mins}:${secs}`;
  if (analogWrap)  analogWrap.style.display  = isAnalog ? 'flex' : 'none';
  if (digitalWrap) digitalWrap.style.display = isAnalog ? 'none' : 'flex';
  doc.body?.setAttribute('data-theme', state.theme);
  doc.documentElement?.style.setProperty('--accent', state.settings.accentColor);
  if (isAnalog && canvas) drawPipClock(canvas);
}

function drawPipClock(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const r = Math.min(cx, cy) - 4;
  const isDark = state.theme === 'dark';
  const color = modeColor();
  const progress = state.totalTime > 0 ? state.timeLeft / state.totalTime : 0;
  const faceR = r - 8;

  ctx.clearRect(0, 0, W, H);

  // Outer metallic ring
  const ringGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  ringGrad.addColorStop(0,   isDark ? '#606070' : '#d8d8d8');
  ringGrad.addColorStop(0.5, isDark ? '#252530' : '#909090');
  ringGrad.addColorStop(1,   isDark ? '#505060' : '#c0c0c0');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = ringGrad;
  ctx.fill();

  // White clock face
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? '#dde0e8' : '#f8f8f8';
  ctx.fill();

  // Filled sector
  if (progress > 0.002) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, faceR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.88;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Face border
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  ctx.strokeStyle = isDark ? '#aaa' : '#bbb';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Scale: 12 evenly-spaced labels, values depend on duration
  const totalMins = state.totalTime / 60;
  const labels = totalMins > 60
    ? [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80]
    : [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  // Tick marks (60 evenly spaced)
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const isMajor = i % 5 === 0;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * (faceR - 1), cy + Math.sin(angle) * (faceR - 1));
    ctx.lineTo(cx + Math.cos(angle) * (faceR - (isMajor ? 9 : 5)), cy + Math.sin(angle) * (faceR - (isMajor ? 9 : 5)));
    ctx.strokeStyle = '#333';
    ctx.lineWidth = isMajor ? 1.5 : 0.8;
    ctx.stroke();
  }

  // Numbers (12 evenly spaced)
  const fontSize = Math.max(7, Math.round(r * 0.12));
  ctx.font = `700 ${fontSize}px 'Segoe UI',system-ui,sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#111';
  labels.forEach((num, i) => {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    ctx.fillText(num.toString(), cx + Math.cos(angle) * (faceR - 17), cy + Math.sin(angle) * (faceR - 17));
  });

  // Center knob
  ctx.beginPath();
  ctx.arc(cx + 1, cy + 2, 12, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fill();
  const knobGrad = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, 12);
  knobGrad.addColorStop(0, '#f0f0f0');
  knobGrad.addColorStop(0.6, '#c0c0c0');
  knobGrad.addColorStop(1, '#888');
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.fillStyle = knobGrad;
  ctx.fill();
  ctx.strokeStyle = '#777';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - 3, cy - 3, 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fill();
}

// ─── Sound ────────────────────────────────────────────────────────────────────
function playAlarm() {
  if (!state.settings.soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sounds = {
      bell: () => {
        [0, 0.4, 0.8].forEach(delay => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'sine'; osc.frequency.value = 830;
          gain.gain.setValueAtTime(0.5, ctx.currentTime + delay);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.8);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + 0.8);
        });
      },
      beep: () => {
        [0, 0.15, 0.3].forEach(delay => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'square'; osc.frequency.value = 440;
          gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
          gain.gain.setValueAtTime(0, ctx.currentTime + delay + 0.1);
          osc.start(ctx.currentTime + delay);
          osc.stop(ctx.currentTime + delay + 0.1);
        });
      },
      chime: () => {
        [523, 659, 784, 1047].forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.type = 'sine'; osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.4, ctx.currentTime + i * 0.2);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.2 + 0.6);
          osc.start(ctx.currentTime + i * 0.2);
          osc.stop(ctx.currentTime + i * 0.2 + 0.6);
        });
      },
      digital: () => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sawtooth'; osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + 0.05);
        gain.gain.setValueAtTime(0, ctx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0, ctx.currentTime + 0.13);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + 0.19);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
      }
    };
    (sounds[state.settings.soundType] || sounds.bell)();
  } catch (_) {}
}

function previewSound(type) {
  const prev = state.settings.soundType;
  state.settings.soundType = type;
  playAlarm();
  state.settings.soundType = prev;
}

// ─── Notifications ────────────────────────────────────────────────────────────
function sendNotification() {
  if (!state.settings.notificationsEnabled || Notification.permission !== 'granted') return;
  const title = state.mode === 'work' ? 'Time for a break!' : 'Back to focus!';
  const body = state.mode === 'work'
    ? `Session ${state.session} complete.${state.task ? ` (${state.task})` : ''}`
    : 'Break over. Start your next session.';
  new Notification(title, { body, icon: 'assets/icon-192.png' });
}

async function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────
function toggleStartPause() {
  if (state.status === 'running') pauseTimer();
  else startTimer();
}

function bindEvents() {
  document.getElementById('start-btn').addEventListener('click', toggleStartPause);
  document.getElementById('reset-btn').addEventListener('click', resetTimer);
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  document.getElementById('pip-btn').addEventListener('click', () => pipWindow ? closePip() : openPip());

  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-card').classList.toggle('hidden');
    document.getElementById('history-card').classList.add('hidden');
  });

  document.getElementById('history-btn').addEventListener('click', () => {
    document.getElementById('history-card').classList.toggle('hidden');
    document.getElementById('settings-card').classList.add('hidden');
    loadHistory();
  });

  // Mode tabs
  document.querySelectorAll('#flow-section .mode-btn').forEach(btn =>
    btn.addEventListener('click', () => switchMode(btn.dataset.mode))
  );

  // Clock type toggle
  document.querySelectorAll('.clock-type-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      state.settings.clockType = btn.dataset.clock;
      applyClockType();
      saveToStorage();
    })
  );

  // Task input
  document.getElementById('task-input').addEventListener('input', e => {
    state.task = e.target.value;
    saveToStorage();
  });

  // Color swatches
  document.querySelectorAll('.color-swatch').forEach(btn =>
    btn.addEventListener('click', () => {
      state.settings.accentColor = btn.dataset.color;
      applyAccentColor();
      saveToStorage();
      document.querySelectorAll('.color-swatch').forEach(b =>
        b.classList.toggle('active', b === btn)
      );
      renderTimer(); // redraw clock with new color
    })
  );

  // Duration presets
  document.querySelectorAll('.preset-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const mins = parseInt(btn.dataset.mins);
      state.settings.work = mins;
      if (state.mode === 'work') resetTimer();
      saveToStorage();
      updatePresetUI();
      setSlider('work-slider', 'work-val', mins, v => `${v} min`);
    })
  );

  // Sound options
  document.querySelectorAll('.sound-opt').forEach(btn =>
    btn.addEventListener('click', () => {
      state.settings.soundType = btn.dataset.sound;
      document.querySelectorAll('.sound-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('sound-val').textContent = btn.dataset.sound.charAt(0).toUpperCase() + btn.dataset.sound.slice(1);
      previewSound(btn.dataset.sound);
      saveToStorage();
    })
  );

  // Sliders
  bindSlider('work-slider', 'work-val', v => {
    state.settings.work = v;
    if (state.mode === 'work') resetTimer();
    saveToStorage();
    updatePresetUI();
  }, v => `${v} min`);

  bindSlider('short-slider', 'short-val', v => {
    state.settings.short = v;
    if (state.mode === 'short') resetTimer();
    saveToStorage();
  }, v => `${v} min`);

  bindSlider('long-slider', 'long-val', v => {
    state.settings.long = v;
    if (state.mode === 'long') resetTimer();
    saveToStorage();
  }, v => `${v} min`);

  bindSlider('sessions-slider', 'sessions-val', v => {
    state.settings.sessionsBeforeLong = v;
    state.session = 1;
    renderSessionDots();
    saveToStorage();
  }, v => `${v}`);

  document.getElementById('sound-toggle').addEventListener('change', e => {
    state.settings.soundEnabled = e.target.checked;
    saveToStorage();
  });

  document.getElementById('notif-toggle').addEventListener('change', async e => {
    state.settings.notificationsEnabled = e.target.checked;
    if (e.target.checked) await requestNotificationPermission();
    saveToStorage();
  });

  document.getElementById('autostart-toggle').addEventListener('change', e => {
    state.settings.autoStart = e.target.checked;
    saveToStorage();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (window.activeTimerMode && window.activeTimerMode !== 'work') return;
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); toggleStartPause(); }
    if (e.code === 'KeyR') resetTimer();
    if (e.code === 'KeyT') toggleTheme();
    if (e.code === 'KeyS') {
      document.getElementById('settings-card').classList.toggle('hidden');
      document.getElementById('history-card').classList.add('hidden');
    }
    if (e.code === 'KeyH') {
      document.getElementById('history-card').classList.toggle('hidden');
      document.getElementById('settings-card').classList.add('hidden');
      loadHistory();
    }
  });
}

function bindSlider(sliderId, valId, onChange, format) {
  const slider = document.getElementById(sliderId);
  const valEl = document.getElementById(valId);
  if (!slider) return;
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value);
    if (valEl) valEl.textContent = format(v);
    onChange(v);
  });
}

// ─── Service Worker ───────────────────────────────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', init);
