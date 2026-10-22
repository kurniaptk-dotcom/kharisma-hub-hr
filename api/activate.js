import { setCors } from './_supabase.js';
import { reject, requireUser, supabaseAdmin } from './_auth.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const auth = await requireUser(req, { allowPending: true });
  if (auth.error) return reject(res, auth);
  if (auth.profile.status === 'Inactive') return res.status(403).json({ error: 'Akun ini dinonaktifkan. Hubungi administrator.' });
  if (auth.profile.status === 'Active') return res.status(200).json({ data: auth.profile });
  if (!auth.user.email_confirmed_at) return res.status(403).json({ error: 'Terima undangan melalui email sebelum mengaktifkan akun.' });
  if (auth.profile.role === 'Employee' && !auth.profile.employee_id) return res.status(409).json({ error: 'Akun belum ditautkan ke data karyawan. Hubungi administrator.' });
  if (auth.profile.role === 'Supervisor' && !auth.profile.department) return res.status(409).json({ error: 'Departemen atasan belum ditentukan. Hubungi administrator.' });

  const result = await supabaseAdmin(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(auth.user.id)}&status=eq.Pending`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'Active', updated_at: new Date().toISOString() })
  });
  if (!result.ok) return res.status(result.status).json({ error: result.data?.message || 'Akun belum dapat diaktifkan.' });
  const profile = result.data?.[0];
  if (!profile) return res.status(409).json({ error: 'Status akun berubah. Keluar lalu masuk kembali.' });
  return res.status(200).json({ data: profile });
}
