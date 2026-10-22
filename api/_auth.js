import { SUPABASE_URL, setCors } from './_supabase.js';

const anonKey = process.env.SUPABASE_ANON_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export async function requireUser(req, { allowPending = false } = {}) {
  const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !anonKey) return { error: 'Sesi login tidak valid.', status: 401 };
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (!response.ok) return { error: 'Sesi login kedaluwarsa atau tidak valid.', status: 401 };
    const user = await response.json();
    if (!user?.id) return { error: 'Pengguna tidak ditemukan.', status: 401 };
    if (!serviceKey) return { error: 'SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi di server.', status: 503 };
    const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,role,department,title,status,full_name,employee_id`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    if (!profileResponse.ok) return { error: 'Profil pengguna tidak dapat divalidasi.', status: 403 };
    const [profile] = await profileResponse.json();
    if (!profile || profile.status === 'Inactive' || (!allowPending && profile.status !== 'Active')) return { error: 'Akun belum aktif atau profil tidak tersedia.', status: 403 };
    return { user, profile, token };
  } catch {
    return { error: 'Layanan autentikasi tidak tersedia.', status: 503 };
  }
}

export function adminOnly(auth) {
  return auth.profile.role === 'Admin';
}

export async function supabaseAdmin(path, options = {}) {
  if (!serviceKey) return { ok: false, status: 503, error: 'SUPABASE_SERVICE_ROLE_KEY belum dikonfigurasi.' };
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

export function reject(res, auth) {
  setCors(res);
  return res.status(auth.status || 401).json({ error: auth.error || 'Akses ditolak.' });
}
