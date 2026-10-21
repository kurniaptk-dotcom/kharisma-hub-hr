import { setCors, querySupabase } from './_supabase.js';
import { reject, requireUser } from './_auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const auth = await requireUser(req);
  if (auth.error) return reject(res, auth);

  if (req.method === 'GET') {
    const sb = await querySupabase('calendar_events?select=*&order=day.asc', { accessToken: auth.token });
    if (sb.ok) {
      return res.status(200).json({ source: 'supabase', data: sb.data });
    }
    return res.status(sb.status || 502).json({ error: 'Data kalender tidak dapat dimuat.' });
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
      accessToken: auth.token,
      body: JSON.stringify(newEvent),
      headers: { 'Prefer': 'return=representation' }
    });

    if (!sb.ok) return res.status(sb.status || 502).json({ error: 'Agenda tidak dapat disimpan.' });
    return res.status(201).json({ source: 'supabase', data: sb.data?.[0] || newEvent });
  }

  if (req.method === 'DELETE') {
    const id = req.query.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'id required' });

    const sb = await querySupabase(`calendar_events?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', accessToken: auth.token });
    if (!sb.ok) return res.status(sb.status || 502).json({ error: 'Agenda tidak dapat dihapus.' });
    return res.status(200).json({ success: true, message: `Agenda ${id} berhasil dihapus.`, source: 'supabase' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
