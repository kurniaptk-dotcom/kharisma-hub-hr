import { setCors, querySupabase, defaultData } from './_supabase.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const sb = await querySupabase('leave_requests?select=*&order=created_at.desc');
    if (sb.ok) {
      return res.status(200).json({ source: 'supabase', data: sb.data });
    }
    return res.status(200).json({ source: 'fallback', data: defaultData.leave });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const newLeave = {
      id: body.id || `lv-${Date.now().toString().slice(-4)}`,
      employee_name: body.name || 'Pegawai',
      title: body.title || 'Staff',
      type: body.type || 'Annual Leave',
      submit_date: body.submitDate || new Date().toLocaleDateString('id-ID'),
      period: body.period || '1 Hari',
      duration: body.duration || '1 Day',
      reason: body.reason || 'Keperluan keluarga',
      status: body.status || 'Pending'
    };

    const sb = await querySupabase('leave_requests', {
      method: 'POST',
      body: JSON.stringify(newLeave),
      headers: { 'Prefer': 'return=representation' }
    });

    return res.status(201).json({
      source: sb.ok ? 'supabase' : 'fallback',
      data: sb.ok && sb.data?.[0] ? sb.data[0] : newLeave
    });
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body || {};
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });

    const sb = await querySupabase(`leave_requests?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });

    return res.status(200).json({ success: true, id, status, source: sb.ok ? 'supabase' : 'fallback' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
