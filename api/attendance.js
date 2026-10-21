import { setCors, querySupabase } from './_supabase.js';
import { reject, requireUser } from './_auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const auth = await requireUser(req);
  if (auth.error) return reject(res, auth);

  if (req.method === 'GET') {
    const sb = await querySupabase('attendance_records?select=*&order=date.desc,created_at.desc&limit=500', { accessToken: auth.token });
    return sb.ok ? res.status(200).json({ source: 'supabase', data: sb.data }) : res.status(sb.status || 502).json({ error: 'Data kehadiran tidak dapat dimuat.' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const body = req.body || {};

  if (body.action === 'transition') {
    const { transition, date, latitude, longitude, accuracy, eventAt } = body;
    if (!['clock_in', 'break_start', 'break_end', 'clock_out'].includes(transition) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || latitude == null || longitude == null || !Number.isFinite(Number(latitude)) || Number(latitude) < -90 || Number(latitude) > 90 || !Number.isFinite(Number(longitude)) || Number(longitude) < -180 || Number(longitude) > 180 || (eventAt && !Number.isFinite(Date.parse(eventAt)))) {
      return res.status(400).json({ error: 'Aksi, tanggal, dan koordinat GPS wajib valid.' });
    }
    const sb = await querySupabase('rpc/attendance_transition', {
      method: 'POST', accessToken: auth.token,
      body: JSON.stringify({ p_action: transition, p_date: date, p_latitude: Number(latitude), p_longitude: Number(longitude), p_accuracy_m: Number.isFinite(Number(accuracy)) ? Number(accuracy) : null, p_event_at: eventAt || new Date().toISOString() })
    });
    return sb.ok ? res.status(200).json({ source: 'supabase', data: sb.data }) : res.status(sb.status || 502).json({ error: 'Presensi gagal divalidasi atau disimpan.' });
  }

  if (body.action === 'request_correction') {
    const requested = body.requestedValues || {};
    const validTime = value => value == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    const reason = String(body.reason || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(String(body.attendanceId || '')) || !validTime(requested.clock_in) || !validTime(requested.clock_out) || reason.length < 5 || reason.length > 1000) {
      return res.status(400).json({ error: 'Data koreksi atau alasan tidak valid.' });
    }
    const sb = await querySupabase('attendance_correction_requests', {
      method: 'POST', accessToken: auth.token,
      body: JSON.stringify({ attendance_id: body.attendanceId, requester_id: auth.user.id, requested_values: requested, reason }),
      headers: { Prefer: 'return=representation' }
    });
    return sb.ok ? res.status(201).json({ data: sb.data?.[0] }) : res.status(sb.status || 502).json({ error: 'Permintaan koreksi gagal disimpan.' });
  }

  if (body.action === 'review_correction' || body.action === 'review_overtime') {
    if (!['Admin', 'Supervisor'].includes(auth.profile.role)) return res.status(403).json({ error: 'Hanya atasan atau admin yang dapat menyetujui.' });
    const correction = body.action === 'review_correction';
    const sb = await querySupabase(correction ? 'rpc/review_attendance_correction' : 'rpc/review_attendance_overtime', {
      method: 'POST', accessToken: auth.token,
      body: JSON.stringify(correction
        ? { p_request_id: body.id, p_approve: body.approve === true, p_note: String(body.note || '').slice(0, 1000) }
        : { p_attendance_id: body.id, p_approve: body.approve === true })
    });
    return sb.ok ? res.status(200).json({ data: sb.data }) : res.status(sb.status || 502).json({ error: 'Keputusan persetujuan gagal disimpan.' });
  }

  return res.status(400).json({ error: 'Aksi absensi tidak dikenal.' });
}
