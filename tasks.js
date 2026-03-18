// ─── Task Manager ─────────────────────────────────────────────────────────────

// ─── Task Activity Calendar ────────────────────────────────────────────────────

const TaskCalendar = {
  _year:  new Date().getFullYear(),
  _month: new Date().getMonth(), // 0-based
  _bound: false,

  init(tasks) {
    this._populateCategoryFilter(tasks);
    this._renderCalendar(tasks);
    if (!this._bound) {
      document.getElementById('tcal-prev')?.addEventListener('click', () => {
        if (this._month === 0) { this._month = 11; this._year--; }
        else this._month--;
        this._renderCalendar(TaskManager._tasks);
      });
      document.getElementById('tcal-next')?.addEventListener('click', () => {
        if (this._month === 11) { this._month = 0; this._year++; }
        else this._month++;
        this._renderCalendar(TaskManager._tasks);
      });
      document.getElementById('tcal-category-filter')?.addEventListener('change', () => {
        this._renderCalendar(TaskManager._tasks);
      });
      this._bound = true;
    }
  },

  _populateCategoryFilter(tasks) {
    const sel = document.getElementById('tcal-category-filter');
    if (!sel) return;
    const cats = [...new Set((tasks || []).map(t => t.category).filter(Boolean))];
    const current = sel.value;
    sel.innerHTML = '<option value="">All categories</option>' +
      cats.map(c => `<option value="${c}">${c}</option>`).join('');
    if (cats.includes(current)) sel.value = current;
  },

  _renderCalendar(tasks) {
    const grid    = document.getElementById('tcal-grid');
    const label   = document.getElementById('tcal-month-label');
    if (!grid || !label) return;

    // Apply category filter
    const filterCat = document.getElementById('tcal-category-filter')?.value || '';
    const filtered = filterCat ? (tasks || []).filter(t => t.category === filterCat) : (tasks || []);

    const y = this._year, m = this._month;
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    label.textContent = `${monthNames[m]} ${y}`;

    // Build counts map: 'YYYY-MM-DD' → activity count
    const counts = {};
    const planned = {}; // days that have planned (not-done) week items

    // Tasks: mark days with scheduled/created tasks; count completed
    filtered.forEach(t => {
      const dayKey = t.scheduled_date || t.created_at?.slice(0, 10);
      if (dayKey && counts[dayKey] === undefined) counts[dayKey] = 0;
      if (t.completed && t.completed_at) {
        const d = t.completed_at.slice(0, 10);
        counts[d] = (counts[d] || 0) + 1;
      }
      // For recurring tasks, mark each occurrence in this month
      if (t.recurring_days?.length) {
        for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
          const date = new Date(y, m, d);
          if (t.recurring_days.includes(date.getDay())) {
            const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            if (counts[ds] === undefined) counts[ds] = 0;
          }
        }
      }
    });

    // Week Planner: done items count toward the day; planned (not-done) items mark the day
    try {
      const wpData = JSON.parse(localStorage.getItem('flow-week-plan') || '{}');
      Object.entries(wpData).forEach(([ds, items]) => {
        (items || []).forEach(item => {
          if (item.done) {
            counts[ds] = (counts[ds] || 0) + 1;
          } else {
            planned[ds] = true; // has planned activity
          }
        });
      });
    } catch(_) {}

    const firstDay  = new Date(y, m, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = new Date().toISOString().slice(0, 10);

    grid.innerHTML = '';

    // Leading empty cells
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'tcal-cell tcal-empty';
      grid.appendChild(empty);
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const count = counts[ds];
      const isToday = ds === today;
      const isFuture = ds > today;

      const hasPlanned = planned[ds];
      const cell = document.createElement('div');
      cell.className = 'tcal-cell' +
        (isToday    ? ' tcal-today'   : '') +
        (isFuture   ? ' tcal-future'  : '') +
        (count > 0  ? ' tcal-active'  : '') +
        (hasPlanned && count === 0 ? ' tcal-planned' : '');

      cell.innerHTML = `<span class="tcal-day-num">${d}</span>${count > 0 ? `<span class="tcal-count">${count}</span>` : (hasPlanned ? `<span class="tcal-planned-dot"></span>` : '')}`;
      if (count > 0) cell.title = `${count} activity${count !== 1 ? 's' : ''} done`;
      else if (hasPlanned) cell.title = 'Activities planned';
      grid.appendChild(cell);
    }
  }
};

