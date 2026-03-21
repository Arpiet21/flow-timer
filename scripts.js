/* ── Script Copier ──────────────────────────────────────────────────────── */
const ScriptCopier = (() => {
  let _uid = null;
  let _scripts = [];
  let _editingId = null;
  let _pipWin = null;

  function _scriptsRef() {
    return _db.collection('users').doc(_uid).collection('scripts');
  }

  // ── Init ────────────────────────────────────────────────────────────────
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
      _scripts = snap.docs.map(d => {
        const data = { id: d.id, ...d.data() };
        // Backwards compat: old scripts had content string, not clips array
        if (!data.clips) {
          data.clips = [{ id: crypto.randomUUID(), name: 'Clip 1', content: data.content || '' }];
        }
        return data;
      });
    } catch (e) { _scripts = []; }
  }

  // ── Render main list ────────────────────────────────────────────────────
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
        <div class="script-clips">
          ${(s.clips || []).map((c, i) => `
            <div class="script-clip" data-clip-id="${c.id}" data-script-id="${s.id}">
              <div class="script-clip-header">
                <span class="script-clip-name">${_esc(c.name || 'Clip ' + (i + 1))}</span>
                <div class="script-clip-actions">
                  <button class="script-copy-btn" data-id="${s.id}" data-clip="${c.id}" title="Copy clip">Copy</button>
                  <button class="script-clip-del-btn" data-id="${s.id}" data-clip="${c.id}" title="Remove clip">✕</button>
                </div>
              </div>
              <div class="script-clip-preview">${_esc(c.content).substring(0, 100)}${c.content.length > 100 ? '…' : ''}</div>
            </div>
          `).join('')}
        </div>
        <div class="script-item-actions">
          <button class="script-addclip-btn" data-id="${s.id}">+ Add Clip</button>
          <button class="script-float-open-btn" data-id="${s.id}">Float</button>
          <button class="script-edit-btn" data-id="${s.id}">Edit</button>
          <button class="script-del-btn" data-id="${s.id}">Delete</button>
        </div>
      </div>
    `).join('');
  }

  // ── Bind events ─────────────────────────────────────────────────────────
  function _bindEvents() {
    document.getElementById('script-add-trigger')?.addEventListener('click', () => _showForm());
    document.getElementById('script-submit-btn')?.addEventListener('click', () => _submit());
    document.getElementById('script-cancel-btn')?.addEventListener('click', () => _hideForm());
    document.getElementById('script-import-btn')?.addEventListener('click', () => _showImport());
    document.getElementById('script-import-submit')?.addEventListener('click', () => _doImport());
    document.getElementById('script-import-cancel')?.addEventListener('click', () => _hideImport());
    document.getElementById('script-import-cancel2')?.addEventListener('click', () => _hideImport());

    // Add clip inline form
    document.getElementById('script-clip-add-save')?.addEventListener('click', () => _saveInlineClip());
    document.getElementById('script-clip-add-cancel')?.addEventListener('click', () => _hideClipForm());

    // List delegated
    document.getElementById('script-list')?.addEventListener('click', e => {
      const sid = e.target.dataset.id;
      const cid = e.target.dataset.clip;
      if (e.target.classList.contains('script-copy-btn')) _copyClip(sid, cid);
      if (e.target.classList.contains('script-float-open-btn')) _toggleFloat(true);
      if (e.target.classList.contains('script-edit-btn')) _showEditForm(sid);
      if (e.target.classList.contains('script-del-btn')) _deleteScript(sid);
      if (e.target.classList.contains('script-addclip-btn')) _showClipForm(sid);
      if (e.target.classList.contains('script-clip-del-btn')) _deleteClip(sid, cid);
    });

    document.getElementById('script-float-btn')?.addEventListener('click', () => _toggleFloat());
  }

  // ── Add / Edit script form ───────────────────────────────────────────────
  function _showForm(script = null) {
    document.getElementById('script-add-form').style.display = 'block';
    document.getElementById('script-add-trigger').style.display = 'none';
    document.getElementById('script-import-btn').style.display = 'none';
    if (script) {
      document.getElementById('script-title-input').value = script.title;
      document.getElementById('script-content-input').value = (script.clips || [])[0]?.content || '';
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
    document.getElementById('script-import-btn').style.display = 'inline-flex';
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
      const idx = _scripts.findIndex(x => x.id === _editingId);
      if (idx !== -1) {
        const clips = _scripts[idx].clips || [];
        if (clips[0]) clips[0].content = content;
        else clips.push({ id: crypto.randomUUID(), name: 'Clip 1', content });
        _scripts[idx] = { ..._scripts[idx], title, model, clips };
        _renderList();
        await _scriptsRef().doc(_editingId).update({ title, model, clips });
      }
    } else {
      const id = crypto.randomUUID();
      const clips = [{ id: crypto.randomUUID(), name: 'Clip 1', content }];
      const row = { id, title, model, clips, created_at: new Date().toISOString() };
      _scripts.unshift(row);
      _renderList();
      await _scriptsRef().doc(id).set(row);
    }
    _hideForm();
  }

  // ── Import from ChatGPT ──────────────────────────────────────────────────
  function _showImport() {
    document.getElementById('script-import-modal').style.display = 'flex';
    document.getElementById('script-import-text').value = '';
    document.getElementById('script-import-title').value = '';
    document.getElementById('script-import-model').value = 'Other';
    document.getElementById('script-import-text').focus();
  }

  function _hideImport() {
    document.getElementById('script-import-modal').style.display = 'none';
  }

  async function _doImport() {
    const raw   = document.getElementById('script-import-text').value.trim();
    const title = document.getElementById('script-import-title').value.trim() || 'Imported Script';
    const model = document.getElementById('script-import-model').value;
    if (!raw) return;

    const clips = _parseClips(raw);
    const id = crypto.randomUUID();
    const row = { id, title, model, clips, created_at: new Date().toISOString() };
    _scripts.unshift(row);
    _renderList();
    await _scriptsRef().doc(id).set(row);
    _hideImport();
  }

  // Auto-detect format and split into clips
  function _parseClips(text) {
    // ── Try JSON first ──────────────────────────────────────────────────────
    try {
      const json = JSON.parse(text);
      const clips = [];

      // Format: { scenes: [ { scene_id, clips: [ { id, prompt, duration } ] } ] }
      if (json.scenes && Array.isArray(json.scenes)) {
        json.scenes.forEach(scene => {
          const sceneLabel = scene.scene_id || scene.id || 'Scene';
          if (scene.clips && Array.isArray(scene.clips)) {
            scene.clips.forEach(clip => {
              const name = `${sceneLabel} — ${clip.id || ''}`.trim().replace(/—\s*$/, '');
              const content = clip.prompt || clip.content || clip.text || JSON.stringify(clip);
              const extras = [
                clip.duration   ? `Duration: ${clip.duration}` : '',
                clip.motion     ? `Motion: ${clip.motion}` : '',
                scene.style_override ? `Style: ${scene.style_override}` : ''
              ].filter(Boolean).join('\n');
              clips.push({ id: crypto.randomUUID(), name, content: extras ? `${content}\n\n${extras}` : content });
            });
          } else {
            // Scene has no sub-clips
            const content = scene.prompt || scene.description || JSON.stringify(scene);
            clips.push({ id: crypto.randomUUID(), name: sceneLabel, content });
          }
        });
        if (clips.length) return clips;
      }

      // Format: { clips: [ { id, prompt } ] }
      if (json.clips && Array.isArray(json.clips)) {
        json.clips.forEach((clip, i) => {
          const name = clip.id || clip.name || `Clip ${i + 1}`;
          const content = clip.prompt || clip.content || clip.text || JSON.stringify(clip);
          clips.push({ id: crypto.randomUUID(), name, content });
        });
        if (clips.length) return clips;
      }

      // Generic JSON — save as single clip (pretty-printed)
      return [{ id: crypto.randomUUID(), name: 'Clip 1', content: JSON.stringify(json, null, 2) }];

    } catch (_) {
      // Not JSON — fall through to text parsing
    }

    // ── Text: split by section headers ─────────────────────────────────────
    const lines = text.split('\n');
    const sections = [];
    let cur = null;

    for (const line of lines) {
      const isHeader = /^[\*_]{0,2}(?:scene|clip|part|section|shot|act)\s*\d+[\*_]{0,2}[\s:\-\.]*/i.test(line.trim())
        || /^\d+[\.\)]\s+\w/.test(line.trim());

      if (isHeader) {
        if (cur) sections.push(cur);
        cur = { name: line.replace(/[\*_]/g, '').trim().replace(/[:.\-]+$/, '').trim(), lines: [] };
      } else {
        if (!cur) cur = { name: 'Clip 1', lines: [] };
        cur.lines.push(line);
      }
    }
    if (cur) sections.push(cur);

    if (sections.length <= 1) {
      return [{ id: crypto.randomUUID(), name: 'Clip 1', content: text.trim() }];
    }

    return sections.map((s, i) => ({
      id: crypto.randomUUID(),
      name: s.name || `Clip ${i + 1}`,
      content: s.lines.join('\n').trim()
    })).filter(c => c.content);
  }

  // ── Add clip inline ──────────────────────────────────────────────────────
  let _addClipForScriptId = null;

  function _showClipForm(scriptId) {
    _addClipForScriptId = scriptId;
    const form = document.getElementById('script-clip-add-form');
    form.style.display = 'block';
    document.getElementById('script-clip-name-input').value = '';
    document.getElementById('script-clip-content-input').value = '';
    // Move form below the script item
    const item = document.querySelector(`.script-item[data-id="${scriptId}"]`);
    if (item) item.after(form);
    document.getElementById('script-clip-name-input').focus();
  }

  function _hideClipForm() {
    document.getElementById('script-clip-add-form').style.display = 'none';
    _addClipForScriptId = null;
  }

  async function _saveInlineClip() {
    const name    = document.getElementById('script-clip-name-input').value.trim();
    const content = document.getElementById('script-clip-content-input').value.trim();
    if (!content || !_addClipForScriptId) return;

    const idx = _scripts.findIndex(x => x.id === _addClipForScriptId);
    if (idx === -1) return;

    const clip = { id: crypto.randomUUID(), name: name || `Clip ${(_scripts[idx].clips?.length || 0) + 1}`, content };
    _scripts[idx].clips = [...(_scripts[idx].clips || []), clip];
    _renderList();
    await _scriptsRef().doc(_addClipForScriptId).update({ clips: _scripts[idx].clips });
    _hideClipForm();
  }

  async function _deleteClip(scriptId, clipId) {
    const idx = _scripts.findIndex(x => x.id === scriptId);
    if (idx === -1) return;
    _scripts[idx].clips = (_scripts[idx].clips || []).filter(c => c.id !== clipId);
    _renderList();
    await _scriptsRef().doc(scriptId).update({ clips: _scripts[idx].clips });
  }

  // ── Delete script ────────────────────────────────────────────────────────
  async function _deleteScript(id) {
    _scripts = _scripts.filter(x => x.id !== id);
    _renderList();
    await _scriptsRef().doc(id).delete();
  }

  // ── Copy clip ────────────────────────────────────────────────────────────
  function _copyClip(scriptId, clipId) {
    const s = _scripts.find(x => x.id === scriptId);
    if (!s) return;
    const clip = (s.clips || []).find(c => c.id === clipId);
    if (!clip) return;
    navigator.clipboard.writeText(clip.content).then(() => {
      document.querySelectorAll(`.script-copy-btn[data-id="${scriptId}"][data-clip="${clipId}"]`).forEach(btn => {
        btn.textContent = 'Copied!';
        btn.style.background = 'var(--accent)';
        btn.style.color = '#000';
        setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = ''; btn.style.color = ''; }, 1500);
      });
    });
  }

  // ── PiP Float ────────────────────────────────────────────────────────────
  async function _toggleFloat(forceOpen = false) {
    if (_pipWin && !forceOpen) { _pipWin.close(); _pipWin = null; return; }
    if (_pipWin) return;

    if ('documentPictureInPicture' in window) {
      try {
        _pipWin = await window.documentPictureInPicture.requestWindow({ width: 300, height: 480 });
        const style = _pipWin.document.createElement('style');
        style.textContent = SCRIPT_PIP_STYLES;
        _pipWin.document.head.appendChild(style);
        _pipWin.document.body.innerHTML = _buildPipHtml();
        _pipWin.document.body.onclick = e => {
          const sid = e.target.dataset.sid;
          const cid = e.target.dataset.cid;
          if (sid && cid && e.target.classList.contains('pip-copy-btn')) {
            const s = _scripts.find(x => x.id === sid);
            const clip = (s?.clips || []).find(c => c.id === cid);
            if (clip) {
              navigator.clipboard.writeText(clip.content).then(() => {
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
    } else { _fallbackPopup(); }
  }

  function _fallbackPopup() {
    const w = window.open('', 'script-copier-pip', 'width=300,height=480,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><style>${SCRIPT_PIP_STYLES}</style></head><body>${_buildPipHtml()}</body></html>`);
    w.document.close();
  }

  function _buildPipHtml() {
    if (!_scripts.length) return '<div class="pip-empty">No scripts saved yet.</div>';
    return _scripts.map(s => `
      <div class="pip-script-item">
        <div class="pip-script-top">
          <span class="pip-script-title">${_esc(s.title)}</span>
          <span class="pip-model-tag">${_esc(s.model || 'General')}</span>
        </div>
        ${(s.clips || []).map(c => `
          <div class="pip-clip">
            <span class="pip-clip-name">${_esc(c.name)}</span>
            <div class="pip-clip-preview">${_esc(c.content).substring(0, 80)}${c.content.length > 80 ? '…' : ''}</div>
            <button class="pip-copy-btn" data-sid="${s.id}" data-cid="${c.id}">Copy</button>
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  const SCRIPT_PIP_STYLES = `
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#1a1a2e;color:#eaeaea;
      padding:10px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;height:100vh}
    .pip-script-item{background:#16213e;border:1px solid #2a2a4a;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:6px}
    .pip-script-top{display:flex;align-items:center;gap:6px;border-bottom:1px solid #2a2a4a;padding-bottom:5px}
    .pip-script-title{font-weight:700;font-size:.82rem;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pip-model-tag{background:#39ff14;color:#000;font-size:.6rem;font-weight:700;border-radius:4px;padding:1px 5px}
    .pip-clip{background:rgba(255,255,255,0.04);border-radius:6px;padding:5px 7px;display:flex;flex-direction:column;gap:3px}
    .pip-clip-name{font-size:.7rem;font-weight:600;color:#39ff14}
    .pip-clip-preview{font-size:.68rem;color:#888;line-height:1.35}
    .pip-copy-btn{align-self:flex-end;background:transparent;border:1px solid #2a2a4a;color:#888;
      border-radius:5px;padding:2px 9px;font-size:.68rem;cursor:pointer;transition:border-color .15s,color .15s}
    .pip-copy-btn:hover{border-color:#39ff14;color:#39ff14}
    .pip-empty{color:#888;font-size:.8rem;text-align:center;padding:20px 0}
  `;

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { init, refresh: async () => { await _load(); _renderList(); } };
})();
