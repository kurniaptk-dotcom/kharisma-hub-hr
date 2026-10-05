import { setCors, querySupabase, defaultData } from './_supabase.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const sb = await querySupabase('calendar_events?select=*&order=day.asc');
    if (sb.ok) {
      return res.status(200).json({ source: 'supabase', data: sb.data });
    }
    return res.status(200).json({ source: 'fallback', data: defaultData.calendar });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const newEvent = {
      id: body.id || `cal-${Date.now().toString().slice(-4)}`,
      day: Number(body.day || 1),
      date: body.date || '2035-06-01',
      title: body.title || 'Agenda Baru',
      time: body.time || '09:00 - 10:00 WIB',
      location: body.location || 'Kantor Utama',
      category: body.category || 'General',
      tone: Number(body.tone || 0)
    };

    const sb = await querySupabase('calendar_events', {
      method: 'POST',
      body: JSON.stringify(newEvent),
      headers: { 'Prefer': 'return=representation' }
    });

    return res.status(201).json({
      source: sb.ok ? 'supabase' : 'fallback',
      data: sb.ok && sb.data?.[0] ? sb.data[0] : newEvent
    });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'id required' });

    const sb = await querySupabase(`calendar_events?id=eq.${id}`, { method: 'DELETE' });
    return res.status(200).json({ success: true, message: `Event ${id} deleted`, source: sb.ok ? 'supabase' : 'fallback' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
