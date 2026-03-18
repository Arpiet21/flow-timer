// ─── Task Manager ─────────────────────────────────────────────────────────────

const TaskManager = {
  _tasks:    [],
  _priority: 2,
  _showDone: false,
  _bound:    false,   // prevent duplicate event listener bindings

  // ── Init ──────────────────────────────────────────────────────────────────
  async init() {
    await this._load();
    this._render();
    if (!this._bound) { this._bindButtons(); this._bound = true; }
  },

  // ── Persistence ───────────────────────────────────────────────────────────
  async _load() {
    try {
      if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
        const { data } = await _sb.from('tasks')
          .select('*')
          .eq('user_id', Auth.getUser().id)
          .order('created_at', { ascending: true });
        this._tasks = data || [];
      } else {
        this._tasks = JSON.parse(localStorage.getItem('flow-tasks') || '[]');
      }
    } catch (_) { this._tasks = []; }
  },

  _saveLocal() {
    if (!(typeof Auth !== 'undefined' && Auth.isLoggedIn())) {
      try { localStorage.setItem('flow-tasks', JSON.stringify(this._tasks)); } catch (_) {}
    }
  },

  // ── Bind all interactive buttons once ─────────────────────────────────────
  _bindButtons() {
    // Trigger → show form
    document.getElementById('task-add-trigger')?.addEventListener('click', () => this.showAddForm());

    // Add Task button
    document.getElementById('task-submit-btn')?.addEventListener('click', () => this.submitAdd());

    // Cancel button
    document.getElementById('task-cancel-btn')?.addEventListener('click', () => this.hideAddForm());

    // Enter key in title input
    document.getElementById('task-title-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.submitAdd(); }
    });

    // Priority dots
    document.querySelectorAll('#task-priority-pick .task-dot').forEach((el, i) => {
      el.addEventListener('click', () => this.setPriority(i + 1));
    });
  },

  // ── Add form show / hide ───────────────────────────────────────────────────
  showAddForm() {
    document.getElementById('task-add-trigger').style.display = 'none';
    document.getElementById('task-add-form').style.display    = 'flex';
    document.getElementById('task-title-input')?.focus();
  },

  hideAddForm() {
    document.getElementById('task-add-form').style.display    = 'none';
    document.getElementById('task-add-trigger').style.display = '';
    if (document.getElementById('task-title-input'))
      document.getElementById('task-title-input').value = '';
    if (document.getElementById('task-tags-input'))
      document.getElementById('task-tags-input').value = '';
    this.setPriority(2);
  },

  setPriority(p) {
    this._priority = p;
    document.querySelectorAll('#task-priority-pick .task-dot').forEach((el, i) => {
      el.classList.toggle('task-dot-active', i < p);
    });
  },

  // ── Submit new task ────────────────────────────────────────────────────────
  async submitAdd() {
    const title = document.getElementById('task-title-input')?.value.trim();
    if (!title) {
      document.getElementById('task-title-input')?.classList.add('task-field-error');
      setTimeout(() => document.getElementById('task-title-input')?.classList.remove('task-field-error'), 800);
      return;
    }

    const category = document.getElementById('task-category-select')?.value || 'Personal';
    const estMins  = parseInt(document.getElementById('task-est-select')?.value || '25');
    const tagsRaw  = document.getElementById('task-tags-input')?.value.trim() || '';
    const tags = tagsRaw
      ? tagsRaw.split(/[\s,]+/).filter(Boolean).map(t => t.startsWith('#') ? t : '#' + t)
      : [];

    const task = {
      id:                (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36),
      title,
      category,
      estimated_minutes: estMins,
      priority:          this._priority,
      tags,
      completed:         false,
      completed_at:      null,
      created_at:        new Date().toISOString()
    };

    // Save to Supabase (fire-and-forget; don't let failures block the UI)
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      try {
        const { data } = await _sb.from('tasks')
          .insert({ ...task, user_id: Auth.getUser().id })
          .select('id')
          .limit(1);
        if (data?.[0]?.id) task.id = data[0].id;
      } catch (_) { /* Supabase error — task still saved locally */ }
    }

    this._tasks.push(task);
    this._saveLocal();
    this.hideAddForm();
    this._render();
  },

  // ── Toggle complete ────────────────────────────────────────────────────────
  async toggleComplete(id) {
    const task = this._tasks.find(t => t.id === id);
    if (!task) return;
    task.completed    = !task.completed;
    task.completed_at = task.completed ? new Date().toISOString() : null;
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      try { await _sb.from('tasks').update({ completed: task.completed, completed_at: task.completed_at }).eq('id', id); }
      catch (_) {}
    }
    this._saveLocal();
    this._render();
  },

  // ── Delete ────────────────────────────────────────────────────────────────
  async deleteTask(id) {
    this._tasks = this._tasks.filter(t => t.id !== id);
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      try { await _sb.from('tasks').delete().eq('id', id); } catch (_) {}
    }
    this._saveLocal();
    this._render();
  },

  // ── Start focus on task ───────────────────────────────────────────────────
  startFocus(id) {
    const task = this._tasks.find(t => t.id === id);
    if (!task) return;
    if (typeof switchTimerType === 'function') switchTimerType('work');
    const taskInput = document.getElementById('task-input');
    if (taskInput) {
      taskInput.value = task.title;
      if (typeof state !== 'undefined') { state.task = task.title; saveToStorage(); }
    }
    if (typeof state !== 'undefined' && task.estimated_minutes) {
      const presets = [10, 15, 20, 25, 30, 45, 50, 60, 75, 90];
      state.settings.work = presets.reduce((a, b) =>
        Math.abs(b - task.estimated_minutes) < Math.abs(a - task.estimated_minutes) ? b : a
      );
      if (typeof resetTimer === 'function') resetTimer();
      if (typeof updatePresetUI === 'function') updatePresetUI();
    }
    document.getElementById('flow-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  // ── Render ────────────────────────────────────────────────────────────────
  _render() {
    this._renderStats();
    this._renderList();
  },

  _renderStats() {
    const today      = new Date().toISOString().slice(0, 10);
    const incomplete = this._tasks.filter(t => !t.completed);
    const doneToday  = this._tasks.filter(t => t.completed && t.completed_at?.slice(0, 10) === today);
    const estMins    = incomplete.reduce((a, t) => a + (t.estimated_minutes || 0), 0);
    const fmt = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const estEl  = document.getElementById('task-est-time');
    const todoEl = document.getElementById('task-todo-count');
    const doneEl = document.getElementById('task-done-count');
    if (estEl)  estEl.textContent  = fmt(estMins);
    if (todoEl) todoEl.textContent = incomplete.length;
    if (doneEl) doneEl.textContent = doneToday.length;
  },

  _renderList() {
    const list = document.getElementById('task-list');
    if (!list) return;

    const incomplete = this._tasks.filter(t => !t.completed);
    const done       = this._tasks.filter(t => t.completed);
    list.innerHTML   = '';

    if (incomplete.length === 0 && done.length === 0) {
      list.innerHTML = '<p class="task-empty">No tasks yet — add one above ↑</p>';
      return;
    }

    // Group incomplete tasks by category
    const groups = {};
    incomplete.forEach(t => { (groups[t.category] = groups[t.category] || []).push(t); });
    Object.entries(groups).forEach(([cat, tasks]) => {
      const g = document.createElement('div');
      g.className = 'task-group';
      g.innerHTML = `<div class="task-group-label">${cat}</div>`;
      tasks.forEach(t => g.appendChild(this._taskEl(t)));
      list.appendChild(g);
    });

    // Completed section (collapsible)
    if (done.length > 0) {
      const toggle = document.createElement('button');
      toggle.className = 'task-show-completed-btn';
      toggle.textContent = `▾ Show ${done.length} completed task${done.length !== 1 ? 's' : ''}`;
      const doneWrap = document.createElement('div');
      doneWrap.style.display = 'none';
      toggle.addEventListener('click', () => {
        this._showDone = !this._showDone;
        doneWrap.style.display = this._showDone ? '' : 'none';
        toggle.textContent = this._showDone ? '▴ Hide completed' : `▾ Show ${done.length} completed task${done.length !== 1 ? 's' : ''}`;
      });
      done.forEach(t => doneWrap.appendChild(this._taskEl(t)));
      list.appendChild(toggle);
      list.appendChild(doneWrap);
    }
  },

  _taskEl(task) {
    const el = document.createElement('div');
    el.className = 'task-item' + (task.completed ? ' task-item-done' : '');

    const dots = [1, 2, 3].map(i =>
      `<span class="task-dot${i <= task.priority ? ' task-dot-active' : ''}"></span>`
    ).join('');
    const tags = (task.tags || []).map(t => `<span class="task-tag">${this._esc(t)}</span>`).join('');

    const checkIcon = task.completed
      ? `<svg viewBox="0 0 12 12" fill="none"><polyline points="1.5,6 5,9.5 10.5,2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : '';

    el.innerHTML = `
      <button class="task-check${task.completed ? ' checked' : ''}">${checkIcon}</button>
      <div class="task-body">
        <div class="task-title">${this._esc(task.title)}</div>
        <div class="task-meta">
          <div class="task-dots">${dots}</div>
          ${tags}
          ${task.estimated_minutes ? `<span class="task-est-badge">${task.estimated_minutes}m</span>` : ''}
        </div>
      </div>
      ${!task.completed ? `<button class="task-play-btn" title="Focus on this">▶</button>` : ''}
      <button class="task-del-btn" title="Delete">✕</button>`;

    // Bind via addEventListener (not onclick attributes)
    el.querySelector('.task-check').addEventListener('click', () => this.toggleComplete(task.id));
    el.querySelector('.task-del-btn').addEventListener('click', () => this.deleteTask(task.id));
    el.querySelector('.task-play-btn')?.addEventListener('click', () => this.startFocus(task.id));

    return el;
  },

  _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
};

// Expose globally so inline handlers still work as fallback
window.TaskManager = TaskManager;
