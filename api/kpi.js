import { setCors, querySupabase, defaultData } from './_supabase.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const sb = await querySupabase('kpi_indicators?select=*&order=created_at.asc');
    if (sb.ok) {
      return res.status(200).json({ source: 'supabase', data: sb.data });
    }
    return res.status(200).json({ source: 'fallback', data: defaultData.kpi });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const newKpi = {
      id: body.id || `kpi-${Date.now().toString().slice(-4)}`,
      title: body.title,
      dept: body.dept || 'Operations',
      pic: body.pic || 'Davis Levin',
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
      body: JSON.stringify(newKpi),
      headers: { 'Prefer': 'return=representation' }
    });

    return res.status(201).json({
      source: sb.ok ? 'supabase' : 'fallback',
      data: sb.ok && sb.data?.[0] ? sb.data[0] : newKpi
    });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'id required' });

    const sb = await querySupabase(`kpi_indicators?id=eq.${id}`, { method: 'DELETE' });
    return res.status(200).json({ success: true, message: `KPI ${id} deleted`, source: sb.ok ? 'supabase' : 'fallback' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
