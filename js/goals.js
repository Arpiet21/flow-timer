/* ── 7-Level Goal Cascade + AI Suggestions ──────────────────────────────────
   Someday → Five-Year → One-Year → Monthly → Weekly → Daily → Right Now.
   Each level answers "so what do I do about it?" for the level above — the
   test of a real cascade: any small task should trace up to a Someday goal,
   and any Someday goal should trace down to something doable right now.
   Same lineage as OKR cascading (company → team → individual) and Hoshin
   Kanri, applied to one person's life instead of an org.
   AI Suggest calls Grok via /api/generate-goal-suggestions with the ancestor
   chain as context. Right Now items can be sent straight into the Task
   Manager. Stored at users/{uid}/goals/{id}: { level, title, parent_id, cascade_id }. ── */
const GoalCascade = (() => {
  const LEVELS = [
    { level: 1, name: 'Someday',   icon: '🌟', placeholder: 'Add your someday goal…' },
    { level: 2, name: 'Five-Year', icon: '🏔', placeholder: 'Add your five-year goal…' },
    { level: 3, name: 'One-Year',  icon: '🚀', placeholder: 'Add your one-year goal…' },
    { level: 4, name: 'Monthly',   icon: '📅', placeholder: "Add this month's goal…" },
    { level: 5, name: 'Weekly',    icon: '📊', placeholder: "Add this week's goal…" },
    { level: 6, name: 'Daily',     icon: '🗓', placeholder: "Add today's action…" },
    { level: 7, name: 'Right Now', icon: '✅', placeholder: 'Add what you\'ll do right now…' },
  ];

  let _goals = [];
  let _activeCascadeId = null;
  let _editingLevel = null;
  let _suggestState = {}; // level -> 'loading' | string[]
  let _currentChallengeGoalId = null; // Hero Mode's pinned Monthly/One-Year goal, if any

  function init() {
    document.getElementById('goals-new-vision-btn')?.addEventListener('click', () => {
      document.getElementById('goals-new-vision-form').style.display = 'flex';
      document.getElementById('goals-new-vision-btn').style.display = 'none';
      document.getElementById('goals-new-vision-input')?.focus();
    });
    document.getElementById('goals-new-vision-cancel')?.addEventListener('click', () => {
      document.getElementById('goals-new-vision-form').style.display = 'none';
      document.getElementById('goals-new-vision-btn').style.display = '';
      document.getElementById('goals-new-vision-input').value = '';
    });
    document.getElementById('goals-new-vision-save')?.addEventListener('click', _createVision);
    document.getElementById('goals-new-vision-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _createVision();
    });
    document.getElementById('goals-back-btn')?.addEventListener('click', _showCascadeList);
    _loadGoals();
  }

  function refresh() { _loadGoals(); }

  function _esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  async function _loadGoals() {
    const listEl = document.getElementById('goals-cascade-list');
    if (!(typeof Auth !== 'undefined' && Auth.isLoggedIn())) {
      if (listEl) listEl.innerHTML = '<p class="history-empty">Sign in to build your goal cascade.</p>';
      return;
    }
    _goals = await Auth.getGoals();
    if (typeof GameLayer !== 'undefined') {
      const profile = await GameLayer.getProfile();
      _currentChallengeGoalId = profile ? profile.currentChallengeGoalId : null;
    }
    if (_activeCascadeId && _visionGoals().some(v => v.id === _activeCascadeId)) {
      _renderLevels();
    } else {
      _activeCascadeId = null;
      _renderCascadeList();
    }
  }

  async function _reloadQuiet() {
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) _goals = await Auth.getGoals();
  }

  function _visionGoals() {
    return _goals.filter(g => g.level === 1).sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  }

  function _levelsFor(cascadeId) {
    return _goals.filter(g => g.cascade_id === cascadeId);
  }

  function _goalAtLevel(cascadeId, level) {
    return _levelsFor(cascadeId).find(g => g.level === level) || null;
  }

  function _countFilled(cascadeId) {
    return _levelsFor(cascadeId).length;
  }

  function _renderCascadeList() {
    const listEl = document.getElementById('goals-cascade-list');
    if (!listEl) return;
    const visions = _visionGoals();
    if (!visions.length) {
      listEl.innerHTML = '<p class="history-empty">No goal cascades yet — start with your Someday goal below.</p>';
    } else {
      listEl.innerHTML = visions.map(v => `
        <div class="goal-vision-card" data-id="${v.id}">
          <div class="goal-vision-card-title">🌟 ${_esc(v.title)}</div>
          <div class="goal-vision-card-progress">${_countFilled(v.id)} / 7 levels set</div>
        </div>`).join('');
      listEl.querySelectorAll('.goal-vision-card').forEach(card => {
        card.addEventListener('click', () => _openCascade(card.dataset.id));
      });
    }
    document.getElementById('goals-cascade-picker').style.display = '';
    document.getElementById('goals-cascade-detail').style.display = 'none';
  }

  async function _createVision() {
    const input = document.getElementById('goals-new-vision-input');
    const title = input?.value.trim();
    if (!title) return;
    if (!(typeof Auth !== 'undefined' && Auth.isLoggedIn())) return;
    const id = await Auth.createGoal({ level: 1, title, parent_id: null, cascade_id: null });
    await Auth.updateGoal(id, { cascade_id: id });
    input.value = '';
    document.getElementById('goals-new-vision-form').style.display = 'none';
    document.getElementById('goals-new-vision-btn').style.display = '';
    await _reloadQuiet();
    _openCascade(id);
  }

  function _showCascadeList() {
    _activeCascadeId = null;
    _editingLevel = null;
    _suggestState = {};
    _renderCascadeList();
  }

  function _openCascade(cascadeId) {
    _activeCascadeId = cascadeId;
    _editingLevel = null;
    _suggestState = {};
    document.getElementById('goals-cascade-picker').style.display = 'none';
    document.getElementById('goals-cascade-detail').style.display = '';
    _renderLevels();
  }

  function _renderLevels() {
    const el = document.getElementById('goals-levels-list');
    if (!el || !_activeCascadeId) return;
    el.innerHTML = LEVELS.map(_renderLevelRow).join('');
    _bindLevelRowEvents();
  }

  function _renderLevelRow(L) {
    const goal = _goalAtLevel(_activeCascadeId, L.level);
    const parentGoal = L.level > 1 ? _goalAtLevel(_activeCascadeId, L.level - 1) : true;
    const locked = L.level > 1 && !parentGoal;
    const editing = _editingLevel === L.level;
    const suggestions = _suggestState[L.level];

    let body;
    if (goal && !editing) {
      const isPinned = _currentChallengeGoalId === goal.id;
      const canPin = (L.level === 3 || L.level === 4) && !goal.completed;
      body = `
        <div class="goal-level-value ${goal.completed ? 'is-complete' : ''}">
          <span>${_esc(goal.title)}</span>
          <div class="goal-level-actions">
            <button class="goal-level-complete-btn${goal.completed ? ' is-done' : ''}" data-level="${L.level}" title="${goal.completed ? 'Reopen' : 'Mark complete'}">${goal.completed ? '↺' : '✓'}</button>
            ${canPin ? `<button class="goal-level-pin-btn${isPinned ? ' is-pinned' : ''}" data-level="${L.level}" title="${isPinned ? 'Unpin Current Challenge' : 'Pin as Current Challenge'}">${isPinned ? '📌 Challenge' : '📌 Pin'}</button>` : ''}
            <button class="goal-level-edit-btn" data-level="${L.level}" title="Edit">✏️</button>
            <button class="goal-level-del-btn" data-level="${L.level}" data-id="${goal.id}" title="Delete">🗑</button>
            ${L.level === 7 ? `<button class="goal-level-totask-btn" data-level="${L.level}">→ Send to Tasks</button>` : ''}
          </div>
        </div>`;
    } else if (locked) {
      body = `<div class="goal-level-locked">Set the level above first</div>`;
    } else {
      body = `
        <div class="goal-level-input-row">
          <input type="text" class="task-field goal-level-input" data-level="${L.level}" placeholder="${_esc(L.placeholder)}">
          <button class="btn-accent-sm goal-level-save-btn" data-level="${L.level}">Save</button>
          <button class="goal-level-ai-btn" data-level="${L.level}" title="AI Suggest">✨ AI Suggest</button>
          ${goal ? `<button class="goal-level-cancel-btn" data-level="${L.level}" title="Cancel">✕</button>` : ''}
        </div>
        ${suggestions ? `
          <div class="goal-suggestions">
            ${suggestions === 'loading'
              ? '<span class="goal-suggest-loading">Thinking…</span>'
              : suggestions.map(s => `<button type="button" class="goal-suggestion-chip" data-level="${L.level}">${_esc(s)}</button>`).join('')}
          </div>` : ''}
      `;
    }

    return `
      <div class="goal-level-row ${goal ? 'is-filled' : ''} ${locked ? 'is-locked' : ''}">
        <div class="goal-level-header"><span class="goal-level-icon">${L.icon}</span> <span class="goal-level-name">${L.name}</span></div>
        ${body}
      </div>`;
  }

  function _bindLevelRowEvents() {
    document.querySelectorAll('.goal-level-save-btn').forEach(btn =>
      btn.addEventListener('click', () => _saveLevel(parseInt(btn.dataset.level))));
    document.querySelectorAll('.goal-level-input').forEach(input =>
      input.addEventListener('keydown', e => { if (e.key === 'Enter') _saveLevel(parseInt(input.dataset.level)); }));
    document.querySelectorAll('.goal-level-ai-btn').forEach(btn =>
      btn.addEventListener('click', () => _suggestForLevel(parseInt(btn.dataset.level))));
    document.querySelectorAll('.goal-suggestion-chip').forEach(chip =>
      chip.addEventListener('click', () => {
        const level = parseInt(chip.dataset.level);
        const input = document.querySelector(`.goal-level-input[data-level="${level}"]`);
        if (input) input.value = chip.textContent;
      }));
    document.querySelectorAll('.goal-level-edit-btn').forEach(btn =>
      btn.addEventListener('click', () => _editLevel(parseInt(btn.dataset.level))));
    document.querySelectorAll('.goal-level-cancel-btn').forEach(btn =>
      btn.addEventListener('click', () => {
        _editingLevel = null;
        delete _suggestState[parseInt(btn.dataset.level)];
        _renderLevels();
      }));
    document.querySelectorAll('.goal-level-del-btn').forEach(btn =>
      btn.addEventListener('click', () => _deleteLevel(parseInt(btn.dataset.level))));
    document.querySelectorAll('.goal-level-totask-btn').forEach(btn =>
      btn.addEventListener('click', () => _sendToTasks(parseInt(btn.dataset.level))));
    document.querySelectorAll('.goal-level-complete-btn').forEach(btn =>
      btn.addEventListener('click', () => _toggleGoalComplete(parseInt(btn.dataset.level))));
    document.querySelectorAll('.goal-level-pin-btn').forEach(btn =>
      btn.addEventListener('click', () => _pinChallenge(parseInt(btn.dataset.level))));
  }

  // ── Hero Mode: goal completion drives XP/Epic Win; levels 1 (Someday) and
  //    7 (Right Now) have no completion bonus in v1 — see GAME_LAYER_NOTES.md ──
  async function _toggleGoalComplete(level) {
    const goal = _goalAtLevel(_activeCascadeId, level);
    if (!goal || !(typeof Auth !== 'undefined' && Auth.isLoggedIn())) return;
    const completed = !goal.completed;
    const completed_at = completed ? new Date().toISOString() : null;
    goal.completed = completed;
    goal.completed_at = completed_at;
    await Auth.updateGoal(goal.id, { completed, completed_at });
    _renderLevels();

    if (typeof GameLayer === 'undefined') return;
    // Toasts/Epic-Win modal are triggered centrally by hero-ui.js's GameLayer.onChange
    // listener (every award() call notifies 'award' regardless of caller) — not here,
    // to avoid double-firing.
    if (completed) {
      await GameLayer.award('goal', { sourceId: goal.id, level: goal.level, goalTitle: goal.title });
    } else {
      await GameLayer.revoke(`goal_${goal.id}`);
    }
  }

  async function _pinChallenge(level) {
    const goal = _goalAtLevel(_activeCascadeId, level);
    if (!goal || typeof GameLayer === 'undefined') return;
    const alreadyPinned = _currentChallengeGoalId === goal.id;
    await GameLayer.pinChallenge(alreadyPinned ? null : goal.id);
    _currentChallengeGoalId = alreadyPinned ? null : goal.id;
    _renderLevels();
  }

  async function _saveLevel(level) {
    const input = document.querySelector(`.goal-level-input[data-level="${level}"]`);
    const title = input?.value.trim();
    if (!title) return;
    const existing = _goalAtLevel(_activeCascadeId, level);
    const suggestions = _suggestState[level];
    const wasAiSuggested = Array.isArray(suggestions) && suggestions.includes(title);

    if (existing) {
      await Auth.updateGoal(existing.id, { title, ai_generated: wasAiSuggested });
    } else {
      const parentGoal = level > 1 ? _goalAtLevel(_activeCascadeId, level - 1) : null;
      await Auth.createGoal({
        level, title,
        parent_id: parentGoal ? parentGoal.id : null,
        cascade_id: _activeCascadeId,
        ai_generated: wasAiSuggested
      });
    }
    delete _suggestState[level];
    _editingLevel = null;
    await _reloadQuiet();
    _renderLevels();
  }

  function _editLevel(level) {
    _editingLevel = level;
    _renderLevels();
    const goal = _goalAtLevel(_activeCascadeId, level);
    const input = document.querySelector(`.goal-level-input[data-level="${level}"]`);
    if (input && goal) { input.value = goal.title; input.focus(); }
  }

  async function _deleteLevel(level) {
    // Deleting a level also deletes everything cascading below it in this cascade
    const toDelete = _levelsFor(_activeCascadeId).filter(g => g.level >= level);
    for (const g of toDelete) await Auth.deleteGoal(g.id);
    await _reloadQuiet();
    if (level === 1) {
      _showCascadeList();
    } else {
      _renderLevels();
    }
  }

  async function _suggestForLevel(level) {
    const L = LEVELS.find(l => l.level === level);
    _suggestState[level] = 'loading';
    _renderLevels();

    const chain = [];
    for (let lv = 1; lv < level; lv++) {
      const g = _goalAtLevel(_activeCascadeId, lv);
      if (g) chain.push({ levelName: LEVELS.find(x => x.level === lv).name, title: g.title });
    }

    try {
      const res = await fetch('/api/generate-goal-suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ levelName: L.name, levelNumber: level, chain })
      });
      const data = await res.json();
      _suggestState[level] = Array.isArray(data.suggestions) ? data.suggestions : [];
    } catch (_) {
      _suggestState[level] = [];
    }
    _renderLevels();
  }

  function _sendToTasks(level) {
    const goal = _goalAtLevel(_activeCascadeId, level);
    if (!goal) return;
    if (typeof switchTimerType === 'function') switchTimerType('tasks');
    if (typeof TaskManager !== 'undefined') {
      TaskManager.showAddForm();
      const input = document.getElementById('task-title-input');
      if (input) { input.value = goal.title; input.focus(); }
    }
  }

  return { init, refresh };
})();
