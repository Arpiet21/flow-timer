/* ── Meditation Timer ────────────────────────────────────────────────────── */
const MeditationTimer = (() => {
  let _mins       = 5;
  let _seconds    = 0;
  let _totalSecs  = 300;
  let _remaining  = 300;
  let _interval   = null;
  let _running    = false;
  let _breathPhase = 0; // 0=inhale 1=hold 2=exhale 3=hold
  let _breathInterval = null;
  const _breathCycle  = [
    { label: 'Inhale…',  secs: 4,  scale: 1.35 },
    { label: 'Hold…',    secs: 4,  scale: 1.35 },
    { label: 'Exhale…',  secs: 6,  scale: 1.0  },
    { label: 'Hold…',    secs: 2,  scale: 1.0  },
  ];

  function init() {
    _bindDurBtns();
    _bindControls();
    _bindSoundBtns();
    _updateDisplay();
  }

  function _bindDurBtns() {
    document.querySelectorAll('.med-dur-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (_running) return;
        document.querySelectorAll('.med-dur-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _mins     = parseInt(btn.dataset.mins);
        _totalSecs = _mins * 60;
        _remaining = _totalSecs;
        _updateDisplay();
      });
    });
  }

  function _bindControls() {
    document.getElementById('med-start-btn')?.addEventListener('click', () => {
      _running ? _pause() : _start();
    });
    document.getElementById('med-reset-btn')?.addEventListener('click', _reset);
  }

  function _bindSoundBtns() {
    document.querySelectorAll('.med-sound-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.med-sound-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  function _start() {
    _running = true;
    document.getElementById('med-start-btn').textContent = 'Pause';
    _startBreathCycle();
    _interval = setInterval(() => {
      _remaining--;
      _updateDisplay();
      if (_remaining <= 0) _complete();
    }, 1000);
  }

  function _pause() {
    _running = false;
    clearInterval(_interval);
    clearInterval(_breathInterval);
    document.getElementById('med-start-btn').textContent = 'Resume';
    document.getElementById('med-breath-label').textContent = 'Paused';
  }

  function _reset() {
    _running = false;
    clearInterval(_interval);
    clearInterval(_breathInterval);
    _remaining = _totalSecs;
    _breathPhase = 0;
    document.getElementById('med-start-btn').textContent = 'Start';
    document.getElementById('med-breath-label').textContent = 'Press Start to begin';
    const ring = document.getElementById('med-breath-ring');
    if (ring) { ring.style.transform = 'scale(1)'; ring.style.borderColor = 'var(--accent)'; }
    _updateDisplay();
  }

  function _complete() {
    _running = false;
    clearInterval(_interval);
    clearInterval(_breathInterval);
    document.getElementById('med-start-btn').textContent = 'Start';
    document.getElementById('med-breath-label').textContent = '🎉 Session complete!';
    const ring = document.getElementById('med-breath-ring');
    if (ring) ring.textContent = '🙏';
    // Log to Firebase
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      Auth.logSession('meditation', _mins);
    }
    _remaining = _totalSecs;
    setTimeout(_updateDisplay, 2000);
  }

  function _startBreathCycle() {
    _runBreathPhase();
    _breathInterval = setInterval(() => {
      _breathPhase = (_breathPhase + 1) % _breathCycle.length;
      _runBreathPhase();
    }, _breathCycle.reduce((acc, p) => acc + p.secs * 1000, 0) / _breathCycle.length);

    // More accurate: run each phase for its own duration
    clearInterval(_breathInterval);
    let phaseTimer = null;
    function nextPhase() {
      const phase = _breathCycle[_breathPhase];
      _runBreathPhase();
      phaseTimer = setTimeout(() => {
        _breathPhase = (_breathPhase + 1) % _breathCycle.length;
        if (_running) nextPhase();
      }, phase.secs * 1000);
    }
    nextPhase();
  }

  function _runBreathPhase() {
    const phase = _breathCycle[_breathPhase];
    const ring  = document.getElementById('med-breath-ring');
    const label = document.getElementById('med-breath-label');
    if (!ring || !label) return;
    ring.style.transform    = `scale(${phase.scale})`;
    ring.style.transition   = `transform ${phase.secs}s ease-in-out`;
    ring.style.borderColor  = phase.scale > 1 ? 'var(--accent)' : 'rgba(57,255,20,0.4)';
    ring.textContent        = phase.label;
    label.textContent       = phase.label;
  }

  function _updateDisplay() {
    const m = String(Math.floor(_remaining / 60)).padStart(2, '0');
    const s = String(_remaining % 60).padStart(2, '0');
    const el = document.getElementById('med-timer-display');
    if (el) el.textContent = `${m}:${s}`;
  }

  return { init };
})();
