// ── Weekly Report Emailer ──────────────────────────────────────────────────
// Vercel Cron: runs every Monday at 8 AM UTC (see vercel.json)
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // service-role needed to read all users
);

export default async function handler(req, res) {
  // Allow manual trigger via POST (for testing), Vercel Cron sends GET
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // Verify cron secret to prevent unauthorized calls
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  // Fetch all Pro/Trial users
  const { data: plans } = await sb
    .from('user_plans')
    .select('user_id, plan')
    .in('plan', ['pro', 'trial']);

  if (!plans || plans.length === 0) return res.json({ sent: 0 });

  const userIds = plans.map(p => p.user_id);

  // Fetch this week's sessions
  const { data: sessions } = await sb
    .from('sessions')
    .select('user_id, mode, duration_minutes, completed_at')
    .in('user_id', userIds)
    .gte('completed_at', weekAgo.toISOString())
    .order('completed_at', { ascending: true });

  // Fetch last week's sessions (for comparison)
  const { data: lastWeekSessions } = await sb
    .from('sessions')
    .select('user_id, mode, duration_minutes')
    .in('user_id', userIds)
    .gte('completed_at', twoWeeksAgo.toISOString())
    .lt('completed_at', weekAgo.toISOString());

  // Group by user
  const byUser = {};
  for (const uid of userIds) byUser[uid] = { sessions: [], lastWeek: [] };
  (sessions || []).forEach(s => byUser[s.user_id]?.sessions.push(s));
  (lastWeekSessions || []).forEach(s => byUser[s.user_id]?.lastWeek.push(s));

  // Get user emails from auth.users (service role required)
  const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const emailMap = {};
  (users || []).forEach(u => { emailMap[u.id] = { email: u.email, name: u.user_metadata?.full_name || u.email.split('@')[0] }; });

  let sent = 0;
  const errors = [];

  for (const uid of userIds) {
    const info = emailMap[uid];
    if (!info?.email) continue;

    const { sessions: thisSessions, lastWeek } = byUser[uid];
    const workSessions   = thisSessions.filter(s => s.mode === 'work');
    const workoutSessions = thisSessions.filter(s => s.mode === 'workout');
    const totalMins = workSessions.reduce((a, s) => a + (s.duration_minutes || 0), 0);
    const lastMins  = lastWeek.filter(s => s.mode === 'work').reduce((a, s) => a + (s.duration_minutes || 0), 0);
    const trend = totalMins >= lastMins ? '📈' : '📉';
    const hrs  = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

    // Build a simple day-by-day breakdown
    const dayMap = {};
    workSessions.forEach(s => {
      const d = new Date(s.completed_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      dayMap[d] = (dayMap[d] || 0) + 1;
    });
    const dayRows = Object.entries(dayMap)
      .map(([d, n]) => `<tr><td style="padding:4px 12px 4px 0;color:#aaa;">${d}</td><td style="padding:4px 0;font-weight:600;">${n} session${n > 1 ? 's' : ''}</td></tr>`)
      .join('');

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#1a1a2e;font-family:'Segoe UI',system-ui,sans-serif;color:#eaeaea;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:2rem;margin-bottom:8px;">⏱</div>
      <h1 style="margin:0;font-size:1.4rem;font-weight:800;color:#eaeaea;">Your Weekly Flow Report</h1>
      <p style="margin:6px 0 0;font-size:0.85rem;color:#888;">Week of ${weekAgo.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${now.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</p>
    </div>

    <div style="background:#16213e;border-radius:16px;padding:24px;margin-bottom:16px;text-align:center;">
      <p style="margin:0 0 4px;font-size:0.78rem;color:#888;text-transform:uppercase;letter-spacing:1px;">Total focus time</p>
      <div style="font-size:2.4rem;font-weight:800;color:#39ff14;line-height:1.1;">${timeStr}</div>
      <p style="margin:8px 0 0;font-size:0.82rem;color:#888;">${trend} vs ${lastMins > 0 ? Math.floor(lastMins/60)+'h '+lastMins%60+'m' : '0m'} last week</p>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:16px;">
      <div style="flex:1;background:#16213e;border-radius:14px;padding:16px;text-align:center;">
        <div style="font-size:1.6rem;font-weight:800;color:#eaeaea;">${workSessions.length}</div>
        <div style="font-size:0.72rem;color:#888;margin-top:4px;">Focus sessions</div>
      </div>
      <div style="flex:1;background:#16213e;border-radius:14px;padding:16px;text-align:center;">
        <div style="font-size:1.6rem;font-weight:800;color:#eaeaea;">${workoutSessions.length}</div>
        <div style="font-size:0.72rem;color:#888;margin-top:4px;">Workouts</div>
      </div>
      <div style="flex:1;background:#16213e;border-radius:14px;padding:16px;text-align:center;">
        <div style="font-size:1.6rem;font-weight:800;color:#eaeaea;">${Object.keys(dayMap).length}</div>
        <div style="font-size:0.72rem;color:#888;margin-top:4px;">Active days</div>
      </div>
    </div>

    ${dayRows ? `
    <div style="background:#16213e;border-radius:14px;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 10px;font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;">Day by Day</p>
      <table style="border-collapse:collapse;width:100%;font-size:0.82rem;">${dayRows}</table>
    </div>` : ''}

    <div style="text-align:center;padding:16px;">
      <a href="https://flow-timer.vercel.app" style="display:inline-block;padding:12px 28px;background:#39ff14;color:#111;font-weight:800;border-radius:12px;text-decoration:none;font-size:0.9rem;">Open Flow Timer →</a>
    </div>

    <p style="text-align:center;font-size:0.68rem;color:#555;margin-top:24px;">
      You're receiving this because you have a Flow Timer account.<br>
      <a href="https://flow-timer.vercel.app" style="color:#555;">Unsubscribe</a>
    </p>
  </div>
</body>
</html>`;

    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Flow Timer <reports@flowtimer.app>',
          to: info.email,
          subject: `Your weekly focus report ${trend} — ${timeStr} this week`,
          html
        })
      });
      if (r.ok) sent++;
      else errors.push({ uid, status: r.status });
    } catch (e) {
      errors.push({ uid, error: e.message });
    }
  }

  return res.json({ sent, errors: errors.length ? errors : undefined });
}
