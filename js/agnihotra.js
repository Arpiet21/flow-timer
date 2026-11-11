/* ── Agnihotra Timer ─────────────────────────────────────────────────────────
   Computes today's sunrise/sunset for the user's location (morning & evening
   Agnihotra times) and counts down to whichever is next. Location comes from
   browser geolocation, with a manual lat/lon fallback saved to Firestore. ── */
const AgnihotraTimer = (() => {
  let _lat = null;
  let _lon = null;
  let _tickInterval = null;
  let _todayRise = null; // Date object
  let _todaySet  = null; // Date object

  const _MANTRA_SUNRISE = 'Sooryāya Swāhā, Sooryāya Idam Na Mama.\nPrajāpataye Swāhā, Prajāpataye Idam Na Mama.';
  const _MANTRA_SUNSET  = 'Agnaye Swāhā, Agnaye Idam Na Mama.\nPrajāpataye Swāhā, Prajāpataye Idam Na Mama.';

  function init() {
    _bindUseLocationBtn();
    _bindManualForm();
    _bindMapsLinkForm();
    _bindMarkDoneBtn();
    _bindChangeLocationLink();
    _loadSavedLocation();
  }

  function _bindChangeLocationLink() {
    document.getElementById('agni-change-location-link')?.addEventListener('click', e => {
      e.preventDefault();
      _showManualForm(true);
      document.getElementById('agni-location-controls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function _loadSavedLocation() {
    let loc = null;
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      loc = await Auth.getAgnihotraLocation();
    }
    if (loc && typeof loc.lat === 'number' && typeof loc.lon === 'number') {
      _lat = loc.lat;
      _lon = loc.lon;
      _setStatus(`📍 Using saved location (${_lat.toFixed(2)}, ${_lon.toFixed(2)})`);
      _computeAndRender();
    } else {
      _tryGeolocation();
    }
  }

  function _tryGeolocation() {
    if (!('geolocation' in navigator)) {
      _setStatus('Geolocation not available — enter your location manually below.');
      _showManualForm(true);
      return;
    }
    _setStatus('Detecting your location…');
    navigator.geolocation.getCurrentPosition(
      pos => {
        _lat = pos.coords.latitude;
        _lon = pos.coords.longitude;
        _setStatus(`📍 Location detected (${_lat.toFixed(2)}, ${_lon.toFixed(2)})`);
        _showManualForm(false);
        _saveLocation();
        _computeAndRender();
      },
      () => {
        _setStatus('Location permission denied — enter your location manually below.');
        _showManualForm(true);
      },
      { timeout: 8000 }
    );
  }

  function _saveLocation() {
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn() && _lat != null && _lon != null) {
      Auth.saveAgnihotraLocation(_lat, _lon);
    }
  }

  function _setStatus(text) {
    const el = document.getElementById('agni-status');
    if (el) el.textContent = text;
  }

  function _bindUseLocationBtn() {
    document.getElementById('agni-use-location-btn')?.addEventListener('click', _tryGeolocation);
  }

  function _showManualForm(show) {
    const form = document.getElementById('agni-manual-form');
    if (form) form.style.display = show ? 'flex' : 'none';
  }

  function _bindManualForm() {
    document.getElementById('agni-manual-btn')?.addEventListener('click', () => {
      const latInput = document.getElementById('agni-lat-input');
      const lonInput = document.getElementById('agni-lon-input');
      const lat = parseFloat(latInput.value);
      const lon = parseFloat(lonInput.value);
      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        _setStatus('Enter a valid latitude (-90 to 90) and longitude (-180 to 180).');
        return;
      }
      _lat = lat;
      _lon = lon;
      _setStatus(`📍 Using manual location (${_lat.toFixed(2)}, ${_lon.toFixed(2)})`);
      _saveLocation();
      _computeAndRender();
    });
    document.getElementById('agni-show-manual-link')?.addEventListener('click', e => {
      e.preventDefault();
      _showManualForm(true);
    });
  }

  // Accepts a plain "lat, lon" pair or a (non-shortened) Google Maps URL
  // containing coordinates (@lat,lng / q=lat,lng / ll=lat,lng / !3dlat!4dlng).
  function _parseLocationInput(text) {
    text = (text || '').trim();
    let m = text.match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

    m = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
        text.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
        text.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
        text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

    return null;
  }

  function _bindMapsLinkForm() {
    document.getElementById('agni-maps-link-btn')?.addEventListener('click', () => {
      const input = document.getElementById('agni-maps-link-input');
      const parsed = _parseLocationInput(input.value);
      if (!parsed || parsed.lat < -90 || parsed.lat > 90 || parsed.lon < -180 || parsed.lon > 180) {
        _setStatus('Could not read coordinates from that — try pasting "lat, lon" or a Google Maps link with coordinates in it (shortened links like maps.app.goo.gl aren\'t supported).');
        return;
      }
      _lat = parsed.lat;
      _lon = parsed.lon;
      _setStatus(`📍 Using location from link (${_lat.toFixed(4)}, ${_lon.toFixed(4)})`);
      _saveLocation();
      _computeAndRender();
    });
  }

  function _bindMarkDoneBtn() {
    document.getElementById('agni-done-btn')?.addEventListener('click', () => {
      if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
        Auth.logSession('agnihotra', 5);
      }
      const btn = document.getElementById('agni-done-btn');
      if (btn) {
        const original = btn.textContent;
        btn.textContent = '✓ Logged';
        setTimeout(() => { btn.textContent = original; }, 2000);
      }
      if (typeof renderActivityHeatmap === 'function') renderActivityHeatmap();
    });
  }

  // Sunrise equation (Julian-day based), adapted from the standard public-domain
  // formula (Wikipedia "Sunrise equation"). Returns [sunrise, sunset] as Date objects.
  function _suntimes(lat, lng, date) {
    const radians = Math.PI / 180;
    const degrees = 180 / Math.PI;

    const a = Math.floor((14 - (date.getMonth() + 1)) / 12);
    const y = date.getFullYear() + 4800 - a;
    const m = (date.getMonth() + 1) + 12 * a - 3;
    const jDay = date.getDate() + Math.floor((153 * m + 2) / 5) + 365 * y +
      Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;

    const nStar = jDay - 2451545.0009 - lng / 360;
    const n = Math.floor(nStar + 0.5);
    const solarNoon = 2451545.0009 - lng / 360 + n;
    const M = 356.0470 + 0.9856002585 * n;
    const C = 1.9148 * Math.sin(M * radians) + 0.02 * Math.sin(2 * M * radians) + 0.0003 * Math.sin(3 * M * radians);
    const L = (M + 102.9372 + C + 180) % 360;
    const jTransit = solarNoon + 0.0053 * Math.sin(M * radians) - 0.0069 * Math.sin(2 * L * radians);
    const D = Math.asin(Math.sin(L * radians) * Math.sin(23.45 * radians)) * degrees;
    const cosOmega = (Math.sin(-0.83 * radians) - Math.sin(lat * radians) * Math.sin(D * radians)) /
      (Math.cos(lat * radians) * Math.cos(D * radians));

    if (cosOmega > 1) return [null, null]; // sun never rises
    if (cosOmega < -1) return [null, null]; // sun never sets

    const omega = Math.acos(cosOmega) * degrees;
    const jSet  = jTransit + omega / 360;
    const jRise = jTransit - omega / 360;

    const riseMs = (jRise - 2440587.5) * 86400000;
    const setMs  = (jSet  - 2440587.5) * 86400000;
    return [new Date(riseMs), new Date(setMs)];
  }

  function _computeAndRender() {
    if (_lat == null || _lon == null) return;
    const [rise, set] = _suntimes(_lat, _lon, new Date());
    _todayRise = rise;
    _todaySet  = set;

    const riseEl = document.getElementById('agni-sunrise-time');
    const setEl  = document.getElementById('agni-sunset-time');
    if (!rise || !set) {
      if (riseEl) riseEl.textContent = '—';
      if (setEl)  setEl.textContent  = '—';
      _setCountdown('Sun does not rise/set today at this latitude.');
      return;
    }
    if (riseEl) riseEl.textContent = rise.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (setEl)  setEl.textContent  = set.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    _startCountdown();
  }

  function _startCountdown() {
    clearInterval(_tickInterval);
    _tick();
    _tickInterval = setInterval(_tick, 1000);
  }

  function _tick() {
    const el = document.getElementById('agni-countdown');
    const labelEl = document.getElementById('agni-next-label');
    if (!el || !_todayRise || !_todaySet) return;

    const now = new Date();
    let target = null;
    let label = '';
    let isSunrise = true;

    if (now < _todayRise) {
      target = _todayRise; label = 'Morning Agnihotra (Sunrise)'; isSunrise = true;
    } else if (now < _todaySet) {
      target = _todaySet; label = 'Evening Agnihotra (Sunset)'; isSunrise = false;
    } else {
      // Next sunrise is tomorrow — recompute for tomorrow's date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const [rise] = _suntimes(_lat, _lon, tomorrow);
      target = rise; label = 'Morning Agnihotra (Sunrise)'; isSunrise = true;
    }

    if (labelEl) labelEl.textContent = label;
    const mantraEl = document.getElementById('agni-mantra');
    if (mantraEl) mantraEl.textContent = isSunrise ? _MANTRA_SUNRISE : _MANTRA_SUNSET;
    if (!target) { el.textContent = '—'; return; }

    const diff = Math.max(0, target - now);
    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  }

  function _setCountdown(text) {
    const el = document.getElementById('agni-countdown');
    if (el) el.textContent = text;
  }

  function refresh() {
    if (_lat != null && _lon != null) _computeAndRender();
  }

  return { init, refresh };
})();
