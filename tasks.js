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
  _recurDone:  {},  // { taskId: ['YYYY-MM-DD', ...] } — per-day completion for recurring
  _priority:   3,
  _showDone:   false,
  _bound:      false,

  // ── Init ──────────────────────────────────────────────────────────────────
  async init() {
    // One-time purge of old localStorage task data (now Supabase-only)
    try { localStorage.removeItem('flow-tasks'); localStorage.removeItem('flow-task-tombstones'); } catch(_) {}
    this._loadCategories();
    this._loadRecurDone();
    await this._load();
    // If categories were lost (localStorage cleared / new device), rebuild from task data
    if (this._categories.length === 0 && this._tasks.length > 0) {
      const names = [...new Set(this._tasks.map(t => t.category).filter(Boolean))];
      if (names.length) {
        this._categories = names.map(name => ({ name, reasons: [] }));
        this._saveCategories();
      }
    }
    this._populateCategorySelect();
    this._render();
    if (typeof WeekPlanner !== 'undefined') WeekPlanner._render();
    if (!this._bound) { this._bindButtons(); this._bound = true; }
  },

  // ── Persistence — Firestore (source of truth) + localStorage cache ─────────
  _CACHE_KEY: 'flow-tasks-cache',

  _saveCache() {
    try { localStorage.setItem(this._CACHE_KEY, JSON.stringify(this._tasks)); } catch(_) {}
  },

  _tasksRef(uid) {
    return _db.collection('users').doc(uid).collection('tasks');
  },

  // Firestore helpers
  async _sbInsert(row) {
    try {
      const uid = Auth.getUser()?.id;
      if (!uid) return false;
      const { id, user_id, ...data } = row;
      await this._tasksRef(uid).doc(id).set(data);
      return true;
    } catch(_) { return false; }
  },

  async _sbUpdate(id, patch) {
    try {
      const uid = Auth.getUser()?.id;
      if (!uid) return false;
      await this._tasksRef(uid).doc(id).update(patch);
      return true;
    } catch(_) { return false; }
  },

  async _sbDelete(id) {
    try {
      const uid = Auth.getUser()?.id;
      if (!uid) return false;
      await this._tasksRef(uid).doc(id).delete();
      return true;
    } catch(_) { return false; }
  },

  async _load() {
    // Show cached data immediately
    try { this._tasks = JSON.parse(localStorage.getItem(this._CACHE_KEY) || '[]'); } catch(_) { this._tasks = []; }
    // Fetch from Firestore — no cold starts, always fast
    try {
      const uid = Auth.getUser()?.id;
      if (!uid) return;
      const snap = await this._tasksRef(uid).orderBy('created_at').get();
      this._tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      this._saveCache();
    } catch (_) { /* stay with cached data if offline */ }
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

  // ── Per-day recurring completion ──────────────────────────────────────────
  _loadRecurDone() {
    try { this._recurDone = JSON.parse(localStorage.getItem('flow-recur-done') || '{}'); }
    catch(_) { this._recurDone = {}; }
  },

  _saveRecurDone() {
    try { localStorage.setItem('flow-recur-done', JSON.stringify(this._recurDone)); } catch(_) {}
  },

  // Is a recurring task done on a specific date?
  isDoneOn(taskId, ds) {
    return !!(this._recurDone[taskId] || []).includes(ds);
  },

  // Toggle done for a specific date (recurring tasks only)
  toggleDoneOn(taskId, ds) {
    if (!this._recurDone[taskId]) this._recurDone[taskId] = [];
    const idx = this._recurDone[taskId].indexOf(ds);
    if (idx === -1) this._recurDone[taskId].push(ds);
    else            this._recurDone[taskId].splice(idx, 1);
    this._saveRecurDone();
    this._render();
    if (typeof WeekPlanner !== 'undefined') WeekPlanner._render();
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
      hint.innerHTML = reasons.map(r => `<span class="cat-reason-line">💡 ${this._esc(r)}</span>`).join('');
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
      item.innerHTML = `<span>${this._esc(cat.name)}</span><button class="cat-edit-btn" title="Edit"><img src="icons/edit.svg" class="edit-icon" alt="Edit"></button><button class="cat-delete-btn" title="Delete">✕</button>`;
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
    const existingReasons = (cat.reasons || []).filter(Boolean);
    const reasonRows = existingReasons.length
      ? existingReasons.map(r => `<div class="cat-reason-row"><input type="text" class="task-field cat-reason-input" value="${this._esc(r)}" placeholder="Why are you working on this?"><button class="cat-reason-del-btn" title="Remove">✕</button></div>`).join('')
      : `<div class="cat-reason-row"><input type="text" class="task-field cat-reason-input" placeholder="Why are you working on this?"><button class="cat-reason-del-btn" title="Remove">✕</button></div>`;
    form.innerHTML = `
      <div class="cat-edit-form-title">Editing: <strong>${this._esc(name)}</strong></div>
      <input type="text" id="cat-edit-name" class="task-field" value="${this._esc(cat.name)}" placeholder="Category name…" maxlength="40">
      <div id="cat-reason-rows">${reasonRows}</div>
      <button class="cat-add-reason-btn" id="cat-add-reason-btn">+ Add reason</button>
      <div class="cat-edit-actions">
        <button class="btn-accent-sm" id="cat-edit-save-btn">Save</button>
        <button class="task-cancel-btn" id="cat-edit-cancel-btn">Cancel</button>
      </div>`;
    panel.appendChild(form);
    document.getElementById('cat-edit-name')?.focus();
    document.getElementById('cat-edit-save-btn').addEventListener('click', () => this._saveCatEdit(name));
    document.getElementById('cat-edit-cancel-btn').addEventListener('click', () => document.getElementById('cat-edit-form')?.remove());
    document.getElementById('cat-add-reason-btn').addEventListener('click', () => {
      const rows = document.getElementById('cat-reason-rows');
      const row  = document.createElement('div');
      row.className = 'cat-reason-row';
      row.innerHTML = `<input type="text" class="task-field cat-reason-input" placeholder="Another reason…"><button class="cat-reason-del-btn" title="Remove">✕</button>`;
      row.querySelector('.cat-reason-del-btn').addEventListener('click', () => row.remove());
      rows.appendChild(row);
      row.querySelector('input').focus();
    });
    form.querySelectorAll('.cat-reason-del-btn').forEach(btn =>
      btn.addEventListener('click', () => btn.closest('.cat-reason-row').remove())
    );
  },

  _saveCatEdit(originalName) {
    const newName = document.getElementById('cat-edit-name')?.value.trim();
    if (!newName) { document.getElementById('cat-edit-name')?.classList.add('task-field-error'); return; }
    const reasons = [...document.querySelectorAll('#cat-reason-rows .cat-reason-input')]
      .map(i => i.value.trim()).filter(Boolean);
    const idx = this._categories.findIndex(c => c.name === originalName);
    if (idx === -1) return;
    if (newName !== originalName) {
      this._tasks.forEach(t => { if (t.category === originalName) t.category = newName; });
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
    this._editingId = null;
    const submitBtn = document.getElementById('task-submit-btn');
    if (submitBtn) submitBtn.textContent = 'Add Task';
  },

  setPriority(p) {
    this._priority = p;
    document.querySelectorAll('#task-priority-pick .task-dot').forEach((el, i) => {
      el.classList.toggle('task-dot-active', i < p);
    });
  },

  // ── Edit existing task ────────────────────────────────────────────────────
  showEditForm(id) {
    const task = this._tasks.find(t => t.id === id);
    if (!task) return;
    this._editingId = id;

    // Reuse the add form — pre-fill with task data
    this.showAddForm();

    document.getElementById('task-title-input').value      = task.title || '';
    document.getElementById('task-est-select').value       = task.estimated_minutes || 25;
    document.getElementById('task-tags-input').value       = (task.tags || []).join(' ');
    document.getElementById('task-date-input').value       = task.scheduled_date || '';
    if (task.scheduled_date) {
      const btn = document.getElementById('task-date-clear-btn');
      if (btn) btn.style.display = '';
    }
    this.setPriority(task.priority || 2);

    // Set category — defer so select options are rendered first
    setTimeout(() => {
      const sel = document.getElementById('task-category-select');
      if (sel && task.category) sel.value = task.category;
    }, 50);

    // Set recurring days
    document.querySelectorAll('#task-recur-days .recur-day-btn').forEach(btn => {
      const day = parseInt(btn.dataset.day);
      btn.classList.toggle('active', (task.recurring_days || []).includes(day));
    });

    // Change button to Update
    const submitBtn = document.getElementById('task-submit-btn');
    if (submitBtn) submitBtn.textContent = 'Update Task';
  },

  async submitEdit() {
    const id   = this._editingId;
    const task = this._tasks.find(t => t.id === id);
    if (!task) return;

    const title = document.getElementById('task-title-input')?.value.trim();
    if (!title) {
      document.getElementById('task-title-input')?.classList.add('task-field-error');
      setTimeout(() => document.getElementById('task-title-input')?.classList.remove('task-field-error'), 800);
      return;
    }

    let category = document.getElementById('task-category-select')?.value;
    if (!category || category === '__new__') category = task.category || '';

    const estMins  = parseInt(document.getElementById('task-est-select')?.value || '25');
    const tagsRaw  = document.getElementById('task-tags-input')?.value.trim() || '';
    const tags     = tagsRaw ? tagsRaw.split(/[\s,]+/).filter(Boolean).map(t => t.startsWith('#') ? t : '#' + t) : [];
    const scheduledDate  = document.getElementById('task-date-input')?.value || null;
    const recurringDays  = [...document.querySelectorAll('#task-recur-days .recur-day-btn.active')]
      .map(b => parseInt(b.dataset.day));

    // Update in memory
    Object.assign(task, {
      title, category,
      estimated_minutes: estMins,
      priority: this._priority,
      tags,
      scheduled_date: scheduledDate,
      recurring_days: recurringDays.length > 0 ? recurringDays : null
    });

    this._saveCache();
    this.hideAddForm();
    this._editingId = null;
    this._render();
    if (typeof WeekPlanner !== 'undefined') WeekPlanner._render();

    // Sync to Firestore
    this._sbUpdate(id, {
      title, category,
      estimated_minutes: estMins,
      priority: this._priority,
      tags,
      scheduled_date: scheduledDate,
      recurring_days: recurringDays.length > 0 ? recurringDays : null
    }).then(ok => {
      if (!ok) this._toast('⚠️ Could not update in cloud', 3000);
    });
  },

  // ── Submit new task ────────────────────────────────────────────────────────
  async submitAdd() {
    if (this._editingId) { await this.submitEdit(); return; }
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
    const uid = typeof Auth !== 'undefined' && Auth.isLoggedIn() ? Auth.getUser()?.id : null;
    if (!uid) { this._toast('⚠️ Not logged in — task not saved', 4000); return; }

    // Client generates the UUID — same ID used in UI and Supabase, always in sync
    const task = {
      id: crypto.randomUUID(), title, category,
      estimated_minutes: estMins, priority: this._priority, tags,
      scheduled_date: scheduledDate,
      recurring_days: recurringDays.length > 0 ? recurringDays : null,
      completed: false, completed_at: null,
      created_at: new Date().toISOString()
    };

    // Show immediately — never block on network
    this._tasks.push(task);
    this._saveCache();
    this.hideAddForm();
    this._render();
    if (typeof WeekPlanner !== 'undefined') WeekPlanner._render();
    if (task.scheduled_date && task.scheduled_date > this._todayDs()) {
      const [y, m, d] = task.scheduled_date.split('-');
      this._toast(`✅ Scheduled for ${d}/${m}/${y} — see Weekly Plan ↓`);
    }

    // Sync to Supabase via direct fetch — client UUID sent as primary key
    this._sbInsert({ ...task, user_id: uid }).then(ok => {
      if (!ok) {
        this._tasks = this._tasks.filter(t => t.id !== task.id);
        this._saveCache(); this._render();
        this._toast('⚠️ Cloud sync failed — task removed. Check connection.', 5000);
      }
    });
  },

  _toast(msg, durationMs = 3000) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:#1e2d1e; color:#39ff14; border:1px solid rgba(57,255,20,0.3);
      padding:10px 20px; border-radius:12px; font-size:0.82rem; font-weight:600;
      z-index:9999; white-space:nowrap; box-shadow:0 4px 20px rgba(0,0,0,0.5);
      animation: toast-in 0.2s ease;
    `;
    document.body.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity 0.3s'; t.style.opacity = '0'; }, durationMs);
    setTimeout(() => t.remove(), durationMs + 300);
  },

  // ── Toggle complete ────────────────────────────────────────────────────────
  toggleComplete(id) {
    const task = this._tasks.find(t => t.id === id);
    if (!task) return;
    task.completed    = !task.completed;
    task.completed_at = task.completed ? new Date().toISOString() : null;
    this._saveCache();
    this._render();
    if (typeof WeekPlanner !== 'undefined') WeekPlanner._render();
    this._sbUpdate(id, { completed: task.completed, completed_at: task.completed_at });
  },

  // ── Delete ────────────────────────────────────────────────────────────────
  deleteTask(id) {
    this._tasks = this._tasks.filter(t => t.id !== id);
    this._saveCache();
    this._render();
    if (typeof WeekPlanner !== 'undefined') WeekPlanner._render();
    this._sbDelete(id).then(ok => {
      if (!ok) this._toast('⚠️ Could not delete from cloud', 3000);
    });
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
      // Timer idle — show total estimated minutes of today's incomplete tasks
      const totalSecs = this._tasks.filter(t => !t.completed && this._isToday(t))
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

  // Returns true if a task belongs to today
  _isToday(task) {
    const todayDs = this._todayDs();
    // Recurring tasks: visible from their scheduled_date onwards (or always if no start date)
    if (task.recurring_days?.length) {
      if (task.scheduled_date && todayDs < task.scheduled_date) return false;
      return true;
    }
    // One-off completed task: only show on the day it was completed
    if (task.completed) return task.completed_at?.slice(0, 10) === todayDs;
    if (task.scheduled_date) return task.scheduled_date === todayDs;
    return true; // unscheduled tasks always show
  },

  _todayDs() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  _dsAdd(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  _renderStats() {
    const todayDs    = this._todayDs();
    const todayTasks = this._tasks.filter(t => this._isToday(t));
    const isEffDone  = t => t.recurring_days?.length ? this.isDoneOn(t.id, todayDs) : t.completed;
    const incomplete = todayTasks.filter(t => !isEffDone(t));
    const doneToday  = todayTasks.filter(t =>  isEffDone(t));
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
    list.innerHTML = '';

    const todayDs    = this._todayDs();
    const tomorrowDs = this._dsAdd(1);
    const dayAfterDs = this._dsAdd(2);
    const isEffDone  = t => t.recurring_days?.length ? this.isDoneOn(t.id, todayDs) : t.completed;

    const todayIncomplete = this._tasks.filter(t => this._isToday(t) && !isEffDone(t));
    const doneToday       = this._tasks.filter(t => this._isToday(t) &&  isEffDone(t));
    const tomorrowTasks   = this._tasks.filter(t => !t.recurring_days?.length && t.scheduled_date === tomorrowDs && !t.completed);
    const dayAfterTasks   = this._tasks.filter(t => !t.recurring_days?.length && t.scheduled_date === dayAfterDs && !t.completed);

    const fmtDs = ds => new Date(ds + 'T00:00:00').toLocaleDateString('default', { weekday: 'short', day: 'numeric', month: 'short' });

    // ── Today ──────────────────────────────────────────────────────────────
    if (todayIncomplete.length === 0 && doneToday.length === 0) {
      list.innerHTML = '<p class="task-empty">Nothing for today — add a task or check the Weekly Plan ↓</p>';
    } else {
      const groups = {};
      todayIncomplete.forEach(t => { (groups[t.category] = groups[t.category] || []).push(t); });
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

      if (doneToday.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'task-done-divider';
        divider.textContent = `✓ Completed today (${doneToday.length})`;
        list.appendChild(divider);
        doneToday.forEach(t => list.appendChild(this._taskEl(t)));
      }
    }

    const fmtEst = tasks => {
      const mins = tasks.reduce((a, t) => a + (t.estimated_minutes || 0), 0);
      if (!mins) return '';
      return mins >= 60
        ? ` · ${Math.floor(mins/60)}h${mins%60 ? (mins%60)+'m' : ''}`
        : ` · ${mins}m`;
    };

    // ── Tomorrow ───────────────────────────────────────────────────────────
    if (tomorrowTasks.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'task-date-section';
      sec.innerHTML = `<div class="task-date-section-label">Tomorrow — ${fmtDs(tomorrowDs)}<span class="section-est">${fmtEst(tomorrowTasks)}</span></div>`;
      tomorrowTasks.forEach(t => sec.appendChild(this._taskEl(t)));
      list.appendChild(sec);
    }

    // ── Day after tomorrow ─────────────────────────────────────────────────
    if (dayAfterTasks.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'task-date-section';
      sec.innerHTML = `<div class="task-date-section-label">${fmtDs(dayAfterDs)}<span class="section-est">${fmtEst(dayAfterTasks)}</span></div>`;
      dayAfterTasks.forEach(t => sec.appendChild(this._taskEl(t)));
      list.appendChild(sec);
    }

    // ── Upcoming (beyond day-after-tomorrow) ───────────────────────────────
    const upcomingTasks = this._tasks
      .filter(t => !t.recurring_days?.length && t.scheduled_date > dayAfterDs && !t.completed)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));

    if (upcomingTasks.length > 0) {
      const sec = document.createElement('div');
      sec.className = 'task-date-section';
      sec.innerHTML = `<div class="task-date-section-label">Upcoming<span class="section-est">${fmtEst(upcomingTasks)}</span></div>`;
      upcomingTasks.forEach(t => sec.appendChild(this._taskEl(t)));
      list.appendChild(sec);
    }

  },

  async _refreshFromCloud() {
    const uid = typeof Auth !== 'undefined' && Auth.isLoggedIn() ? Auth.getUser()?.id : null;
    if (!uid) { this._toast('⚠️ Not logged in', 3000); return; }
    const btn = document.getElementById('task-save-cloud-btn');
    if (btn) { btn.innerHTML = '⏳ Loading…'; btn.disabled = true; }
    try {
      const snap = await this._tasksRef(uid).orderBy('created_at').get();
      this._tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      this._saveCache();
      this._render();
      if (typeof WeekPlanner !== 'undefined') WeekPlanner._render();
      if (btn) { btn.innerHTML = '✅ Up to date!'; btn.disabled = false; }
      setTimeout(() => { if (btn) btn.innerHTML = '🔄 Refresh from Cloud'; }, 2500);
    } catch(e) {
      if (btn) { btn.innerHTML = '❌ Failed — try again'; btn.disabled = false; }
      setTimeout(() => { if (btn) btn.innerHTML = '🔄 Refresh from Cloud'; }, 3000);
    }
  },

  _taskEl(task) {
    const el = document.createElement('div');
    el.className = 'task-item' + (task.completed ? ' task-item-done' : '');

    const dots = [1, 2, 3, 4, 5].map(i =>
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

    // For recurring tasks use per-day completion; for one-off use global flag
    const isRecurring = task.recurring_days?.length > 0;
    const todayDs     = this._todayDs();
    const isDone      = isRecurring ? this.isDoneOn(task.id, todayDs) : task.completed;

    const checkIcon = isDone
      ? `<svg viewBox="0 0 12 12" fill="none"><polyline points="1.5,6 5,9.5 10.5,2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : '';

    const completeStyle = this._getCompleteStyle();
    const useSlider = completeStyle === 'slider' && !isDone;

    const subtasks = task.subtasks || [];
    const subDone  = subtasks.filter(s => s.completed).length;
    const subBadge = subtasks.length ? `<span class="task-sub-badge">${subDone}/${subtasks.length}</span>` : '';
    const subTotal = subtasks.reduce((sum, s) => sum + (s.minutes || 0), 0);
    const subHtml  = subtasks.map(s => `
      <div class="task-subtask${s.completed ? ' task-subtask-done' : ''}" data-sid="${this._esc(s.id)}">
        <button class="task-subtask-check${s.completed ? ' checked' : ''}">
          ${s.completed ? `<svg viewBox="0 0 12 12" fill="none"><polyline points="1.5,6 5,9.5 10.5,2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
        </button>
        <span class="task-subtask-title">${this._esc(s.title)}</span>
        <input class="task-subtask-mins" type="number" min="1" max="120" placeholder="min" value="${s.minutes || ''}" title="Time in minutes">
        <button class="task-subtask-del" title="Remove">✕</button>
      </div>`).join('');

    el.className = 'task-item' + (isDone ? ' task-item-done' : '');
    el.innerHTML = `
      ${!useSlider ? `<button class="task-check${isDone ? ' checked' : ''}">${checkIcon}</button>` : ''}
      <div class="task-body">
        <div class="task-title">${this._esc(task.title)}</div>
        <div class="task-meta">
          <div class="task-dots">${dots}</div>
          ${tags}
          ${dateLabel}
          ${recurLabel}
          ${subBadge}
          ${subTotal > 0 ? `<span class="task-est-badge">${subTotal}m</span>` : task.estimated_minutes ? `<span class="task-est-badge">${task.estimated_minutes}m</span>` : ''}
        </div>
        ${subHtml ? `<div class="task-subtasks">${subHtml}</div>` : ''}
        <div class="task-subtask-add-row">
          <input class="task-subtask-input" placeholder="+ Add subtask…" type="text">
        </div>
      </div>
      ${!isDone ? `<button class="task-play-btn" title="Focus on this">▶</button>` : ''}
      ${!isDone ? `<button class="task-edit-btn" title="Edit"><img src="icons/edit.svg" class="edit-icon" alt="Edit"></button>` : ''}
      <button class="task-del-btn" title="Delete">✕</button>`;

    if (useSlider) {
      // Append slider as overlay covering the whole task-item (position: absolute; inset: 0)
      const onComplete = () => isRecurring ? this.toggleDoneOn(task.id, todayDs) : this.toggleComplete(task.id);
      el.appendChild(this._makeSlider(onComplete));
    } else {
      // Recurring → per-day toggle; one-off → global toggle
      el.querySelector('.task-check').addEventListener('click', (e) => {
        if (!isDone) {
          const r = e.currentTarget.getBoundingClientRect();
          this._triggerSparkle(r.left + r.width / 2, r.top + r.height / 2);
        }
        isRecurring ? this.toggleDoneOn(task.id, todayDs) : this.toggleComplete(task.id);
      });
    }

    el.querySelector('.task-del-btn').addEventListener('click', () => this.deleteTask(task.id));
    el.querySelector('.task-play-btn')?.addEventListener('click', () => this.startFocus(task.id));
    el.querySelector('.task-edit-btn')?.addEventListener('click', () => this.showEditForm(task.id));

    // Subtask: add on Enter
    el.querySelector('.task-subtask-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.addSubtask(task.id, e.target.value.trim()); e.target.value = ''; }
    });
    // Subtask: toggle complete
    el.querySelectorAll('.task-subtask-check').forEach(btn => {
      btn.addEventListener('click', () => this.toggleSubtask(task.id, btn.closest('.task-subtask').dataset.sid));
    });
    // Subtask: delete
    el.querySelectorAll('.task-subtask-del').forEach(btn => {
      btn.addEventListener('click', () => this.deleteSubtask(task.id, btn.closest('.task-subtask').dataset.sid));
    });
    // Subtask: time input → save and recalculate total
    el.querySelectorAll('.task-subtask-mins').forEach(input => {
      input.addEventListener('change', () => {
        const sid = input.closest('.task-subtask').dataset.sid;
        this.updateSubtaskMinutes(task.id, sid, parseInt(input.value) || 0);
      });
    });

    return el;
  },

  // ── Subtask methods ───────────────────────────────────────────────────────
  addSubtask(taskId, title) {
    if (!title) return;
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;
    if (!task.subtasks) task.subtasks = [];
    task.subtasks.push({ id: crypto.randomUUID(), title, completed: false });
    this._saveCache();
    this._render();
    this._sbUpdate(taskId, { subtasks: task.subtasks });
  },

  toggleSubtask(taskId, subtaskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;
    const sub = (task.subtasks || []).find(s => s.id === subtaskId);
    if (!sub) return;
    sub.completed = !sub.completed;
    this._saveCache();
    this._render();
    this._sbUpdate(taskId, { subtasks: task.subtasks });
  },

  deleteSubtask(taskId, subtaskId) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;
    task.subtasks = (task.subtasks || []).filter(s => s.id !== subtaskId);
    const total = task.subtasks.reduce((sum, s) => sum + (s.minutes || 0), 0);
    if (total > 0) task.estimated_minutes = total;
    this._saveCache();
    this._render();
    this._sbUpdate(taskId, { subtasks: task.subtasks, estimated_minutes: task.estimated_minutes });
  },

  updateSubtaskMinutes(taskId, subtaskId, mins) {
    const task = this._tasks.find(t => t.id === taskId);
    if (!task) return;
    const sub = (task.subtasks || []).find(s => s.id === subtaskId);
    if (!sub) return;
    sub.minutes = mins;
    // Sum all subtask times → update main task estimated_minutes
    const total = task.subtasks.reduce((sum, s) => sum + (s.minutes || 0), 0);
    if (total > 0) task.estimated_minutes = total;
    this._saveCache();
    this._render();
    this._sbUpdate(taskId, { subtasks: task.subtasks, estimated_minutes: total || task.estimated_minutes });
  },

  // ── Completion style ──────────────────────────────────────────────────────
  _getCompleteStyle() {
    try { return localStorage.getItem('flow-task-complete-style') || 'checkbox'; } catch(_) { return 'checkbox'; }
  },

  // ── Sparkle burst at (x, y) ───────────────────────────────────────────────
  _triggerSparkle(x, y) {
    const colors  = ['#39ff14','#ffd60a','#ff453a','#0a84ff','#ff2d92','#ffffff','#ff9500'];
    const symbols = ['✦','✧','★','•','✿','❋','◆'];
    for (let i = 0; i < 18; i++) {
      const el = document.createElement('span');
      el.className = 'sparkle-particle';
      el.textContent = symbols[Math.floor(Math.random() * symbols.length)];
      const angle = (i / 18) * 360 + Math.random() * 20;
      const dist  = 50 + Math.random() * 60;
      const rad   = angle * Math.PI / 180;
      el.style.cssText = `
        left:${x}px; top:${y}px;
        color:${colors[Math.floor(Math.random() * colors.length)]};
        font-size:${8 + Math.random() * 10}px;
        --dx:${Math.cos(rad) * dist}px;
        --dy:${Math.sin(rad) * dist}px;
        --dur:${0.5 + Math.random() * 0.4}s;
        animation-delay:${Math.random() * 0.08}s;
      `;
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
  },

  // ── Swipe slider element ──────────────────────────────────────────────────
  _makeSlider(onComplete) {
    const wrap   = document.createElement('div');
    wrap.className = 'task-slider-wrap';
    wrap.innerHTML = `<div class="task-slider-fill"></div><div class="task-slider-handle"></div><span class="task-slider-label">slide</span>`;
    const fill   = wrap.querySelector('.task-slider-fill');
    const handle = wrap.querySelector('.task-slider-handle');

    let dragging = false;

    const handleW = 14;
    const update = (clientX) => {
      if (!dragging) return;
      const rect = wrap.getBoundingClientRect();
      const travel = rect.width - handleW - 16;
      const raw    = clientX - rect.left - 8 - handleW / 2;
      const pct    = Math.min(100, Math.max(0, (raw / travel) * 100));
      fill.style.width  = pct + '%';
      handle.style.left = (8 + pct / 100 * travel) + 'px';
      if (pct >= 90) {
        dragging = false;
        fill.style.width  = '100%';
        handle.style.left = (rect.width - handleW - 8) + 'px';
        const r = wrap.getBoundingClientRect();
        this._triggerSparkle(r.right - 10, r.top + r.height / 2);
        setTimeout(() => onComplete(), 300);
      }
    };

    const reset = () => {
      if (!dragging) return;
      dragging = false;
      fill.style.width  = '0%';
      handle.style.left = '8px';
    };

    const onMove = e => update(e.touches ? e.touches[0].clientX : e.clientX);
    const onEnd  = () => {
      reset();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup',   onEnd);
      document.removeEventListener('touchend',  onEnd);
    };

    const startDrag = (clientX) => {
      dragging = true;
      update(clientX);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('mouseup',   onEnd);
      document.addEventListener('touchend',  onEnd);
    };

    wrap.addEventListener('mousedown',  e => startDrag(e.clientX));
    wrap.addEventListener('touchstart', e => startDrag(e.touches[0].clientX), { passive: true });

    return wrap;
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

  _ds(date) {
    // Use local date, not UTC — toISOString() shifts day in non-UTC timezones
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  },

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
      // 1. Scheduled to this exact date (not recurring)
      // 2. Recurring on this day-of-week (not globally completed)
      // 3. Fallback: created on this date (no schedule set, not recurring)
      const dow = date.getDay(); // 0=Sun
      const dayTasks = typeof TaskManager !== 'undefined'
        ? TaskManager._tasks.filter(t => {
            if (t.recurring_days?.length) {
              if (!t.recurring_days.includes(dow)) return false;
              // Respect scheduled_date as a start date for recurring tasks
              if (t.scheduled_date && ds < t.scheduled_date) return false;
              return true;
            }
            if (t.scheduled_date) return t.scheduled_date === ds;
            return !t.scheduled_date && t.created_at?.slice(0, 10) === ds;
          })
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

      // Synced tasks — checkable per-day for recurring, global for one-off
      if (dayTasks.length > 0) {
        const tasksDiv = document.createElement('div');
        tasksDiv.className = 'week-day-items';
        dayTasks.forEach(t => {
          const isRecurring = t.recurring_days?.length > 0;
          const isDone = isRecurring
            ? (typeof TaskManager !== 'undefined' && TaskManager.isDoneOn(t.id, ds))
            : t.completed;

          const el = document.createElement('div');
          el.className = 'week-day-item';
          // Only non-recurring tasks with a scheduled_date are draggable
          if (!isRecurring) {
            el.draggable = true;
            el.classList.add('week-task-draggable');
            el.dataset.taskId = t.id;
            el.addEventListener('dragstart', e => {
              e.dataTransfer.setData('text/plain', t.id);
              e.dataTransfer.effectAllowed = 'move';
              el.classList.add('dragging');
            });
            el.addEventListener('dragend', () => el.classList.remove('dragging'));
          }
          el.innerHTML = `
            <div class="week-item-check${isDone ? ' done' : ''}"></div>
            <span class="week-item-text${isDone ? ' done' : ''}">${this._esc(t.title)}</span>
            <div class="week-task-actions">
              <button class="week-task-edit-btn" title="Edit task">✏</button>
            </div>`;
          el.querySelector('.week-item-check').addEventListener('click', () => {
            if (typeof TaskManager === 'undefined') return;
            if (isRecurring) TaskManager.toggleDoneOn(t.id, ds);
            else TaskManager.toggleComplete(t.id);
          });
          el.querySelector('.week-task-shift-btn')?.addEventListener('click', e => {
            e.stopPropagation();
            if (typeof TaskManager === 'undefined') return;
            const next = new Date(ds + 'T00:00:00');
            next.setDate(next.getDate() + 1);
            const nextDs = next.toISOString().slice(0, 10);
            const task = TaskManager._tasks.find(tk => tk.id === t.id);
            if (!task) return;
            task.scheduled_date = nextDs;
            TaskManager._saveCache();
            TaskManager._render();
            TaskManager._sbUpdate(t.id, { scheduled_date: nextDs });
            WeekPlanner._render();
          });
          el.querySelector('.week-task-edit-btn')?.addEventListener('click', e => {
            e.stopPropagation();
            if (typeof TaskManager === 'undefined') return;
            // Switch to Tasks tab and open edit form
            if (typeof switchTimerType === 'function') switchTimerType('tasks');
            setTimeout(() => TaskManager.showEditForm(t.id), 200);
          });
          tasksDiv.appendChild(el);
        });
        content.appendChild(tasksDiv);
      }

      // Drop zone for dragged tasks
      content.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        content.classList.add('week-drop-over');
      });
      content.addEventListener('dragleave', () => content.classList.remove('week-drop-over'));
      content.addEventListener('drop', e => {
        e.preventDefault();
        content.classList.remove('week-drop-over');
        const taskId = e.dataTransfer.getData('text/plain');
        if (!taskId || typeof TaskManager === 'undefined') return;
        const task = TaskManager._tasks.find(t => t.id === taskId);
        if (!task || task.recurring_days?.length) return;
        if (task.scheduled_date === ds) return; // same day — no change
        task.scheduled_date = ds;
        TaskManager._saveCache();
        TaskManager._render();
        TaskManager._sbUpdate(taskId, { scheduled_date: ds });
        WeekPlanner._render();
      });

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
