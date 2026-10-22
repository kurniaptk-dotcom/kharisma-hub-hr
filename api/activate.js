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
  let linkedEmployeeId = auth.profile.employee_id || null;
  let linkedDepartment = auth.profile.department || '';
  let linkedTitle = auth.profile.title || '';

  if (!linkedEmployeeId && (auth.profile.email || auth.user?.email)) {
    const emailToFind = String(auth.profile.email || auth.user.email).trim().toLowerCase();
    const empRes = await supabaseAdmin(`/rest/v1/employees?select=id,email,department,title&id=not.is.null&email=ilike.${encodeURIComponent(emailToFind)}`);
    const matchedEmp = empRes.ok ? empRes.data?.find(r => String(r.email || '').trim().toLowerCase() === emailToFind) : null;
    if (matchedEmp) {
      linkedEmployeeId = matchedEmp.id;
      if (!linkedDepartment && matchedEmp.department) linkedDepartment = matchedEmp.department;
      if (!linkedTitle && matchedEmp.title) linkedTitle = matchedEmp.title;
    }
  }

  if (auth.profile.role === 'Employee' && !linkedEmployeeId) {
    const emailToUse = String(auth.profile.email || auth.user?.email || '').trim().toLowerCase();
    const autoEmp = {
      id: `EMP-${Date.now().toString().slice(-4)}`,
      name: auth.profile.full_name || emailToUse.split('@')[0] || 'Karyawan',
      email: emailToUse,
      department: linkedDepartment || 'Operations',
      title: linkedTitle || 'Karyawan',
      status: 'On-Time',
      employment_type: 'Full-Time',
      work_model: 'On-Site'
    };
    const empSaved = await supabaseAdmin('/rest/v1/employees?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(autoEmp)
    });
    if (empSaved.ok && empSaved.data?.[0]) {
      linkedEmployeeId = empSaved.data[0].id;
      linkedDepartment = linkedDepartment || empSaved.data[0].department;
      linkedTitle = linkedTitle || empSaved.data[0].title;
    } else {
      linkedEmployeeId = autoEmp.id;
    }
  }
  if (auth.profile.role === 'Supervisor' && !linkedDepartment) {
    linkedDepartment = 'Operations';
  }

  const patchPayload = {
    status: 'Active',
    updated_at: new Date().toISOString()
  };
  if (linkedEmployeeId && !auth.profile.employee_id) patchPayload.employee_id = linkedEmployeeId;
  if (linkedDepartment && !auth.profile.department) patchPayload.department = linkedDepartment;
  if (linkedTitle && !auth.profile.title) patchPayload.title = linkedTitle;

  const result = await supabaseAdmin(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(auth.user.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patchPayload)
  });
  if (!result.ok) return res.status(result.status).json({ error: result.data?.message || 'Akun belum dapat diaktifkan.' });
  const profile = result.data?.[0];
  if (!profile) return res.status(409).json({ error: 'Status akun berubah. Keluar lalu masuk kembali.' });
  return res.status(200).json({ data: profile });
}
