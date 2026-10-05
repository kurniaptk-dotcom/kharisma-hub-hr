import { setCors, querySupabase, defaultData } from './_supabase.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const sb = await querySupabase('employees?select=*&order=created_at.asc');
    if (sb.ok) {
      return res.status(200).json({ source: 'supabase', data: sb.data });
    }
    return res.status(200).json({ source: 'fallback', data: defaultData.employees });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (!body.name) return res.status(400).json({ error: 'Nama karyawan wajib diisi' });

    const newEmp = {
      id: body.id || `EMP-${Date.now().toString().slice(-4)}`,
      name: body.name,
      email: body.email || `${body.name.toLowerCase().replace(/\s+/g, '.')}@kharismahub.com`,
      department: body.department || 'Operations',
      title: body.title || 'Staff',
      status: body.status || 'On-Time',
      work_model: body.workModel || body.work_model || 'Hybrid',
      updated_at: new Date().toISOString()
    };

    const sb = await querySupabase('employees', {
      method: 'POST',
      body: JSON.stringify(newEmp),
      headers: { 'Prefer': 'return=representation' }
    });

    if (sb.ok) {
      return res.status(201).json({ source: 'supabase', data: sb.data[0] || newEmp });
    }
    return res.status(201).json({ source: 'fallback', data: newEmp });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'ID karyawan wajib diisi' });

    const sb = await querySupabase(`employees?id=eq.${id}`, { method: 'DELETE' });
    return res.status(200).json({ success: true, message: `Karyawan ${id} diproses untuk dihapus`, source: sb.ok ? 'supabase' : 'fallback' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
