import { setCors, querySupabase } from './_supabase.js';
import { reject, requireUser } from './_auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const auth = await requireUser(req);
  if (auth.error) return reject(res, auth);

  if (req.method === 'GET') {
    const sb = await querySupabase('leave_requests?select=*&order=created_at.desc', { accessToken: auth.token });
    if (sb.ok) {
      return res.status(200).json({ source: 'supabase', data: sb.data });
    }
    return res.status(sb.status || 502).json({ error: 'Data cuti tidak dapat dimuat.' });
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
      accessToken: auth.token,
      body: JSON.stringify(newLeave),
      headers: { 'Prefer': 'return=representation' }
    });

    if (!sb.ok) return res.status(sb.status || 502).json({ error: 'Permohonan cuti tidak dapat disimpan.' });
    return res.status(201).json({ source: 'supabase', data: sb.data?.[0] || newLeave });
  }

  if (req.method === 'PATCH') {
    const { id, status } = req.body || {};
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });

    const sb = await querySupabase(`leave_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      accessToken: auth.token,
      body: JSON.stringify({ status })
    });

    if (!sb.ok) return res.status(sb.status || 502).json({ error: 'Status cuti tidak dapat diperbarui.' });
    return res.status(200).json({ success: true, id, status, source: 'supabase' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
