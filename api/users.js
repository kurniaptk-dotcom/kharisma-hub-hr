import { setCors, SUPABASE_URL } from './_supabase.js';
import { adminOnly, reject, requireUser, supabaseAdmin } from './_auth.js';

const ROLES = new Set(['Admin', 'Supervisor', 'Employee']);
const STATUSES = new Set(['Pending', 'Active', 'Inactive']);
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function getEmployeeByEmail(email) {
  const result = await supabaseAdmin(`/rest/v1/employees?select=id,name,email,department,title&id=not.is.null&email=ilike.${encodeURIComponent(email)}`);
  if (!result.ok) return { error: result.data?.message || 'Data karyawan tidak dapat divalidasi.', status: result.status };
  return { employee: result.data?.find(row => normalizeEmail(row.email) === email) || null };
}

async function lastActiveAdminWouldBeRemoved(id, nextRole, nextStatus) {
  const target = await supabaseAdmin(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=role,status`);
  if (!target.ok) return true;
  const profile = target.data?.[0];
  if (!profile || profile.role !== 'Admin' || profile.status !== 'Active') return false;
  if (nextRole === 'Admin' && nextStatus === 'Active') return false;
  const admins = await supabaseAdmin('/rest/v1/user_profiles?select=id&role=eq.Admin&status=eq.Active');
  return !admins.ok || admins.data.length <= 1;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  const auth = await requireUser(req);
  if (auth.error) return reject(res, auth);
  if (!adminOnly(auth)) return res.status(403).json({ error: 'Hanya administrator yang dapat mengelola akun pengguna.' });

  if (req.method === 'GET') {
    const result = await supabaseAdmin('/rest/v1/user_profiles?select=id,email,full_name,role,department,title,status,employee_id,created_at&order=created_at.asc');
    return res.status(result.ok ? 200 : result.status).json(result.ok ? { data: result.data } : { error: result.data?.message || 'Gagal memuat akun.' });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.action === 'resend_invite') {
      const targetEmail = normalizeEmail(body.email);
      if (!validEmail(targetEmail)) return res.status(400).json({ error: 'Alamat email tidak valid.' });
      const appUrl = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://kharismahub.vercel.app');
      const resend = await supabaseAdmin(`/auth/v1/invite?redirect_to=${encodeURIComponent(appUrl)}`, {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail })
      });
      if (!resend.ok) return res.status(resend.status || 502).json({ error: resend.data?.msg || resend.data?.message || 'Gagal mengirim ulang undangan.' });
      return res.status(200).json({ success: true, message: `Tautan undangan telah dikirim ulang ke ${targetEmail}.` });
    }

    if (body.action === 'reset_password') {
      const targetEmail = normalizeEmail(body.email);
      if (!validEmail(targetEmail)) return res.status(400).json({ error: 'Alamat email tidak valid.' });
      const appUrl = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://kharismahub.vercel.app');
      const reset = await supabaseAdmin(`/auth/v1/recover?redirect_to=${encodeURIComponent(appUrl)}`, {
        method: 'POST',
        body: JSON.stringify({ email: targetEmail })
      });
      if (!reset.ok) return res.status(reset.status || 502).json({ error: reset.data?.msg || reset.data?.message || 'Gagal mengirim email reset kata sandi.' });
      return res.status(200).json({ success: true, message: `Email pemulihan kata sandi telah dikirim ke ${targetEmail}.` });
    }

    const name = String(body.name || '').trim();
    const email = normalizeEmail(body.email);
    const role = String(body.role || 'Employee');
    const department = String(body.department || '').trim();
    const title = String(body.title || '').trim();
    if (!name || !validEmail(email)) return res.status(400).json({ error: 'Nama dan alamat email yang valid wajib diisi.' });
    if (!ROLES.has(role)) return res.status(400).json({ error: 'Peran akun tidak valid.' });
    if (role === 'Supervisor' && !department) return res.status(400).json({ error: 'Pilih departemen untuk akun atasan.' });

    const match = await getEmployeeByEmail(email);
    if (match.error) return res.status(match.status || 502).json({ error: match.error });
    if (role === 'Employee' && !match.employee) return res.status(409).json({ error: 'Email harus cocok dengan data karyawan yang sudah terdaftar.' });
    const employee = match.employee;
    const appUrl = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://kharismahub.vercel.app');
    const invite = await supabaseAdmin(`/auth/v1/invite?redirect_to=${encodeURIComponent(appUrl)}`, {
      method: 'POST',
      body: JSON.stringify({ email, data: { full_name: name } })
    });
    if (!invite.ok || !invite.data?.id) {
      const errMsg = invite.data?.msg || invite.data?.message || '';
      if (/already\s+been\s+registered/i.test(errMsg) || invite.status === 422) {
        return res.status(409).json({ error: `Pengguna dengan email ${email} sudah terdaftar di Supabase Auth. Gunakan fitur kirim ulang undangan atau ubah status akun.` });
      }
      return res.status(invite.status || 502).json({ error: errMsg || 'Undangan login gagal dikirim.' });
    }

    const profile = {
      id: invite.data.id,
      email,
      full_name: name,
      role,
      department: role === 'Employee' ? (employee?.department || department) : (department || employee?.department || ''),
      title: title || employee?.title || (role === 'Admin' ? 'Administrator SDM' : role === 'Supervisor' ? 'Atasan' : 'Karyawan'),
      employee_id: employee?.id || null,
      status: 'Pending'
    };
    const saved = await supabaseAdmin('/rest/v1/user_profiles?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(profile)
    });
    if (!saved.ok) {
      await supabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(invite.data.id)}`, { method: 'DELETE' });
      return res.status(saved.status || 502).json({ error: saved.data?.message || 'Undangan dibatalkan karena profil akun gagal dibuat.' });
    }
    return res.status(201).json({ data: saved.data?.[0] || profile });
  }

  if (req.method === 'PATCH') {
    const body = req.body || {};
    const { id } = body;
    if (!id) return res.status(400).json({ error: 'ID akun wajib diisi.' });
    if (id === auth.user.id && ((body.role !== undefined && body.role !== 'Admin') || body.status === 'Inactive' || body.status === 'Pending')) {
      return res.status(400).json({ error: 'Anda tidak dapat menurunkan peran atau menonaktifkan akun sendiri.' });
    }
    if (body.role !== undefined && !ROLES.has(body.role)) return res.status(400).json({ error: 'Peran akun tidak valid.' });
    if (body.status !== undefined && !STATUSES.has(body.status)) return res.status(400).json({ error: 'Status akun tidak valid.' });

    const currentResult = await supabaseAdmin(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=id,role,status,email,employee_id,department`);
    const current = currentResult.data?.[0];
    if (!currentResult.ok || !current) return res.status(currentResult.status || 404).json({ error: currentResult.data?.message || 'Akun tidak ditemukan.' });
    const nextRole = body.role ?? current.role;
    const nextStatus = body.status ?? current.status;
    const fields = { role: nextRole, status: nextStatus, updated_at: new Date().toISOString() };
    if (body.name !== undefined) fields.full_name = String(body.name).trim();
    if (body.email !== undefined) fields.email = normalizeEmail(body.email);
    if (body.department !== undefined) fields.department = String(body.department).trim();
    if (body.title !== undefined) fields.title = String(body.title).trim();
    if (body.employee_id !== undefined) fields.employee_id = body.employee_id || null;
    if (nextRole === 'Supervisor' && !String(body.department ?? current.department ?? '').trim()) return res.status(400).json({ error: 'Pilih departemen untuk akun atasan.' });
    if (nextRole === 'Employee') {
      let employeeId = body.employee_id ?? current.employee_id;
      if (!employeeId) {
        const match = await getEmployeeByEmail(normalizeEmail(body.email ?? current.email));
        if (match.error) return res.status(match.status || 502).json({ error: match.error });
        employeeId = match.employee?.id;
      }
      if (!employeeId) return res.status(409).json({ error: 'Akun karyawan harus ditautkan ke data karyawan dengan email yang sama.' });
      const employee = await supabaseAdmin(`/rest/v1/employees?id=eq.${encodeURIComponent(employeeId)}&select=id,email,department,title`);
      if (!employee.ok || !employee.data?.[0] || normalizeEmail(employee.data[0].email) !== normalizeEmail(body.email ?? current.email)) {
        return res.status(409).json({ error: 'Tautan akun harus mengarah ke data karyawan dengan email yang sama.' });
      }
      fields.employee_id = employeeId;
      if (nextRole === 'Employee') {
        fields.department = employee.data[0].department;
        fields.title = employee.data[0].title;
      }
    }
    if (await lastActiveAdminWouldBeRemoved(id, nextRole, nextStatus)) return res.status(409).json({ error: 'Sistem harus memiliki setidaknya satu administrator aktif.' });

    if (body.email !== undefined || body.name !== undefined) {
      const authUpdate = {};
      if (body.email !== undefined) { if (!validEmail(fields.email)) return res.status(400).json({ error: 'Alamat email tidak valid.' }); authUpdate.email = fields.email; authUpdate.email_confirm = true; }
      if (body.name !== undefined) authUpdate.user_metadata = { full_name: fields.full_name };
      const identity = await supabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(authUpdate) });
      if (!identity.ok) return res.status(identity.status).json({ error: identity.data?.message || 'Identitas login gagal diperbarui.' });
    }

    const updated = await supabaseAdmin(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(fields)
    });
    if (!updated.ok) return res.status(updated.status).json({ error: updated.data?.message || 'Pembaruan akun gagal.' });
    if (nextStatus === 'Inactive') {
      const banned = await supabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ban_duration: '876000h' }) });
      if (!banned.ok) return res.status(banned.status).json({ error: banned.data?.message || 'Profil berubah, tetapi sesi login gagal dinonaktifkan.' });
    } else if (nextStatus === 'Active') {
      await supabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ban_duration: 'none' }) });
    }
    return res.status(200).json({ data: updated.data?.[0] || null });
  }

  if (req.method === 'DELETE') {
    const id = String(req.query?.id || req.body?.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID akun wajib disertakan.' });
    if (id === auth.user.id) return res.status(400).json({ error: 'Anda tidak dapat menghapus akun Anda sendiri.' });

    if (await lastActiveAdminWouldBeRemoved(id, null, null)) {
      return res.status(409).json({ error: 'Sistem harus memiliki setidaknya satu administrator aktif.' });
    }

    const authDel = await supabaseAdmin(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!authDel.ok && authDel.status !== 404) {
      return res.status(authDel.status || 502).json({ error: authDel.data?.message || 'Gagal menghapus pengguna dari autentikasi.' });
    }

    await supabaseAdmin(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.status(200).json({ success: true, message: 'Akun berhasil dihapus permanen.' });
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
}
