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

    // Float button — opens Document PiP window
    const floatBtn = document.getElementById('script-float-btn');
    if (floatBtn) floatBtn.onclick = () => _toggleFloat();
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
    document.getElementById('script-title-input').value = '';
    document.getElementById('script-content-input').value = '';
    document.getElementById('script-model-select').value = 'Other';
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
        await _scriptsRef().doc(_editingId).update({ title, content, model });
      }
    } else {
      // Insert
      const id = crypto.randomUUID();
      const row = { id, title, content, model, created_at: new Date().toISOString() };
      _scripts.unshift(row);
      _renderList();
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

  let _pipWin = null;

  function _openFloat(id) {
    _toggleFloat(true);
  }

  async function _toggleFloat(forceOpen = false) {
    // If PiP window already open, close it (toggle)
    if (_pipWin && !forceOpen) {
      _pipWin.close();
      _pipWin = null;
      return;
    }
    if (_pipWin) return; // already open

    if ('documentPictureInPicture' in window) {
      try {
        _pipWin = await window.documentPictureInPicture.requestWindow({ width: 300, height: 420 });
        const style = _pipWin.document.createElement('style');
        style.textContent = SCRIPT_PIP_STYLES;
        _pipWin.document.head.appendChild(style);
        _pipWin.document.body.innerHTML = _buildPipHtml();
        _pipWin.document.body.onclick = e => {
          const id = e.target.dataset.id;
          if (id && e.target.classList.contains('pip-copy-btn')) {
            const s = _scripts.find(x => x.id === id);
            if (s) {
              // Copy via parent window clipboard
              navigator.clipboard.writeText(s.content).then(() => {
                e.target.textContent = 'Copied!';
                e.target.style.background = '#39ff14';
                e.target.style.color = '#000';
                setTimeout(() => { e.target.textContent = 'Copy'; e.target.style.background = ''; e.target.style.color = ''; }, 1500);
              });
            }
          }
        };
        _pipWin.addEventListener('pagehide', () => { _pipWin = null; });
      } catch (_) { _fallbackPopup(); }
    } else {
      _fallbackPopup();
    }
  }

  function _fallbackPopup() {
    const w = window.open('', 'script-copier-pip', 'width=300,height=420,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><style>${SCRIPT_PIP_STYLES}</style></head><body>${_buildPipHtml()}</body></html>`);
    w.document.close();
    w.document.body.onclick = e => {
      const id = e.target.dataset.id;
      if (id && e.target.classList.contains('pip-copy-btn')) {
        const s = _scripts.find(x => x.id === id);
        if (s) {
          navigator.clipboard.writeText(s.content).then(() => {
            e.target.textContent = 'Copied!';
            setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
          });
        }
      }
    };
  }

  function _buildPipHtml() {
    if (!_scripts.length) return '<div class="pip-empty">No scripts saved yet.</div>';
    return _scripts.map(s => `
      <div class="pip-script-item">
        <div class="pip-script-top">
          <span class="pip-script-title">${_esc(s.title)}</span>
          <span class="pip-model-tag">${_esc(s.model || 'General')}</span>
        </div>
        <div class="pip-script-preview">${_esc(s.content).substring(0, 90)}${s.content.length > 90 ? '…' : ''}</div>
        <button class="pip-copy-btn" data-id="${s.id}">Copy</button>
      </div>
    `).join('');
  }

const SCRIPT_PIP_STYLES = `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#1a1a2e;color:#eaeaea;
    padding:10px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;height:100vh}
  .pip-header{font-size:.75rem;font-weight:700;color:#39ff14;letter-spacing:.5px;padding-bottom:6px;
    border-bottom:1px solid #2a2a4a;margin-bottom:2px}
  .pip-script-item{background:#16213e;border:1px solid #2a2a4a;border-radius:8px;padding:8px 10px;
    display:flex;flex-direction:column;gap:4px}
  .pip-script-top{display:flex;align-items:center;gap:6px}
  .pip-script-title{font-weight:600;font-size:.82rem;flex:1;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .pip-model-tag{background:#39ff14;color:#000;font-size:.62rem;font-weight:700;
    border-radius:4px;padding:1px 6px;white-space:nowrap}
  .pip-script-preview{font-size:.72rem;color:#888;line-height:1.4}
  .pip-copy-btn{align-self:flex-end;background:transparent;border:1px solid #2a2a4a;
    color:#888;border-radius:5px;padding:3px 10px;font-size:.72rem;cursor:pointer;
    transition:border-color .15s,color .15s}
  .pip-copy-btn:hover{border-color:#39ff14;color:#39ff14}
  .pip-empty{color:#888;font-size:.8rem;text-align:center;padding:20px 0}
`;

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, refresh: async () => { await _load(); _renderList(); _renderFloatList(); } };
})();
