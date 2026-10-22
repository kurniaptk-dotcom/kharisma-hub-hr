import { setCors, querySupabase } from './_supabase.js';
import { reject, requireUser } from './_auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const auth = await requireUser(req);
  if (auth.error) return reject(res, auth);

  if (req.method === 'GET') {
    const sb = await querySupabase('kpi_indicators?select=*&order=created_at.asc', { accessToken: auth.token });
    if (sb.ok) {
      return res.status(200).json({ source: 'supabase', data: sb.data });
    }
    return res.status(sb.status || 502).json({ error: 'Data KPI tidak dapat dimuat.' });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const pic = String(body.pic || auth.profile.full_name || '').trim();
    const employeeLookup = pic ? await querySupabase(`employees?select=id,name&name=ilike.${encodeURIComponent(pic)}`, { accessToken: auth.token }) : { ok: false };
    const newKpi = {
      id: body.id || `kpi-${Date.now().toString().slice(-4)}`,
      title: body.title,
      dept: body.dept || 'Operations',
      pic,
      employee_id: employeeLookup.ok ? (employeeLookup.data?.[0]?.id || null) : null,
      target: Number(body.target || 100),
      actual: Number(body.actual || 0),
      unit: body.unit || '%',
      weight: Number(body.weight || 20),
      period: body.period || 'Q2 2035',
      status: body.status || 'On-Track',
      lower_is_better: !!body.lowerIsBetter,
      notes: body.notes || '',
      updated_at: new Date().toISOString()
    };

    const sb = await querySupabase('kpi_indicators', {
      method: 'POST',
      accessToken: auth.token,
      body: JSON.stringify(newKpi),
      headers: { 'Prefer': 'return=representation' }
    });

    if (!sb.ok) return res.status(sb.status || 502).json({ error: 'KPI tidak dapat disimpan.' });
    return res.status(201).json({ source: 'supabase', data: sb.data?.[0] || newKpi });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'id required' });

    const sb = await querySupabase(`kpi_indicators?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', accessToken: auth.token });
    if (!sb.ok) return res.status(sb.status || 502).json({ error: 'KPI tidak dapat dihapus.' });
    return res.status(200).json({ success: true, message: `KPI ${id} berhasil dihapus.` });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
