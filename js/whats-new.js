/* ── What's New — short user-facing changelog ────────────────────────────────
   Static list of update batches, newest first. Reachable anytime via the 📣
   header icon; auto-shown once per batch (gated by localStorage, same
   "seen once" convention as flow-pwa-dismissed — this is informational only,
   not account state, so unlike the Hero Mode wizard it doesn't need to be
   account-wide in Firestore). Bump CURRENT_VERSION and add a new entry at
   the top of UPDATES to surface a new batch to everyone again. ── */
const WhatsNew = (() => {
  const SEEN_KEY = 'flow-whats-new-seen';

  const UPDATES = [
    {
      version: 'v1',
      date: 'November 2026',
      items: [
        '🎮 <strong>Hero Mode</strong> — turn focus time into XP, levels and streaks. Complete tasks and goals, do daily power-ups, and battle your personal "bad guys" (distractions) for coins to spend in a Rewards Shop.',
        '🏆 <strong>Milestone cards</strong> — every cumulative hour of focus now earns a shareable badge, from bronze (1 hour) up to legendary (1,000 hours).',
        '🎯 <strong>Goal Cascade fixes</strong> — the 7-level goal cascade now works end-to-end (a bug was stopping it past the first level), and you can now delete an entire cascade in one click.',
        '✅ <strong>Task Dashboard actions</strong> — mark tasks complete, delete them, or show completed ones, right from the dashboard table.',
        '⏱ <strong>End &amp; Log</strong> — stop a focus session early and still get credit for the real minutes worked, instead of losing them.',
        '♾️ <strong>Continuous Mode</strong> — optionally let the timer keep running past the planned time instead of auto-stopping, for sessions that run long.',
        '📝 <strong>Power-up notes</strong> — add unlimited, multi-line notes to any power-up (why it matters, how to do it).',
        '🎴 <strong>Prettier certificates</strong> — session and milestone cards now look like real achievement badges.',
      ],
    },
  ];

  function init() {
    document.getElementById('whats-new-btn')?.addEventListener('click', open);
    document.getElementById('whats-new-close-btn')?.addEventListener('click', close);
  }

  // Called separately from init() — and deliberately later, after the Hero
  // Mode onboarding wizard has had its chance to open (see index.html) —
  // so a brand-new account never gets two modals stacked on first login.
  // If the wizard is up, this just defers to next load rather than queuing
  // behind it, since announcing features the wizard is already introducing
  // would be redundant for a first-time user anyway.
  function maybeAutoShow() {
    if (localStorage.getItem(SEEN_KEY) === UPDATES[0].version) return;
    if (document.getElementById('hero-wizard-modal')?.style.display === 'flex') return;
    open();
  }

  function _render() {
    const body = document.getElementById('whats-new-body');
    if (!body) return;
    body.innerHTML = UPDATES.map(batch => `
      <div class="whats-new-batch">
        <div class="whats-new-batch-date">${batch.date}</div>
        <ul class="whats-new-list">
          ${batch.items.map(item => `<li>${item}</li>`).join('')}
        </ul>
      </div>
    `).join('');
  }

  function open() {
    const modal = document.getElementById('whats-new-modal');
    if (!modal) return;
    _render();
    modal.style.display = 'flex';
  }

  function close() {
    const modal = document.getElementById('whats-new-modal');
    if (modal) modal.style.display = 'none';
    localStorage.setItem(SEEN_KEY, UPDATES[0].version);
  }

  return { init, maybeAutoShow, open, close };
})();
