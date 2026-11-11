/* ── Amavasya / Poonam Reminders (FY 2026-27: Apr 2026 – Mar 2027) ──────────
   Dates sourced from Drik Panchang (Delhi, India reference). Notification-only
   feature — no UI widget. Fires a browser notification the day of and the day
   before each date, gated on the user's existing notification preference. ── */
const LUNAR_DATES_FY26 = [
  { date: '2026-04-01', type: 'purnima',  name: 'Chaitra Purnima' },
  { date: '2026-04-17', type: 'amavasya', name: 'Vaishakha Amavasya' },
  { date: '2026-05-01', type: 'purnima',  name: 'Vaishakha Purnima (Buddha Purnima)' },
  { date: '2026-05-16', type: 'amavasya', name: 'Jyeshtha Amavasya' },
  { date: '2026-05-30', type: 'purnima',  name: 'Adhika Jyeshtha Purnima' },
  { date: '2026-06-14', type: 'amavasya', name: 'Adhika Jyeshtha Amavasya' },
  { date: '2026-06-29', type: 'purnima',  name: 'Jyeshtha Purnima' },
  { date: '2026-07-14', type: 'amavasya', name: 'Ashadha Amavasya' },
  { date: '2026-07-29', type: 'purnima',  name: 'Ashadha Purnima (Guru Purnima)' },
  { date: '2026-08-12', type: 'amavasya', name: 'Shravana Amavasya' },
  { date: '2026-08-27', type: 'purnima',  name: 'Shravana Purnima (Raksha Bandhan)' },
  { date: '2026-09-10', type: 'amavasya', name: 'Bhadrapada Amavasya' },
  { date: '2026-09-26', type: 'purnima',  name: 'Bhadrapada Purnima' },
  { date: '2026-10-10', type: 'amavasya', name: 'Ashwina Amavasya (Mahalaya Amavasya)' },
  { date: '2026-10-25', type: 'purnima',  name: 'Ashwina Purnima (Sharad Purnima)' },
  { date: '2026-11-08', type: 'amavasya', name: 'Kartika Amavasya (Diwali)' },
  { date: '2026-11-24', type: 'purnima',  name: 'Kartika Purnima' },
  { date: '2026-12-08', type: 'amavasya', name: 'Margashirsha Amavasya' },
  { date: '2026-12-23', type: 'purnima',  name: 'Margashirsha Purnima' },
  { date: '2027-01-07', type: 'amavasya', name: 'Pausha Amavasya' },
  { date: '2027-01-22', type: 'purnima',  name: 'Pausha Purnima' },
  { date: '2027-02-06', type: 'amavasya', name: 'Magha Amavasya (Mauni Amavasya)' },
  { date: '2027-02-20', type: 'purnima',  name: 'Magha Purnima' },
  { date: '2027-03-08', type: 'amavasya', name: 'Phalguna Amavasya' },
  { date: '2027-03-22', type: 'purnima',  name: 'Phalguna Purnima (Holi)' },
];

const LunarReminders = (() => {
  function _dateStr(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function _notifiedKey(entry, when) {
    return `lunar-notified-${entry.date}-${when}`;
  }

  function _fire(entry, when) {
    const key = _notifiedKey(entry, when);
    if (localStorage.getItem(key) === '1') return;
    const emoji = entry.type === 'amavasya' ? '🌑' : '🌕';
    const title = entry.type === 'amavasya' ? `${emoji} Amavasya Reminder` : `${emoji} Poonam Reminder`;
    const body  = when === 'today' ? `Today is ${entry.name}` : `Tomorrow is ${entry.name}`;
    new Notification(title, { body, icon: 'assets/icon-192.png' });
    localStorage.setItem(key, '1');
  }

  function check() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem('flow-timer-state') || '{}').settings || {}; } catch (_) {}
    if (settings.notificationsEnabled === false) return;

    const today    = _dateStr(0);
    const tomorrow = _dateStr(1);
    LUNAR_DATES_FY26.forEach(entry => {
      if (entry.date === today)    _fire(entry, 'today');
      else if (entry.date === tomorrow) _fire(entry, 'tomorrow');
    });
  }

  return { init: check };
})();
