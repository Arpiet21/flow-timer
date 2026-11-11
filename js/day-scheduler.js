// ── Day Scheduler ─────────────────────────────────────────────────────────────
// Google Calendar-style day view. Shows tasks at their scheduled_time slots.
// Tasks without a scheduled_time appear in the "Unscheduled" strip at the top.

const DayScheduler = {
  _date: null,     // Date object (midnight) for the displayed day
  _bound: false,
  _nowTimer: null,

  // ── Public ────────────────────────────────────────────────────────────────
  init() {
    if (this._bound) return;
    this._date = new Date();
    this._date.setHours(0, 0, 0, 0);
    this._bindNav();
    this._bindViewToggle();
    this._render();
    // Advance the "now" line every minute when visible
    this._nowTimer = setInterval(() => {
      if (!document.getElementById('day-scheduler')?.offsetParent) return;
      const line = document.getElementById('day-now-line');
      if (!line) return;
      const now = new Date();
      const mins = (now.getHours() - DayScheduler.START_HOUR) * 60 + now.getMinutes();
      if (mins >= 0) line.style.top = (mins * DayScheduler.PX_PER_MIN) + 'px';
    }, 60000);
  },

  refresh() {
    if (document.getElementById('day-view-btn')?.classList.contains('active')) {
      this._render();
    }
  },

  // ── Constants ─────────────────────────────────────────────────────────────
  START_HOUR: 6,
  END_HOUR: 23,
  PX_PER_MIN: 1.3,   // pixels per minute → ~78px per hour

  // ── Nav binding ───────────────────────────────────────────────────────────
  _bindNav() {
    document.getElementById('day-prev-btn')?.addEventListener('click', () => {
      this._date.setDate(this._date.getDate() - 1);
      this._render();
    });
    document.getElementById('day-next-btn')?.addEventListener('click', () => {
      this._date.setDate(this._date.getDate() + 1);
      this._render();
    });
    document.getElementById('day-today-btn')?.addEventListener('click', () => {
      this._date = new Date();
      this._date.setHours(0, 0, 0, 0);
      this._render();
    });
    this._bound = true;
  },

  _bindViewToggle() {
    const listBtn = document.getElementById('list-view-btn');
    const dayBtn  = document.getElementById('day-view-btn');
    if (!listBtn || !dayBtn) return;

    listBtn.addEventListener('click', () => {
      listBtn.classList.add('active');
      dayBtn.classList.remove('active');
      document.getElementById('list-view').style.display = '';
      document.getElementById('day-scheduler').style.display = 'none';
    });

    dayBtn.addEventListener('click', () => {
      dayBtn.classList.add('active');
      listBtn.classList.remove('active');
      document.getElementById('list-view').style.display = 'none';
      document.getElementById('day-scheduler').style.display = '';
      this.init();
      this._render();
      // Scroll to current time on today
      setTimeout(() => this._scrollToNow(), 100);
    });
  },

  // ── Helpers ───────────────────────────────────────────────────────────────
  _ds(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  _todayDs() {
    return this._ds(new Date());
  },

  _esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0; }
    return h;
  },

  _catColor(category) {
    if (!category) return '#6e6e73';
    const palette = ['#0a84ff', '#30d158', '#ff9f0a', '#ff453a', '#bf5af2', '#64d2ff', '#ffd60a', '#ff6961', '#5e5ce6'];
    return palette[Math.abs(this._hash(category)) % palette.length];
  },

  _fmtHour(h) {
    if (h === 0)  return '12 AM';
    if (h < 12)   return `${h} AM`;
    if (h === 12) return '12 PM';
    return `${h - 12} PM`;
  },

  // ── Task fetching ─────────────────────────────────────────────────────────
  _getTasksForDay(ds) {
    if (typeof TaskManager === 'undefined') return [];
    const dayOfWeek = new Date(ds + 'T12:00:00').getDay(); // 0=Sun
    return (TaskManager._tasks || []).filter(t => {
      if (t.completed) return false;
      if (t.scheduled_date === ds) return true;
      if (t.recurring_days?.includes(dayOfWeek)) {
        const start = t.scheduled_date || '0000-00-00';
        return ds >= start;
      }
      return false;
    });
  },

  _getDoneTasksForDay(ds) {
    if (typeof TaskManager === 'undefined') return [];
    return (TaskManager._tasks || []).filter(t => {
      if (!t.completed) return false;
      // completed today or scheduled for today and done
      const completedDs = t.completed_at ? t.completed_at.slice(0, 10) : null;
      return completedDs === ds || t.scheduled_date === ds;
    });
  },

  // ── Main render ───────────────────────────────────────────────────────────
  _render() {
    if (!document.getElementById('day-scheduler')) return;
    const ds     = this._ds(this._date);
    const isToday = ds === this._todayDs();

    // Header label
    const label = document.getElementById('day-label');
    if (label) {
      const opts = { weekday: 'long', month: 'long', day: 'numeric' };
      const dateStr = this._date.toLocaleDateString(undefined, opts);
      label.textContent = isToday ? `Today  ·  ${dateStr}` : dateStr;
    }

    const pending = this._getTasksForDay(ds);
    const done    = this._getDoneTasksForDay(ds);
    const all     = [...pending, ...done];
    const scheduled   = all.filter(t => t.scheduled_time);
    const unscheduled = pending.filter(t => !t.scheduled_time);

    this._renderUnscheduled(unscheduled, ds);
    this._renderGrid(scheduled, ds, isToday);
  },

  // ── Unscheduled strip ─────────────────────────────────────────────────────
  _renderUnscheduled(tasks, ds) {
    const el = document.getElementById('day-unscheduled');
    if (!el) return;

    if (!tasks.length) {
      el.innerHTML = '';
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.innerHTML = `
      <div class="day-unsched-label">Unscheduled  ·  ${tasks.length} task${tasks.length !== 1 ? 's' : ''}</div>
      <div class="day-unsched-chips">
        ${tasks.map(t => `
          <div class="day-unsched-chip" data-id="${t.id}">
            <span class="day-chip-dot" style="background:${this._catColor(t.category)}"></span>
            <span class="day-chip-title">${this._esc(t.title)}</span>
            ${t.estimated_minutes ? `<span class="day-chip-dur">${t.estimated_minutes}m</span>` : ''}
          </div>`).join('')}
      </div>`;

    el.querySelectorAll('.day-unsched-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.id;
        // Switch to list view and open edit form
        document.getElementById('list-view-btn')?.click();
        setTimeout(() => {
          if (typeof switchTimerType === 'function') switchTimerType('tasks');
          setTimeout(() => TaskManager?.showEditForm(id), 100);
        }, 50);
      });
    });
  },

  // ── Hour grid ────────────────────────────────────────────────────────────
  _renderGrid(scheduledTasks, ds, isToday) {
    const grid = document.getElementById('day-sched-grid');
    if (!grid) return;

    const HOUR_HEIGHT = 60 * this.PX_PER_MIN;
    const totalHeight = (this.END_HOUR - this.START_HOUR + 1) * HOUR_HEIGHT;

    // Build hour rows HTML
    let hoursHtml = '';
    for (let h = this.START_HOUR; h <= this.END_HOUR; h++) {
      hoursHtml += `
        <div class="day-hour-row" data-hour="${h}" style="height:${HOUR_HEIGHT}px">
          <span class="day-hour-label">${this._fmtHour(h)}</span>
          <div class="day-hour-line"></div>
        </div>`;
    }

    // Current time line
    let nowHtml = '';
    if (isToday) {
      const now  = new Date();
      const mins = (now.getHours() - this.START_HOUR) * 60 + now.getMinutes();
      if (mins >= 0 && mins <= (this.END_HOUR - this.START_HOUR + 1) * 60) {
        const top = mins * this.PX_PER_MIN;
        nowHtml = `<div class="day-now-line" id="day-now-line" style="top:${top}px"></div>`;
      }
    }

    grid.innerHTML = `
      <div class="day-grid-inner" style="height:${totalHeight}px; position:relative;">
        ${hoursHtml}
        <div class="day-tasks-layer" id="day-tasks-layer"></div>
        ${nowHtml}
      </div>`;

    // Bind click on hour rows → pre-fill add form
    grid.querySelectorAll('.day-hour-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('.day-task-block')) return;
        const h    = parseInt(row.dataset.hour);
        const rect = row.getBoundingClientRect();
        const relY = Math.max(0, e.clientY - rect.top);
        const clickedMins = Math.floor(relY / this.PX_PER_MIN);
        const snapped = Math.round(clickedMins / 15) * 15;
        const totalMins = h * 60 + snapped;
        const hh  = String(Math.floor(totalMins / 60)).padStart(2, '0');
        const mm  = String(totalMins % 60).padStart(2, '0');

        document.getElementById('list-view-btn')?.click();
        setTimeout(() => {
          if (typeof TaskManager !== 'undefined') {
            TaskManager.showAddForm();
            const dateInput = document.getElementById('task-date-input');
            if (dateInput) { dateInput.value = ds; dateInput.dispatchEvent(new Event('input')); }
            // Show time row and set value
            const timeRow   = document.getElementById('task-time-row');
            const timeInput = document.getElementById('task-time-input');
            if (timeRow)  timeRow.style.display = '';
            if (timeInput) timeInput.value = `${hh}:${mm}`;
          }
        }, 100);
      });
    });

    // Place task blocks
    this._placeTasks(scheduledTasks);
  },

  _placeTasks(tasks) {
    const layer = document.getElementById('day-tasks-layer');
    if (!layer) return;

    // Sort by start time so z-index ordering is predictable
    const sorted = [...tasks].sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''));

    // Simple overlap detection — column layout
    // Build time intervals: { start, end, task }
    const intervals = sorted.map(t => {
      const [hh, mm] = (t.scheduled_time || '00:00').split(':').map(Number);
      const start = hh * 60 + mm;
      const dur   = t.estimated_minutes || 30;
      return { start, end: start + dur, task: t };
    });

    // Assign columns to overlapping tasks
    const cols = []; // each col = array of {start, end}
    const taskCols = intervals.map(iv => {
      let c = 0;
      while (cols[c] && cols[c].some(ex => iv.start < ex.end && iv.end > ex.start)) c++;
      if (!cols[c]) cols[c] = [];
      cols[c].push(iv);
      return c;
    });
    const numCols = cols.length || 1;

    intervals.forEach((iv, i) => {
      const t = iv.task;
      const col = taskCols[i];
      const [hh, mm] = (t.scheduled_time).split(':').map(Number);
      if (hh < this.START_HOUR || hh > this.END_HOUR) return;

      const topMins  = (hh - this.START_HOUR) * 60 + mm;
      const topPx    = topMins * this.PX_PER_MIN;
      const heightPx = Math.max(iv.end - iv.start, 20) * this.PX_PER_MIN;
      const color    = this._catColor(t.category);

      const colWidth = 100 / numCols;
      const left  = col * colWidth;
      const right = 100 - (col + 1) * colWidth;

      const block = document.createElement('div');
      block.className = `day-task-block${t.completed ? ' done' : ''}`;
      block.dataset.id = t.id;
      block.style.cssText = `
        top: ${topPx}px;
        height: ${heightPx}px;
        left: calc(${left}% + 2px);
        right: calc(${right}% + 2px);
        border-left: 3px solid ${color};
        background: ${color}22;`;

      const endMins   = iv.end;
      const endHH     = String(Math.floor(endMins / 60)).padStart(2, '0');
      const endMM     = String(endMins % 60).padStart(2, '0');
      block.innerHTML = `
        <div class="day-block-title">${this._esc(t.title)}</div>
        <div class="day-block-meta">${t.scheduled_time} – ${endHH}:${endMM}  ·  ${iv.end - iv.start}m</div>`;

      block.addEventListener('click', () => {
        document.getElementById('list-view-btn')?.click();
        setTimeout(() => {
          if (typeof switchTimerType === 'function') switchTimerType('tasks');
          setTimeout(() => TaskManager?.showEditForm(t.id), 100);
        }, 50);
      });

      layer.appendChild(block);
    });
  },

  // ── Scroll to now ─────────────────────────────────────────────────────────
  _scrollToNow() {
    const line = document.getElementById('day-now-line');
    const scrollEl = document.querySelector('.day-sched-scroll');
    if (!line || !scrollEl) return;
    const lineTop = parseFloat(line.style.top) || 0;
    scrollEl.scrollTop = Math.max(0, lineTop - 120);
  }
};
