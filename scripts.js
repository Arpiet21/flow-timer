/* ── Script Copier ──────────────────────────────────────────────────────── */
const ScriptCopier = (() => {
  let _uid = null;
  let _scripts = [];
  let _editingId = null;

  const VIDEO_MODELS = ['Sora', 'Runway', 'Kling', 'Pika', 'Luma', 'Hailuo', 'Vidu', 'Other'];

  function _scriptsRef() {
    return _db.collection('users').doc(_uid).collection('scripts');
  }

  async function init() {
    const user = Auth.getUser();
    if (!user) return;
    _uid = user.uid;
    await _load();
    _renderList();
    _bindEvents();
  }

  async function _load() {
    try {
      const snap = await _scriptsRef().orderBy('created_at', 'desc').get();
      _scripts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      _scripts = [];
    }
  }

  function _renderList() {
    const list = document.getElementById('script-list');
    if (!list) return;

    if (!_scripts.length) {
      list.innerHTML = '<div class="script-empty">No scripts yet. Add your first one above.</div>';
      return;
    }

    list.innerHTML = _scripts.map(s => `
      <div class="script-item" data-id="${s.id}">
        <div class="script-item-header">
          <span class="script-item-title">${_esc(s.title)}</span>
          <span class="script-model-tag">${_esc(s.model || 'General')}</span>
        </div>
        <div class="script-item-preview">${_esc(s.content).substring(0, 120)}${s.content.length > 120 ? '…' : ''}</div>
        <div class="script-item-actions">
          <button class="script-copy-btn" data-id="${s.id}" title="Copy to clipboard">Copy</button>
          <button class="script-float-open-btn" data-id="${s.id}" title="Open in floating panel">Float</button>
          <button class="script-edit-btn" data-id="${s.id}" title="Edit">Edit</button>
          <button class="script-del-btn" data-id="${s.id}" title="Delete">✕</button>
        </div>
      </div>
    `).join('');
  }

  function _renderFloatList() {
    const list = document.getElementById('float-script-list');
    if (!list) return;
    if (!_scripts.length) {
      list.innerHTML = '<div class="script-empty" style="padding:12px;font-size:0.8rem;">No scripts saved yet.</div>';
      return;
    }
    list.innerHTML = _scripts.map(s => `
      <div class="float-script-item" data-id="${s.id}">
        <div class="float-script-top">
          <span class="float-script-title">${_esc(s.title)}</span>
          <span class="script-model-tag">${_esc(s.model || 'General')}</span>
        </div>
        <div class="float-script-preview">${_esc(s.content).substring(0, 80)}${s.content.length > 80 ? '…' : ''}</div>
        <button class="script-copy-btn float-copy-btn" data-id="${s.id}">Copy</button>
      </div>
    `).join('');
  }

  function _bindEvents() {
    // Add / submit
    const addBtn = document.getElementById('script-add-trigger');
    if (addBtn) addBtn.onclick = () => _showForm();

    const submitBtn = document.getElementById('script-submit-btn');
    if (submitBtn) submitBtn.onclick = () => _submit();

    const cancelBtn = document.getElementById('script-cancel-btn');
    if (cancelBtn) cancelBtn.onclick = () => _hideForm();

    // List delegated clicks
    const list = document.getElementById('script-list');
    if (list) {
      list.onclick = e => {
        const id = e.target.dataset.id;
        if (!id) return;
        if (e.target.classList.contains('script-copy-btn')) _copyScript(id);
        if (e.target.classList.contains('script-float-open-btn')) _openFloat(id);
        if (e.target.classList.contains('script-edit-btn')) _showEditForm(id);
        if (e.target.classList.contains('script-del-btn')) _deleteScript(id);
      };
    }

    // Floating panel
    const floatBtn = document.getElementById('script-float-btn');
    if (floatBtn) floatBtn.onclick = () => _toggleFloat();

    const floatClose = document.getElementById('float-script-close');
    if (floatClose) floatClose.onclick = () => _closeFloat();

    const floatList = document.getElementById('float-script-list');
    if (floatList) {
      floatList.onclick = e => {
        const id = e.target.dataset.id;
        if (id && e.target.classList.contains('script-copy-btn')) _copyScript(id);
      };
    }

    // Drag to move floating panel
    _makeDraggable(document.getElementById('script-float-panel'));
  }

  function _showForm(script = null) {
    document.getElementById('script-add-form').style.display = 'block';
    document.getElementById('script-add-trigger').style.display = 'none';
    if (script) {
      document.getElementById('script-title-input').value = script.title;
      document.getElementById('script-content-input').value = script.content;
      document.getElementById('script-model-select').value = script.model || 'Other';
      document.getElementById('script-submit-btn').textContent = 'Update Script';
      _editingId = script.id;
    } else {
      document.getElementById('script-title-input').value = '';
      document.getElementById('script-content-input').value = '';
      document.getElementById('script-model-select').value = 'Other';
      document.getElementById('script-submit-btn').textContent = 'Save Script';
      _editingId = null;
    }
    document.getElementById('script-title-input').focus();
  }

  function _hideForm() {
    document.getElementById('script-add-form').style.display = 'none';
    document.getElementById('script-add-trigger').style.display = 'flex';
    _editingId = null;
  }

  function _showEditForm(id) {
    const s = _scripts.find(x => x.id === id);
    if (s) _showForm(s);
  }

  async function _submit() {
    const title   = document.getElementById('script-title-input').value.trim();
    const content = document.getElementById('script-content-input').value.trim();
    const model   = document.getElementById('script-model-select').value;
    if (!title || !content) return;

    if (_editingId) {
      // Update
      const idx = _scripts.findIndex(x => x.id === _editingId);
      if (idx !== -1) {
        _scripts[idx] = { ..._scripts[idx], title, content, model };
        _renderList();
        _renderFloatList();
        await _scriptsRef().doc(_editingId).update({ title, content, model });
      }
    } else {
      // Insert
      const id = crypto.randomUUID();
      const row = { id, title, content, model, created_at: new Date().toISOString() };
      _scripts.unshift(row);
      _renderList();
      _renderFloatList();
      await _scriptsRef().doc(id).set(row);
    }
    _hideForm();
  }

  async function _deleteScript(id) {
    _scripts = _scripts.filter(x => x.id !== id);
    _renderList();
    _renderFloatList();
    await _scriptsRef().doc(id).delete();
  }

  function _copyScript(id) {
    const s = _scripts.find(x => x.id === id);
    if (!s) return;
    navigator.clipboard.writeText(s.content).then(() => {
      // Flash all copy buttons for this id
      document.querySelectorAll(`[data-id="${id}"].script-copy-btn`).forEach(btn => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = 'var(--accent)';
        btn.style.color = '#000';
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.background = '';
          btn.style.color = '';
        }, 1500);
      });
    });
  }

  function _openFloat(id) {
    // Scroll to the script in float panel and open it
    _toggleFloat(true);
    setTimeout(() => {
      const el = document.querySelector(`#float-script-list [data-id="${id}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }

  function _toggleFloat(forceOpen = false) {
    const panel = document.getElementById('script-float-panel');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none' && panel.style.display !== '';
    if (forceOpen || !isOpen) {
      panel.style.display = 'flex';
      _renderFloatList();
    } else {
      panel.style.display = 'none';
    }
  }

  function _closeFloat() {
    const panel = document.getElementById('script-float-panel');
    if (panel) panel.style.display = 'none';
  }

  function _makeDraggable(el) {
    if (!el) return;
    let ox = 0, oy = 0, mx = 0, my = 0;
    const header = el.querySelector('.float-script-header');
    if (!header) return;
    header.style.cursor = 'grab';
    header.onmousedown = e => {
      e.preventDefault();
      mx = e.clientX; my = e.clientY;
      document.onmousemove = drag;
      document.onmouseup = () => { document.onmousemove = null; document.onmouseup = null; header.style.cursor = 'grab'; };
      header.style.cursor = 'grabbing';
    };
    function drag(e) {
      ox = mx - e.clientX; oy = my - e.clientY;
      mx = e.clientX; my = e.clientY;
      el.style.top  = (el.offsetTop - oy) + 'px';
      el.style.left = (el.offsetLeft - ox) + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
  }

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, refresh: async () => { await _load(); _renderList(); _renderFloatList(); } };
})();