const TaskManager = {
  _tasks:      [],
  _categories: [],
  _priority:   2,
  _showDone:   false,
  _bound:      false,

  // ── Init ──────────────────────────────────────────────────────────────────
  async init() {
    this._loadCategories();
    await this._load();
    this._populateCategorySelect();
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

  // ── Category persistence ──────────────────────────────────────────────────
  _loadCategories() {
    try {
      const saved = JSON.parse(localStorage.getItem('flow-task-categories') || 'null');
      if (Array.isArray(saved) && saved.length) this._categories = saved;
    } catch (_) {}
  },

  _saveCategories() {
    try { localStorage.setItem('flow-task-categories', JSON.stringify(this._categories)); } catch (_) {}
  },

  _populateCategorySelect() {
    const sel = document.getElementById('task-category-select');
    if (!sel) return;
    const current = sel.value;
    if (this._categories.length === 0) {
      sel.innerHTML = `<option value="__new__">+ Create a category first…</option>`;
    } else {
      sel.innerHTML = this._categories.map(c =>
        `<option value="${this._esc(c.name)}">${this._esc(c.name)}</option>`
      ).join('') + `<option value="__new__">+ New category…</option>`;
      if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
    }
  },

  _showCatReason(name) {
    const cat = this._categories.find(c => c.name === name);
    const hint = document.getElementById('cat-reason-hint');
    if (!hint) return;
    const reasons = (cat?.reasons || []).filter(Boolean);
    if (reasons.length) {
      hint.innerHTML = reasons.map((r, i) => `<span class="cat-reason-line">💡 ${this._esc(r)}</span>`).join('');
      hint.style.display = '';
    } else {
      hint.style.display = 'none';
    }
  },

  // ── Bind all interactive buttons once ─────────────────────────────────────
  _bindButtons() {
    document.getElementById('task-add-trigger')?.addEventListener('click', () => this.showAddForm());
    // Recurring day toggles
    document.querySelectorAll('#task-recur-days .recur-day-btn').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    });
    document.getElementById('task-date-input')?.addEventListener('input', e => {
      const btn = document.getElementById('task-date-clear-btn');
      if (btn) btn.style.display = e.target.value ? '' : 'none';
    });
    document.getElementById('task-date-clear-btn')?.addEventListener('click', () => {
      const inp = document.getElementById('task-date-input');
      if (inp) inp.value = '';
      const btn = document.getElementById('task-date-clear-btn');
      if (btn) btn.style.display = 'none';
    });
    document.getElementById('task-submit-btn')?.addEventListener('click', () => this.submitAdd());
    document.getElementById('task-cancel-btn')?.addEventListener('click', () => this.hideAddForm());
    document.getElementById('task-title-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.submitAdd(); }
    });
    document.querySelectorAll('#task-priority-pick .task-dot').forEach((el, i) => {
      el.addEventListener('click', () => this.setPriority(i + 1));
    });

    // Category select — show new-cat form or reason hint
    const _handleCatSelect = (val) => {
      if (val === '__new__') {
        document.getElementById('new-cat-form').style.display = '';
        document.getElementById('new-cat-name')?.focus();
        document.getElementById('cat-reason-hint').style.display = 'none';
      } else {
        document.getElementById('new-cat-form').style.display = 'none';
        this._showCatReason(val);
      }
    };
    document.getElementById('task-category-select')?.addEventListener('change', e => _handleCatSelect(e.target.value));
    document.getElementById('task-category-select')?.addEventListener('click', e => {
      if (e.target.value === '__new__') _handleCatSelect('__new__');
    });

    // Save new category
    document.getElementById('new-cat-save-btn')?.addEventListener('click', () => this._saveNewCategory());
    document.getElementById('new-cat-cancel-btn')?.addEventListener('click', () => {
      document.getElementById('new-cat-form').style.display = 'none';
      const sel = document.getElementById('task-category-select');
      if (sel) sel.value = this._categories[0]?.name || 'Personal';
    });
    document.getElementById('new-cat-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this._saveNewCategory(); }
    });

    // Category manager toggle
    document.getElementById('task-cat-manage-btn')?.addEventListener('click', () => this._toggleCatManager());
  },

  _toggleCatManager() {
    const panel = document.getElementById('cat-manager');
    if (!panel) return;
    if (panel.style.display === 'none') {
      this._renderCatManager();
      panel.style.display = '';
    } else {
      panel.style.display = 'none';
    }
  },

  _renderCatManager() {
    const list = document.getElementById('cat-manager-list');
    if (!list) return;
    if (this._categories.length === 0) {
      list.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem;">No categories yet.</span>';
      return;
    }
    list.innerHTML = '';
    this._categories.forEach(cat => {
      const item = document.createElement('div');
      item.className = 'cat-manager-item';
      item.innerHTML = `<span>${this._esc(cat.name)}</span><button class="cat-edit-btn" title="Edit">✏</button><button class="cat-delete-btn" title="Delete">✕</button>`;
      item.querySelector('.cat-edit-btn').addEventListener('click', () => this._showCatEditForm(cat.name));
      item.querySelector('.cat-delete-btn').addEventListener('click', () => this.deleteCategory(cat.name));
      list.appendChild(item);
    });
  },

  _showCatEditForm(name) {
    document.getElementById('cat-edit-form')?.remove();
    const cat = this._categories.find(c => c.name === name);
    if (!cat) return;
    const panel = document.getElementById('cat-manager');
    const form = document.createElement('div');
    form.className = 'cat-edit-form';
    form.id = 'cat-edit-form';
    form.innerHTML = `
      <div class="cat-edit-form-title">Editing: <strong>${this._esc(name)}</strong></div>
      <input type="text" id="cat-edit-name" class="task-field" value="${this._esc(cat.name)}" placeholder="Category name…" maxlength="40">
      <input type="text" id="cat-edit-reason-1" class="task-field" value="${this._esc(cat.reasons?.[0] || '')}" placeholder="Reason 1 — why are you working on this?">
      <input type="text" id="cat-edit-reason-2" class="task-field" value="${this._esc(cat.reasons?.[1] || '')}" placeholder="Reason 2 (optional)">
      <input type="text" id="cat-edit-reason-3" class="task-field" value="${this._esc(cat.reasons?.[2] || '')}" placeholder="Reason 3 (optional)">
      <div class="cat-edit-actions">
        <button class="btn-accent-sm" id="cat-edit-save-btn">Save</button>
        <button class="task-cancel-btn" id="cat-edit-cancel-btn">Cancel</button>
      </div>`;
    panel.appendChild(form);
    document.getElementById('cat-edit-name')?.focus();
    document.getElementById('cat-edit-save-btn').addEventListener('click', () => this._saveCatEdit(name));
    document.getElementById('cat-edit-cancel-btn').addEventListener('click', () => document.getElementById('cat-edit-form')?.remove());
  },

  _saveCatEdit(originalName) {
    const newName = document.getElementById('cat-edit-name')?.value.trim();
    if (!newName) { document.getElementById('cat-edit-name')?.classList.add('task-field-error'); return; }
    const reasons = [
      document.getElementById('cat-edit-reason-1')?.value.trim() || '',
      document.getElementById('cat-edit-reason-2')?.value.trim() || '',
      document.getElementById('cat-edit-reason-3')?.value.trim() || ''
    ].filter(Boolean);
    const idx = this._categories.findIndex(c => c.name === originalName);
    if (idx === -1) return;
    if (newName !== originalName) {
      this._tasks.forEach(t => { if (t.category === originalName) t.category = newName; });
      this._saveLocal();
    }
    this._categories[idx] = { name: newName, reasons };
    this._saveCategories();
    this._populateCategorySelect();
    document.getElementById('cat-edit-form')?.remove();
    this._renderCatManager();
  },

  deleteCategory(name) {
    this._categories = this._categories.filter(c => c.name !== name);
    this._saveCategories();
    this._populateCategorySelect();
    document.getElementById('cat-edit-form')?.remove();
    this._renderCatManager();
  },

  _saveNewCategory() {
    const nameEl = document.getElementById('new-cat-name');
    const name   = nameEl?.value.trim();
    if (!name) { nameEl?.classList.add('task-field-error'); setTimeout(() => nameEl?.classList.remove('task-field-error'), 800); return; }

    const reasons = [
      document.getElementById('new-cat-reason-1')?.value.trim() || '',
      document.getElementById('new-cat-reason-2')?.value.trim() || '',
      document.getElementById('new-cat-reason-3')?.value.trim() || ''
    ].filter(Boolean);

    if (!this._categories.find(c => c.name.toLowerCase() === name.toLowerCase())) {
      this._categories.push({ name, reasons });
      this._saveCategories();
    }
    this._populateCategorySelect();
    const sel = document.getElementById('task-category-select');
    if (sel) sel.value = name;
    this._showCatReason(name);
    ['new-cat-name','new-cat-reason-1','new-cat-reason-2','new-cat-reason-3'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('new-cat-form').style.display = 'none';
  },

  // ── Add form show / hide ───────────────────────────────────────────────────
  showAddForm() {
    document.getElementById('task-add-trigger').style.display = 'none';
    document.getElementById('task-add-form').style.display    = 'flex';
    document.getElementById('task-title-input')?.focus();
    // If no categories yet, auto-open the new category form
    if (this._categories.length === 0) {
      document.getElementById('new-cat-form').style.display = '';
    }
  },

  hideAddForm() {
    document.getElementById('task-add-form').style.display    = 'none';
    document.getElementById('task-add-trigger').style.display = '';
    if (document.getElementById('task-title-input'))
      document.getElementById('task-title-input').value = '';
    if (document.getElementById('task-tags-input'))
      document.getElementById('task-tags-input').value = '';
    const dateInp = document.getElementById('task-date-input');
    if (dateInp) dateInp.value = '';
    const dateClear = document.getElementById('task-date-clear-btn');
    if (dateClear) dateClear.style.display = 'none';
    document.querySelectorAll('#task-recur-days .recur-day-btn').forEach(b => b.classList.remove('active'));
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

    const category = document.getElementById('task-category-select')?.value;
    if (!category || category === '__new__') {
      document.getElementById('new-cat-form').style.display = '';
      document.getElementById('new-cat-name')?.focus();
      return;
    }
    const estMins  = parseInt(document.getElementById('task-est-select')?.value || '25');
    const tagsRaw  = document.getElementById('task-tags-input')?.value.trim() || '';
    const tags = tagsRaw
      ? tagsRaw.split(/[\s,]+/).filter(Boolean).map(t => t.startsWith('#') ? t : '#' + t)
      : [];

    const scheduledDate = document.getElementById('task-date-input')?.value || null;
    const recurringDays = [...document.querySelectorAll('#task-recur-days .recur-day-btn.active')]
      .map(b => parseInt(b.dataset.day)); // 0=Sun,1=Mon…6=Sat
    const task = {
      id:                (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36),
      title,
      category,
      estimated_minutes: estMins,
      priority:          this._priority,
      tags,
      scheduled_date:    scheduledDate,
      recurring_days:    recurringDays.length > 0 ? recurringDays : null,
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
  // ── Live sync with main timer ──────────────────────────────────────────────
  syncTimer() {
    const estEl = document.getElementById('task-est-time');
    if (!estEl) return;
    const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    // When timer is running on a work session, show live countdown
    if (typeof state !== 'undefined' && state.status === 'running' && state.mode === 'work') {
      estEl.textContent = fmt(state.timeLeft);
      estEl.classList.add('task-stat-live');
    } else {
      // Timer idle — show total estimated minutes of incomplete tasks
      const totalSecs = this._tasks.filter(t => !t.completed)
        .reduce((a, t) => a + (t.estimated_minutes || 0) * 60, 0);
      estEl.textContent = fmt(totalSecs);
      estEl.classList.remove('task-stat-live');
    }
  },

  _render() {
    this._renderStats();
    this._renderList();
    TaskCalendar.init(this._tasks);
  },

  _renderStats() {
    const today      = new Date().toISOString().slice(0, 10);
    const incomplete = this._tasks.filter(t => !t.completed);
    const doneToday  = this._tasks.filter(t => t.completed && t.completed_at?.slice(0, 10) === today);
    const estSecs    = incomplete.reduce((a, t) => a + (t.estimated_minutes || 0) * 60, 0);
    const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    const estEl  = document.getElementById('task-est-time');
    const todoEl = document.getElementById('task-todo-count');
    const doneEl = document.getElementById('task-done-count');
    if (estEl)  estEl.textContent  = fmt(estSecs);
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
      const catData = this._categories.find(c => c.name === cat);
      const reasons = (catData?.reasons || []).filter(Boolean);
      const g = document.createElement('div');
      g.className = 'task-group';
      g.innerHTML = `<div class="task-group-label">${this._esc(cat)}</div>`
        + (reasons.length ? `<div class="task-group-reasons">${reasons.map(r => `<span class="task-group-reason-item">💡 ${this._esc(r)}</span>`).join('')}</div>` : '');
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
    const dateLabel = task.scheduled_date
      ? `<span class="task-scheduled-badge">📅 ${task.scheduled_date.slice(5).replace('-','/')}</span>`
      : '';
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const recurLabel = (task.recurring_days?.length > 0)
      ? `<span class="task-recur-badge">🔁 ${task.recurring_days.map(d => dayNames[d]).join(' ')}</span>`
      : '';

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
          ${dateLabel}
          ${recurLabel}
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

// ─── Brain Dump ────────────────────────────────────────────────────────────────
const BrainDump = {
  _items: [],
  _bound: false,

  init() {
    this._load();
    this._render();
    if (!this._bound) { this._bind(); this._bound = true; }
  },

  _load() {
    try { this._items = JSON.parse(localStorage.getItem('flow-brain-dump') || '[]'); }
    catch(_) { this._items = []; }
  },

  _save() {
    try { localStorage.setItem('flow-brain-dump', JSON.stringify(this._items)); } catch(_) {}
  },

  _bind() {
    document.getElementById('dump-add-btn')?.addEventListener('click', () => this.add());
    document.getElementById('dump-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.add(); }
    });
  },

  add() {
    const input = document.getElementById('dump-input');
    const text = input?.value.trim();
    if (!text) return;
    this._items.unshift({ id: Date.now().toString(36), text, created: new Date().toISOString() });
    this._save();
    this._render();
    if (input) input.value = '';
  },

  delete(id) {
    this._items = this._items.filter(i => i.id !== id);
    this._save();
    this._render();
  },

  moveToTasks(id) {
    const item = this._items.find(i => i.id === id);
    if (!item) return;
    if (typeof TaskManager !== 'undefined') {
      TaskManager.showAddForm();
      const el = document.getElementById('task-title-input');
      if (el) { el.value = item.text; el.focus(); }
    }
    this.delete(id);
  },

  _render() {
    const list = document.getElementById('dump-list');
    if (!list) return;
    if (this._items.length === 0) {
      list.innerHTML = '<li class="dump-empty">Nothing here yet — type above and press Enter</li>';
      return;
    }
    list.innerHTML = '';
    this._items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'dump-item';
      li.innerHTML = `
        <span class="dump-item-text">${this._esc(item.text)}</span>
        <button class="dump-move-btn" title="Move to task list">→ Tasks</button>
        <button class="dump-del-btn" title="Delete">✕</button>`;
      li.querySelector('.dump-move-btn').addEventListener('click', () => this.moveToTasks(item.id));
      li.querySelector('.dump-del-btn').addEventListener('click', () => this.delete(item.id));
      list.appendChild(li);
    });
  },

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
};
window.BrainDump = BrainDump;

// ─── Week Planner ──────────────────────────────────────────────────────────────
const WeekPlanner = {
  _data:       {},  // { 'YYYY-MM-DD': [{ id, text, done }] }
  _weekOffset: 0,   // 0 = current week, ±N = weeks back/forward
  _bound:      false,

  init() {
    this._load();
    this._render();
    if (!this._bound) { this._bind(); this._bound = true; }
  },

  _load() {
    try { this._data = JSON.parse(localStorage.getItem('flow-week-plan') || '{}'); }
    catch(_) { this._data = {}; }
  },

  _save() {
    try { localStorage.setItem('flow-week-plan', JSON.stringify(this._data)); } catch(_) {}
  },

  _bind() {
    document.getElementById('week-prev-btn')?.addEventListener('click', () => { this._weekOffset--; this._render(); });
    document.getElementById('week-next-btn')?.addEventListener('click', () => { this._weekOffset++; this._render(); });
  },

  // Returns array of 7 Dates (Mon–Sun) for the current offset week
  _weekDates() {
    const today = new Date();
    const dow = today.getDay(); // 0=Sun
    const mon = new Date(today);
    mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + this._weekOffset * 7);
    mon.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon); d.setDate(mon.getDate() + i); return d;
    });
  },

  _ds(date) { return date.toISOString().slice(0, 10); },

  addItem(ds, text) {
    if (!text) return;
    if (!this._data[ds]) this._data[ds] = [];
    this._data[ds].push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2,5), text, done: false });
    this._save();
    this._render();
  },

  toggleItem(ds, id) {
    const item = (this._data[ds] || []).find(i => i.id === id);
    if (item) { item.done = !item.done; this._save(); this._render(); }
  },

  deleteItem(ds, id) {
    if (this._data[ds]) {
      this._data[ds] = this._data[ds].filter(i => i.id !== id);
      this._save(); this._render();
    }
  },

  _render() {
    const grid  = document.getElementById('week-grid');
    const label = document.getElementById('week-label');
    if (!grid) return;

    const dates    = this._weekDates();
    const todayDs  = new Date().toISOString().slice(0, 10);
    const dayNames = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    if (label) {
      const fmt = d => `${d.getDate()} ${d.toLocaleString('default', { month: 'short' })}`;
      label.textContent = `📅 ${fmt(dates[0])} – ${fmt(dates[6])}`;
    }

    grid.innerHTML = '';
    dates.forEach((date, idx) => {
      const ds      = this._ds(date);
      const items   = this._data[ds] || [];
      const isToday = ds === todayDs;

      // Synced tasks from TaskManager:
      // 1. Scheduled to this exact date
      // 2. Recurring on this day-of-week
      // 3. Fallback: created on this date (no schedule set)
      const dow = date.getDay(); // 0=Sun
      const dayTasks = typeof TaskManager !== 'undefined'
        ? TaskManager._tasks.filter(t =>
            (t.scheduled_date && t.scheduled_date === ds) ||
            (t.recurring_days?.includes(dow)) ||
            (!t.scheduled_date && !t.recurring_days?.length && t.created_at?.slice(0, 10) === ds)
          )
        : [];

      const row = document.createElement('div');
      row.className = 'week-day-row' + (isToday ? ' week-today' : '');

      // Day label column
      const header = document.createElement('div');
      header.className = 'week-day-header';
      header.innerHTML = `<div class="week-day-label">${dayNames[idx]}</div><div class="week-day-date">${date.getDate()}/${date.getMonth()+1}</div>`;

      // Content column
      const content = document.createElement('div');
      content.className = 'week-day-content';

      // Planned week items
      if (items.length > 0) {
        const itemsDiv = document.createElement('div');
        itemsDiv.className = 'week-day-items';
        items.forEach(item => {
          const el = document.createElement('div');
          el.className = 'week-day-item';
          el.innerHTML = `
            <div class="week-item-check${item.done ? ' done' : ''}"></div>
            <span class="week-item-text${item.done ? ' done' : ''}">${this._esc(item.text)}</span>
            <button class="week-item-del">✕</button>`;
          el.querySelector('.week-item-check').addEventListener('click', () => this.toggleItem(ds, item.id));
          el.querySelector('.week-item-del').addEventListener('click', () => this.deleteItem(ds, item.id));
          itemsDiv.appendChild(el);
        });
        content.appendChild(itemsDiv);
      }

      // Synced tasks (read-only, shows tasks created that day)
      if (dayTasks.length > 0) {
        const tasksDiv = document.createElement('div');
        tasksDiv.className = 'week-day-items';
        dayTasks.forEach(t => {
          const el = document.createElement('div');
          el.className = 'week-task-item' + (t.completed ? ' done-task' : '');
          el.innerHTML = `<span class="week-task-badge">task</span><span class="week-task-text">${this._esc(t.title)}</span>`;
          tasksDiv.appendChild(el);
        });
        content.appendChild(tasksDiv);
      }

      // Collapsed add trigger → expands to input row
      const addTrigger = document.createElement('button');
      addTrigger.className = 'week-day-add-trigger';
      addTrigger.textContent = '+ Add activity';

      const addRow = document.createElement('div');
      addRow.className = 'week-day-add-row';
      addRow.style.display = 'none';
      addRow.innerHTML = `
        <input type="text" class="week-day-add-input" placeholder="Activity name…" maxlength="120">
        <button class="week-day-add-btn">Add</button>`;

      const inp = addRow.querySelector('.week-day-add-input');
      const btn = addRow.querySelector('.week-day-add-btn');

      addTrigger.addEventListener('click', () => {
        addTrigger.style.display = 'none';
        addRow.style.display = 'flex';
        inp.focus();
      });

      const doAdd = () => {
        const text = inp.value.trim();
        if (text) { this.addItem(ds, text); }
        else { addRow.style.display = 'none'; addTrigger.style.display = ''; }
      };

      btn.addEventListener('click', doAdd);
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); doAdd(); }
        if (e.key === 'Escape') { addRow.style.display = 'none'; addTrigger.style.display = ''; }
      });
      inp.addEventListener('blur', () => {
        if (!inp.value.trim()) setTimeout(() => { addRow.style.display = 'none'; addTrigger.style.display = ''; }, 150);
      });

      content.appendChild(addTrigger);
      content.appendChild(addRow);
      row.appendChild(header);
      row.appendChild(content);
      grid.appendChild(row);
    });
  },

  _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
};
window.WeekPlanner = WeekPlanner;
