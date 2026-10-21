import { setCors, querySupabase } from './_supabase.js';
import { adminOnly, reject, requireUser } from './_auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = await requireUser(req);
  if (auth.error) return reject(res, auth);
  if (!adminOnly(auth)) return res.status(403).json({ error: 'Sinkronisasi massal hanya tersedia untuk administrator.' });

  const { employees, kpis, attendance } = req.body || {};
  const report = { employees: 0, kpi: 0, attendance: 0 };
  const failed = (sb, kind) => !sb.ok ? res.status(sb.status === 401 || sb.status === 403 ? sb.status : 502).json({ ok: false, error: `Sinkronisasi ${kind} gagal.`, synced: report }) : null;

  if (Array.isArray(employees) && employees.length) {
    const sb = await querySupabase('employees', {
      method: 'POST',
      accessToken: auth.token,
      body: JSON.stringify(employees),
      headers: { 'Prefer': 'resolution=merge-duplicates' }
    });
    if (failed(sb, 'karyawan')) return;
    if (sb.ok) report.employees = employees.length;
  }

  if (Array.isArray(kpis) && kpis.length) {
    const sb = await querySupabase('kpi_indicators', {
      method: 'POST',
      accessToken: auth.token,
      body: JSON.stringify(kpis),
      headers: { 'Prefer': 'resolution=merge-duplicates' }
    });
    if (failed(sb, 'KPI')) return;
    if (sb.ok) report.kpi = kpis.length;
  }

  if (attendance && typeof attendance === 'object') {
    const payload = { ...attendance, auth_user_id: auth.user.id };
    const sb = await querySupabase('attendance_records?on_conflict=auth_user_id,date', {
      method: 'POST',
      accessToken: auth.token,
      body: JSON.stringify(payload),
      headers: { 'Prefer': 'resolution=merge-duplicates', 'on_conflict': 'auth_user_id,date' }
    });
    if (failed(sb, 'presensi')) return;
    if (sb.ok) report.attendance = 1;
  }

  return res.status(200).json({
    ok: true,
    message: 'Sinkronisasi berhasil diproses',
    synced: report,
    timestamp: new Date().toISOString()
  });
}
