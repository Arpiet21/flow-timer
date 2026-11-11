/* ── Strength Score Card ─────────────────────────────────────────────────────
   Logs your best lifts (Squat/Bench/Deadlift/Overhead Press) + bodyweight and
   computes a simple relative-strength score: total lifted ÷ bodyweight.
   Score/level thresholds are a rough approximation for now — placeholder until
   a fuller scoring spec is provided. History is saved to Firestore so progress
   over time is visible, same pattern as the Focus Activity heatmap. ── */
const StrengthScoreCard = (() => {
  const LEVELS = [
    { max: 1.5, label: 'Beginner',     color: '#8a8a8a' },
    { max: 2.5, label: 'Novice',       color: '#39ff14' },
    { max: 3.5, label: 'Intermediate', color: '#00d4ff' },
    { max: 4.5, label: 'Advanced',     color: '#a78bfa' },
    { max: Infinity, label: 'Elite',   color: '#ffb703' },
  ];

  function init() {
    _bindSubmit();
    _loadHistory();
  }

  function _bindSubmit() {
    document.getElementById('str-save-btn')?.addEventListener('click', _submit);
  }

  function _num(id) {
    const v = parseFloat(document.getElementById(id).value);
    return isNaN(v) || v <= 0 ? null : v;
  }

  function _levelFor(ratio) {
    return LEVELS.find(l => ratio <= l.max);
  }

  async function _submit() {
    const bodyweight = _num('str-bodyweight');
    const lifts = {
      squat:     _num('str-squat'),
      bench:     _num('str-bench'),
      deadlift:  _num('str-deadlift'),
      ohp:       _num('str-ohp'),
    };
    const statusEl = document.getElementById('str-status');

    if (!bodyweight) {
      if (statusEl) statusEl.textContent = 'Enter your bodyweight to compute a score.';
      return;
    }
    const enteredLifts = Object.entries(lifts).filter(([, v]) => v != null);
    if (enteredLifts.length === 0) {
      if (statusEl) statusEl.textContent = 'Enter at least one lift (Squat, Bench, Deadlift, or Overhead Press).';
      return;
    }

    const total = enteredLifts.reduce((sum, [, v]) => sum + v, 0);
    const ratio = total / bodyweight;
    const level = _levelFor(ratio);

    const entry = { bodyweight, ...lifts, total, ratio, level: level.label };
    _renderCurrent(entry);

    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      await Auth.saveStrengthEntry(entry);
      _loadHistory();
    }
    if (statusEl) statusEl.textContent = 'Saved.';
  }

  function _renderCurrent(entry) {
    const scoreEl = document.getElementById('str-score');
    const levelEl = document.getElementById('str-level');
    const totalEl = document.getElementById('str-total');
    if (scoreEl) scoreEl.textContent = entry.ratio.toFixed(2) + '×';
    if (totalEl) totalEl.textContent = `${entry.total} kg total ÷ ${entry.bodyweight} kg bodyweight`;
    if (levelEl) {
      const level = LEVELS.find(l => l.label === entry.level) || LEVELS[0];
      levelEl.textContent = level.label;
      levelEl.style.color = level.color;
      levelEl.style.borderColor = level.color;
    }
  }

  async function _loadHistory() {
    const listEl = document.getElementById('str-history-list');
    if (!listEl) return;
    if (!(typeof Auth !== 'undefined' && Auth.isLoggedIn())) {
      listEl.innerHTML = '<p class="history-empty">Sign in to save your strength history.</p>';
      return;
    }
    const entries = await Auth.getStrengthHistory(20);
    if (!entries.length) {
      listEl.innerHTML = '<p class="history-empty">No entries yet. Log your first lifts above.</p>';
      return;
    }
    // Most recent becomes the "current" display
    _renderCurrent(entries[0]);

    listEl.innerHTML = entries.map(e => {
      const date = new Date(e.logged_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const level = LEVELS.find(l => l.label === e.level) || LEVELS[0];
      return `
        <div class="str-history-item">
          <div class="str-history-date">${date}</div>
          <div class="str-history-ratio" style="color:${level.color}">${e.ratio.toFixed(2)}× · ${e.level}</div>
          <div class="str-history-detail">${e.total} kg / ${e.bodyweight} kg BW</div>
        </div>`;
    }).join('');
  }

  return { init, refresh: _loadHistory };
})();
