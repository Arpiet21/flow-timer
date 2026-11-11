/* ── Hero Mode — UI layer (HUD, toasts, modals, quest board, power-ups,
   bad guys, rewards shop, secret identity, onboarding wizard, stats) ───────
   All rendering only — js/hero.js owns the data/Firestore engine. Containers
   are pre-declared in index.html (display:none) and populated here, following
   the same pattern as js/certificate.js. See GAME_LAYER_NOTES.md. ── */
const GameHUD = (() => {
  let _bound = false;
  let _activeTab = 'powerups';
  let _wizardStep = 1;
  let _wizardData = null;

  const DEFAULT_POWERUPS = [
    { name: 'Drink water',     emoji: '💧' },
    { name: '10-min walk',    emoji: '🚶' },
    { name: 'Stretch',         emoji: '🧘' },
    { name: 'Sunlight',        emoji: '☀️' },
    { name: 'One song break', emoji: '🎵' },
    { name: 'Phone away',      emoji: '📵' },
  ];
  const BADGUY_TEMPLATES = [
    { name: 'Doomscroll Demon',       emoji: '📱', counterMove: 'Phone in another room' },
    { name: 'Snooze Goblin',          emoji: '😴', counterMove: 'Alarm across the room' },
    { name: 'Perfectionism Phantom',  emoji: '👻', counterMove: 'Ship the rough draft' },
  ];

  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    if (typeof GameLayer === 'undefined' || typeof Auth === 'undefined' || !Auth.isLoggedIn()) return;
    if (!_bound) {
      _bound = true;
      GameLayer.onChange((evt, data) => _onGameEvent(evt, data));
      _bindStaticControls();
    }
    await _ensureDefaultsIfFirstTime();
    await _refreshAll();
    await _maybeShowWizardPrompt();
  }

  function _bindStaticControls() {
    document.getElementById('hero-mode-btn')?.addEventListener('click', _openPanel);
    document.getElementById('hero-panel-close-btn')?.addEventListener('click', _closePanel);
    document.querySelectorAll('.hero-panel-tab').forEach(btn => {
      btn.addEventListener('click', () => _switchPanelTab(btn.dataset.tab));
    });
    document.getElementById('hero-mode-toggle')?.addEventListener('change', async (e) => {
      await GameLayer.setEnabled(e.target.checked);
      await _refreshAll();
    });
    document.getElementById('hero-levelup-close-btn')?.addEventListener('click', () => {
      document.getElementById('hero-levelup-modal').style.display = 'none';
    });
    document.getElementById('hero-epicwin-close-btn')?.addEventListener('click', () => {
      document.getElementById('hero-epicwin-modal').style.display = 'none';
    });
    document.getElementById('hero-wizard-skip-btn')?.addEventListener('click', _skipWizard);
    document.getElementById('hero-wizard-next-btn')?.addEventListener('click', _wizardNext);
  }

  function _onGameEvent(evt, data) {
    if (evt === 'award') {
      const { type, result, payload } = data;
      if (!result) { _refreshAll(); return; } // capped/no-op award — counters may still have shifted elsewhere
      if (result.newLevel > result.oldLevel) {
        _showLevelUp(result);
      } else if (type === 'goal' && result.meta && result.meta.epicWin) {
        _showEpicWin(result, payload);
      } else if (type === 'boss_defeat') {
        _showPlainToast(`👾 ${(payload && payload.badGuyName) || 'Demon'} defeated! +${result.xp} XP`);
      } else if (result.xp) {
        _showXpToast(result.xp);
      }
      _refreshAll();
      _refreshOpenPanelTab();
    } else if (evt === 'superbetterDay') {
      _showPlainToast('🎉 SuperBetter Day! +50 XP');
      _refreshAll();
    } else {
      _refreshAll(); // revoke / enabledChanged / identityChanged / challengeChanged / redeemed / streakEvaluated
    }
  }

  // Re-renders whichever Hero Panel tab is currently open, if the panel is
  // visible — so e.g. a bad guy's HP bar updates live from a task completed
  // elsewhere, not only when the tab is next switched to.
  function _refreshOpenPanelTab() {
    const modal = document.getElementById('hero-panel-modal');
    if (modal && modal.style.display === 'flex') _switchPanelTab(_activeTab);
  }

  // ── HUD bar + Quest Board + power-up chips + challenge banner ───────────────
  async function _refreshAll() {
    const profile = await GameLayer.getProfile();
    const toggle = document.getElementById('hero-mode-toggle');
    if (toggle) toggle.checked = !profile || profile.enabled !== false;

    const hud = document.getElementById('hero-hud');
    if (!hud) return;
    if (!profile || profile.enabled === false) {
      hud.style.display = 'none';
      _hideBelowHud();
      return;
    }
    hud.style.display = 'flex';

    const { level, currentLevelXp, neededXp } = GameLayer.xpForNextLevel(profile.totalXp || 0);
    const title = GameLayer.titleForLevel(level);
    const nameEl = document.getElementById('hero-hud-name');
    const levelEl = document.getElementById('hero-hud-level');
    const fillEl = document.getElementById('hero-hud-xp-fill');
    const labelEl = document.getElementById('hero-hud-xp-label');
    const streakEl = document.getElementById('hero-hud-streak');
    const coinsEl = document.getElementById('hero-hud-coins');
    if (nameEl) nameEl.textContent = profile.heroName || 'Hero';
    if (levelEl) levelEl.textContent = `Lv ${level} · ${title}`;
    const pct = neededXp > 0 ? Math.min(100, Math.round((currentLevelXp / neededXp) * 100)) : 100;
    if (fillEl) fillEl.style.width = pct + '%';
    if (labelEl) labelEl.textContent = `${currentLevelXp} / ${neededXp}`;
    if (streakEl) streakEl.textContent = `🔥 ${profile.currentStreak || 0}`;
    if (coinsEl) coinsEl.textContent = `🪙 ${profile.coins || 0}`;

    await _refreshChallengeBanner(profile);
    await _refreshQuestBoard();
    await _refreshPowerupChips();
  }

  function _hideBelowHud() {
    ['hero-quest-board', 'hero-powerup-chips', 'hero-challenge-banner'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  async function _refreshChallengeBanner(profile) {
    const el = document.getElementById('hero-challenge-banner');
    if (!el) return;
    if (!profile.currentChallengeGoalId) { el.style.display = 'none'; return; }
    try {
      const goals = await Auth.getGoals();
      const goal = goals.find(g => g.id === profile.currentChallengeGoalId);
      if (!goal) { el.style.display = 'none'; return; }
      el.innerHTML = `<span>🎯 Current Challenge: <strong>${_esc(goal.title)}</strong></span>`;
      el.style.display = 'flex';
    } catch (_) { el.style.display = 'none'; }
  }

  async function _refreshQuestBoard() {
    const el = document.getElementById('hero-quest-board');
    if (!el) return;
    const day = await GameLayer.getGameDay();
    const items = [
      { label: 'Power-ups', have: (day.powerupsDone || []).length, need: 3 },
      { label: 'Bad guy',   have: day.battles || 0, need: 1 },
      { label: 'Quest',     have: day.quests || 0, need: 1 },
    ];
    el.innerHTML = `
      <div style="display:flex;gap:10px;justify-content:space-between;width:100%;flex-wrap:wrap;">
        ${items.map(i => `
          <div class="hero-quest-item${i.have >= i.need ? ' is-complete' : ''}">
            <div class="hero-quest-ring">${Math.min(i.have, i.need)}/${i.need}</div>
            <div class="hero-quest-label">${i.label}</div>
          </div>`).join('')}
      </div>
      ${day.superbetterDay ? '<div class="hero-quest-celebrate">🎉 SuperBetter Day!</div>' : ''}
    `;
    el.style.cssText = 'display:flex;flex-direction:column;';
  }

  async function _refreshPowerupChips() {
    const el = document.getElementById('hero-powerup-chips');
    if (!el) return;
    const [allPowerups, day] = await Promise.all([GameLayer.Powerups.list(), GameLayer.getGameDay()]);
    const powerups = allPowerups.filter(p => GameLayer.isScheduledToday(p.recurring_days));
    if (!powerups.length) { el.style.display = 'none'; return; }
    const doneSet = new Set(day.powerupsDone || []);
    el.innerHTML = powerups.map(p => `
      <button type="button" class="hero-powerup-chip${doneSet.has(p.id) ? ' is-done' : ''}" data-id="${p.id}">
        ${p.emoji || '⚡'} ${_esc(p.name)}
      </button>`).join('');
    el.querySelectorAll('.hero-powerup-chip').forEach(btn => {
      btn.addEventListener('click', () => _togglePowerup(btn.dataset.id));
    });
    el.style.display = 'flex';
  }

  async function _togglePowerup(id) {
    const day = await GameLayer.getGameDay();
    const done = (day.powerupsDone || []).includes(id);
    if (done) {
      await GameLayer.revoke(`powerup_${id}_${GameLayer.dayKey()}`);
    } else {
      const result = await GameLayer.award('powerup', { sourceId: id });
      if (!result) _showPlainToast('Daily power-up limit reached (8/day)');
    }
  }

  // Break-time nudge — called from app.js's switchMode() when entering a break
  function onBreakStart() {
    if (typeof Auth === 'undefined' || !Auth.isLoggedIn() || typeof GameLayer === 'undefined') return;
    GameLayer.getProfile().then(profile => {
      if (profile && profile.enabled !== false) _showPlainToast('☕ Break time — grab a power-up below!');
    });
  }

  // ── Toasts (single cached node, same convention as certificate.js's _toast) ──
  function _toastEl() {
    let el = document.getElementById('hero-xp-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hero-xp-toast';
      el.className = 'hero-xp-toast';
      document.body.appendChild(el);
    }
    return el;
  }
  function _showXpToast(xp) {
    const el = _toastEl();
    el.textContent = `+${xp} XP`;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1800);
  }
  function _showPlainToast(msg) {
    const el = _toastEl();
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  // ── Celebration modals ────────────────────────────────────────────────────
  function _showLevelUp(result) {
    const modal = document.getElementById('hero-levelup-modal');
    const body = document.getElementById('hero-levelup-body');
    if (!modal || !body) return;
    const title = GameLayer.titleForLevel(result.newLevel);
    body.innerHTML = `Level <strong>${result.newLevel}</strong> — <strong>${_esc(title)}</strong><br>+${result.xp} XP`;
    modal.style.display = 'flex';
  }
  function _showEpicWin(result, payload) {
    const modal = document.getElementById('hero-epicwin-modal');
    const body = document.getElementById('hero-epicwin-body');
    if (!modal || !body) return;
    const goalTitle = payload && payload.goalTitle;
    body.innerHTML = `${goalTitle ? `<strong>${_esc(goalTitle)}</strong><br>` : ''}+${result.xp} XP`;
    modal.style.display = 'flex';
  }

  // ── Hero Panel (tabs: Power-ups / Bad Guys / Shop / Stats / Identity) ──────
  function _openPanel() {
    document.getElementById('hero-panel-modal').style.display = 'flex';
    _switchPanelTab(_activeTab);
  }
  function _closePanel() {
    const modal = document.getElementById('hero-panel-modal');
    if (modal) modal.style.display = 'none';
  }
  function _switchPanelTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.hero-panel-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const body = document.getElementById('hero-panel-body');
    if (!body) return;
    const renderers = {
      powerups: _renderPowerupsTab, badguys: _renderBadguysTab,
      shop: _renderShopTab, stats: _renderStatsTab, identity: _renderIdentityTab,
    };
    (renderers[tab] || _renderPowerupsTab)(body);
  }

  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let _editingPowerupDays = null; // id currently showing its day-picker open
  let _editingPowerupNotes = null; // id currently showing its notes textarea open
  let _newPowerupDays = []; // days picked for the not-yet-created power-up

  function _dayPickerHtml(idAttr, selectedDays) {
    return `<div class="hero-day-picker" data-for="${idAttr}">
      ${DAY_LABELS.map((lbl, i) => `<button type="button" class="recur-day-btn${(selectedDays || []).includes(i) ? ' active' : ''}" data-day="${i}">${lbl}</button>`).join('')}
    </div>`;
  }

  function _scheduleLabel(recurringDays) {
    if (!recurringDays || !recurringDays.length) return 'Every day';
    const sorted = [...recurringDays].sort();
    return sorted.map(d => DAY_LABELS[d]).join(' ');
  }

  // Last 14 days as filled/empty dots — filled = done, hollow = scheduled but
  // missed, very faint = not scheduled that day. Hand-rolled, no chart library.
  function _streakStripHtml(powerupId, recurringDays, days) {
    return `<div class="hero-streak-strip">
      ${days.map(d => {
        const scheduled = GameLayer.isScheduledToday(recurringDays, new Date(d.dayKey + 'T00:00:00'));
        const done = (d.powerupsDone || []).includes(powerupId);
        const cls = done ? 'is-done' : (scheduled ? 'is-missed' : 'is-unscheduled');
        return `<span class="hero-streak-dot ${cls}" title="${d.dayKey}"></span>`;
      }).join('')}
    </div>`;
  }

  async function _renderPowerupsTab(body) {
    const [powerups, day, history] = await Promise.all([
      GameLayer.Powerups.list(), GameLayer.getGameDay(), GameLayer.listGameDays(14),
    ]);
    const doneSet = new Set(day.powerupsDone || []);
    body.innerHTML = `
      <div class="hero-panel-section-title">Power-ups</div>
      <div class="hero-panel-list">
        ${powerups.length ? powerups.map(p => `
          <div class="hero-panel-row hero-panel-row-stack">
            <div class="hero-panel-row-top">
              <span class="hero-panel-row-title">${p.emoji || '⚡'} ${_esc(p.name)}</span>
              <div class="hero-panel-row-actions">
                <button class="hero-panel-btn-sm${doneSet.has(p.id) ? ' hero-panel-btn-accent' : ''}" data-id="${p.id}" data-action="toggle">${doneSet.has(p.id) ? '✓ Done' : 'Mark done'}</button>
                <button class="hero-panel-btn-sm" data-id="${p.id}" data-action="edit-notes">📝</button>
                <button class="hero-panel-btn-sm" data-id="${p.id}" data-action="edit-days">📅</button>
                <button class="hero-panel-btn-sm" data-id="${p.id}" data-action="delete">🗑</button>
              </div>
            </div>
            <div class="hero-panel-row-sub">${_scheduleLabel(p.recurring_days)}</div>
            ${p.description && _editingPowerupNotes !== p.id ? `<div class="hero-panel-row-notes">${_esc(p.description)}</div>` : ''}
            ${_streakStripHtml(p.id, p.recurring_days, history)}
            ${_editingPowerupDays === p.id ? `
              <div class="hero-day-edit-row">
                ${_dayPickerHtml(p.id, p.recurring_days)}
                <button class="hero-panel-btn-sm hero-panel-btn-accent" data-id="${p.id}" data-action="save-days">Save</button>
              </div>` : ''}
            ${_editingPowerupNotes === p.id ? `
              <div class="hero-day-edit-row">
                <textarea class="task-field hero-panel-notes-input" data-id="${p.id}" id="hero-edit-notes-${p.id}" placeholder="Notes (optional)… Enter for a new line." rows="2">${_esc(p.description || '')}</textarea>
                <button class="hero-panel-btn-sm hero-panel-btn-accent" data-id="${p.id}" data-action="save-notes">Save</button>
              </div>` : ''}
          </div>`).join('') : '<div class="hero-panel-empty">No power-ups yet — add one below.</div>'}
      </div>
      <div class="hero-panel-add-row-stack">
        <div class="hero-panel-add-row">
          <input type="text" id="hero-new-powerup-name" class="task-field" placeholder="New power-up… (e.g. Stretch)" maxlength="40">
          <button class="hero-panel-btn-sm hero-panel-btn-accent" id="hero-new-powerup-save">Add</button>
        </div>
        <textarea id="hero-new-powerup-notes" class="task-field hero-panel-notes-input" placeholder="Notes (optional) — why it matters, how to do it… Enter for a new line." rows="2"></textarea>
        <div class="hero-panel-row-sub">Schedule (optional — blank = every day)</div>
        ${_dayPickerHtml('new', _newPowerupDays)}
      </div>
    `;
    body.querySelectorAll('[data-action="toggle"]').forEach(btn => btn.addEventListener('click', async () => {
      await _togglePowerup(btn.dataset.id);
      _renderPowerupsTab(body);
    }));
    body.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', async () => {
      await GameLayer.Powerups.remove(btn.dataset.id);
      _renderPowerupsTab(body);
      _refreshPowerupChips();
    }));
    body.querySelectorAll('[data-action="edit-days"]').forEach(btn => btn.addEventListener('click', () => {
      _editingPowerupDays = _editingPowerupDays === btn.dataset.id ? null : btn.dataset.id;
      _renderPowerupsTab(body);
    }));
    body.querySelectorAll('[data-action="edit-notes"]').forEach(btn => btn.addEventListener('click', () => {
      _editingPowerupNotes = _editingPowerupNotes === btn.dataset.id ? null : btn.dataset.id;
      _renderPowerupsTab(body);
    }));
    body.querySelectorAll('[data-action="save-notes"]').forEach(btn => btn.addEventListener('click', async () => {
      const textarea = document.getElementById(`hero-edit-notes-${btn.dataset.id}`);
      await GameLayer.Powerups.update(btn.dataset.id, { description: (textarea?.value || '').trim() });
      _editingPowerupNotes = null;
      _renderPowerupsTab(body);
    }));
    body.querySelectorAll('[data-action="save-days"]').forEach(btn => btn.addEventListener('click', async () => {
      const picker = body.querySelector(`.hero-day-picker[data-for="${btn.dataset.id}"]`);
      const days = picker ? [...picker.querySelectorAll('.recur-day-btn.active')].map(b => parseInt(b.dataset.day, 10)) : [];
      await GameLayer.Powerups.update(btn.dataset.id, { recurring_days: days });
      _editingPowerupDays = null;
      _renderPowerupsTab(body);
      _refreshPowerupChips();
    }));
    body.querySelectorAll('.hero-day-picker .recur-day-btn').forEach(btn => btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      if (btn.closest('.hero-day-picker')?.dataset.for === 'new') {
        const day = parseInt(btn.dataset.day, 10);
        _newPowerupDays = btn.classList.contains('active')
          ? [...new Set([..._newPowerupDays, day])]
          : _newPowerupDays.filter(d => d !== day);
      }
    }));
    document.getElementById('hero-new-powerup-save')?.addEventListener('click', async () => {
      const input = document.getElementById('hero-new-powerup-name');
      const notesInput = document.getElementById('hero-new-powerup-notes');
      const name = input?.value.trim();
      if (!name) return;
      const description = (notesInput?.value || '').trim(); // unlimited length — just a free-text note, not shown on the compact chip
      await GameLayer.Powerups.create({ name, emoji: '⚡', description, recurring_days: [..._newPowerupDays] });
      input.value = '';
      if (notesInput) notesInput.value = '';
      _newPowerupDays = [];
      _renderPowerupsTab(body);
      _refreshPowerupChips();
    });
  }

  async function _renderBadguysTab(body) {
    const [badguys, battles, profile] = await Promise.all([
      GameLayer.BadGuys.list(), GameLayer.listBattlesThisWeek(), GameLayer.getProfile(),
    ]);
    const tallyFor = id => battles.filter(b => b.badGuyId === id).length;
    const activeId = profile ? profile.activeBadGuyId : null;
    body.innerHTML = `
      <div class="hero-panel-section-title">Bad Guys</div>
      <div class="hero-panel-row-sub" style="margin-bottom:-4px;">⭐ Active bad guy takes passive damage from every quest/power-up. "Battled it" always hits whichever one you click.</div>
      <div class="hero-panel-list">
        ${badguys.length ? badguys.map(b => {
          const maxHp = b.maxHp || GameLayer.rules.badguyDefaultHp;
          const curHp = b.currentHp != null ? b.currentHp : maxHp;
          const pct = Math.max(0, Math.min(100, Math.round((curHp / maxHp) * 100)));
          const isActive = activeId === b.id;
          return `
          <div class="hero-panel-row hero-panel-row-stack">
            <div class="hero-panel-row-top">
              <div class="hero-panel-row-title">${b.emoji || '👾'} ${_esc(b.name)}${isActive ? ' ⭐' : ''}</div>
              <div class="hero-panel-row-actions">
                <button class="hero-panel-btn-sm hero-panel-btn-accent" data-id="${b.id}" data-action="battle">Battled it</button>
                <button class="hero-panel-btn-sm" data-id="${b.id}" data-action="delete">🗑</button>
              </div>
            </div>
            <div class="hero-boss-hp-bar"><div class="hero-boss-hp-fill" style="width:${pct}%"></div></div>
            <div class="hero-panel-row-sub">HP ${curHp}/${maxHp} · Beaten ${tallyFor(b.id)}× this week${b.defeatedCount ? ` · Defeated ${b.defeatedCount}×` : ''}${b.counterMove ? ' · ' + _esc(b.counterMove) : ''}</div>
            <button class="hero-panel-btn-sm${isActive ? ' hero-panel-btn-accent' : ''}" data-id="${b.id}" data-action="set-active">${isActive ? '⭐ Active' : 'Set Active'}</button>
          </div>`;
        }).join('') : `<div class="hero-panel-empty">No bad guys yet. Try: ${BADGUY_TEMPLATES.map(t => _esc(t.name)).join(', ')}</div>`}
      </div>
      <div class="hero-panel-add-row">
        <input type="text" id="hero-new-badguy-name" class="task-field" placeholder="Name your bad guy… (e.g. Doomscroll Demon)" maxlength="40">
        <button class="hero-panel-btn-sm hero-panel-btn-accent" id="hero-new-badguy-save">Add</button>
      </div>
    `;
    body.querySelectorAll('[data-action="battle"]').forEach(btn => btn.addEventListener('click', async () => {
      await GameLayer.logBattle(btn.dataset.id);
      _renderBadguysTab(body);
    }));
    body.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', async () => {
      await GameLayer.BadGuys.remove(btn.dataset.id);
      _renderBadguysTab(body);
    }));
    body.querySelectorAll('[data-action="set-active"]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      await GameLayer.pinActiveBadGuy(activeId === id ? null : id);
      _renderBadguysTab(body);
    }));
    document.getElementById('hero-new-badguy-save')?.addEventListener('click', async () => {
      const input = document.getElementById('hero-new-badguy-name');
      const name = input?.value.trim();
      if (!name) return;
      const maxHp = GameLayer.rules.badguyDefaultHp;
      await GameLayer.BadGuys.create({ name, emoji: '👾', counterMove: '', maxHp, currentHp: maxHp, defeatedCount: 0 });
      input.value = '';
      _renderBadguysTab(body);
    });
  }

  async function _renderShopTab(body) {
    const [rewards, redemptions, profile] = await Promise.all([
      GameLayer.Rewards.list(), GameLayer.listRedemptions(), GameLayer.getProfile(),
    ]);
    const coins = profile ? profile.coins || 0 : 0;
    body.innerHTML = `
      <div class="hero-panel-section-title">Rewards Shop · 🪙 ${coins}</div>
      <div class="hero-panel-list">
        ${rewards.length ? rewards.map(r => `
          <div class="hero-panel-row">
            <span class="hero-panel-row-title">${r.emoji || '🎁'} ${_esc(r.name)} — 🪙${r.cost}</span>
            <button class="hero-panel-btn-sm hero-panel-btn-accent" data-id="${r.id}" data-action="redeem" ${coins < r.cost ? 'disabled' : ''}>Redeem</button>
          </div>`).join('') : '<div class="hero-panel-empty">No rewards yet — add one below.</div>'}
      </div>
      <div class="hero-panel-add-row">
        <input type="text" id="hero-new-reward-name" class="task-field" placeholder="Reward name…" maxlength="40">
        <input type="number" id="hero-new-reward-cost" class="task-select" placeholder="Cost" min="10" style="max-width:80px;">
        <button class="hero-panel-btn-sm hero-panel-btn-accent" id="hero-new-reward-save">Add</button>
      </div>
      <div class="hero-panel-section-title">Redeemed</div>
      <div class="hero-panel-list">
        ${redemptions.length ? redemptions.slice(0, 10).map(r => `
          <div class="hero-panel-row"><span class="hero-panel-row-sub">${_esc(r.rewardName)} — 🪙${r.cost} · ${new Date(r.createdAt).toLocaleDateString()}</span></div>
        `).join('') : '<div class="hero-panel-empty">No redemptions yet.</div>'}
      </div>
    `;
    body.querySelectorAll('[data-action="redeem"]').forEach(btn => btn.addEventListener('click', async () => {
      const result = await GameLayer.redeemReward(btn.dataset.id);
      if (!result || !result.ok) _showPlainToast(result && result.reason === 'insufficient' ? 'Not enough coins' : 'Could not redeem');
      _renderShopTab(body);
    }));
    document.getElementById('hero-new-reward-save')?.addEventListener('click', async () => {
      const nameInput = document.getElementById('hero-new-reward-name');
      const costInput = document.getElementById('hero-new-reward-cost');
      const name = nameInput?.value.trim();
      const cost = Math.max(10, parseInt(costInput?.value || '10', 10));
      if (!name) return;
      await GameLayer.Rewards.create({ name, emoji: '🎁', cost });
      nameInput.value = ''; costInput.value = '';
      _renderShopTab(body);
    });
  }

  async function _renderStatsTab(body) {
    const [days, profile, battles, badguys] = await Promise.all([
      GameLayer.listGameDays(7), GameLayer.getProfile(), GameLayer.listBattles(30), GameLayer.BadGuys.list(),
    ]);
    const maxXp = Math.max(1, ...days.map(d => d.xpTotal || 0));
    const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const totalFocusMin = days.reduce((s, d) => s + (d.focusMinutesXp || 0), 0);
    const sbCount = days.filter(d => d.superbetterDay).length;

    const battleTally = {};
    battles.forEach(b => { battleTally[b.badGuyId] = (battleTally[b.badGuyId] || 0) + 1; });
    const topEntry = Object.entries(battleTally).sort((a, b) => b[1] - a[1])[0];
    const topBadguy = topEntry ? badguys.find(b => b.id === topEntry[0]) : null;

    body.innerHTML = `
      <div class="hero-panel-section-title">Last 7 Days</div>
      <div class="hero-stats-bars">
        ${days.map(d => `
          <div class="hero-stats-bar-col">
            <div class="hero-stats-bar" style="height:${Math.round(((d.xpTotal || 0) / maxXp) * 100)}%" title="${d.xpTotal || 0} XP"></div>
            <div class="hero-stats-bar-label">${dow[new Date(d.dayKey + 'T00:00:00').getDay()]}${d.superbetterDay ? ' 🎉' : ''}${d.frozen ? ' ❄️' : ''}</div>
          </div>`).join('')}
      </div>
      <div class="hero-stats-summary-row"><span>SuperBetter Days</span><strong>${sbCount} / 7</strong></div>
      <div class="hero-stats-summary-row"><span>Focus minutes (capped/day)</span><strong>${totalFocusMin}</strong></div>
      <div class="hero-stats-summary-row"><span>Longest streak</span><strong>${profile ? profile.longestStreak || 0 : 0}</strong></div>
      <div class="hero-stats-summary-row"><span>Freezes available</span><strong>${profile ? profile.freezes || 0 : 0} / 2</strong></div>
      ${topBadguy ? `<div class="hero-stats-summary-row"><span>Most battled (30d)</span><strong>${_esc(topBadguy.name)} ×${topEntry[1]}</strong></div>` : ''}
    `;
  }

  async function _renderIdentityTab(body) {
    const profile = await GameLayer.getProfile();
    body.innerHTML = `
      <div class="hero-panel-section-title">Secret Identity</div>
      <input type="text" id="hero-identity-name" class="task-field" placeholder="Hero name" maxlength="30" value="${_esc(profile ? profile.heroName : '')}">
      <input type="text" id="hero-identity-inspired" class="task-field" placeholder="Inspired by… (optional)" maxlength="60" value="${_esc(profile ? profile.inspiredBy : '')}">
      <input type="text" id="hero-identity-strength" class="task-field" placeholder="Your strength… (optional)" maxlength="60" value="${_esc(profile ? profile.strength : '')}">
      <button class="hero-panel-btn-sm hero-panel-btn-accent" id="hero-identity-save">Save</button>
    `;
    document.getElementById('hero-identity-save')?.addEventListener('click', async () => {
      await GameLayer.setIdentity({
        heroName: document.getElementById('hero-identity-name')?.value,
        inspiredBy: document.getElementById('hero-identity-inspired')?.value,
        strength: document.getElementById('hero-identity-strength')?.value,
      });
      _showPlainToast('Identity saved');
    });
  }

  // ── Onboarding wizard (3 steps) — serves both existing and new users since
  //    no prior onboarding flow exists to append to (see GAME_LAYER_NOTES.md) ──
  async function _ensureDefaultsIfFirstTime() {
    try {
      const existing = await GameLayer.Powerups.list();
      if (existing.length) return;
      for (const p of DEFAULT_POWERUPS) await GameLayer.Powerups.create(p);
    } catch (_) {}
  }

  // Gated on the account's Firestore profile, not per-browser localStorage —
  // so the wizard (and the Secret Identity it sets) is shared across every
  // device the same person logs into, not re-asked on each new one.
  async function _maybeShowWizardPrompt() {
    const profile = await GameLayer.getProfile();
    if (profile && profile.onboarded) return;
    _openWizard();
  }

  function _openWizard() {
    _wizardStep = 1;
    _wizardData = {
      heroName: '', inspiredBy: '', strength: '',
      powerups: DEFAULT_POWERUPS.slice(0, 3).map(p => p.name),
      badguyName: '', badguyCounter: '',
    };
    const modal = document.getElementById('hero-wizard-modal');
    if (modal) modal.style.display = 'flex';
    _renderWizardStep();
  }

  function _skipWizard() {
    GameLayer.markOnboarded();
    const modal = document.getElementById('hero-wizard-modal');
    if (modal) modal.style.display = 'none';
  }

  function _renderWizardStep() {
    const body = document.getElementById('hero-wizard-body');
    const nextBtn = document.getElementById('hero-wizard-next-btn');
    if (!body || !nextBtn) return;

    if (_wizardStep === 1) {
      body.innerHTML = `
        <div class="hero-wizard-step-title">Step 1 of 3 — Secret Identity</div>
        <div class="hero-wizard-step-hint">Who are you when you're at your best?</div>
        <input type="text" id="wiz-hero-name" class="task-field" placeholder="Hero name (e.g. Nightwriter)" maxlength="30" value="${_esc(_wizardData.heroName)}">
        <input type="text" id="wiz-inspired" class="task-field" placeholder="Inspired by… (optional, e.g. a samurai)" maxlength="60" value="${_esc(_wizardData.inspiredBy)}">
        <input type="text" id="wiz-strength" class="task-field" placeholder="Your strength… (optional)" maxlength="60" value="${_esc(_wizardData.strength)}">
      `;
      nextBtn.textContent = 'Next';
    } else if (_wizardStep === 2) {
      body.innerHTML = `
        <div class="hero-wizard-step-title">Step 2 of 3 — Power-ups</div>
        <div class="hero-wizard-step-hint">Pick a few quick routines to tap when you do them.</div>
        <div class="hero-wizard-chip-grid">
          ${DEFAULT_POWERUPS.map(p => `<button type="button" class="hero-wizard-chip${_wizardData.powerups.includes(p.name) ? ' active' : ''}" data-name="${_esc(p.name)}">${p.emoji} ${_esc(p.name)}</button>`).join('')}
        </div>
      `;
      body.querySelectorAll('.hero-wizard-chip').forEach(btn => btn.addEventListener('click', () => {
        const name = btn.dataset.name;
        if (_wizardData.powerups.includes(name)) _wizardData.powerups = _wizardData.powerups.filter(n => n !== name);
        else _wizardData.powerups.push(name);
        btn.classList.toggle('active');
      }));
      nextBtn.textContent = 'Next';
    } else {
      body.innerHTML = `
        <div class="hero-wizard-step-title">Step 3 of 3 — Name a Bad Guy</div>
        <div class="hero-wizard-step-hint">A distraction or obstacle you battle. Pick one or write your own.</div>
        <div class="hero-wizard-chip-grid">
          ${BADGUY_TEMPLATES.map(t => `<button type="button" class="hero-wizard-chip" data-name="${_esc(t.name)}" data-counter="${_esc(t.counterMove)}">${t.emoji} ${_esc(t.name)}</button>`).join('')}
        </div>
        <input type="text" id="wiz-badguy-name" class="task-field" placeholder="Or name your own…" maxlength="40" value="${_esc(_wizardData.badguyName)}">
      `;
      body.querySelectorAll('.hero-wizard-chip').forEach(btn => btn.addEventListener('click', () => {
        _wizardData.badguyName = btn.dataset.name;
        _wizardData.badguyCounter = btn.dataset.counter || '';
        const nameInput = document.getElementById('wiz-badguy-name');
        if (nameInput) nameInput.value = btn.dataset.name;
      }));
      nextBtn.textContent = 'Finish';
    }
  }

  async function _wizardNext() {
    if (_wizardStep === 1) {
      _wizardData.heroName = document.getElementById('wiz-hero-name')?.value.trim() || 'Hero';
      _wizardData.inspiredBy = document.getElementById('wiz-inspired')?.value.trim() || '';
      _wizardData.strength = document.getElementById('wiz-strength')?.value.trim() || '';
      _wizardStep = 2;
      _renderWizardStep();
    } else if (_wizardStep === 2) {
      _wizardStep = 3;
      _renderWizardStep();
    } else {
      _wizardData.badguyName = document.getElementById('wiz-badguy-name')?.value.trim() || '';
      await _finishWizard();
    }
  }

  async function _finishWizard() {
    const modal = document.getElementById('hero-wizard-modal');
    if (modal) modal.style.display = 'none';

    await GameLayer.setIdentity({ heroName: _wizardData.heroName, inspiredBy: _wizardData.inspiredBy, strength: _wizardData.strength });
    await GameLayer.markOnboarded();
    await GameLayer.setEnabled(true);

    // Defaults were already seeded by _ensureDefaultsIfFirstTime() in init();
    // trim down to just what the user picked rather than re-seeding.
    try {
      const existing = await GameLayer.Powerups.list();
      for (const p of existing) {
        if (!_wizardData.powerups.includes(p.name)) await GameLayer.Powerups.remove(p.id);
      }
    } catch (_) {}

    if (_wizardData.badguyName) {
      try {
        const existingBadguys = await GameLayer.BadGuys.list();
        if (!existingBadguys.length) {
          await GameLayer.BadGuys.create({ name: _wizardData.badguyName, emoji: '👾', counterMove: _wizardData.badguyCounter || '' });
        }
      } catch (_) {}
    }

    await _refreshAll();
  }

  return { init, onBreakStart };
})();
