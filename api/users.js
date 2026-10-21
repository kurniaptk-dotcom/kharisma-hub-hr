import { setCors } from './_supabase.js';
import { adminOnly, reject, requireUser, supabaseAdmin } from './_auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const auth = await requireUser(req);
  if (auth.error) return reject(res, auth);
  if (!adminOnly(auth)) return res.status(403).json({ error: 'Hanya administrator yang dapat mengelola akun pengguna.' });

  if (req.method === 'GET') {
    const result = await supabaseAdmin('/rest/v1/user_profiles?select=id,email,full_name,role,department,title,status,created_at&order=created_at.asc');
    return res.status(result.ok ? 200 : result.status).json(result.ok ? { data: result.data } : { error: result.data?.message || 'Gagal memuat akun.' });
  }

  if (req.method === 'POST') {
    const { name, email, role, department, title } = req.body || {};
    if (!String(name || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) return res.status(400).json({ error: 'Nama dan email yang valid wajib diisi.' });
    if (!['Admin', 'Supervisor'].includes(role)) return res.status(400).json({ error: 'Role tidak valid.' });
    const invited = await supabaseAdmin('/auth/v1/invite', { method: 'POST', body: JSON.stringify({ email: String(email).trim().toLowerCase(), data: { full_name: String(name).trim() } }) });
    if (!invited.ok || !invited.data?.id) return res.status(invited.status || 502).json({ error: invited.data?.msg || invited.data?.message || 'Undangan login gagal dikirim.' });
    const created = await supabaseAdmin('/rest/v1/user_profiles?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id: invited.data.id, email: String(email).trim().toLowerCase(), full_name: String(name).trim(), role, department: department || '', title: title || role, status: 'Active' })
    });
    if (!created.ok) return res.status(created.status || 502).json({ error: created.data?.message || 'Akun login dibuat tetapi profil gagal disimpan. Jalankan migrasi database.' });
    return res.status(201).json({ data: created.data?.[0] || { id: invited.data.id, email, name, role, department, title, status: 'Active' } });
  }

  if (req.method === 'PATCH') {
    const { id, name, email, role, department, title, status } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID akun wajib diisi.' });
    if (id === auth.user.id && (role !== 'Admin' || status === 'Inactive')) return res.status(400).json({ error: 'Anda tidak dapat menurunkan role atau menonaktifkan akun sendiri.' });
    if (role && !['Admin', 'Supervisor'].includes(role)) return res.status(400).json({ error: 'Role tidak valid.' });
    if (role === 'Supervisor' || status === 'Inactive') {
      const target = await supabaseAdmin(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=role,status`);
      if (target.data?.[0]?.role === 'Admin' && target.data[0].status === 'Active') {
        const admins = await supabaseAdmin('/rest/v1/user_profiles?select=id&role=eq.Admin&status=eq.Active');
        if (admins.ok && admins.data.length <= 1) return res.status(409).json({ error: 'Sistem harus memiliki setidaknya satu administrator aktif.' });
      }
    }
    const fields = {};
    if (name !== undefined) fields.full_name = String(name).trim();
    if (email !== undefined) fields.email = String(email).trim().toLowerCase();
    for (const key of ['role', 'department', 'title', 'status']) if (req.body[key] !== undefined) fields[key] = req.body[key];
    if (email !== undefined || name !== undefined) {
      const authUpdate = {};
      if (email !== undefined) { authUpdate.email = String(email).trim().toLowerCase(); authUpdate.email_confirm = true; }
      if (name !== undefined) authUpdate.user_metadata = { full_name: String(name).trim() };
      const identity = await supabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(authUpdate) });
      if (!identity.ok) return res.status(identity.status).json({ error: identity.data?.message || 'Identitas login gagal diperbarui.' });
    }
    const updated = await supabaseAdmin(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(fields) });
    if (!updated.ok) return res.status(updated.status).json({ error: updated.data?.message || 'Pembaruan akun gagal.' });
    if (status) {
      const banned = await supabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ban_duration: status === 'Inactive' ? '876000h' : 'none' }) });
      if (!banned.ok) return res.status(banned.status).json({ error: banned.data?.message || 'Data profil berubah, tetapi status login gagal diperbarui.' });
    }
    return res.status(200).json({ data: updated.data?.[0] || null });
  }
  return res.status(405).json({ error: 'Method Not Allowed' });
}
