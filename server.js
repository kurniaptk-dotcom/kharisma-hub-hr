// Kharisma Hub HR Management — Robust Local Backend Server & REST API
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env or .env.local if present
for (const envFile of ['.env', '.env.local', '.env.development.local']) {
  const envPath = path.join(__dirname, envFile);
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split(/\r?\n/).forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || '';
          if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
          if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
          if (!process.env[key]) process.env[key] = value;
        }
      });
    } catch {}
  }
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initial default seed state
const initialData = {
  employees: [
    { id: 'EMP-0234', name: 'Olivia Mason', email: 'olivia.mason@kharismahub.com', department: 'Marketing', title: 'Executive Marketing', status: 'On-Time', workModel: 'Hybrid' },
    { id: 'EMP-0178', name: 'Ethan Ray', email: 'ethan.ray@kharismahub.com', department: 'Product Design', title: 'UI Designer', status: 'Late', workModel: 'Remote' },
    { id: 'EMP-0312', name: 'Lina Armand', email: 'lina.armand@kharismahub.com', department: 'R&D', title: 'Lab Analyst', status: 'On Leave', workModel: 'On-Site' },
    { id: 'EMP-0115', name: 'Jacob Yuen', email: 'jacob.yuen@kharismahub.com', department: 'Operations', title: 'Site Supervisor', status: 'Absent', workModel: 'On-Site' },
    { id: 'EMP-0289', name: 'Mia Torres', email: 'mia.torres@kharismahub.com', department: 'Human Resources', title: 'HR Officer', status: 'On-Time', workModel: 'Hybrid' },
    { id: 'EMP-0356', name: 'Sara Kim', email: 'sara.kim@kharismahub.com', department: 'Customer Service', title: 'Customer Support Intern', status: 'Late', workModel: 'On-Site' },
    { id: 'EMP-0291', name: 'Daniel Cheung', email: 'daniel.cheung@kharismahub.com', department: 'Operations', title: 'Compliance Specialist', status: 'On-Time', workModel: 'Remote' },
    { id: 'EMP-0275', name: 'Anya Rodriguez', email: 'anya.rodriguez@kharismahub.com', department: 'Marketing', title: 'Graphic Designer', status: 'Late', workModel: 'Remote' },
    { id: 'EMP-0159', name: 'Kelvin Yu', email: 'kelvin.yu@kharismahub.com', department: 'Human Resources', title: 'Training Coordinator', status: 'On-Time', workModel: 'On-Site' },
    { id: 'EMP-0320', name: 'Farah Nabila', email: 'farah.nabila@kharismahub.com', department: 'Customer Service', title: 'Customer Experience Lead', status: 'On-Time', workModel: 'Hybrid' },
    { id: 'EMP-0362', name: 'Juno Park', email: 'juno.park@kharismahub.com', department: 'Product Design', title: 'UX Researcher', status: 'On-Time', workModel: 'Hybrid' },
    { id: 'EMP-0265', name: 'Hana Putri', email: 'hana.putri@kharismahub.com', department: 'Human Resources', title: 'Recruitment Assistant', status: 'On-Time', workModel: 'On-Site' }
  ],
  attendance: [],
  leaveRequests: [
    { id: 'lv-1', name: 'Lina Armand', title: 'Lab Analyst', type: 'Sick Leave', submitDate: '18 Jun 2035', period: '20–22 Jun 2035', duration: '3 Days', reason: 'Doctor’s note attached', status: 'Approved' },
    { id: 'lv-2', name: 'Jacob Yuen', title: 'Site Supervisor', type: 'Annual Leave', submitDate: '10 Jun 2035', period: '17–21 Jun 2035', duration: '5 Days', reason: 'Family trip', status: 'Approved' },
    { id: 'lv-3', name: 'Anya Rodriguez', title: 'Graphic Designer', type: 'Other Leave', submitDate: '17 Jun 2035', period: '19 Jun 2035', duration: '1 Day', reason: 'Personal matter', status: 'Pending' }
  ],
  kpis: [
    { id: 'kpi-1', title: 'Customer Satisfaction Score (CSAT)', dept: 'Customer Service', pic: 'Olivia Mason', target: 90, actual: 95.2, unit: '%', weight: 25, status: 'Exceeded' },
    { id: 'kpi-2', title: 'Design System Component Coverage', dept: 'Product Design', pic: 'Ethan Ray', target: 85, actual: 92.4, unit: '%', weight: 30, status: 'Exceeded' },
    { id: 'kpi-3', title: 'Employee Retention Rate', dept: 'Human Resources', pic: 'Mia Torres', target: 95, actual: 96.8, unit: '%', weight: 35, status: 'Exceeded' }
  ],
  calendarEvents: []
};

function readDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('[Backend] DB read error:', err.message);
  }
  return initialData;
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Backend] DB write error:', err.message);
  }
}

// Initialize db if not present
if (!fs.existsSync(DB_FILE)) {
  writeDb(initialData);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const USER_ROLES = new Set(['Admin', 'Supervisor', 'Employee']);
const USER_STATUSES = new Set(['Pending', 'Active', 'Inactive']);
const normalizeUserEmail = value => String(value || '').trim().toLowerCase();
const validUserEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function handleLocalUserApi(req, res) {
  const projectUrl = process.env.SUPABASE_URL || 'https://wirgqezinegebauddmgy.supabase.co';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!anonKey || !serviceKey) return sendJson(res, 503, { error: 'Konfigurasi server memerlukan SUPABASE_ANON_KEY dan SUPABASE_SERVICE_ROLE_KEY.' });
  if (!token) return sendJson(res, 401, { error: 'Sesi login tidak valid.' });

  try {
    const authResponse = await fetch(`${projectUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (!authResponse.ok) return sendJson(res, 401, { error: 'Sesi login kedaluwarsa atau tidak valid.' });
    const user = await authResponse.json();
    const serviceFetch = (route, options = {}) => fetch(`${projectUrl}${route}`, {
      ...options,
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', ...options.headers }
    });
    const profileResponse = await serviceFetch(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(user.id)}&select=role,status`);
    const [profile] = await profileResponse.json();
    if (!profile || profile.status !== 'Active') return sendJson(res, 403, { error: 'Profil akun tidak aktif.' });
    if (profile.role !== 'Admin') return sendJson(res, 403, { error: 'Hanya administrator yang dapat mengelola akun.' });

    if (req.method === 'GET') {
      const response = await serviceFetch('/rest/v1/user_profiles?select=id,email,full_name,role,department,title,status,employee_id,created_at&order=created_at.asc');
      const data = await response.json();
      return sendJson(res, response.status, response.ok ? { data } : { error: data.message || 'Gagal memuat akun.' });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (body.action === 'resend_invite') {
        const targetEmail = normalizeUserEmail(body.email);
        if (!validUserEmail(targetEmail)) return sendJson(res, 400, { error: 'Alamat email tidak valid.' });
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const resend = await serviceFetch(`/auth/v1/invite?redirect_to=${encodeURIComponent(appUrl)}`, {
          method: 'POST',
          body: JSON.stringify({ email: targetEmail })
        });
        const resendData = await resend.json();
        if (!resend.ok) return sendJson(res, resend.status || 502, { error: resendData.msg || resendData.message || 'Gagal mengirim ulang undangan.' });
        return sendJson(res, 200, { success: true, message: `Tautan undangan telah dikirim ulang ke ${targetEmail}.` });
      }

      if (body.action === 'reset_password') {
        const targetEmail = normalizeUserEmail(body.email);
        if (!validUserEmail(targetEmail)) return sendJson(res, 400, { error: 'Alamat email tidak valid.' });
        const appUrl = process.env.APP_URL || 'http://localhost:3000';
        const reset = await serviceFetch(`/auth/v1/recover?redirect_to=${encodeURIComponent(appUrl)}`, {
          method: 'POST',
          body: JSON.stringify({ email: targetEmail })
        });
        const resetData = await reset.json();
        if (!reset.ok) return sendJson(res, reset.status || 502, { error: resetData.msg || resetData.message || 'Gagal mengirim email reset kata sandi.' });
        return sendJson(res, 200, { success: true, message: `Email pemulihan kata sandi telah dikirim ke ${targetEmail}.` });
      }

      const name = String(body.name || '').trim();
      const email = normalizeUserEmail(body.email);
      const role = String(body.role || 'Employee');
      const department = String(body.department || '').trim();
      const title = String(body.title || '').trim();
      if (!name || !validUserEmail(email)) return sendJson(res, 400, { error: 'Nama dan alamat email yang valid wajib diisi.' });
      if (!USER_ROLES.has(role)) return sendJson(res, 400, { error: 'Peran akun tidak valid.' });
      if (role === 'Supervisor' && !department) return sendJson(res, 400, { error: 'Pilih departemen untuk akun atasan.' });

      const empRes = await serviceFetch(`/rest/v1/employees?select=id,name,email,department,title&id=not.is.null&email=ilike.${encodeURIComponent(email)}`);
      const empData = await empRes.json();
      const employee = Array.isArray(empData) ? empData.find(row => normalizeUserEmail(row.email) === email) : null;
      if (role === 'Employee' && !employee) return sendJson(res, 409, { error: 'Email harus cocok dengan data karyawan yang sudah terdaftar.' });

      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      const invited = await serviceFetch(`/auth/v1/invite?redirect_to=${encodeURIComponent(appUrl)}`, {
        method: 'POST',
        body: JSON.stringify({ email, data: { full_name: name } })
      });
      const authUser = await invited.json();
      if (!invited.ok || !authUser.id) {
        const errMsg = authUser.msg || authUser.message || '';
        if (/already\s+been\s+registered/i.test(errMsg) || invited.status === 422) {
          return sendJson(res, 409, { error: `Pengguna dengan email ${email} sudah terdaftar di Supabase Auth.` });
        }
        return sendJson(res, invited.status || 502, { error: errMsg || 'Undangan gagal dikirim.' });
      }

      const userProfile = {
        id: authUser.id,
        email,
        full_name: name,
        role,
        department: role === 'Employee' ? (employee?.department || department) : (department || employee?.department || ''),
        title: title || employee?.title || (role === 'Admin' ? 'Administrator SDM' : role === 'Supervisor' ? 'Atasan' : 'Karyawan'),
        employee_id: employee?.id || null,
        status: 'Pending'
      };
      const saved = await serviceFetch('/rest/v1/user_profiles?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(userProfile)
      });
      const savedData = await saved.json();
      if (!saved.ok) {
        await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(authUser.id)}`, { method: 'DELETE' });
        return sendJson(res, saved.status || 502, { error: savedData.message || 'Profil akun gagal dibuat.' });
      }
      return sendJson(res, 201, { data: savedData[0] || userProfile });
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const id = String(body.id || '');
      if (!id) return sendJson(res, 400, { error: 'ID akun wajib diisi.' });
      if (id === user.id && ((body.role !== undefined && body.role !== 'Admin') || body.status === 'Inactive' || body.status === 'Pending')) {
        return sendJson(res, 400, { error: 'Anda tidak dapat menurunkan peran atau menonaktifkan akun sendiri.' });
      }
      if (body.role !== undefined && !USER_ROLES.has(body.role)) return sendJson(res, 400, { error: 'Peran akun tidak valid.' });
      if (body.status !== undefined && !USER_STATUSES.has(body.status)) return sendJson(res, 400, { error: 'Status akun tidak valid.' });

      const currentResponse = await serviceFetch(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=id,role,status,email,employee_id,department`);
      const currentList = await currentResponse.json();
      const current = currentList?.[0];
      if (!currentResponse.ok || !current) return sendJson(res, currentResponse.status || 404, { error: currentList?.message || 'Akun tidak ditemukan.' });

      const nextRole = body.role ?? current.role;
      const nextStatus = body.status ?? current.status;
      if (current.role === 'Admin' && current.status === 'Active' && (nextRole !== 'Admin' || nextStatus !== 'Active')) {
        const adminsRes = await serviceFetch('/rest/v1/user_profiles?select=id&role=eq.Admin&status=eq.Active');
        const admins = await adminsRes.json();
        if (adminsRes.ok && admins.length <= 1) return sendJson(res, 409, { error: 'Sistem harus memiliki setidaknya satu administrator aktif.' });
      }

      const fields = { role: nextRole, status: nextStatus, updated_at: new Date().toISOString() };
      if (body.name !== undefined) fields.full_name = String(body.name).trim();
      if (body.email !== undefined) fields.email = normalizeUserEmail(body.email);
      if (body.department !== undefined) fields.department = String(body.department).trim();
      if (body.title !== undefined) fields.title = String(body.title).trim();
      if (body.employee_id !== undefined) fields.employee_id = body.employee_id || null;

      if (body.email !== undefined || body.name !== undefined) {
        const authUpdate = {};
        if (body.email !== undefined) {
          if (!validUserEmail(fields.email)) return sendJson(res, 400, { error: 'Alamat email tidak valid.' });
          authUpdate.email = fields.email;
          authUpdate.email_confirm = true;
        }
        if (body.name !== undefined) authUpdate.user_metadata = { full_name: fields.full_name };
        const identity = await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(authUpdate) });
        if (!identity.ok) {
          const errData = await identity.json();
          return sendJson(res, identity.status, { error: errData.message || 'Identitas login gagal diperbarui.' });
        }
      }

      const updated = await serviceFetch(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(fields) });
      const data = await updated.json();
      if (!updated.ok) return sendJson(res, updated.status, { error: data.message || 'Pembaruan akun gagal.' });
      if (nextStatus === 'Inactive') {
        await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ban_duration: '876000h' }) });
      } else if (nextStatus === 'Active') {
        await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ ban_duration: 'none' }) });
      }
      return sendJson(res, 200, { data: data[0] || null });
    }

    if (req.method === 'DELETE') {
      const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      let id = parsedUrl.searchParams.get('id');
      if (!id) {
        const body = await readBody(req);
        id = body.id;
      }
      if (!id) return sendJson(res, 400, { error: 'ID akun wajib disertakan.' });
      if (id === user.id) return sendJson(res, 400, { error: 'Anda tidak dapat menghapus akun Anda sendiri.' });

      const adminsRes = await serviceFetch('/rest/v1/user_profiles?select=id&role=eq.Admin&status=eq.Active');
      const admins = await adminsRes.json();
      const targetRes = await serviceFetch(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}&select=role,status`);
      const targetList = await targetRes.json();
      if (targetList?.[0]?.role === 'Admin' && targetList[0].status === 'Active' && adminsRes.ok && admins.length <= 1) {
        return sendJson(res, 409, { error: 'Sistem harus memiliki setidaknya satu administrator aktif.' });
      }

      const authDel = await serviceFetch(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!authDel.ok && authDel.status !== 404) {
        const err = await authDel.json();
        return sendJson(res, authDel.status || 502, { error: err.message || 'Gagal menghapus pengguna dari autentikasi.' });
      }
      await serviceFetch(`/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      return sendJson(res, 200, { success: true, message: 'Akun berhasil dihapus permanen.' });
    }

    return sendJson(res, 405, { error: 'Method Not Allowed' });
  } catch {
    return sendJson(res, 503, { error: 'Layanan Supabase tidak dapat dijangkau.' });
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // This JSON-file API is a local demo backend. Restrict it to loopback and
  // deny cross-origin browser requests so another site cannot read or mutate HR data.
  if (pathname.startsWith('/api/')) {
    const remoteAddress = req.socket.remoteAddress || '';
    const isLoopback = remoteAddress === '::1' || remoteAddress === '127.0.0.1' || remoteAddress.startsWith('::ffff:127.');
    const origin = req.headers.origin;
    let sameOrigin = true;
    if (origin) {
      try { sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; }
    }
    if (!isLoopback || !sameOrigin) return sendJson(res, 403, { error: 'API demo hanya tersedia dari aplikasi lokal.' });
  }

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    res.end();
    return;
  }

  // ==========================================================================
  // REST API ROUTER (/api/*)
  // ==========================================================================
  if (pathname.startsWith('/api/')) {
    const db = readDb();

    if (pathname === '/api/config') {
      const supabaseUrl = process.env.SUPABASE_URL || 'https://wirgqezinegebauddmgy.supabase.co';
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
      const serviceKeyConfigured = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
      return sendJson(res, 200, {
        supabaseUrl,
        supabaseAnonKey,
        authRequired: true,
        configured: Boolean(supabaseAnonKey),
        backendConfigured: Boolean(supabaseAnonKey) && serviceKeyConfigured,
        missingConfiguration: [!supabaseAnonKey && 'SUPABASE_ANON_KEY', !serviceKeyConfigured && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean)
      });
    }

    if (pathname === '/api/users') return handleLocalUserApi(req, res);

    // 1. Health check
    if (pathname === '/api/health') {
      return sendJson(res, 200, {
        status: 'online',
        app: 'Kharisma Hub HR Management',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        supabase: {
          url: 'https://wirgqezinegebauddmgy.supabase.co',
          projectRef: 'wirgqezinegebauddmgy'
        }
      });
    }

    // 2. Dashboard Aggregate Stats
    if (pathname === '/api/stats') {
      const emps = db.employees || [];
      const onTimeCount = emps.filter(e => e.status === 'On-Time').length;
      const leaveToday = (db.leaveRequests || []).filter(l => l.status === 'Approved').length;
      return sendJson(res, 200, {
        totalEmployees: emps.length,
        attendanceRate: emps.length ? Math.round((onTimeCount / emps.length) * 100) + '%' : '92%',
        onLeaveToday: leaveToday,
        activeKpis: (db.kpis || []).length
      });
    }

    // 3. Employees CRUD
    if (pathname === '/api/employees') {
      if (req.method === 'GET') {
        return sendJson(res, 200, { data: db.employees || [] });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body.name) return sendJson(res, 400, { error: 'Nama karyawan wajib diisi' });
        const newEmp = {
          id: body.id || `EMP-${Date.now().toString().slice(-4)}`,
          name: body.name,
          email: body.email || `${body.name.toLowerCase().replace(/\s+/g, '.')}@kharismahub.com`,
          department: body.department || 'Operations',
          title: body.title || 'Staff',
          status: body.status || 'On-Time',
          workModel: body.workModel || 'Hybrid'
        };
        db.employees.unshift(newEmp);
        writeDb(db);
        return sendJson(res, 201, { data: newEmp });
      }
    }

    if (pathname.startsWith('/api/employees/') && req.method === 'DELETE') {
      const id = pathname.replace('/api/employees/', '');
      db.employees = db.employees.filter(e => e.id !== id && e.name !== decodeURIComponent(id));
      writeDb(db);
      return sendJson(res, 200, { success: true, message: 'Karyawan berhasil dihapus' });
    }

    // 4. Leave Requests API
    if (pathname === '/api/leave') {
      if (req.method === 'GET') {
        return sendJson(res, 200, { data: db.leaveRequests || [] });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const newLeave = {
          id: body.id || `lv-${Date.now().toString().slice(-4)}`,
          name: body.name,
          title: body.title || 'Staff',
          type: body.type || 'Annual Leave',
          submitDate: body.submitDate || new Date().toLocaleDateString('id-ID'),
          period: body.period || '1 Hari',
          duration: body.duration || '1 Day',
          reason: body.reason || 'Keperluan pribadi',
          status: 'Pending'
        };
        db.leaveRequests.unshift(newLeave);
        writeDb(db);
        return sendJson(res, 201, { data: newLeave });
      }
    }

    // 5. KPI API
    if (pathname === '/api/kpi') {
      if (req.method === 'GET') {
        return sendJson(res, 200, { data: db.kpis || [] });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const newKpi = {
          id: body.id || `kpi-${Date.now().toString().slice(-4)}`,
          title: body.title,
          dept: body.dept || 'Operations',
          pic: body.pic || 'Davis Levin',
          target: Number(body.target || 100),
          actual: Number(body.actual || 0),
          unit: body.unit || '%',
          weight: Number(body.weight || 20),
          status: body.status || 'On-Track'
        };
        db.kpis.push(newKpi);
        writeDb(db);
        return sendJson(res, 201, { data: newKpi });
      }
    }

    // 6. Calendar API
    if (pathname === '/api/calendar') {
      if (req.method === 'GET') {
        return sendJson(res, 200, { data: db.calendarEvents || [] });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const newEv = {
          id: body.id || `cal-${Date.now().toString().slice(-4)}`,
          day: Number(body.day || 1),
          date: body.date || '2035-06-01',
          title: body.title || 'Agenda Baru',
          time: body.time || '09:00 - 10:00 WIB',
          location: body.location || 'Kantor Utama',
          category: body.category || 'General',
          tone: Number(body.tone || 0)
        };
        db.calendarEvents = db.calendarEvents || [];
        db.calendarEvents.push(newEv);
        writeDb(db);
        return sendJson(res, 201, { data: newEv });
      }
    }

    // 7. Bulk Sync API
    if (pathname === '/api/sync' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.employees && Array.isArray(body.employees)) {
        db.employees = body.employees;
      }
      if (body.kpis && Array.isArray(body.kpis)) {
        db.kpis = body.kpis;
      }
      if (body.calendar && Array.isArray(body.calendar)) {
        db.calendarEvents = body.calendar;
      }
      if (body.leave && Array.isArray(body.leave)) {
        db.leaveRequests = body.leave;
      }
      if (body.applicants && Array.isArray(body.applicants)) {
        db.applicants = body.applicants;
      }
      writeDb(db);
      return sendJson(res, 200, {
        ok: true,
        message: 'Data lokal berhasil disinkronkan',
        timestamp: new Date().toISOString()
      });
    }

    return sendJson(res, 404, { error: 'API route not found' });
  }

  // ==========================================================================
  // STATIC ASSETS & CLEAN URL ROUTER
  // ==========================================================================
  let resolvedPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(PUBLIC_DIR, resolvedPath);

  // Clean URL resolution: if "/calendar" requested, check for "/calendar.html"
  if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
    filePath += '.html';
  }

  // Security check: ensure path is within PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 Halaman Tidak Ditemukan</h1><p><a href="/">Kembali ke Dasbor</a></p>');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Kharisma Hub HR Management Server is running`);
  console.log(`🌐 Local URL:  http://localhost:${PORT}`);
  console.log(`🔌 REST API:   http://localhost:${PORT}/api/health`);
  console.log(`☁️  Supabase:   https://wirgqezinegebauddmgy.supabase.co`);
  console.log(`=======================================================`);
});
