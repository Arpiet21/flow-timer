/* ── Hour Certificate ("This hour counted.") ────────────────────────────────
   Shareable session card generated after every completed Work Timer session
   ≥ 10 min. Card is a hidden, fixed-size DOM node (1080×1350 feed / 1080×1920
   story) rendered to PNG with html-to-image (loaded via CDN in index.html —
   it's DOM-based, not React-specific, so no fidelity is lost adapting the
   original React spec to this app's vanilla-JS/no-build-step stack).
   Firestore: users/{uid}/certificates/{id} — no PNG stored, only the data;
   the image is regenerated on demand. Capped at 30 most recent (Auth.createCertificate
   handles the cleanup). Free tier: Minimal template only, no goal-cascade line,
   last 5 shown in the gallery — enforced in hours.html, not here. ── */
const Certificate = (() => {
  const WIDTH       = 1080;
  const HEIGHT_FEED  = 1350;
  const HEIGHT_STORY = 1920;
  const MIN_DURATION_MIN = 10;

  const TEMPLATES = {
    minimal:  { bg: '#FFFFFF', text: '#111111', accent: '#111111', muted: 'rgba(17,17,17,0.55)' },
    dark:     { bg: '#0E0E10', text: '#F5F1EA', accent: '#F5A623', muted: 'rgba(245,241,234,0.55)' },
    gradient: { bg: 'linear-gradient(135deg,#2b0b3f 0%,#7b2ff7 55%,#f72585 100%)', text: '#FFFFFF', accent: '#ffd60a', muted: 'rgba(255,255,255,0.65)' },
  };

  let _pending = null; // { durationMin, taskTitle, streakDay, goalTitle, timestamp }
  let _activeTemplate = null; // template the currently-open modal is rendering

  function init() {
    document.getElementById('cert-share-btn')?.addEventListener('click', () => _share('feed'));
    document.getElementById('cert-story-btn')?.addEventListener('click', () => _share('story'));
    document.getElementById('cert-skip-btn')?.addEventListener('click', _closeModal);
    document.querySelectorAll('.cert-template-pick').forEach(btn => {
      btn.addEventListener('click', () => _selectTemplate(btn.dataset.template));
    });
  }

  // ── Premium check (same criteria used elsewhere: pro or trial plan) ──────
  function _isPremium() {
    const user = typeof Auth !== 'undefined' ? Auth.getUser() : null;
    if (!user) return false;
    return user.email === 'arpietmalpani@gmail.com' || user.plan === 'pro' || user.plan === 'trial';
  }

  // Reads the same in-memory settings object app.js persists via saveToStorage()
  function _settings() {
    return (typeof state !== 'undefined' && state.settings) ? state.settings : {};
  }

  function _certMode()     { return _settings().certMode || 'always'; }
  function _certTemplate() {
    const t = _settings().certTemplate || 'minimal';
    return _isPremium() ? t : 'minimal'; // free tier is always locked to Minimal
  }

  // ── Called from app.js right after a work session is logged ──────────────
  async function onSessionComplete({ durationMin, taskTitle }) {
    if (!durationMin || durationMin < MIN_DURATION_MIN) return;

    let streakDay = null;
    try {
      if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) streakDay = await Auth.getStreak('work');
    } catch (_) {}

    const goalTitle = null; // no task↔goal link in the data model yet — see CLAUDE.md note

    _pending = {
      durationMin,
      taskTitle: taskTitle || null,
      streakDay: streakDay > 1 ? streakDay : null,
      goalTitle,
      timestamp: new Date(),
    };

    // Certificate always saves to the gallery, even if the popup is skipped/hidden
    _saveToGallery(_pending);

    const mode = _certMode();
    const shouldShow = mode === 'always' || (mode === '60min' && durationMin >= 60);
    if (mode !== 'never' && shouldShow) _openModal();
  }

  async function _saveToGallery(session) {
    if (!(typeof Auth !== 'undefined' && Auth.isLoggedIn())) return;
    try {
      await Auth.createCertificate({
        session_id:   `${Date.now()}`,
        duration_min: session.durationMin,
        task_title:   session.taskTitle,
        goal_title:   session.goalTitle,
        streak_day:   session.streakDay,
        user_line:    null,
        template:     _certTemplate(),
      });
    } catch (_) {}
  }

  function _truncate(s, max) {
    if (!s) return '';
    return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
  }

  function _escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function _formatTimestamp(date) {
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const day  = date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    return `${time} · ${day}`;
  }

  // ── Build the offscreen card node for a given session + template + size ──
  function buildCardNode(session, templateName, variant) {
    const T = TEMPLATES[templateName] || TEMPLATES.minimal;
    const height = variant === 'story' ? HEIGHT_STORY : HEIGHT_FEED;
    const pad = Math.round(WIDTH * 0.09);

    const node = document.createElement('div');
    // html-to-image only rasterizes content the browser actually paints — offscreen
    // (large negative left/top), opacity:0, visibility:hidden, and clip-path all
    // produce a blank capture. Sitting on-screen at z-index:-1 paints normally while
    // staying invisible behind the page's own background.
    node.style.cssText = `
      width:${WIDTH}px; height:${height}px; position:fixed; left:0; top:0; z-index:-1; pointer-events:none;
      background:${T.bg}; color:${T.text};
      font-family:'Segoe UI', system-ui, sans-serif;
      display:flex; flex-direction:column; justify-content:space-between;
      padding:${pad}px; box-sizing:border-box;
    `;

    const streakChip = session.streakDay
      ? `<div style="display:inline-flex;align-items:center;gap:8px;background:rgba(128,128,128,0.18);border-radius:999px;padding:10px 22px;font-size:28px;font-weight:700;align-self:flex-start;">🔥 Day ${session.streakDay}</div>`
      : '';

    const taskLine = session.taskTitle
      ? `<div style="font-size:34px;opacity:0.85;margin-top:16px;">${_escHtml(_truncate(session.taskTitle, 40))}</div>`
      : '';

    const goalLine = session.goalTitle
      ? `<div style="font-size:28px;color:${T.accent};margin-top:12px;">→ toward: ${_escHtml(_truncate(session.goalTitle, 48))}</div>`
      : '';

    const userLine = session.userLine
      ? `<div style="font-size:30px;font-style:italic;opacity:0.9;margin-top:28px;border-left:4px solid ${T.accent};padding-left:20px;">"${_escHtml(session.userLine)}"</div>`
      : '';

    node.innerHTML = `
      <div>
        ${streakChip}
        <div style="font-size:64px;font-weight:800;line-height:1.15;margin-top:${streakChip ? '28px' : '0'};">This hour counted.</div>
        <div style="font-size:42px;font-weight:700;color:${T.accent};margin-top:20px;">${session.durationMin} min deep work</div>
        ${taskLine}
        ${goalLine}
        ${userLine}
      </div>
      <div>
        <div style="font-size:26px;opacity:${templateName === 'minimal' ? 0.5 : 0.6};margin-bottom:${Math.round(height * 0.045)}px;">${_formatTimestamp(session.timestamp)}</div>
        <div style="display:flex;justify-content:flex-end;">
          <div style="font-size:26px;opacity:0.6;letter-spacing:0.02em;">flowtimer.app</div>
        </div>
      </div>
    `;
    document.body.appendChild(node);
    return node;
  }

  async function renderPng(session, templateName, variant) {
    const node = buildCardNode(session, templateName, variant);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      // Node's own inline width/height (set in buildCardNode) already fix the capture
      // size; html-to-image's real size options are canvasWidth/canvasHeight, not
      // width/height — pixelRatio alone is enough here since we don't need to override.
      const dataUrl = await htmlToImage.toPng(node, { pixelRatio: 2 });
      return dataUrl;
    } finally {
      node.remove();
    }
  }

  // ── Modal (shown right after a qualifying session completes) ─────────────
  async function _openModal(forceTemplate) {
    const modal = document.getElementById('cert-modal');
    const previewWrap = document.getElementById('cert-preview-wrap');
    const lockedNote = document.getElementById('cert-locked-note');
    if (!modal || !_pending) return;

    modal.style.display = 'flex';
    if (previewWrap) previewWrap.innerHTML = '<div class="cert-preview-loading">Rendering…</div>';

    _activeTemplate = forceTemplate || _certTemplate();
    if (lockedNote) lockedNote.style.display = _isPremium() ? 'none' : 'block';

    try {
      const dataUrl = await renderPng(_pending, _activeTemplate, 'feed');
      if (previewWrap) previewWrap.innerHTML = `<img src="${dataUrl}" class="cert-preview-img" alt="Hour certificate">`;
    } catch (e) {
      if (previewWrap) previewWrap.innerHTML = '<div class="cert-preview-loading">Could not render card.</div>';
    }
  }

  function _closeModal() {
    const modal = document.getElementById('cert-modal');
    if (modal) modal.style.display = 'none';
    _pending = null;
    _activeTemplate = null;
  }

  function _selectTemplate(name) {
    if (!_isPremium() && name !== 'minimal') {
      _toast('Dark & Gradient styles are Premium — upgrade to unlock');
      return;
    }
    if (typeof state !== 'undefined' && state.settings) state.settings.certTemplate = name;
    if (typeof saveToStorage === 'function') saveToStorage();
    document.querySelectorAll('.cert-template-pick').forEach(b => b.classList.toggle('active', b.dataset.template === name));
    if (_pending) _openModal(name);
  }

  // ── Reconstruct a session shape from a stored Firestore certificate record ──
  function _recordToSession(record) {
    return {
      durationMin: record.duration_min,
      taskTitle:   record.task_title || null,
      streakDay:   record.streak_day || null,
      goalTitle:   record.goal_title || null,
      userLine:    record.user_line || null,
      timestamp:   record.created_at ? new Date(record.created_at) : new Date(),
    };
  }

  // Opens the modal for a past certificate from the My Hours gallery
  function openFromRecord(record) {
    _pending = _recordToSession(record);
    _openModal(record.template || 'minimal');
  }

  // ── Share flow: Web Share API with file → download + clipboard fallback ──
  function _caption(session) {
    const parts = ['This hour counted.'];
    parts.push(`${session.durationMin} min${session.taskTitle ? ' on ' + session.taskTitle : ''}.`);
    if (session.streakDay) parts.push(`Day ${session.streakDay}.`);
    parts.push('⏳ flowtimer.app?utm_source=certificate');
    return parts.join(' ').slice(0, 200);
  }

  async function _share(variant) {
    if (!_pending) return;
    const btn = variant === 'story' ? document.getElementById('cert-story-btn') : document.getElementById('cert-share-btn');
    const original = btn?.textContent;
    if (btn) btn.textContent = 'Preparing…';

    try {
      const dataUrl = await renderPng(_pending, _activeTemplate || _certTemplate(), variant === 'story' ? 'story' : 'feed');
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'flow-timer-hour.png', { type: 'image/png' });
      const caption = _caption(_pending);

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: caption, title: 'This hour counted.' });
      } else {
        // Fallback: download PNG + copy caption to clipboard (iOS Safari file-share support is inconsistent)
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'flow-timer-hour.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        try { await navigator.clipboard.writeText(caption); } catch (_) {}
        _toast('Image saved, caption copied — paste anywhere');
      }
    } catch (e) {
      if (e.name !== 'AbortError') _toast('Could not share the card — try again.'); // user canceling the share sheet isn't an error
    } finally {
      if (btn) btn.textContent = original;
    }
  }

  function _toast(msg) {
    let el = document.getElementById('cert-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cert-toast';
      el.className = 'cert-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3000);
  }

  async function renderThumbnail(record) {
    return renderPng(_recordToSession(record), record.template || 'minimal', 'feed');
  }

  return { init, onSessionComplete, buildCardNode, renderPng, openFromRecord, renderThumbnail, isPremium: _isPremium };
})();
