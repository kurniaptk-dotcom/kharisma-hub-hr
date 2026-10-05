import { setCors, querySupabase } from './_supabase.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { employees, kpis, calendar, leave } = req.body || {};
  const report = { employees: 0, kpi: 0, calendar: 0, leave: 0 };

  if (Array.isArray(employees) && employees.length) {
    const sb = await querySupabase('employees', {
      method: 'POST',
      body: JSON.stringify(employees),
      headers: { 'Prefer': 'resolution=merge-duplicates' }
    });
    if (sb.ok) report.employees = employees.length;
  }

  if (Array.isArray(kpis) && kpis.length) {
    const sb = await querySupabase('kpi_indicators', {
      method: 'POST',
      body: JSON.stringify(kpis),
      headers: { 'Prefer': 'resolution=merge-duplicates' }
    });
    if (sb.ok) report.kpi = kpis.length;
  }

  if (Array.isArray(calendar) && calendar.length) {
    const sb = await querySupabase('calendar_events', {
      method: 'POST',
      body: JSON.stringify(calendar),
      headers: { 'Prefer': 'resolution=merge-duplicates' }
    });
    if (sb.ok) report.calendar = calendar.length;
  }

  if (Array.isArray(leave) && leave.length) {
    const sb = await querySupabase('leave_requests', {
      method: 'POST',
      body: JSON.stringify(leave),
      headers: { 'Prefer': 'resolution=merge-duplicates' }
    });
    if (sb.ok) report.leave = leave.length;
  }

  return res.status(200).json({
    ok: true,
    message: 'Sinkronisasi berhasil diproses',
    synced: report,
    timestamp: new Date().toISOString()
  });
}
