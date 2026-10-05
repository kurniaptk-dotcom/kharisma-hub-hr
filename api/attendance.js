import { setCors, querySupabase } from './_supabase.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const sb = await querySupabase('attendance_records?select=*&order=created_at.desc&limit=50');
    if (sb.ok) {
      return res.status(200).json({ source: 'supabase', data: sb.data });
    }
    return res.status(200).json({ source: 'fallback', data: [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const record = {
      employee_id: body.id || 'EMP-0001',
      employee_name: body.name || 'Davis Levin',
      date: body.date || new Date().toISOString().split('T')[0],
      work_model: body.workModel || 'Di Kantor',
      clock_in: body.clockIn || '09:00 AM',
      clock_out: body.clockOut || null,
      duration: body.duration || '—',
      overtime: body.overtime || '—',
      status: body.status || 'On-Time'
    };

    const sb = await querySupabase('attendance_records', {
      method: 'POST',
      body: JSON.stringify(record),
      headers: { 'Prefer': 'return=representation' }
    });

    return res.status(201).json({
      source: sb.ok ? 'supabase' : 'fallback',
      data: sb.ok && sb.data?.[0] ? sb.data[0] : record
    });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
