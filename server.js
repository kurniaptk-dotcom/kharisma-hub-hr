// Kharisma Hub HR Management — Robust Local Backend Server & REST API
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
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
    'Access-Control-Allow-Origin': '*',
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

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // ==========================================================================
  // REST API ROUTER (/api/*)
  // ==========================================================================
  if (pathname.startsWith('/api/')) {
    const db = readDb();

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
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Kharisma Hub HR Management Server is running`);
  console.log(`🌐 Local URL:  http://localhost:${PORT}`);
  console.log(`🔌 REST API:   http://localhost:${PORT}/api/health`);
  console.log(`☁️  Supabase:   https://wirgqezinegebauddmgy.supabase.co`);
  console.log(`=======================================================`);
});
