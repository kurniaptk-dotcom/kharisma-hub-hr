// Kharisma Hub HR Management - Core Application Script
document.querySelector('.app-shell')?.setAttribute('data-auth-pending', '');
let toastTimer;

function showToast(message) {
  const el = document.querySelector('#toast') || document.querySelector('#toastNotification');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

const formatIDR = (amount) => new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0
}).format(Number(amount) * 1000);

function readStoredValue(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

function calculateKpiScore(kpi) {
  const target = Number(kpi?.target);
  const actual = Number(kpi?.actual);
  if (!Number.isFinite(target) || !Number.isFinite(actual) || target <= 0) return 0;
  if (kpi.lowerIsBetter) return actual <= target ? 100 : (target / Math.max(actual, Number.EPSILON)) * 100;
  return (Math.max(0, actual) / target) * 100;
}
function refreshKpiStatus(kpi) {
  const score = calculateKpiScore(kpi);
  kpi.status = score >= 100 ? 'Exceeded' : score >= 80 ? 'On-Track' : 'At Risk';
  return score;
}

const initials = (name) => String(name || '').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

// Cloud sessions are the source of truth whenever authentication is required.
let authenticatedSupabaseSession = null;
let authenticatedUserProfile = null;
let cloudDataHydrating = false;
let employeeCloudWriteQueue = Promise.resolve();
let kpiCloudWriteQueue = Promise.resolve();
function roleLabel(role) { return role === 'Admin' ? 'Administrator' : role === 'Supervisor' ? 'Atasan' : role === 'Employee' ? 'Karyawan' : 'Pengguna'; }
function applyRoleNavigation(role) {
  const allowed = role === 'Admin'
    ? null
    : role === 'Supervisor'
      ? new Set(['dashboard','calendar','employees','attendance','performance','kpi','leave'])
      : new Set(['dashboard','calendar','employees','attendance','leave']);
  document.querySelectorAll('.main-nav .nav-link').forEach(link => {
    link.hidden = Boolean(allowed && !allowed.has(link.dataset.module));
  });
  document.body.dataset.authRole = role || '';
}
function installSupabaseAuthGate() {
  if (!window.KharismaDB?.auth) return;
  const root = document.querySelector('.app-shell');
  if (!root) return;

  let validSession = false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const d = JSON.parse(localStorage.getItem(k));
        if (d && d.access_token) { validSession = true; break; }
      }
    }
  } catch {}

  if (!validSession) {
    try {
      localStorage.removeItem('kharisma_auth_active');
      sessionStorage.removeItem('kharisma_auth_active');
    } catch {}
    if (!window.location.pathname.endsWith('login.html') && !window.location.pathname.endsWith('/login')) {
      window.location.replace('login.html');
    }
    return;
  }

  root.hidden = false;
  root.inert = false;
  document.body.classList.add('auth-ready');
  document.body.classList.add('auth-active');

  const hydrateScopedData = async () => {
    try {
      const [employees, kpis, leaves, attendance, calendar] = await Promise.all([
        window.KharismaDB.employees.getAll([]),
        window.KharismaDB.kpi.getAll([]),
        window.KharismaDB.leave.getAll([]),
        window.KharismaDB.attendance.getAll(),
        window.KharismaDB.calendar.getAll([])
      ]);
      if (employees && employees.length) {
        employeeData.splice(0, employeeData.length, ...employees);
      }
      employeeData.forEach(person => { if (person[5] && /^EMP-/.test(person[5])) employeeIdByName.set(person[0], person[5].replace(/^EMP-/, '')); });
      Object.keys(employeeProfileOverrides).forEach(name => delete employeeProfileOverrides[name]);
      Object.assign(employeeProfileOverrides, window.__kharismaEmployeeProfiles || {});
      if (kpis && kpis.length) kpiData.splice(0, kpiData.length, ...kpis);
      if (leaves && leaves.length) leaveRequests.splice(0, leaveRequests.length, ...leaves);
      if (attendance && attendance.length) cloudAttendanceRecords = attendance;
      if (calendar && calendar.length) calendarItems.splice(0, calendarItems.length, ...calendar);
      persistEmployeeData(); persistKpiData(); persistLeaveRequests(); writeStoredValue('teamhub.calendarItems', calendarItems);
    } catch (e) {
      console.warn('[KharismaDB] Hydration:', e.message);
    }
  };

  const applySession = async session => {
    authenticatedSupabaseSession = session || null;
    if (!session) {
      try { sessionStorage.removeItem('kharisma_auth_active'); localStorage.removeItem('kharisma_auth_active'); } catch {}
      window.location.replace('login.html');
      return false;
    }
    let profile = null;
    try {
      const res = await window.KharismaDB.auth.getProfile(session.user.id);
      profile = res.profile;
    } catch {}

    if (!profile) {
      try {
        const stored = localStorage.getItem('teamhub.userProfile');
        if (stored) profile = JSON.parse(stored);
      } catch {}
    }

    if (!profile) {
      profile = {
        id: session.user.id,
        email: session.user.email,
        full_name: session.user.email.split('@')[0],
        role: 'Admin',
        department: 'Human Resources',
        title: 'Administrator SDM',
        status: 'Active'
      };
    }

    authenticatedUserProfile = profile;
    try { sessionStorage.setItem('kharisma_auth_active', '1'); localStorage.setItem('kharisma_auth_active', '1'); } catch {}

    const role = profile.role || 'Admin';
    const account = { id: profile.id, name: profile.full_name || session.user.email, email: session.user.email, role, department: profile.department || '', title: profile.title || role, status: profile.status || 'Active' };
    userAccounts.splice(0, userAccounts.length, account);
    activeAccountId = account.id;
    syncActiveProfileFromAccount(true);

    // Update topbar profile button
    const profileBtn = document.querySelector('#profileButton');
    if (profileBtn) {
      const nameEl = profileBtn.querySelector('strong');
      if (nameEl) nameEl.textContent = profile.full_name || profile.name || userProfile.name;
      const roleEl = profileBtn.querySelector('small');
      if (roleEl) roleEl.textContent = profile.title || role;
      const avatarEl = profileBtn.querySelector('.avatar');
      if (avatarEl) {
        const initials = (profile.full_name || userProfile.name).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        avatarEl.innerHTML = '<span>' + initials + '</span>';
      }
    }

    // Attach Logout Button in Profile Modal
    const logout = document.querySelector('#supabaseLogoutButton');
    if (!logout) {
      const actions = document.querySelector('#userProfileForm .dialog-actions');
      if (actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'supabaseLogoutButton';
        button.className = 'module-button secondary';
        button.textContent = 'Keluar (Logout)';
        button.addEventListener('click', async () => {
          try {
            sessionStorage.removeItem('kharisma_auth_active');
            localStorage.removeItem('kharisma_auth_active');
            localStorage.removeItem('teamhub.userProfile');
            if (window.KharismaDB?.auth) await window.KharismaDB.auth.signOut();
          } catch {}
          window.location.replace('login.html');
        });
        actions.prepend(button);
      }
    }

    applyRoleNavigation(role);

    // Hydrate data in background
    hydrateScopedData().then(() => {
      const curPage = document.querySelector('#moduleView')?.dataset?.page;
      if (curPage && curPage !== 'dashboard') {
        const mv = document.querySelector('#moduleView');
        if (mv) {
          mv.innerHTML = pageMarkup(curPage);
          setupTablePagination();
        }
      }
    });

    return true;
  };

  window.KharismaDB.auth.getSession().then(({ session }) => {
    if (session) {
      applySession(session);
    } else {
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('sb-') || k.includes('kharisma'))) localStorage.removeItem(k);
        }
        sessionStorage.removeItem('kharisma_auth_active');
      } catch {}
      window.location.replace('login.html');
    }
  }).catch(() => {});

  window.KharismaDB.auth.onAuthStateChange((event, nextSession) => {
    if (event === 'SIGNED_OUT') {
      try {
        sessionStorage.removeItem('kharisma_auth_active');
        localStorage.removeItem('kharisma_auth_active');
        localStorage.removeItem('teamhub.userProfile');
      } catch {}
      window.location.replace('login.html');
    } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && nextSession) {
      applySession(nextSession);
    }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installSupabaseAuthGate, { once: true });
else installSupabaseAuthGate();

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
  const href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  showToast(`${filename} berhasil diunduh`);
}

/* ==========================================================================
   Global State & Data Stores (Persisted in LocalStorage)
   ========================================================================== */

const defaultAppSettings = {
  companyName: 'PT Kharisma Group Indonesia',
  currency: 'IDR',
  timezone: 'WIB',
  workStart: '09:00',
  workEnd: '17:00',
  lateTolerance: 15
};
let appSettings = readStoredValue('teamhub.settings', defaultAppSettings);
function persistSettings() { writeStoredValue('teamhub.settings', appSettings); }

const defaultUserProfile = {
  name: 'Davis Levin',
  email: 'davis.levin@kharismahub.com',
  role: 'HR Administrator',
  department: 'Human Resources'
};
let userProfile = readStoredValue('teamhub.userProfile', defaultUserProfile);
function persistUserProfile() { writeStoredValue('teamhub.userProfile', userProfile); }

let userAttendanceRecord = readStoredValue('teamhub.userAttendance', null);
let attendanceIncompleteHistory = readStoredValue('teamhub.attendanceIncompleteHistory', []);
let cloudAttendanceRecords = null;
let attendancePolicy = readStoredValue('teamhub.attendancePolicy', { location: null, shifts: [], assignments: [] });
let attendanceReviewQueue = { corrections: [], overtime: [] };
let attendanceActionPending = false;
const attendanceSyncQueue = readStoredValue('teamhub.attendanceQueue', []);
function attendanceTodayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function attendanceTimeLabel(value) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
function attendanceMinutesOfDay(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}
function attendanceDistanceMeters(aLat, aLng, bLat, bLng) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}
function getAttendanceLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Perangkat ini tidak mendukung lokasi GPS.'));
    navigator.geolocation.getCurrentPosition(position => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }), error => {
      const messages = { 1: 'Izin lokasi ditolak. Aktifkan izin lokasi lalu coba lagi.', 2: 'Lokasi perangkat belum tersedia. Coba lagi di area terbuka.', 3: 'Pencarian lokasi terlalu lama. Coba lagi.' };
      reject(new Error(messages[error.code] || 'Lokasi GPS tidak dapat dibaca.'));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}
function attendanceDisplayState(record = userAttendanceRecord) {
  if (!record) return 'Belum Absen';
  if (record.state) return ({ working: 'Sedang Bekerja', on_break: 'Sedang Istirahat', completed: 'Selesai' })[record.state] || 'Belum Lengkap';
  return record.clockOut ? 'Selesai' : 'Sedang Bekerja';
}
function isActiveOvernightAttendance(record = userAttendanceRecord) {
  if (!record || record.state === 'completed' || record.clockOut || !record.dateKey) return false;
  const shift = attendancePolicy.shifts?.find(item => item.id === record.shiftId);
  if (!shift || String(shift.end_time).slice(0,5) > String(shift.start_time).slice(0,5)) return false;
  const start = new Date(`${record.dateKey}T00:00:00Z`), today = new Date(`${attendanceTodayKey()}T00:00:00Z`);
  const days = Math.floor((today - start) / 86400000);
  return days >= 0 && days <= 1;
}
async function syncAttendanceQueue() {
  if (!window.KharismaDB?.isConnected || !attendanceSyncQueue.length) return;
  while (attendanceSyncQueue.length) {
    const queued = attendanceSyncQueue[0];
    await window.KharismaDB.attendance.transition(queued.action, queued.date, queued.location);
    attendanceSyncQueue.shift();
    writeStoredValue('teamhub.attendanceQueue', attendanceSyncQueue);
  }
  const mine = await window.KharismaDB.attendance.getMine();
  if (mine.record) { userAttendanceRecord = mine.record; persistUserAttendance(false); }
}
async function performAttendanceTransition(action) {
  if (attendanceActionPending) return;
  const locationPolicy = attendancePolicy.location;
  if (!locationPolicy) { showToast('Lokasi kantor belum diatur. Hubungi administrator SDM.'); return; }
  const eventAt = new Date().toISOString();
  attendanceActionPending = true;
  const button = moduleView.querySelector(`[data-action="attendance-transition"][data-transition="${action}"]`);
  if (button) { button.disabled = true; button.textContent = 'Memeriksa lokasiâ€¦'; }
  try {
    const location = await getAttendanceLocation();
    const distance = attendanceDistanceMeters(Number(locationPolicy.latitude), Number(locationPolicy.longitude), location.latitude, location.longitude);
    if (distance > Number(locationPolicy.radius_m || locationPolicy.radiusM || 0)) {
      throw new Error(`Anda berada ${Math.round(distance)} m dari kantor, di luar radius ${locationPolicy.radius_m || locationPolicy.radiusM} m. Mendekat ke kantor lalu coba lagi.`);
    }
    location.distance = distance;
    location.verified = true;
    location.eventAt = eventAt;
    const date = action === 'clock_in' ? attendanceTodayKey() : (userAttendanceRecord?.dateKey || attendanceTodayKey());
    if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
      const result = await window.KharismaDB.attendance.transition(action, date, location);
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!row?.id) throw new Error('Server tidak mengembalikan catatan presensi. Muat ulang aplikasi sebelum mencoba lagi.');
      userAttendanceRecord = { id: row.id, employeeId: row.employee_id, name: row.employee_name, dateKey: row.date, date: row.date, workModel: row.work_model, clockIn: row.clock_in, clockOut: row.clock_out || '', clockInAt: row.clock_in_at, clockOutAt: row.clock_out_at, duration: row.duration, overtime: row.overtime, lateMinutes: row.late_minutes, status: row.status, state: row.state, breakSessions: row.break_sessions || [], shiftId: row.shift_id, overtimeApprovalStatus: row.overtime_approval_status, location: { latitude: row.location_latitude, longitude: row.location_longitude, accuracy: row.location_accuracy_m, distance: row.location_distance_m, verified: Boolean(row.location_verified) } };
    } else {
      const current = userAttendanceRecord?.dateKey === date ? userAttendanceRecord : null;
      const activeEmployee = employeeData.find(row => row[1]?.toLowerCase() === userProfile.email.toLowerCase()) || findEmployeeByName(userProfile.name);
      const employeeCode = activeEmployee ? `EMP-${getEmployeeId(activeEmployee)}` : '';
      if (!employeeCode) throw new Error('Akun belum ditautkan ke data karyawan. Hubungi administrator SDM.');
      const assignment = attendancePolicy.assignments?.find(item => item.employee_id === employeeCode);
      const shift = attendancePolicy.shifts?.find(item => item.id === assignment?.shift_id);
      if (!shift) throw new Error('Shift kerja belum ditetapkan untuk Anda. Hubungi atasan.');
      const now = new Date(eventAt);
      if (action === 'clock_in') {
        if (current) throw new Error('Presensi masuk hari ini sudah tercatat.');
        const [sh, sm] = String(shift.start_time).slice(0, 5).split(':').map(Number);
        const lateMinutes = Math.max(0, attendanceMinutesOfDay(now) - (sh * 60 + sm + Number(shift.tolerance_minutes || 0)));
        userAttendanceRecord = { employeeId: employeeCode, name: userProfile.name, dateKey: date, date, workModel: activeEmployee ? (employeeProfileOverrides[activeEmployee[0]]?.workModel || 'Kantor') : 'Kantor', clockInAt: now.toISOString(), clockIn: attendanceTimeLabel(now), clockOut: '', state: 'working', clockedIn: true, breakSessions: [], shiftId: shift.id, lateMinutes, status: lateMinutes ? 'Late' : 'On-Time', duration: 'Sedang Berjalan', overtime: 'â€”', location };
      } else {
        if (!current) throw new Error('Catat presensi masuk terlebih dahulu.');
        const sessions = current.breakSessions || [];
        if (action === 'break_start') {
          if (current.state !== 'working' && current.state !== undefined) throw new Error('Istirahat hanya dapat dimulai saat sedang bekerja.');
          sessions.push({ start: now.toISOString(), end: null }); current.state = 'on_break';
        } else if (action === 'break_end') {
          if (current.state !== 'on_break') throw new Error('Tidak ada istirahat yang sedang berlangsung.');
          sessions[sessions.length - 1].end = now.toISOString(); current.state = 'working';
        } else if (action === 'clock_out') {
          if (current.state === 'on_break') throw new Error('Akhiri istirahat sebelum presensi pulang.');
          if (current.state !== 'working' && current.state !== undefined) throw new Error('Presensi masuk belum tersedia.');
          current.clockOutAt = now.toISOString(); current.clockOut = attendanceTimeLabel(now); current.state = 'completed'; current.clockedIn = false;
          let minutes = Math.floor((now - new Date(current.clockInAt)) / 60000);
          sessions.forEach(item => { if (item.end) minutes -= Math.max(0, Math.floor((new Date(item.end) - new Date(item.start)) / 60000)); });
          minutes = Math.max(0, minutes); current.duration = `${Math.floor(minutes / 60)}j ${minutes % 60}m`;
          const end = new Date(`${date}T${String(shift.end_time).slice(0, 5)}:00+07:00`);
          if (String(shift.end_time).slice(0, 5) <= String(shift.start_time).slice(0, 5)) end.setDate(end.getDate() + 1);
          const extra = Math.max(0, Math.floor((now - end) / 60000));
          current.overtime = extra ? `${Math.floor(extra / 60)}j ${extra % 60}m` : 'â€”'; current.overtimeApprovalStatus = extra ? 'pending' : 'not_required';
        }
        current.breakSessions = sessions; current.location = location; userAttendanceRecord = current;
      }
      if (authenticatedSupabaseSession) {
        attendanceSyncQueue.push({ action, date, location });
        writeStoredValue('teamhub.attendanceQueue', attendanceSyncQueue);
        userAttendanceRecord.provisional = true;
        showToast('Presensi dicatat sementara. Akan diverifikasi dan disinkronkan saat koneksi tersedia.');
      } else {
        userAttendanceRecord.provisional = false;
        showToast('Presensi demo dicatat di perangkat ini.');
      }
    }
    persistUserAttendance(false);
    if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
      cloudAttendanceRecords = await window.KharismaDB.attendance.getAll();
      showToast(`Status presensi diperbarui: ${attendanceDisplayState()}.`);
    }
    moduleView.innerHTML = pageMarkup('attendance');
    setupTablePagination();
  } catch (error) {
    showToast(error.message || 'Presensi gagal dicatat. Periksa lokasi lalu coba lagi.');
  } finally {
    attendanceActionPending = false;
    const retryButton = moduleView.querySelector(`[data-action="attendance-transition"][data-transition="${action}"]`);
    if (retryButton) { retryButton.disabled = false; retryButton.textContent = ({ clock_in: 'Absen Masuk', break_start: 'Mulai Istirahat', break_end: 'Kembali Bekerja', clock_out: 'Presensi Pulang' })[action] || 'Catat Presensi'; }
  }
}
function persistUserAttendance() { writeStoredValue('teamhub.userAttendance', userAttendanceRecord); }

const defaultNotifications = [
  { id: 'notif-1', title: 'Permintaan Cuti Disetujui', message: 'Permintaan cuti sakit dari Lina Armand telah disetujui.', time: '10:32 AM', read: false, icon: '' },
  { id: 'notif-2', title: 'Pelamar Baru Terdaftar', message: 'William Hartono melamar untuk posisi Desainer UI.', time: '09:45 AM', read: false, icon: '' },
  { id: 'notif-3', title: 'Pengingat Agenda Kalender', message: 'Wawancara Desainer Produk dijadwalkan pukul 09:00 AM di Ruang C.', time: '08:00 AM', read: false, icon: '' },
  { id: 'notif-4', title: 'Pembaruan Kebijakan Perusahaan', message: 'Kebijakan cuti tahun 2035 telah diterbitkan oleh HR.', time: 'Kemarin', read: true, icon: '' },
  { id: 'notif-5', title: 'Presensi Karyawan', message: 'Jacob Yuen ditandai tidak hadir secara otomatis karena belum presensi.', time: 'Kemarin', read: true, icon: '' }
];
let notifications = readStoredValue('teamhub.notifications', defaultNotifications);
function persistNotifications() {
  writeStoredValue('teamhub.notifications', notifications);
  updateNotificationBadge();
}
function updateNotificationBadge() {
  const badge = document.querySelector('.notification-icon i');
  if (badge) {
    const unreadCount = notifications.filter(n => !n.read).length;
    badge.style.display = unreadCount > 0 ? 'block' : 'none';
  }
}

const defaultEmployeeData = [
  ['Olivia Mason', 'olivia.mason@kharismahub.com', 'Marketing', 'Executive Marketing', 'On-Time'],
  ['Ethan Ray', 'ethan.ray@kharismahub.com', 'Product Design', 'UI Designer', 'Late'],
  ['Lina Armand', 'lina.armand@kharismahub.com', 'R&D', 'Lab Analyst', 'On Leave'],
  ['Jacob Yuen', 'jacob.yuen@kharismahub.com', 'Operations', 'Site Supervisor', 'Absent'],
  ['Mia Torres', 'mia.torres@kharismahub.com', 'Human Resources', 'HR Officer', 'On-Time'],
  ['Sara Kim', 'sara.kim@kharismahub.com', 'Customer Service', 'Customer Support Intern', 'Late'],
  ['Daniel Cheung', 'daniel.cheung@kharismahub.com', 'Operations', 'Compliance Specialist', 'On-Time'],
  ['Anya Rodriguez', 'anya.rodriguez@kharismahub.com', 'Marketing', 'Graphic Designer', 'Late'],
  ['Kelvin Yu', 'kelvin.yu@kharismahub.com', 'Human Resources', 'Training Coordinator', 'On-Time'],
  ['Farah Nabila', 'farah.nabila@kharismahub.com', 'Customer Service', 'Customer Experience Lead', 'On-Time'],
  ['Juno Park', 'juno.park@kharismahub.com', 'Product Design', 'UX Researcher', 'On-Time'],
  ['Hana Putri', 'hana.putri@kharismahub.com', 'Human Resources', 'Recruitment Assistant', 'On-Time'],
];
const storedEmployees = readStoredValue('teamhub.employeeData', defaultEmployeeData);
const employeeData = Array.isArray(storedEmployees) ? storedEmployees.filter(person => Array.isArray(person) && person.length >= 5) : [...defaultEmployeeData];
const employeeIds = ['0234','0178','0312','0115','0289','0356','0291','0275','0159','0320','0362','0265'];
const employeeIdByName = new Map(defaultEmployeeData.map((person, index) => [person[0], employeeIds[index]]));
Object.entries(readStoredValue('teamhub.employeeIds', {})).forEach(([name, id]) => employeeIdByName.set(name, String(id)));

function persistEmployeeData() {
  try {
    localStorage.setItem('teamhub.employeeData', JSON.stringify(employeeData));
    localStorage.setItem('teamhub.employeeIds', JSON.stringify(Object.fromEntries(employeeIdByName)));
  } catch {}
  if (typeof renderDashboardSummary === 'function') renderDashboardSummary();
  if (!cloudDataHydrating && authenticatedSupabaseSession && isAdmin() && window.KharismaDB?.isConnected) {
    const snapshot = employeeData.map(person => [...person]);
    employeeCloudWriteQueue = employeeCloudWriteQueue.catch(() => {}).then(() => Promise.all(snapshot.map(person => {
      const profile = employeeProfileOverrides[person[0]] || {};
      return window.KharismaDB.employees.save({ id: `EMP-${getEmployeeId(person)}`, name: person[0], email: person[1], department: person[2], title: person[3], status: person[4], employmentType: profile.employmentType, workModel: profile.workModel, joinDate: profile.joinDate, gender: profile.gender, birthDate: profile.birthDate, phone: profile.phone, address: profile.address });
    }))).then(results => {
      if (results.some(result => !result?.ok)) showToast('Perubahan karyawan tersimpan lokal, tetapi sebagian gagal disinkronkan ke cloud.');
    });
  }
}

function migrateLegacyBrandData() {
  try {
    if (appSettings.companyName && appSettings.companyName.includes('TeamHub')) {
      appSettings.companyName = 'PT Kharisma Group Indonesia';
      persistSettings();
    }
    if (userProfile.email && userProfile.email.includes('teamhub.com')) {
      userProfile.email = userProfile.email.replace('teamhub.com', 'kharismahub.com');
      persistUserProfile();
    }
    let modified = false;
    employeeData.forEach(row => {
      if (row[1] && row[1].includes('@teamhub.com')) {
        row[1] = row[1].replace('@teamhub.com', '@kharismahub.com');
        modified = true;
      }
    });
    if (modified) {
      persistEmployeeData();
    }
  } catch (err) {
    console.warn('Brand migration notice:', err);
  }
}
migrateLegacyBrandData();

function getEmployeeId(person) {
  const name = Array.isArray(person) ? person[0] : person;
  if (!employeeIdByName.has(name)) {
    employeeIdByName.set(name, String(1000 + employeeIdByName.size).padStart(4, '0'));
    persistEmployeeData();
  }
  return employeeIdByName.get(name);
}

const employeeProfileOverrides = readStoredValue('teamhub.profileOverrides', {
  'Mia Torres': {
    gender: 'Female', birthDate: '28 March 1993', phone: '+62 812-3456-7890', address: 'Jl. Melati No. 45, Sleman, Yogyakarta, Indonesia',
    employmentType: 'Full-Time', workModel: 'Hybrid', joinDate: '14 February 2033', leave: [['14','20','Days',70],['10','15','Days',67],['8','24','Hours',33],['3','4','Days',75]],
    score: '86.75%', scoreChange: '+2.05%', hours: '34 h 30 m', salary: formatIDR(3200), allowance: formatIDR(300), monthlyValue: formatIDR(3855),
  },
});
function persistProfileOverrides() { writeStoredValue('teamhub.profileOverrides', employeeProfileOverrides); }

function getEmployeeProfile(name) {
  const employee = employeeData.find((person) => person[0] === name) || employeeData.find((person) => person[0] === 'Mia Torres') || employeeData[0];
  const index = Math.max(0, employeeData.indexOf(employee));
  const id = getEmployeeId(employee);
  const seedIndex = Math.max(0, employeeIds.indexOf(id));
  const employmentTypes = ['Full-Time','Full-Time','Part-Time','Full-Time','Full-Time','Internship','Full-Time','Freelance','Part-Time','Full-Time','Full-Time','Internship'];
  const workModels = ['Hybrid','Remote','On-Site','On-Site','Hybrid','On-Site','Remote','Remote','On-Site','Hybrid','Hybrid','On-Site'];
  const joinDates = ['12 January 2034','03 March 2033','22 July 2034','05 September 2032','14 February 2033','10 May 2035','19 November 2033','06 April 2035','27 June 2032','08 August 2034','15 April 2034','20 February 2035'];
  const scores = ['92%','90%','81%','80%','86.75%','88%','87%','86%','84%','88%','91%','83%'];
  const salaries = [3200,3100,2900,3300,3200,800,2900,2200,2500,2900,3400,1800];
  const overrides = employeeProfileOverrides[employee[0]] || {};
  return {
    name: employee[0],
    email: employee[1],
    department: employee[2],
    title: employee[3],
    id: `EMP-${id}`,
    status: employee[4] === 'On Leave' ? 'On Leave' : (employee[4] === 'Absent' ? 'Absent' : 'Active'),
    gender: overrides.gender || 'Belum diisi',
    birthDate: overrides.birthDate || 'Belum diisi',
    phone: overrides.phone || '+62 812-9876-' + String(1000 + index * 37).slice(0, 4),
    address: overrides.address || 'Belum diisi',
    employmentType: overrides.employmentType || employmentTypes[seedIndex % employmentTypes.length],
    workModel: overrides.workModel || workModels[seedIndex % workModels.length],
    joinDate: overrides.joinDate || joinDates[seedIndex % joinDates.length],
    leave: overrides.leave || [['10','20','Days',50],['7','15','Days',47],['4','24','Hours',17],['2','4','Days',50]],
    score: overrides.score || scores[seedIndex % scores.length],
    scoreChange: overrides.scoreChange || '+1.8%',
    hours: overrides.hours || `${30 + (seedIndex % 10)} h ${(seedIndex * 5) % 60} m`,
    salary: overrides.salary || formatIDR(salaries[seedIndex % salaries.length]),
    allowance: overrides.allowance || formatIDR(250),
    monthlyValue: overrides.monthlyValue || formatIDR(salaries[seedIndex % salaries.length] + 250 + 355),
    index,
  };
}

const avatar = (name, color = 'p1') => {
  const index = employeeData.findIndex((person) => person[0] === name);
  const woman = index >= 0 ? [0, 2, 4, 5, 7, 9, 11].includes(index) : !/davis|ethan|jacob|daniel|kelvin|juno|william|arifin|bagus/i.test(name);
  const ids = woman ? [44, 68, 17, 32, 49, 58] : [32, 75, 47, 66, 83, 20];
  const photo = `https://randomuser.me/api/portraits/${woman ? 'women' : 'men'}/${ids[Math.max(index, 0) % ids.length]}.jpg`;
  return `<i class="avatar ${color}"><img src="${photo}" alt="" loading="lazy" onerror="this.parentElement.classList.add('avatar-fallback');this.remove()" /><span>${safe(initials(name))}</span></i>`;
};

/* ==========================================================================
   Calendar & Agenda Items
   ========================================================================== */

const defaultCalendarItems = [
  { id: 'cal-1', day: 1, date: '2035-06-01', title: 'Onboarding Session â€” New Hires Batch 3', time: '10:00 AM', location: 'HR Room 2B', category: 'Talent Acquisition', note: 'Prepare welcome kits and ID cards', tone: 0 },
  { id: 'cal-2', day: 4, date: '2035-06-04', title: 'Interview â€” Product Designer', time: '09:00 AM', location: 'Meeting Room C', category: 'Talent Acquisition', note: 'Review portfolio first', tone: 0 },
  { id: 'cal-3', day: 4, date: '2035-06-04', title: 'Quarterly Policy Review', time: '03:00 PM', location: 'Conference Room 1A', category: 'Workplace Engagement', note: 'All department heads', tone: 2 },
  { id: 'cal-4', day: 7, date: '2035-06-07', title: 'Team Communication Workshop', time: '02:00 PM', location: 'Main Training Hall', category: 'Employee Development', note: 'Interactive session', tone: 1 },
  { id: 'cal-5', day: 13, date: '2035-06-13', title: 'Performance Review Check-in â€” Marketing Team', time: '01:00 PM', location: 'Notion Review Sheet', category: 'Employee Development', note: 'Q2 deliverables assessment', tone: 1 },
  { id: 'cal-6', day: 15, date: '2035-06-15', title: 'Recruitment Planning â€” Q3 Targets', time: '11:00 AM', location: 'Meeting Room A', category: 'Talent Acquisition', note: 'Headcount forecast', tone: 0 },
  { id: 'cal-7', day: 18, date: '2035-06-18', title: 'Remote Work Compliance Briefing', time: '09:30 AM', location: 'Zoom (link in calendar)', category: 'Workplace Engagement', note: 'Mandatory for hybrid & remote staff', tone: 2 },
  { id: 'cal-8', day: 21, date: '2035-06-21', title: 'New Recruit Introduction', time: '09:00 AM', location: 'HR Room 2B', category: 'Talent Acquisition', note: 'Prepare welcome kits and ID cards', tone: 0 },
  { id: 'cal-9', day: 21, date: '2035-06-21', title: 'Personal Growth Session â€” Leadership Track', time: '02:00 PM', location: 'Zoom (link shared via email)', category: 'Employee Development', note: 'Attendees must complete pre-session survey', tone: 1 },
  { id: 'cal-10', day: 22, date: '2035-06-22', title: 'Upskilling Program: Advanced Excel', time: '03:30 PM', location: 'Computer Lab 1', category: 'Employee Development', note: 'Financial modeling practice', tone: 1 },
  { id: 'cal-11', day: 27, date: '2035-06-27', title: 'Final Interview â€” Sales Manager', time: '10:00 AM', location: 'Boardroom 3', category: 'Talent Acquisition', note: 'CEO & HR Director panel', tone: 0 },
  { id: 'cal-12', day: 29, date: '2035-06-29', title: 'Internal Team-Building Event', time: '08:00 AM', location: 'Kurnia Green Park', category: 'Workplace Engagement', note: 'Sportswear and casual gear', tone: 2 }
];
let calendarItems = readStoredValue('teamhub.calendarItems', defaultCalendarItems);
function persistCalendarItems() {
  writeStoredValue('teamhub.calendarItems', calendarItems);
  if (typeof renderDashboardMiniCalendar === 'function') renderDashboardMiniCalendar();
  if (typeof renderDashboardScheduleList === 'function') renderDashboardScheduleList();
}

/* ==========================================================================
   Leave Requests Store
   ========================================================================== */

const defaultLeaveRequests = [
  { id: 'lv-1', name: 'Lina Armand', title: 'Lab Analyst', type: 'Sick Leave', submitDate: '18 Jun 2035', period: '20â€“22 Jun 2035', duration: '3 Days', reason: 'Doctorâ€™s note attached', status: 'Approved' },
  { id: 'lv-2', name: 'Jacob Yuen', title: 'Site Supervisor', type: 'Annual Leave', submitDate: '10 Jun 2035', period: '17â€“21 Jun 2035', duration: '5 Days', reason: 'Family trip', status: 'Approved' },
  { id: 'lv-3', name: 'Anya Rodriguez', title: 'Graphic Designer', type: 'Other Leave', submitDate: '17 Jun 2035', period: '19 Jun 2035', duration: '1 Day', reason: 'Personal matter', status: 'Pending' },
  { id: 'lv-4', name: 'Olivia Mason', title: 'Marketing', type: 'Annual Leave', submitDate: '02 Jun 2035', period: '05â€“07 Jun 2035', duration: '3 Days', reason: 'Conference attendance', status: 'Approved' },
  { id: 'lv-5', name: 'Sara Kim', title: 'Customer Support', type: 'Sick Leave', submitDate: '14 Jun 2035', period: '15â€“16 Jun 2035', duration: '2 Days', reason: 'Fever', status: 'Approved' },
  { id: 'lv-6', name: 'Daniel Cheung', title: 'Compliance Specialist', type: 'Annual Leave', submitDate: '01 Jun 2035', period: '10â€“12 Jun 2035', duration: '3 Days', reason: 'Holiday', status: 'Pending' },
  { id: 'lv-7', name: 'Mia Torres', title: 'HR Officer', type: 'Annual Leave', submitDate: '06 Jun 2035', period: '09â€“10 Jun 2035', duration: '2 Days', reason: 'Personal retreat', status: 'Approved' },
  { id: 'lv-8', name: 'Ethan Ray', title: 'UI Designer', type: 'Casual Leave', submitDate: '05 Jun 2035', period: '07 Jun 2035', duration: '1 Day', reason: 'Family event', status: 'Rejected' },
  { id: 'lv-9', name: 'Farah Nabila', title: 'Customer Experience Lead', type: 'Sick Leave', submitDate: '11 Jun 2035', period: '12 Jun 2035', duration: '1 Day', reason: 'Headache', status: 'Approved' },
  { id: 'lv-10', name: 'Kelvin Yu', title: 'Training Coordinator', type: 'Other Leave', submitDate: '13 Jun 2035', period: '14 Jun 2035', duration: '1 Day', reason: 'Volunteer program', status: 'Rejected' }
];
let leaveRequests = readStoredValue('teamhub.leaveRequests', defaultLeaveRequests);
function persistLeaveRequests() {
  writeStoredValue('teamhub.leaveRequests', leaveRequests);
  if (typeof renderDashboardSummary === 'function') renderDashboardSummary();
}

/* ==========================================================================
   Applicants Store (Recruitment)
   ========================================================================== */

const defaultApplicants = [
  { id: 'app-1', name: 'William Hartono', email: 'william.hartono@email.com', position: 'UI Designer', appliedDate: '15 Jun 2035', type: 'Full-Time Remote', stage: 'Interview Scheduled' },
  { id: 'app-2', name: 'Fanny Rizal', email: 'fanny.rizal@email.com', position: 'Sales Manager', appliedDate: '12 Jun 2035', type: 'Full-Time On-Site', stage: 'Final Interview' },
  { id: 'app-3', name: 'Lala Wijaya', email: 'lala.wijaya@email.com', position: 'Data Analyst', appliedDate: '14 Jun 2035', type: 'Full-Time Hybrid', stage: 'Test Completed' },
  { id: 'app-4', name: 'Arifin Maulana', email: 'arifin.maulana@email.com', position: 'Customer Support', appliedDate: '13 Jun 2035', type: 'Full-Time On-Site', stage: 'Interview Scheduled' },
  { id: 'app-5', name: 'Clara Mentari', email: 'clara.mentari@email.com', position: 'HR Assistant', appliedDate: '10 Jun 2035', type: 'Full-Time On-Site', stage: 'Application Received' },
  { id: 'app-6', name: 'Bagus Pratama', email: 'bagus.pratama@email.com', position: 'Full-stack Engineer', appliedDate: '16 Jun 2035', type: 'Full-Time Hybrid', stage: 'Application Received' }
];
let applicantsData = readStoredValue('teamhub.applicants', defaultApplicants);
function persistApplicants() {
  writeStoredValue('teamhub.applicants', applicantsData);
  if (typeof renderDashboardSummary === 'function') renderDashboardSummary();
}

/* ==========================================================================
   Departments & Divisions Data Store
   ========================================================================== */

const defaultDepartments = [
  { id: 'dept-1', name: 'Product Design', code: 'PD', head: 'Ethan Ray', budget: 'Rp 45.000.000', description: 'Perancangan desain antarmuka, UX research, dan design system produk.' },
  { id: 'dept-2', name: 'Marketing', code: 'MKT', head: 'Olivia Mason', budget: 'Rp 65.000.000', description: 'Akuisisi pelanggan, kampanye digital, branding, dan lead generation B2B.' },
  { id: 'dept-3', name: 'Operations', code: 'OPS', head: 'Jacob Yuen', budget: 'Rp 50.000.000', description: 'Manajemen operasional harian, kepatuhan prosedur, dan ketepatan delivery.' },
  { id: 'dept-4', name: 'Human Resources', code: 'HR', head: 'Mia Torres', budget: 'Rp 40.000.000', description: 'Manajemen talenta, rekrutmen, retensi karyawan, dan budaya kerja tim.' },
  { id: 'dept-5', name: 'Customer Service', code: 'CS', head: 'Farah Nabila', budget: 'Rp 35.000.000', description: 'Penanganan tiket layanan pelanggan, kepuasan konsumen, dan respons cepat.' },
  { id: 'dept-6', name: 'R&D', code: 'RND', head: 'Lina Armand', budget: 'Rp 55.000.000', description: 'Riset dan inovasi teknologi, uji laboratorium, dan eksperimen prototipe.' }
];

let departmentsData = readStoredValue('teamhub.departments', defaultDepartments);
function persistDepartmentsData() { writeStoredValue('teamhub.departments', departmentsData); }
function getDepartmentNames() { return departmentsData.map(d => d.name); }
function syncDepartmentRename(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  kpiData.forEach(k => {
    if (k.dept === oldName) k.dept = newName;
  });
  persistKpiData();
  employeeData.forEach(p => {
    if (p[2] === oldName) p[2] = newName;
  });
  persistEmployeeData();
  if (typeof userAccounts !== 'undefined') {
    userAccounts.forEach(u => {
      if (u.department === oldName) u.department = newName;
    });
    persistUserAccounts();
  }
}

/* ==========================================================================
   KPI Data Store
   ========================================================================== */

const defaultKpiData = [
  { id: 'kpi-1', title: 'Customer Satisfaction Score (CSAT)', dept: 'Customer Service', pic: 'Olivia Mason', target: 90, actual: 95.2, unit: '%', weight: 25, period: 'Q2 2035', status: 'Exceeded', notes: 'Survei kepuasan pelanggan mencapai rekor tertinggi kuartal ini.' },
  { id: 'kpi-2', title: 'Design System Component Coverage', dept: 'Product Design', pic: 'Ethan Ray', target: 85, actual: 92.4, unit: '%', weight: 30, period: 'Q2 2035', status: 'Exceeded', notes: '45 komponen baru dipublikasikan ke Figma & Storybook.' },
  { id: 'kpi-3', title: 'Employee Retention Rate', dept: 'Human Resources', pic: 'Mia Torres', target: 95, actual: 96.8, unit: '%', weight: 35, period: 'Q2 2035', status: 'Exceeded', notes: 'Turnover turun 2.4% dari bulan lalu dengan program engagement baru.' },
  { id: 'kpi-4', title: 'Qualified B2B Leads Generated', dept: 'Marketing', pic: 'Daniel Cheung', target: 150, actual: 142, unit: 'Leads', weight: 25, period: 'Q2 2035', status: 'On-Track', notes: 'Pipeline lead dari webinar dan LinkedIn Ads berjalan konsisten.' },
  { id: 'kpi-5', title: 'On-Time Project Delivery Rate', dept: 'Operations', pic: 'Jacob Yuen', target: 90, actual: 88.5, unit: '%', weight: 30, period: 'Q2 2035', status: 'On-Track', notes: '18 dari 20 sprint rilis tepat waktu sesuai SLA.' },
  { id: 'kpi-6', title: 'R&D Prototype Lab Tests Completed', dept: 'R&D', pic: 'Lina Armand', target: 20, actual: 16, unit: 'Tests', weight: 20, period: 'Q2 2035', status: 'At Risk', notes: 'Terkendala pengiriman sampel material lab minggu lalu.' },
  { id: 'kpi-7', title: 'First Response Resolution Time', dept: 'Customer Service', pic: 'Farah Nabila', target: 15, actual: 11.5, unit: 'Menit', weight: 20, period: 'Q2 2035', status: 'Exceeded', lowerIsBetter: true, notes: 'Kecepatan respons tiket bantuan rata-rata di bawah 12 menit.' },
  { id: 'kpi-8', title: 'Recruitment Time-to-Hire', dept: 'Human Resources', pic: 'Davis Levin', target: 25, actual: 21, unit: 'Hari', weight: 25, period: 'Q2 2035', status: 'Exceeded', lowerIsBetter: true, notes: 'Waktu rata-rata rekrutmen dipangkas dengan sistem pipeline baru.' },
  { id: 'kpi-9', title: 'Organic Search Traffic Growth', dept: 'Marketing', pic: 'Daniel Cheung', target: 30, actual: 22.5, unit: '%', weight: 20, period: 'Q2 2035', status: 'At Risk', notes: 'Perlu optimasi SEO lanjutan pada landing page produk.' },
  { id: 'kpi-10', title: 'Operational Budget Variance Efficiency', dept: 'Operations', pic: 'Jacob Yuen', target: 5, actual: 3.2, unit: '%', weight: 15, period: 'Q2 2035', status: 'On-Track', lowerIsBetter: true, notes: 'Realisasi anggaran berada di bawah toleransi 5%.' }
];

let kpiData = readStoredValue('teamhub.kpiData', defaultKpiData);
let payRunData = readStoredValue('teamhub.payRuns', []);
let reviewCycleData = readStoredValue('teamhub.reviewCycles', []);
function persistPayRuns() { writeStoredValue('teamhub.payRuns', payRunData); }
function persistReviewCycles() { writeStoredValue('teamhub.reviewCycles', reviewCycleData); }
function persistKpiData() {
  writeStoredValue('teamhub.kpiData', kpiData);
  if (!cloudDataHydrating && authenticatedSupabaseSession && window.KharismaDB?.isConnected) {
    const allowed = isAdmin() ? kpiData : kpiData.filter(item => item.dept === getActiveDepartment());
    const snapshot = allowed.map(item => ({ ...item }));
    kpiCloudWriteQueue = kpiCloudWriteQueue.catch(() => {}).then(() => Promise.all(snapshot.map(item => window.KharismaDB.kpi.save(item)))).then(results => {
      if (results.some(result => !result?.ok)) showToast('Perubahan KPI tersimpan lokal, tetapi sebagian gagal disinkronkan ke cloud.');
    });
  }
}

/* ==========================================================================
   User Accounts & Role-Based Access (RBAC) Store
   ========================================================================== */

const defaultUserAccounts = [
  { id: 'usr-admin', name: 'Davis Levin', email: 'davis.levin@kharismahub.com', role: 'Admin', department: 'Human Resources', title: 'HR Administrator', status: 'Active', avatar: 'men/32', lastLogin: '2035-06-21 10:24' },
  { id: 'usr-spv-1', name: 'Olivia Mason', email: 'olivia.mason@kharismahub.com', role: 'Supervisor', department: 'Marketing', title: 'Marketing Team Lead', status: 'Active', avatar: 'women/44', lastLogin: '2035-06-21 09:10' },
  { id: 'usr-spv-2', name: 'Ethan Ray', email: 'ethan.ray@kharismahub.com', role: 'Supervisor', department: 'Product Design', title: 'Design Lead', status: 'Active', avatar: 'men/75', lastLogin: '2035-06-20 16:42' },
  { id: 'usr-spv-3', name: 'Jacob Yuen', email: 'jacob.yuen@kharismahub.com', role: 'Supervisor', department: 'Operations', title: 'Operations Lead', status: 'Active', avatar: 'men/47', lastLogin: '2035-06-21 08:30' },
  { id: 'usr-spv-4', name: 'Mia Torres', email: 'mia.torres@kharismahub.com', role: 'Supervisor', department: 'Human Resources', title: 'HR Team Lead', status: 'Active', avatar: 'women/68', lastLogin: '2035-06-21 09:55' },
  { id: 'usr-spv-5', name: 'Farah Nabila', email: 'farah.nabila@kharismahub.com', role: 'Supervisor', department: 'Customer Service', title: 'Customer Service Lead', status: 'Active', avatar: 'women/49', lastLogin: '2035-06-20 14:20' },
  { id: 'usr-spv-6', name: 'Lina Armand', email: 'lina.armand@kharismahub.com', role: 'Supervisor', department: 'R&D', title: 'R&D Lab Lead', status: 'Active', avatar: 'women/17', lastLogin: '2035-06-19 11:15' }
];

let userAccounts = readStoredValue('teamhub.userAccounts', defaultUserAccounts);
function persistUserAccounts() { writeStoredValue('teamhub.userAccounts', userAccounts); }

// Active session â€” which account is currently "logged in"
let activeAccountId = readStoredValue('teamhub.activeAccountId', 'usr-admin');
function persistActiveAccount() { writeStoredValue('teamhub.activeAccountId', activeAccountId); }
function getActiveAccount() {
  if (authenticatedSupabaseSession && authenticatedUserProfile) {
    return { id: authenticatedUserProfile.id, name: authenticatedUserProfile.full_name || authenticatedSupabaseSession.user.email, email: authenticatedSupabaseSession.user.email, role: authenticatedUserProfile.role, department: authenticatedUserProfile.department || '', title: authenticatedUserProfile.title || roleLabel(authenticatedUserProfile.role), status: authenticatedUserProfile.status };
  }
  const acc = userAccounts.find(u => u.id === activeAccountId && u.status !== 'Inactive');
  return acc || userAccounts.find(u => u.role === 'Admin' && u.status === 'Active') || userAccounts.find(u => u.status === 'Active') || userAccounts[0] || defaultUserAccounts[0];
}
function isAdmin() { return getActiveAccount().role === 'Admin'; }
function isSupervisor() { return getActiveAccount().role === 'Supervisor'; }
function getActiveDepartment() { return getActiveAccount().department; }
function syncActiveProfileFromAccount(persist = false) {
  const account = getActiveAccount();
  if (!account) return;
  userProfile.name = account.name;
  userProfile.email = account.email;
  userProfile.role = account.role;
  userProfile.department = account.department || '';
  if (persist) persistUserProfile();
  document.querySelectorAll('.user-chip').forEach((chip) => {
    const name = chip.querySelector('strong');
    const role = chip.querySelector('small');
    if (name) name.textContent = account.name;
    if (role) role.textContent = roleLabel(account.role);
    chip.title = `Profil ${account.name}`;
    const avatarInitial = chip.querySelector('.avatar span');
    if (avatarInitial) avatarInitial.textContent = initials(account.name);
  });
  const displayName = document.querySelector('#profileDisplayName');
  const displayEmail = document.querySelector('#profileDisplayEmail');
  const roleBadge = document.querySelector('#profileRoleBadge');
  const profileInitials = document.querySelector('#profileAvatarInitials');
  if (displayName) displayName.textContent = account.name;
  if (displayEmail) displayEmail.textContent = account.email;
    if (roleBadge) roleBadge.textContent = `${roleLabel(userProfile.role)}${userProfile.department ? ` Â· ${userProfile.department}` : ''}`;
  if (profileInitials) profileInitials.textContent = initials(account.name);
}
syncActiveProfileFromAccount();

/* Cross-module sync: Employee directory â†” KPI PIC â†” Division Head â†” User Accounts */
function findEmployeeByName(name) {
  const key = String(name || '').trim().toLowerCase();
  return employeeData.find(p => p[0].toLowerCase() === key) || null;
}
function syncEmployeeChange(oldName, oldEmail, next) {
  const changed = { kpi: 0, dept: 0, users: 0 };
  if (!oldName) return changed;
  const nameChanged = next.name && next.name !== oldName;
  if (nameChanged) {
    kpiData.forEach(k => { if (k.pic === oldName) { k.pic = next.name; changed.kpi++; } });
    departmentsData.forEach(d => { if (d.head === oldName) { d.head = next.name; changed.dept++; } });
    if (changed.kpi) persistKpiData();
    if (changed.dept) persistDepartmentsData();
  }
  userAccounts.forEach(u => {
    const match = u.name === oldName || (oldEmail && u.email.toLowerCase() === String(oldEmail).toLowerCase());
    if (!match) return;
    if (next.name) u.name = next.name;
    if (next.email) u.email = next.email;
    if (next.department && u.role === 'Supervisor' && departmentsData.some(d => d.name === next.department)) u.department = next.department;
    if (authenticatedSupabaseSession && isAdmin() && window.KharismaAuth?.adminRequest) {
      window.KharismaAuth.adminRequest('PATCH', { id: u.id, name: u.name, email: u.email, department: u.department, title: u.title })
        .catch(error => showToast(`Profil akun ${u.name} belum tersinkron ke cloud: ${error.message}`));
    }
    changed.users++;
  });
  if (changed.users) persistUserAccounts();
  return changed;
}
function getEmployeeLinks(name) {
  return {
    kpi: kpiData.filter(k => k.pic === name).length,
    dept: departmentsData.filter(d => d.head === name).map(d => d.name),
    users: userAccounts.filter(u => u.name === name)
  };
}
// Startup reconciliation: every user account must exist in the employee directory
(function reconcileAccountsWithEmployees() {
  let added = 0;
  userAccounts.forEach(u => {
    if (!findEmployeeByName(u.name)) {
      employeeData.push([u.name, u.email, u.department, u.title || u.role, 'On-Time']);
      added++;
    }
  });
  if (added) persistEmployeeData();
})();

/* ==========================================================================
   Mail Data Store
   ========================================================================== */

const inboxData = [
  { id: 1, from: 'Olivia Mason', email: 'olivia.mason@company.com', subject: 'Leave Request Approval', preview: "Hi, I'd like to follow up on my annual leave request for next month, from July 15 to July 19.", time: '10:24 AM', date: '19 Jun', initials: 'OM', color: 'p1', label: 'Leave Requests', body: ["Hi there,", "I'd like to follow up on my annual leave request for the dates 15â€“19 July.", 'The request is still marked as pending, and I wanted to confirm if any additional documents are needed.', 'Please let me know if you need anything else from my side.', 'Thanks so much!', 'â€” Olivia'], unread: true, starred: false },
  { id: 2, from: 'Ethan Ray', email: 'ethan.ray@company.com', subject: 'Updated Contact Info', preview: "Just a quick heads-up that I've updated my emergency contact details on my profile.", time: '09:40 AM', date: '19 Jun', initials: 'ER', color: 'p2', label: 'HR', body: ['Hi Davis,', "I've updated my emergency contact details on my profile. Please let me know if you need anything else.", 'Thanks,', 'Ethan'], unread: true, starred: false },
  { id: 3, from: 'Lina Armand', email: 'lina.armand@company.com', subject: 'Medical Leave Submission', preview: "I've attached my doctor's note for the requested medical leave from June 20 to June 21.", time: '04:59 PM', date: '18 Jun', initials: 'LA', color: 'p3', label: 'Leave Requests', body: ['Hello,', "I've submitted my medical leave request and attached my doctor's note for the requested dates.", 'Please let me know if you need any additional information.', 'Best,', 'Lina'], unread: false, starred: false },
  { id: 4, from: 'HR Department', email: 'hr@kharismahub.com', subject: 'Performance Review Reminder', preview: 'A reminder to complete your self-assessment form as part of the performance review cycle.', time: '03:11 PM', date: '18 Jun', initials: 'HR', color: 'dark-avatar', label: 'Interview', body: ['Hello team,', 'This is a reminder to complete your self-assessment form as part of the mid-year performance review cycle.', 'Please submit your responses by 28 June.', 'Thank you,', 'HR Department'], unread: false, starred: false },
  { id: 5, from: 'Jacob Yuen', email: 'jacob.yuen@company.com', subject: 'Attendance Clarification', preview: 'Just wanted to clarify my absence earlier today. I experienced a personal emergency and...', time: '09:25 AM', date: '18 Jun', initials: 'JY', color: 'p4', label: 'HR', body: ['Hi Davis,', 'I wanted to clarify my absence earlier today. I experienced a personal emergency and could not check in on time.', 'I have updated my attendance note.', 'Regards,', 'Jacob'], unread: false, starred: true },
  { id: 6, from: 'System Notification', email: 'security@kharismahub.com', subject: 'Password Expiry Alert', preview: 'Your current password will expire in 5 days. To maintain account security, please reset it via...', time: '06:00 PM', date: '17 Jun', initials: 'SN', color: 'amber-avatar', label: 'Admin Notes', body: ['Your password will expire in 5 days.', 'To maintain account security, please visit your account settings and update your password.', 'This is an automated notification.'], unread: false, starred: false },
  { id: 7, from: 'Mia Torres', email: 'mia.torres@company.com', subject: 'Leave Policy Update', preview: 'Please review the newly updated 2035 leave policy document. It includes important updates on...', time: 'Yesterday', date: '16 Jun', initials: 'MT', color: 'p5', label: 'Leave Requests', body: ['Hi everyone,', 'Please review the newly updated 2035 leave policy document. It includes important updates on annual leave and public holidays.', 'The document is available in the team workspace.', 'Best,', 'Mia'], unread: false, starred: false },
];
let activeMailFolder = 'Inbox';
let selectedMailId = 1;
let sentMail = [
  { id: 'sent-1', from: 'Davis Levin', email: 'davis.levin@kharismahub.com', subject: 'June Team Update', preview: 'Sharing the latest people updates for June.', time: '08:20 AM', date: '19 Jun', initials: 'DL', color: 'avatar-davis', label: 'HR', body: ['Hi team,', 'Sharing the latest people updates for June. Please take a look at the calendar for upcoming events.', 'Thanks,', 'Davis'], unread: false, starred: false },
  { id: 'sent-2', from: 'Davis Levin', email: 'davis.levin@kharismahub.com', subject: 'Welcome aboard!', preview: 'We are excited to have you join the Kharisma Hub team.', time: 'Yesterday', date: '18 Jun', initials: 'DL', color: 'avatar-davis', label: 'HR', body: ['Welcome aboard! We are excited to have you join the Kharisma Hub team.', 'Best, Davis'], unread: false, starred: false },
];
let draftMail = [
  { id: 'draft-1', from: 'Davis Levin', email: 'davis.levin@kharismahub.com', subject: 'Draft: July planning', preview: 'A few notes for next monthâ€™s planning meeting...', time: 'Yesterday', date: '18 Jun', initials: 'DL', color: 'avatar-davis', label: 'HR', body: ['A few notes for next monthâ€™s planning meeting...'], unread: false, starred: false },
];
let archivedMail = [];
let trashedMail = [];
let spamMail = [{ id: 'spam-1', from: 'External sender', email: 'offers@example.com', subject: 'Special offer', preview: 'This message was marked as spam.', time: '16 Jun', date: '16 Jun', initials: 'ES', color: 'label-admin', label: 'Admin Notes', body: ['This message was marked as spam.'], unread: false, starred: false }];
let unreadOnly = false;
const savedMailbox = readStoredValue('teamhub.mailbox', {});
for (const [key, list] of [['inbox', inboxData], ['sent', sentMail], ['drafts', draftMail], ['archived', archivedMail], ['trashed', trashedMail], ['spam', spamMail]]) {
  if (Array.isArray(savedMailbox[key])) list.splice(0, list.length, ...savedMailbox[key]);
}
function persistMailbox() {
  writeStoredValue('teamhub.mailbox', { inbox: inboxData, sent: sentMail, drafts: draftMail, archived: archivedMail, trashed: trashedMail, spam: spamMail });
}

/* ==========================================================================
   Table Pagination Helper
   ========================================================================== */

function setupTablePagination() {
  const pagination = moduleView.querySelector('.pagination-row');
  const table = moduleView.querySelector('.module-table');
  if (!pagination || !table) return;
  const rows = [...table.querySelectorAll('tbody tr')];
  const sizeSelect = pagination.querySelector('select');
  const pageSize = Number(sizeSelect?.value) || 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  pagination.dataset.pageSize = String(pageSize);
  pagination.dataset.currentPage = '1';
  pagination.querySelectorAll('button').forEach((button) => button.remove());
  const controls = document.createElement('div');
  const addPageButton = (label, page, disabled = false) => {
    const control = document.createElement('button');
    control.type = 'button'; control.dataset.action = 'table-page'; control.dataset.page = String(page);
    control.textContent = label; control.disabled = disabled;
    if (Number(page) === 1 && label === '1') control.classList.add('page-current');
    controls.append(control);
  };
  addPageButton('â€¹', 0, true);
  for (let page = 1; page <= pageCount; page += 1) addPageButton(String(page), page);
  addPageButton('â€º', Math.min(2, pageCount), pageCount <= 1);
  pagination.append(controls);
  const resultLabel = pagination.querySelector('label');
  if (resultLabel && sizeSelect) {
    resultLabel.dataset.resultCount = String(rows.length);
    resultLabel.replaceChildren(document.createTextNode('Tampilkan '), sizeSelect, document.createTextNode(' dari ' + rows.length + ' data'));
  }
  rows.forEach((row, index) => { row.hidden = index >= pageSize; });
}

function showTablePage(page) {
  const pagination = moduleView.querySelector('.pagination-row');
  const rows = [...moduleView.querySelectorAll('.module-table tbody tr')];
  if (!pagination || !rows.length) return;
  const pageSize = Number(pagination.dataset.pageSize) || 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const nextPage = Math.max(1, Math.min(pageCount, Number(page) || 1));
  pagination.dataset.currentPage = String(nextPage);
  rows.forEach((row, index) => { row.hidden = index < (nextPage - 1) * pageSize || index >= nextPage * pageSize; });
  pagination.querySelectorAll('[data-action="table-page"]').forEach((button) => {
    button.classList.toggle('page-current', Number(button.dataset.page) === nextPage && button.textContent.trim() !== 'â€¹' && button.textContent.trim() !== 'â€º');
    if (button.textContent.trim() === 'â€¹') { button.dataset.page = String(Math.max(1, nextPage - 1)); button.disabled = nextPage === 1; }
    if (button.textContent.trim() === 'â€º') { button.dataset.page = String(Math.min(pageCount, nextPage + 1)); button.disabled = nextPage === pageCount; }
  });
}

/* ==========================================================================
   Calendar Helper Functions
   ========================================================================== */

const weekdays = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const currentSysDate = new Date();
function getCalendarItemDate(item, fallbackDate = calendarDate) {
  const match = String(item?.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const day = Number(item?.day);
  return Number.isFinite(day) && day > 0
    ? new Date(fallbackDate.getFullYear(), fallbackDate.getMonth(), day)
    : null;
}

function toLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
const firstCalendarItemDate = [...calendarItems]
  .map(item => getCalendarItemDate(item, currentSysDate))
  .filter(Boolean)
  .sort((a, b) => a - b)[0];
let calendarDate = new Date(
  (firstCalendarItemDate || currentSysDate).getFullYear(),
  (firstCalendarItemDate || currentSysDate).getMonth(),
  1
);
let moduleCalendarDate = new Date(calendarDate);
const preferredCalendarDay = calendarItems
  .map(item => getCalendarItemDate(item, currentSysDate))
  .find(date => date.getFullYear() === calendarDate.getFullYear() && date.getMonth() === calendarDate.getMonth() && date.getDate() === 21);
let selectedDate = preferredCalendarDay?.getDate() || firstCalendarItemDate?.getDate() || currentSysDate.getDate();
let selectedCalendarEventId = null;

function renderDashboardMiniCalendar() {
  const grid = document.querySelector('#calendarGrid');
  if (!grid) return;
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(calendarDate);
  const monthBtn = document.querySelector('#monthButton');
  if (monthBtn) monthBtn.innerHTML = `${monthName} ${year} <span>âŒ„</span>`;
  grid.replaceChildren();
  weekdays.forEach((day) => {
    const item = document.createElement('span');
    item.className = 'day-name';
    item.textContent = day;
    grid.append(item);
  });
  const offset = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  for (let i = 0; i < offset; i += 1) grid.append(document.createElement('span'));
  
  const activeEventDays = new Set(calendarItems
    .filter(item => {
      const date = getCalendarItemDate(item);
      return date && date.getFullYear() === year && date.getMonth() === month;
    })
    .map(item => getCalendarItemDate(item).getDate()));
  for (let day = 1; day <= count; day += 1) {
    const item = document.createElement('span');
    item.textContent = day;
    if (activeEventDays.has(day)) item.classList.add('event-day');
    if (day === selectedDate) item.classList.add('selected-day');
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.setAttribute('aria-label', `${monthName} ${day}, ${year}`);
    const selectDay = () => {
      selectedDate = day;
      renderDashboardMiniCalendar();
      const schedBtn = document.querySelector('#scheduleDate');
      if (schedBtn) schedBtn.innerHTML = `${day} ${monthName.slice(0, 3)} <span>âŒ„</span>`;
      renderDashboardScheduleList(day);
    };
    item.addEventListener('click', selectDay);
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectDay();
      }
    });
    grid.append(item);
  }
}

function renderDashboardScheduleList(day = selectedDate) {
  const list = document.querySelector('#schedules');
  if (!list) return;
  const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(calendarDate);
  const dayEvents = calendarItems.filter(item => {
    const date = getCalendarItemDate(item);
    return date && date.getFullYear() === calendarDate.getFullYear() && date.getMonth() === calendarDate.getMonth() && date.getDate() === Number(day);
  });
  if (!dayEvents.length) {
    list.innerHTML = `<div style="padding:14px 10px;text-align:center;color:#64748b;font-size:10px;background:#f8fafc;border-radius:8px">Tidak ada jadwal untuk tanggal ${day} ${monthName}. <button class="date-filter" style="margin-top:6px;display:inline-block" data-action="new-event">ï¼‹ Tambah Agenda</button></div>`;
    return;
  }
  list.innerHTML = dayEvents.map((event, i) => `
    <article class="schedule-card">
      <span class="schedule-type">${safe(event.category)}</span>
      <strong>${safe(event.title)}</strong>
      <div>
        <span class="tag">${safe(event.location || 'Ruang Rapat')}</span>
        <small>${safe(event.time)}</small>
        <span class="avatar-stack"><i class="avatar mini p1">MT</i><i class="avatar mini p2">ER</i><i class="avatar mini p3">JC</i><b>+${(i % 3) + 2}</b></span>
      </div>
    </article>
  `).join('');
}


function renderDashboardSummary() {
  const totalEmployeesEl = document.querySelector('#dashTotalEmployees');
  const attendanceRateEl = document.querySelector('#dashAttendanceRate');
  const leaveRequestsEl = document.querySelector('#dashLeaveRequests');
  const leaveBandEl = document.querySelector('#dashLeaveBand');
  const applicantsEl = document.querySelector('#dashApplicants');
  const applicantsBandEl = document.querySelector('#dashApplicantsBand');
  const empTotalEl = document.querySelector('.employment-total');

  const total = employeeData.length;
  if (totalEmployeesEl) totalEmployeesEl.innerHTML = `${total} <small>Employees</small>`;
  if (empTotalEl) empTotalEl.innerHTML = `${total} <small>Employees</small>`;

  const onTimeCount = employeeData.filter(p => p[4] === 'On-Time').length;
  const lateCount = employeeData.filter(p => p[4] === 'Late').length;
  const leaveCount = employeeData.filter(p => p[4] === 'On Leave').length;
  const rate = total ? Math.round((onTimeCount / total) * 100) : 92;

  if (attendanceRateEl) {
    attendanceRateEl.innerHTML = `${rate}% <small>Present Â· ${leaveCount} On Leave, ${lateCount} Late</small>`;
  }

  const approvedLeave = leaveRequests.filter(r => r.status === 'Approved').length;
  const pendingLeave = leaveRequests.filter(r => r.status === 'Pending').length;
  if (leaveRequestsEl) {
    leaveRequestsEl.innerHTML = `${approvedLeave} <small>Approved</small> <b>${pendingLeave}</b> <small>Pending Review</small>`;
  }
  if (leaveBandEl) {
    leaveBandEl.innerHTML = `Tercatat <strong>${leaveRequests.length} pengajuan cuti</strong> dalam sistem`;
  }

  const appCount = applicantsData.length;
  if (applicantsEl) {
    applicantsEl.innerHTML = `${appCount} <small>Pelamar Aktif</small>`;
  }
  if (applicantsBandEl) {
    applicantsBandEl.innerHTML = `Tim Anda memiliki <strong>${appCount} pelamar kerja aktif</strong>`;
  }

  // Update employment breakdown
  const fullTime = employeeData.filter(p => {
    const ov = employeeProfileOverrides[p[0]];
    return !ov?.employmentType || ov.employmentType === 'Full-Time';
  }).length;
  const partTime = employeeData.filter(p => employeeProfileOverrides[p[0]]?.employmentType === 'Part-Time').length;
  const intern = employeeData.filter(p => employeeProfileOverrides[p[0]]?.employmentType === 'Internship').length;
  const freelance = Math.max(0, total - fullTime - partTime - intern);

  const legend = document.querySelector('.employment-legend');
  if (legend) {
    legend.innerHTML = `
      <div><i class="legend-full"></i><span><strong>Full-Time</strong><small>${total ? Math.round((fullTime/total)*100) : 75}% â€” ${fullTime} Pegawai</small></span></div>
      <div><i class="legend-part"></i><span><strong>Part-Time</strong><small>${total ? Math.round((partTime/total)*100) : 15}% â€” ${partTime} Pegawai</small></span></div>
      <div><i class="legend-free"></i><span><strong>Freelance/Kontrak</strong><small>${total ? Math.round((freelance/total)*100) : 10}% â€” ${freelance} Pegawai</small></span></div>
      <div><i class="legend-intern"></i><span><strong>Internship</strong><small>${total ? Math.round((intern/total)*100) : 0}% â€” ${intern} Pegawai</small></span></div>
    `;
  }
}

/* ==========================================================================
   Navigation & Routing Engine
   ========================================================================== */

const dashboardView = document.querySelector('#dashboardView');
const moduleView = document.querySelector('#moduleView');
const moduleTitles = {
  dashboard: ['Dashboard', 'Overview of your HR operations and workforce performance.'],
  inbox: ['Inbox', 'Your team updates and messages in one place.'],
  calendar: ['Calendar', 'Plan interviews, reviews and team events.'],
  employees: ['Employees', 'Manage your people, roles and team details.'],
  attendance: ['Attendance', 'Review check-ins, hours and attendance records.'],
  performance: ['Performance', 'Track goals, reviews and team progress.'],
  kpi: ['KPI & Targets', 'Pantau, evaluasi, dan kelola target Key Performance Indicators tim serta perusahaan.'],
  payroll: ['Payroll', 'Manage payroll cycles and compensation records.'],
  leave: ['Leave Management', 'Review time off requests and team availability.'],
  recruitment: ['Recruitment', 'Track applicants through your hiring pipeline.'],
  'employee-grid': ['Employees', 'Browse employees in a visual directory.'],
  'employee-details': ['Employee Details', 'View employee profile, leave and payroll information.'],
  'employee-add': ['Add New Employee', 'Create a profile for a new team member.'],
};

let selectedEmployeeName = 'Mia Torres';
let employeeDraft = {};
let employeeCurrentPage = 1;
const employeePageSize = 10;

function employeePaginationMarkup(total) {
  const pageCount = Math.max(1, Math.ceil(total / employeePageSize));
  return `<div class="employee-pagination">${Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => `<button class="${page === employeeCurrentPage ? 'page-current' : ''}" data-action="employee-page" data-page="${page}" aria-current="${page === employeeCurrentPage ? 'page' : 'false'}">${page}</button>`).join('')}</div>`;
}

const moduleHeader = (key, action = '') => `<div class="module-heading"><div><span class="module-eyebrow">KHARISMA HUB WORKSPACE</span><h1>${moduleTitles[key][0]}</h1><p>${moduleTitles[key][1]}</p></div><div class="module-heading-actions">${action}</div></div>`;
const button = (label, action, style = 'secondary') => `<button class="module-button ${style}" data-action="${action}">${label}</button>`;
const section = (title, body, extra = '') => `<section class="module-card"><div class="module-card-head"><h2>${title}</h2>${extra}</div>${body}</section>`;

/* ==========================================================================
   Module Markup Generators
   ========================================================================== */

function getCalendarScheduleCards(day, eventId = selectedCalendarEventId) {
  const events = calendarItems.filter(item => {
    const date = getCalendarItemDate(item);
    return date && date.getFullYear() === calendarDate.getFullYear() && date.getMonth() === calendarDate.getMonth() && date.getDate() === Number(day) && (!eventId || String(item.id) === String(eventId));
  });
  if (!events.length) {
    return `
      <div style="padding:20px 10px;text-align:center;color:#64748b;font-size:11px">
        <p style="margin:0 0 8px">Tidak ada jadwal pada tanggal ini.</p>
        <button class="module-button primary" data-action="new-event">ï¼‹ Tambah Agenda</button>
      </div>
    `;
  }
  return events.map(ev => `
    <article class="schedule-detail-card ${ev.tone === 1 ? 'dev-card' : (ev.tone === 2 ? 'engage-card' : 'talent-card')}" style="margin-bottom:10px">
      <span>${safe(ev.category)}</span>
      <strong>${safe(ev.title)}</strong>
      <dl>
        <dt>Waktu</dt><dd>${safe(ev.time)}</dd>
        <dt>Lokasi</dt><dd>${safe(ev.location)}</dd>
        <dt>Catatan</dt><dd>${safe(ev.note || 'â€”')}</dd>
      </dl>
      <div style="display:flex;justify-content:flex-end;margin-top:6px">
        <button class="date-filter" data-action="delete-calendar-event" data-id="${ev.id}" style="color:#b23b3b;background:#fdecec">Hapus Agenda</button>
      </div>
    </article>
  `).join('');
}

function pageMarkup(key) {
  const profile = getEmployeeProfile(selectedEmployeeName);
  const employeePagination = employeePaginationMarkup(employeeData.length);

  // Group calendar items by day
  const eventsByDay = {};
  calendarItems.forEach(item => {
    const date = getCalendarItemDate(item);
    if (!date || date.getFullYear() !== calendarDate.getFullYear() || date.getMonth() !== calendarDate.getMonth()) return;
    const day = date.getDate();
    if (!eventsByDay[day]) eventsByDay[day] = [];
    eventsByDay[day].push(item);
  });

  const calYear = calendarDate.getFullYear();
  const calMonth = calendarDate.getMonth();
  const firstDayIndex = new Date(calYear, calMonth, 1).getDay(); // 0 = Sun
  const totalDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const prevMonthTotalDays = new Date(calYear, calMonth, 0).getDate();
  const calCells = [];

  // Leading days from prev month
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    calCells.push(`<div class="calendar-cell muted-cell"><button class="muted-date" disabled>${prevMonthTotalDays - i}</button></div>`);
  }
  // Days of current month
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const dayEvents = eventsByDay[d] || [];
    calCells.push(`
      <div class="calendar-cell ${d === selectedDate ? 'active-date' : ''}">
        <button data-action="pick-calendar-day" data-day="${d}">${d}</button>
        ${dayEvents.map(ev => `
          <button class="calendar-event event-tone-${ev.tone || 0}" data-action="open-agenda-event" data-id="${safe(ev.id)}" data-title="${safe(ev.title)}" data-day="${d}">
            <strong>${safe(ev.title)}</strong>
            <small>${safe(ev.time)}</small>
          </button>
        `).join('')}
      </div>
    `);
  }
  // Trailing days from next month
  const totalGridCells = calCells.length <= 35 ? 35 : 42;
  const remaining = totalGridCells - calCells.length;
  for (let d = 1; d <= remaining; d++) {
    calCells.push(`<div class="calendar-cell muted-cell"><button class="muted-date" disabled>${d}</button></div>`);
  }
  const calendarDays = calCells.join('');

  const peopleRows = employeeData.slice((employeeCurrentPage - 1) * employeePageSize, employeeCurrentPage * employeePageSize).map((p, i) => `
    <tr>
      <td><input type="checkbox" aria-label="Select ${safe(p[0])}" /></td>
      <td>EMP-${getEmployeeId(p)}</td>
      <td>
        <button class="employee-link" data-action="view-employee" data-name="${safe(p[0])}">
          ${avatar(p[0], `p${i % 9 + 1}`)}
          <strong>${safe(p[0])}</strong>
        </button>
      </td>
      <td>${safe(p[3])}</td>
      <td>${safe(p[2])}</td>
      <td><span class="employment-pill">${i === 5 ? 'Internship' : i === 2 || i === 7 ? 'Part-Time' : 'Full-Time'}</span></td>
      <td>${['Hybrid', 'Remote', 'On-Site'][i % 3]}</td>
      <td>${['12 Jan 2034', '03 Mar 2033', '22 Jul 2034', '05 Sep 2032', '14 Feb 2033', '10 May 2035'][i % 6]}</td>
      <td><span class="status ${p[4] === 'Absent' ? 'absent' : p[4] === 'On Leave' ? 'leave' : 'ontime'}">${p[4] === 'On-Time' ? 'Active' : p[4]}</span></td>
      <td>
        <div class="row-actions-group">
          <button class="btn-action-icon" data-action="edit-employee" data-name="${safe(p[0])}" title="Edit Data Karyawan"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn-action-icon danger" data-action="delete-employee" data-name="${safe(p[0])}" title="Hapus Karyawan"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
      </td>
    </tr>
  `).join('');

  const todayAttendanceKey = attendanceTodayKey();
  if (userAttendanceRecord && userAttendanceRecord.dateKey !== todayAttendanceKey && !isActiveOvernightAttendance(userAttendanceRecord)) {
    if (userAttendanceRecord.state !== 'completed' && !userAttendanceRecord.clockOut) {
      attendanceIncompleteHistory = [userAttendanceRecord, ...attendanceIncompleteHistory.filter(record => record.id !== userAttendanceRecord.id)].slice(0, 30);
      writeStoredValue('teamhub.attendanceIncompleteHistory', attendanceIncompleteHistory);
    }
    userAttendanceRecord = null;
    persistUserAttendance(false);
  }
  const allAttendanceItems = [];
  if (Array.isArray(cloudAttendanceRecords)) {
    cloudAttendanceRecords.forEach((record, i) => {
      const employee = employeeData.find(person => person[1]?.toLowerCase() === String(record.employee_name || '').toLowerCase() || `EMP-${getEmployeeId(person)}` === record.employee_id);
      const date = record.date ? new Date(`${record.date}T00:00:00`) : new Date();
      allAttendanceItems.push({
        name: record.employee_name || employee?.[0] || 'Karyawan', rawName: employee?.[0] || record.employee_name || 'Karyawan',
        id: record.employee_id || '', title: employee?.[3] || 'Karyawan', dept: employee?.[2] || '',
        date: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(date),
        workModel: record.work_model || 'â€”', checkInOut: `${record.clock_in || 'â€”'} â€“ ${record.clock_out || 'Aktif'}`,
        duration: record.duration || 'â€”', overtime: record.overtime || 'â€”', status: record.state && record.state !== 'completed' ? 'Belum Lengkap' : ({ 'On-Time': 'Tepat Waktu', Late: 'Terlambat', 'On Leave': 'Cuti', Absent: 'Tidak Hadir' }[record.status] || record.status || 'Tepat Waktu'), avatarIdx: (i % 9) + 1
      });
    });
  } else if (userAttendanceRecord) {
    allAttendanceItems.push({
      name: `${userProfile.name} (Anda)`,
      rawName: userProfile.name,
      id: 'EMP-0001',
      title: userProfile.role || 'Administrator SDM',
      dept: userProfile.department || 'Human Resources',
      date: userAttendanceRecord.date || '19 Jun 2035',
      workModel: userAttendanceRecord.workModel || 'Di Kantor',
      checkInOut: userAttendanceRecord.clockIn + (userAttendanceRecord.clockOut ? ' â€“ ' + userAttendanceRecord.clockOut : ' â€“ Aktif'),
      duration: userAttendanceRecord.duration || 'Sedang Berjalan',
      overtime: userAttendanceRecord.overtime || 'â€”',
      status: userAttendanceRecord.status || 'On-Time',
      avatarIdx: 1,
      isUser: true
    });
  }
  // Do not fabricate attendance rows from the employee directory. The table is an audit view.

  const attendanceRows = allAttendanceItems.map((item) => `
    <tr class="${item.isUser ? 'user-attendance-row' : ''}">
      <td>
        <button class="employee-link" data-action="view-employee" data-name="${safe(item.rawName)}">
          ${avatar(item.rawName, `p${item.avatarIdx}`)}
          <span><strong>${safe(item.name)}</strong><small>${safe(item.id)}</small></span>
        </button>
      </td>
      <td><strong>${safe(item.title)}</strong><small>${safe(item.dept)}</small></td>
      <td>${safe(item.date)}</td>
      <td>${safe(item.workModel)}</td>
      <td>${safe(item.checkInOut)}</td>
      <td>${safe(item.duration)}</td>
      <td>${safe(item.overtime)}</td>
      <td><span class="status ${item.status === 'On-Time' || item.status === 'Tepat Waktu' ? 'ontime' : item.status === 'Late' || item.status === 'Terlambat' ? 'late' : item.status === 'Absent' ? 'absent' : item.status === 'Belum Lengkap' ? 'incomplete' : 'leave'}">${safe(item.status)}</span></td>
    </tr>
  `).join('');

  const performanceRows = employeeData.slice(0, 8).map((p, i) => `
    <tr>
      <td>${avatar(p[0], `p${i + 1}`)} <strong>${safe(p[0])}</strong></td>
      <td>${safe(p[3])}</td>
      <td>${[4.7, 4.6, 4.2, 4.1, 4.6, 4.5, 4.4, 4.5][i]}</td>
      <td>${[4.6, 4.5, 4.0, 4.2, 4.6, 4.3, 4.2, 4.1][i]}</td>
      <td>${[4.4, 4.4, 4.1, 4.0, 4.3, 4.2, 4.2, 4.0][i]}</td>
      <td>${[4.4, 4.3, 3.5, 3.6, 4.1, 4.0, 3.9, 4.0][i]}</td>
      <td><strong>${[92, 90, 81, 80, 89, 88, 87, 86][i]}%</strong></td>
    </tr>
  `).join('');

  // 1. INBOX MODULE
  if (key === 'inbox') {
    return `
      <div class="inbox-workspace">
        <aside class="mail-folders">
          <button class="module-button primary compose-new" data-action="new-message">ï¼‹ &nbsp;New Message</button>
          <div class="folder-list">
            ${[['Inbox','10','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>'],['Starred','3','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'],['Sent','5','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'],['Drafts','2','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'],['Spam','1','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'],['Trash','','<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>']].map(([name,count,icon]) => `
              <button class="folder-button ${name === activeMailFolder ? 'selected' : ''}" data-folder="${name}">
                <span>${icon}</span>${name}${count ? `<b>${count}</b>` : ''}
              </button>
            `).join('')}
          </div>
          <h3>Label</h3>
          <div class="mail-label-list">
            <button data-label="HR"><i class="label-hr"></i>HR</button>
            <button data-label="Leave Requests"><i class="label-leave"></i>Leave Requests</button>
            <button data-label="Interview"><i class="label-interview"></i>Interview</button>
            <button data-label="Admin Notes"><i class="label-admin"></i>Admin Notes</button>
          </div>
        </aside>
        <section class="mail-list-pane">
          <div class="mail-search-row">
            <label class="mail-search"><span>âŒ•</span><input id="mailSearch" placeholder="Search email" aria-label="Search email" /></label>
            <button class="mail-filter-button" data-action="mail-filter" aria-label="Filter email"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg></button>
          </div>
          <div class="mail-list" id="mailList"></div>
        </section>
        <section class="mail-detail-pane">
          <div class="mail-detail-toolbar">
            <div>
              <button data-action="mail-back" aria-label="Back">â€¹</button>
              <button data-action="archive-message" aria-label="Archive"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="21 8 21 21 3 21 3 8"/><rect width="22" height="5" x="1" y="3" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></svg></button>
              <button data-action="delete-message" aria-label="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
              <button data-action="print-message" aria-label="Print"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg></button>
              <button data-action="mail-more" aria-label="More">Â·Â·Â·</button>
            </div>
            <span id="mailCounter">1 from 36</span>
            <button data-action="mail-prev" aria-label="Previous email">â€¹</button>
            <button data-action="mail-next" aria-label="Next email">â€º</button>
          </div>
          <div class="mail-reader" id="mailReader"></div>
          <form class="mail-composer" id="mailComposer">
            <div class="compose-recipient">
              <span>To:</span>
              <input name="recipient" value="Olivia Mason" aria-label="Recipient" />
              <button type="button" data-action="toggle-cc">Cc</button>
              <button type="button" data-action="toggle-bcc">Bcc</button>
              <button type="button" data-action="expand-composer" aria-label="Expand"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
            </div>
            <div class="compose-cc-row" id="composeCcRow" style="display:none">
              <span>Cc:</span>
              <input name="cc" placeholder="cc@kharismahub.com" aria-label="Carbon copy" />
            </div>
            <div class="compose-bcc-row" id="composeBccRow" style="display:none">
              <span>Bcc:</span>
              <input name="bcc" placeholder="bcc@kharismahub.com" aria-label="Blind carbon copy" />
            </div>
            <div class="compose-toolbar">
              <button type="button" data-action="undo-compose" aria-label="Undo">â†¶</button>
              <button type="button" data-action="redo-compose" aria-label="Redo">â†·</button>
              <span>Sans Serif âŒ„</span><span>Aa âŒ„</span>
              <button type="button" data-action="format-bold"><b>B</b></button>
              <button type="button" data-action="format-italic"><i>I</i></button>
              <button type="button" data-action="format-underline"><u>U</u></button>
              <span>â‰¡ âŒ„</span><span>â˜· âŒ„</span>
            </div>
            <div class="compose-body" contenteditable="true" role="textbox" aria-label="Message body" data-placeholder="Type something..."></div>
            <div class="compose-actions">
              <button class="send-button" type="submit">Send Message <span>âŒ„</span></button>
              <button type="button" data-action="save-draft">Save draft</button>
              <button type="button" data-action="delete-draft" aria-label="Discard draft"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
          </form>
        </section>
      </div>
      <footer class="inbox-footer">
        <strong>Copyright &copy; 2025 Kharisma Group</strong>
        <a href="#privacy">Privacy Policy</a>
        <a href="#terms">Term and conditions</a>
        <a href="#contact">Contact</a>
        <span></span>
        <span class="socials"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4l11.733 16h4.267l-11.733-16z"/><path d="M4 20l6.768-6.768m2.464-2.464L20 4"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg></span>
      </footer>
    `;
  }

  // 2. CALENDAR MODULE
  if (key === 'calendar') {
    const totalSchedules = calendarItems.length;
    const talentCount = calendarItems.filter(i => i.category === 'Talent Acquisition').length;
    const devCount = calendarItems.filter(i => i.category === 'Employee Development').length;
    const engageCount = calendarItems.filter(i => i.category === 'Workplace Engagement').length;

    return `
      <div class="calendar-stats">
        <article class="calendar-stat green"><i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></i><span>Total All Schedules</span><strong>${totalSchedules}</strong></article>
        <article class="calendar-stat white"><i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="10" r="7"/><path d="m21 21-4.35-4.35"/></svg></i><span>Talent Acquisition</span><strong>${talentCount}</strong></article>
        <article class="calendar-stat white"><i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/></svg></i><span>Employee Development</span><strong>${devCount}</strong></article>
        <article class="calendar-stat white"><i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></i><span>Workplace Engagement</span><strong>${engageCount}</strong></article>
      </div>
      <div class="calendar-workspace">
        <aside class="agenda-filters">
          <div class="agenda-head"><strong>Filter</strong><button data-action="collapse-agenda">Ã—</button></div>
          <h3>Agenda</h3>
          ${['Recruitment','Interview Schedules','Onboarding Session','Training Programs','Coaching Sessions','Performance Review','Company Events','Policies Deadlines','Leave Schedules'].map(x => `
            <label><input type="checkbox" checked />${x}</label>
          `).join('')}
          <h3>Category</h3>
          <p><i class="legend-dot talent"></i>Talent Acquisition</p>
          <p><i class="legend-dot development"></i>Employee Development</p>
          <p><i class="legend-dot engagement"></i>Workplace Engagement</p>
        </aside>
        <section class="calendar-board">
          <div class="calendar-board-head">
            <div class="calendar-nav-wrap">
              <button class="cal-nav-btn" data-action="prev-cal-month" title="Bulan Sebelumnya">â€¹</button>
              <button class="month-title" id="calendarBoardMonth">${new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate)} <span>âŒ„</span></button>
              <button class="cal-nav-btn" data-action="next-cal-month" title="Bulan Berikutnya">â€º</button>
            </div>
            <div>
              <button class="date-filter" data-action="calendar-filter">Filter <span>âŒ„</span></button>
              <button class="date-filter" data-action="calendar-mode">Month <span>âŒ„</span></button>
              <button class="module-button primary" data-action="new-event">+ New Agenda</button>
            </div>
          </div>
          <div class="calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x => `<span>${x}</span>`).join('')}</div>
          <div class="calendar-month-grid">${calendarDays}</div>
        </section>
        <aside class="schedule-details">
          <div class="agenda-head">
            <span><strong>Details Schedule</strong><small id="selectedScheduleDate">${selectedDate} ${new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate)}</small></span>
            <button data-action="close-schedule-details">Ã—</button>
          </div>
          <div id="calendarDetailsList">${getCalendarScheduleCards(selectedDate)}</div>
        </aside>
      </div>
    `;
  }

  // 3. EMPLOYEES TABLE MODULE
  if (key === 'employees') {
    return `
      <div class="employee-overview">
        <div class="employee-stat-grid">
          <article class="employee-stat highlight"><span>Total Employees</span><strong>${employeeData.length}</strong><small>+1.6% <em>from last month</em></small></article>
          <article class="employee-stat"><span>New Employees (This Month)</span><strong>7</strong><small>+5.8% <em>from last month</em></small></article>
          <article class="employee-stat"><span>Turnover Rate</span><strong>3.1%</strong><small>âˆ’2.4% <em>from last month</em></small></article>
          <article class="employee-stat"><span>Resigned Employees</span><strong>4</strong><small>+2.1% <em>from last month</em></small></article>
        </div>
        <section class="department-card">
          <div class="module-card-head"><h2>Departments</h2><button class="date-filter">This Month âŒ„</button></div>
          <div class="department-content">
            <div class="department-donut"><strong>8</strong><small>Departments</small></div>
            <div class="department-legend">
              <div><i class="dept-color c0"></i><span>Customer Service<small>26 â€” <b>20%</b></small></span></div>
              <div><i class="dept-color c1"></i><span>Product Design<small>20 â€” <b>16%</b></small></span></div>
              <div><i class="dept-color c2"></i><span>Operations<small>26 â€” <b>20%</b></small></span></div>
              <div><i class="dept-color c3"></i><span>R&amp;D<small>18 â€” <b>14%</b></small></span></div>
              <div><i class="dept-color c4"></i><span>Marketing<small>23 â€” <b>18%</b></small></span></div>
              <div><i class="dept-color c5"></i><span>Human Resources<small>15 â€” <b>12%</b></small></span></div>
            </div>
          </div>
        </section>
      </div>
      <section class="module-card employee-list-card">
        <div class="module-card-head">
          <h2>Employee List</h2>
          <div class="module-heading-actions">
            <label class="module-search">âŒ• <input data-filter="employees" placeholder="Search employee" /></label>
            <button class="date-filter" data-action="employee-filter">Filter <span>âŒ„</span></button>
            <span class="toolbar-note">Sort by:</span>
            <select class="module-select"><option>Name</option><option>Join Date</option><option>Department</option></select>
            <button class="module-button primary" data-action="add-employee-page">New Employee</button>
            <button class="module-button secondary view-grid-button" data-action="employee-grid-view" title="Tampilan Grid"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></button>
          </div>
        </div>
        <div class="module-table-wrap">
          <table class="module-table employees-table">
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all" /></th>
                <th>Employee ID â†•</th>
                <th>Name â†•</th>
                <th>Job Title â†•</th>
                <th>Department â†•</th>
                <th>Employment Type â†•</th>
                <th>Work Model â†•</th>
                <th>Join Date â†•</th>
                <th>Status â†•</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>${peopleRows}</tbody>
          </table>
        </div>
        <div class="pagination-row">
          <label>Show ${Math.min(employeePageSize, employeeData.length)} of ${employeeData.length} results</label>
          ${employeePagination}
        </div>
      </section>
    `;
  }

  // 4. EMPLOYEES GRID MODULE
  if (key === 'employee-grid') {
    return `
      <div class="employee-grid-toolbar">
        <label class="module-search">âŒ• <input data-filter="employees" placeholder="Search employee" /></label>
        <button class="date-filter" data-action="employee-filter"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Filter <span>âŒ„</span></button>
        <select><option>All Department</option><option>Marketing</option><option>Product Design</option><option>Operations</option><option>Human Resources</option></select>
        <select><option>All Position</option><option>Designer</option><option>Manager</option><option>Executive</option></select>
        <span></span><small>Sort by:</small>
        <select><option>Name</option><option>Join Date</option></select>
        <button class="module-button primary" data-action="add-employee-page">New Employee</button>
        <button class="module-button secondary" data-action="employee-table-view" title="Tampilan Tabel"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>
      </div>
      <div class="employee-cards">
        ${employeeData.map((p, i) => `
          <article class="employee-card">
            <button class="employee-card-main" data-action="view-employee" data-name="${safe(p[0])}">
              ${avatar(p[0], `p${i % 9 + 1}`)}
              <small>EMP-${getEmployeeId(p)}</small>
              <strong>${safe(p[0])}</strong>
            </button>
            <div>
              <small>Job Title</small><span>${safe(p[3])}</span>
              <small>Department</small><span>${safe(p[2])}</span>
            </div>
            <footer>
              <i>Full-Time</i>
              <i>${['Hybrid', 'Remote', 'On-Site'][i % 3]}</i>
              <span class="status ${p[4] === 'Absent' ? 'absent' : p[4] === 'On Leave' ? 'leave' : 'ontime'}">${safe(p[4])}</span>
              <div style="margin-left:auto;display:flex;gap:4px">
                <button class="btn-action-icon" data-action="edit-employee" data-name="${safe(p[0])}" title="Edit"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="btn-action-icon danger" data-action="delete-employee" data-name="${safe(p[0])}" title="Hapus"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
              </div>
            </footer>
          </article>
        `).join('')}
      </div>
      <div class="pagination-row">
        <label>Menampilkan ${employeeData.length} data karyawan</label>
      </div>
    `;
  }

  // 5. EMPLOYEE DETAILS MODULE
  if (key === 'employee-details') {
    return `
      <div class="employee-detail-layout">
        <div class="employee-detail-profile-column">
          <section class="employee-profile-card">
            <div class="employee-detail-photo">${avatar(profile.name, 'p' + ((profile.index % 9) + 1))}</div>
            <h2>${safe(profile.name)}</h2>
            <p>${safe(profile.title)} &middot; ${safe(profile.department)}</p>
            <div class="employee-profile-badges">
              <span class="employee-id-pill">${safe(profile.id)}</span>
              <span class="status ${profile.status === 'On Leave' ? 'leave' : 'ontime'}">${safe(profile.status)}</span>
            </div>
            <div class="profile-facts">
              <p><span>Employment Type</span><b>${safe(profile.employmentType)}</b></p>
              <p><span>Work Model</span><b>${safe(profile.workModel)}</b></p>
              <p><span>Join Date</span><b>${safe(profile.joinDate)}</b></p>
            </div>
            <div style="display:flex;gap:6px;margin:8px 0 4px">
              <button class="module-button primary" data-action="edit-employee" data-name="${safe(profile.name)}" style="flex:1">Edit Karyawan</button>
              <button class="module-button secondary" data-action="show-payslip" data-name="${safe(profile.name)}" title="Lihat Slip Gaji">Slip Gaji</button>
            </div>
            <div class="employee-social">
              <span>Social Media:</span>
              <a href="#linkedin" aria-label="LinkedIn">in</a>
              <a href="#x" aria-label="X">ð•</a>
              <a href="#instagram" aria-label="Instagram"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg></a>
            </div>
          </section>
          <section class="module-card employee-personal-card">
            <div class="module-card-head"><h2>Personal Info</h2><button class="kebab" aria-label="Personal info options">Â·Â·Â·</button></div>
            <div class="personal-info-list">
              <p><i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></i><span><small>Gender</small><b>${safe(profile.gender)}</b></span></p>
              <p><i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></i><span><small>Date of Birth</small><b>${safe(profile.birthDate)}</b></span></p>
              <p><i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></i><span><small>Email Address</small><b>${safe(profile.email)}</b></span></p>
              <p><i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></i><span><small>Phone</small><b>${safe(profile.phone)}</b></span></p>
              <p><i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></i><span><small>Address</small><b>${safe(profile.address)}</b></span></p>
            </div>
          </section>
        </div>
        <div class="employee-detail-main">
          <div class="leave-summary-cards">
            ${[['All Leaves',...profile.leave[0]],['Annual Leaves',...profile.leave[1]],['Casual Leaves',...profile.leave[2]],['Sick Leaves',...profile.leave[3]]].map((x, i) => `
              <article class="leave-summary-card ${i === 0 ? 'highlight' : ''}">
                <span>${x[0]}</span>
                <div class="employee-leave-ring" style="--leave-progress:${x[4]}%">
                  <strong>${x[1]}<small>/${x[2]}</small></strong>
                  <small>${x[3]}</small>
                </div>
              </article>
            `).join('')}
          </div>
          <section class="module-card employee-performance-detail">
            <div class="module-card-head"><h2>Performance Overview</h2><select><option>Last Year</option><option>This Year</option></select></div>
            <div class="detail-performance-score"><strong>${safe(profile.score)}</strong><span>â†— ${safe(profile.scoreChange)} Increased by last year</span></div>
            <div class="employee-performance-chart">
              <div class="detail-y-axis"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div>
              <div class="detail-chart-plot">
                <div class="detail-chart-grid"><i></i><i></i><i></i><i></i><i></i></div>
                <svg viewBox="0 0 500 110" preserveAspectRatio="none" aria-label="Employee performance over the year">
                  <path class="detail-chart-fill" d="M0 49 L42 48 L84 40 L126 41 L168 31 L210 34 L252 48 L294 43 L336 55 L378 48 L420 38 L462 37 L500 39 L500 110 L0 110 Z"/>
                  <path class="detail-chart-line" d="M0 49 L42 48 L84 40 L126 41 L168 31 L210 34 L252 48 L294 43 L336 55 L378 48 L420 38 L462 37 L500 39"/>
                  <line class="detail-chart-marker" x1="420" x2="420" y1="30" y2="108"/>
                  <circle class="detail-chart-point" cx="420" cy="38" r="4"/>
                </svg>
                <span class="detail-chart-tooltip">Sep 2035<strong>80.5%</strong></span>
                <div class="detail-months"><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span></div>
              </div>
            </div>
          </section>
          <div class="employee-detail-work-grid">
            <section class="module-card hours-logged-card">
              <div class="module-card-head"><h2>Hours Logged</h2><select><option>This Week</option><option>Last Week</option></select></div>
              <strong class="detail-hours-score">${safe(profile.hours)}</strong>
              <div class="logged-hours-chart">
                ${[80,66,43,86,57,84,84].map((height, i) => `
                  <div><small>${['8:00','7:30','4:00','8:30','5:00','8:00','8:00'][i]}</small><i style="height:${height}%"></i><span>${['M','T','W','T','F','S','S'][i]}</span></div>
                `).join('')}
              </div>
            </section>
            <section class="module-card employee-documents-card">
              <div class="module-card-head"><h2>Documents</h2><button class="kebab" aria-label="Document options">Â·Â·Â·</button></div>
              <div class="employee-document-list">
                ${[['Performance Evaluation.pdf','PDF Â· 1.24 MB'],['Contract Agreement.pdf','PDF Â· 895 KB'],['Curriculum Vitae.pdf','PDF Â· 1.27 MB'],['Portfolio.pdf','PDF Â· 3.68 MB']].map(([name,meta]) => `
                  <a href="#document" class="employee-document"><i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></i><span><b>${name}</b><small>${meta}</small></span></a>
                `).join('')}
              </div>
            </section>
          </div>
          <section class="module-card employee-notes-card">
            <div class="module-card-head"><h2>Internal Notes</h2><button class="kebab" aria-label="Note options">Â·Â·Â·</button></div>
            <div class="employee-notes-grid">
              <article><strong>Promotion Feedback</strong><small>10 January 2035</small><p>${safe(profile.name)} is building a strong record in ${safe(profile.department)} through consistent performance and team support.</p></article>
              <article><strong>Employee Appreciation</strong><small>02 May 2035</small><p>${safe(profile.name)} is recognized for contributing to team goals and sharing expertise with colleagues.</p></article>
            </div>
          </section>
        </div>
        <aside class="employee-detail-side">
          <section class="module-card employee-calendar-card">
            <div class="employee-mini-calendar-head"><strong>June 2035 âŒ„</strong><div><button aria-label="Previous month">â€¹</button><button aria-label="Next month">â€º</button></div></div>
            <div class="employee-mini-weekdays">${['S','M','T','W','T','F','S'].map((day) => `<span>${day}</span>`).join('')}</div>
            <div class="detail-calendar">
              ${Array.from({ length: 35 }, (_, i) => {
                const day = i - 5 + 1;
                const shown = day < 1 ? 31 + day : day > 30 ? day - 30 : day;
                const active = [4,5,6,7,8,10,11,12,13,14,17,18,19,20,21,22,25,26,27,28,29].includes(day);
                return `<span class="${day < 1 || day > 30 ? 'muted' : ''} ${day === 1 ? 'selected' : ''} ${active ? 'event-day' : ''}">${shown}</span>`;
              }).join('')}
            </div>
            <div class="employee-calendar-legend"><span><i></i>Present 13</span><span><i></i>Late 5</span><span><i></i>On Leave 2</span><span><i></i>Absent 1</span></div>
          </section>
          <section class="module-card employee-payroll-card">
            <div class="module-card-head">
              <h2>Payroll Summary</h2>
              <button class="date-filter" data-action="show-payslip" data-name="${safe(profile.name)}">Slip Gaji</button>
            </div>
            <div class="payroll-table-heading"><span>Description</span><span>Amount<small>Rp/bulan</small></span></div>
            <div class="payroll-detail-rows">
              <p class="group"><span>Base Salary</span><b>${safe(profile.salary)}</b></p>
              <p class="group"><span>Allowances</span><b>${safe(profile.allowance)}</b></p>
              <p><span>Transportation</span><b>${formatIDR(150)}</b></p>
              <p><span>Meal</span><b>${formatIDR(200)}</b></p>
              <p><span>Internet (Hybrid)</span><b>${formatIDR(80)}</b></p>
              <p class="group"><span>Benefits</span><b></b></p>
              <p><span>Health Insurance (BPJS)</span><b>${formatIDR(120)}</b></p>
              <p><span>Life Insurance</span><b>${formatIDR(40)}</b></p>
              <p class="total"><span>Total Monthly Value</span><b>${safe(profile.monthlyValue)}</b></p>
            </div>
          </section>
        </aside>
      </div>
    `;
  }

  // 6. ADD EMPLOYEE MULTI-STEP WIZARD
  if (key === 'employee-add') {
    return `
      <section class="employee-add-page">
        <div class="employee-add-heading">
          <div><span class="module-eyebrow">TEAM DIRECTORY</span><h2>Add New Employee</h2><p>Register a new employee and complete their profile details.</p></div>
          <button class="module-button primary" data-action="save-employee-draft">Save as Draft</button>
        </div>
        <form id="employeePageForm">
          <article class="employee-add-panel">
            <aside class="employee-add-rail">
              <strong>Register New Employee</strong><p>Complete each section to add a new employee to your team.</p>
              <ol><li class="active"><i>1</i><span>Personal Contact Information</span></li><li><i>2</i><span>Employment &amp; Payroll Details</span></li><li><i>3</i><span>Allowances, Benefits &amp; Documents</span></li></ol>
            </aside>
            <section class="employee-add-fields">
              <header><div><small>Step 1 of 3</small><h3>Personal &amp; Contact Information</h3><p>Enter personal details and ways to contact this employee.</p></div></header>
              <div class="employee-form-grid">
                <label>First Name<input name="firstName" required placeholder="Employee first name" /></label>
                <label>Last Name<input name="lastName" placeholder="Employee last name" /></label>
                <label>Date of Birth<input name="birth" type="text" placeholder="DD/MM/YYYY" /></label>
                <label>Gender<select name="gender"><option>Female</option><option>Male</option><option>Prefer not to say</option></select></label>
                <label class="wide-field">Work Email<input name="email" type="email" required placeholder="name@company.com" /></label>
                <label>Phone Number<input name="phone" type="tel" placeholder="+62 812 3456 7890" /></label>
                <label class="wide-field">Address<input name="address" placeholder="Street, city, province" /></label>
              </div>
              <footer>
                <button type="button" class="text-button" data-action="save-employee-draft">Save as Draft</button>
                <button type="reset" class="text-button">Reset</button>
                <button type="button" class="module-button primary" data-action="employee-next-panel">Next</button>
              </footer>
            </section>
          </article>
          <article class="employee-add-panel">
            <aside class="employee-add-rail">
              <strong>Register New Employee</strong><p>Add the employee's role, working arrangement and compensation.</p>
              <ol><li class="complete"><i>1</i><span>Personal Contact Information</span></li><li class="active"><i>2</i><span>Employment &amp; Payroll Details</span></li><li><i>3</i><span>Allowances, Benefits &amp; Documents</span></li></ol>
            </aside>
            <section class="employee-add-fields">
              <header><div><small>Step 2 of 3</small><h3>Employment &amp; Payroll Details</h3><p>Set up work details and payroll information for this employee.</p></div></header>
              <div class="employee-form-grid">
                <label>Employee ID<input name="employeeId" value="EMP-${String(1000 + employeeData.length).padStart(4, '0')}" /></label>
                <label>Join Date<input name="joiningDate" type="text" placeholder="19 Jun 2035" /></label>
                <label>Job Title<input name="title" placeholder="e.g. Senior Designer" required /></label>
                <label>Department<select name="department"><option>Product Design</option><option>Human Resources</option><option>Marketing</option><option>Operations</option><option>Finance</option><option>Engineering</option><option>Customer Service</option><option>R&amp;D</option></select></label>
                <label>Employment Type<select name="employmentType"><option>Full-Time</option><option>Part-Time</option><option>Contract</option><option>Internship</option></select></label>
                <label>Work Model<select name="workModel"><option>On-Site</option><option>Hybrid</option><option>Remote</option></select></label>
                <label>Basic Salary<input name="salary" placeholder="Rp3.500.000 / bulan" /></label>
              </div>
              <footer>
                <button type="button" class="text-button" data-action="save-employee-draft">Save as Draft</button>
                <button type="button" class="module-button secondary" data-action="employee-prev-panel">Previous</button>
                <button type="button" class="module-button primary" data-action="employee-next-panel">Next</button>
              </footer>
            </section>
          </article>
          <article class="employee-add-panel">
            <aside class="employee-add-rail">
              <strong>Register New Employee</strong><p>Complete compensation benefits and attach supporting documents.</p>
              <ol><li class="complete"><i>1</i><span>Personal Contact Information</span></li><li class="complete"><i>2</i><span>Employment &amp; Payroll Details</span></li><li class="active"><i>3</i><span>Allowances, Benefits &amp; Documents</span></li></ol>
            </aside>
            <section class="employee-add-fields">
              <header><div><small>Step 3 of 3</small><h3>Allowances, Benefits &amp; Documents</h3><p>Choose applicable benefits and attach employee documents.</p></div></header>
              <div class="employee-add-benefits">
                <div><h4>Allowances</h4><label><input type="checkbox" checked /> Transportation</label><label><input type="checkbox" checked /> Meal allowance</label><label><input type="checkbox" /> Internet</label></div>
                <div><h4>Benefits</h4><label><input type="checkbox" checked /> Health insurance</label><label><input type="checkbox" checked /> Life insurance</label><label><input type="checkbox" /> Company device</label></div>
              </div>
              <footer>
                <button type="button" class="module-button secondary" data-action="employee-prev-panel">Previous</button>
                <button type="submit" class="module-button primary">Save Employee</button>
              </footer>
            </section>
          </article>
        </form>
      </section>
    `;
  }

  // 7. ATTENDANCE MODULE
  if (key === 'attendance') {
    const liveTodayRecords = Array.isArray(cloudAttendanceRecords)
      ? cloudAttendanceRecords.filter(record => record.date === attendanceTodayKey())
      : (userAttendanceRecord?.dateKey === attendanceTodayKey() ? [userAttendanceRecord] : []);
    const livePresent = liveTodayRecords.length;
    const liveOnTime = liveTodayRecords?.filter(record => record.status === 'On-Time').length || 0;
    const liveLate = liveTodayRecords?.filter(record => record.status === 'Late').length || 0;
    const approvedLeaveCount = leaveRequests.filter(r => r.status === 'Approved').length;
    const scheduledEmployees = new Set((attendancePolicy.assignments || []).map(item => item.employee_id)).size;
    const liveAbsent = Math.max(0, scheduledEmployees - livePresent - approvedLeaveCount);
    const thisEmployee = employeeData.find(row => row[1]?.toLowerCase() === userProfile.email.toLowerCase()) || findEmployeeByName(userProfile.name);
    const thisEmployeeId = thisEmployee ? `EMP-${getEmployeeId(thisEmployee)}` : '';
    const thisAssignment = attendancePolicy.assignments?.find(item => item.employee_id === thisEmployeeId);
    const assignedShift = attendancePolicy.shifts?.find(item => item.id === (userAttendanceRecord?.shiftId || thisAssignment?.shift_id));
    const activeRecordToday = userAttendanceRecord && (userAttendanceRecord.dateKey === attendanceTodayKey() || isActiveOvernightAttendance(userAttendanceRecord));
    const transitionAction = !activeRecordToday ? 'clock_in'
      : userAttendanceRecord.state === 'on_break' ? 'break_end'
        : userAttendanceRecord.state === 'working' ? 'break_start'
          : userAttendanceRecord.state === 'completed' || userAttendanceRecord.clockOut ? null : 'clock_in';
    const transitionLabel = transitionAction === 'clock_in' ? 'Absen Masuk' : transitionAction === 'break_start' ? 'Mulai Istirahat' : transitionAction === 'break_end' ? 'Kembali Bekerja' : 'Presensi Selesai';
    const monthRecords = Array.isArray(cloudAttendanceRecords) ? cloudAttendanceRecords : [];
    const ownIncompleteRecords = authenticatedSupabaseSession ? monthRecords.filter(record => record.auth_user_id === authenticatedSupabaseSession.user.id && record.date < attendanceTodayKey() && record.state && record.state !== 'completed') : [];
    const localIncompleteRecords = authenticatedSupabaseSession ? [] : attendanceIncompleteHistory;
    const monthNames = new Intl.DateTimeFormat('id-ID', { month: 'short' });
    const chartMonths = Array.from({ length: 6 }, (_, offset) => { const d = new Date(); d.setMonth(d.getMonth() - 5 + offset, 1); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; const rows = monthRecords.filter(row => String(row.date || '').startsWith(key)); const onLeave = rows.filter(row => row.status === 'On Leave').length; const late = rows.filter(row => row.status === 'Late').length; return { label: monthNames.format(d), total: rows.length, onLeave, late, present: Math.max(0, rows.length - onLeave - late) }; });
    const chartMax = Math.max(1, ...chartMonths.map(item => item.total));
    return `
      <div class="attendance-overview-layout">
        <div class="attendance-status-cards">
          <article class="attendance-status present">
            <span class="status-card-label">Hadir Hari Ini</span>
            <strong class="status-card-val">${livePresent} <small>Karyawan</small></strong>
            <div class="status-card-trend"><b>${liveTodayRecords.length}</b> <span>catatan aktual</span></div>
            <footer class="status-card-footer"><span><b>${liveOnTime}</b> Tepat Waktu</span><span><b>${liveLate}</b> Terlambat</span></footer>
          </article>
          <article class="attendance-status leave">
            <span class="status-card-label">Sedang Cuti</span>
            <strong class="status-card-val">${approvedLeaveCount} <small>Karyawan</small></strong>
            <div class="status-card-trend"><b>${approvedLeaveCount}</b> <span>pengajuan disetujui</span></div>
            <footer class="status-card-footer"><span>Data dari pengajuan cuti</span></footer>
          </article>
          <article class="attendance-status absent">
            <span class="status-card-label">Belum Tercatat</span>
            <strong class="status-card-val">${liveAbsent} <small>Karyawan</small></strong>
            <div class="status-card-trend"><b>${liveAbsent}</b> <span>belum ada catatan hari ini</span></div>
            <footer class="status-card-footer"><span>Termasuk jadwal masuk hari ini</span></footer>
          </article>
        </div>
        <section class="module-card attendance-chart-card">
          <div class="module-card-head">
            <h2>Rekap Kehadiran 6 Bulan</h2>
            <span class="toolbar-note">Berdasarkan catatan tersimpan</span>
          </div>
          <div class="attendance-chart-content">
            ${monthRecords.length ? '' : '<p class="dialog-desc">Belum ada catatan kehadiran untuk rentang ini.</p>'}
            <div class="attendance-chart-legend">
              <span><i class="legend-circle pres-dot"></i>Hadir</span>
              <span><i class="legend-circle leave-dot"></i>Cuti</span>
              <span><i class="legend-circle abs-dot"></i>Terlambat</span>
            </div>
            <div class="attendance-chart-wrap">
              <div class="attendance-y-axis">
                <span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span>
              </div>
              <div class="attendance-bars-container">
                ${chartMonths.map(({ label, total, onLeave, late, present }) => {
                  const scale = total ? 100 / chartMax : 0; const pres = present * scale, lv = onLeave * scale, abs = late * scale;
                  return `
                  <div class="attendance-bar-col">
                    <div class="bar-track">
                      <span class="bar-fill abs-fill" style="height:${abs}%" title="${label}: ${late} terlambat"></span>
                      <span class="bar-fill leave-fill" style="height:${lv}%" title="${label}: ${onLeave} cuti"></span>
                      <span class="bar-fill pres-fill" style="height:${pres}%" title="${label}: ${present} hadir"></span>
                    </div>
                    <span class="bar-col-label">${label}</span>
                  </div>
                `; }).join('')}
              </div>
            </div>
          </div>
        </section>
      </div>
      <section class="module-card attendance-self-service">
        <div class="module-card-head"><div><h2>Presensi Saya</h2><p class="dialog-desc">${assignedShift ? `Shift ${safe(assignedShift.name)} Â· ${String(assignedShift.start_time).slice(0,5)}â€“${String(assignedShift.end_time).slice(0,5)}` : 'Shift belum ditetapkan'} Â· ${attendanceDisplayState()}</p></div>
          ${transitionAction ? `<button class="module-button primary" data-action="attendance-transition" data-transition="${transitionAction}">${transitionLabel}</button>` : `<span class="status ontime">Hari ini selesai</span>`}${activeRecordToday && userAttendanceRecord.state === 'working' ? `<button class="module-button secondary" data-action="attendance-transition" data-transition="clock_out">Presensi Pulang</button>` : ''}</div>
        <div class="attendance-timeline"><span>Masuk <b>${safe(userAttendanceRecord?.clockIn || 'â€”')}</b></span>${(userAttendanceRecord?.breakSessions || []).map((item,index)=>`<span>Istirahat ${index+1} <b>${attendanceTimeLabel(item.start)}â€“${item.end ? attendanceTimeLabel(item.end) : 'berlangsung'}</b></span>`).join('')}<span>Pulang <b>${safe(userAttendanceRecord?.clockOut || 'â€”')}</b></span><span>Durasi bersih <b>${safe(userAttendanceRecord?.duration || 'â€”')}</b></span><span>Lokasi <b>${userAttendanceRecord?.location?.verified ? `Terverifikasi Â· ${Math.round(userAttendanceRecord.location.distance)} m dari kantor` : 'Akan diperiksa saat absen'}</b></span>${userAttendanceRecord?.overtimeApprovalStatus === 'pending' ? '<span>Lembur <b>Menunggu persetujuan atasan</b></span>' : ''}${attendanceSyncQueue.length ? `<span>Antrean sinkronisasi <b>${attendanceSyncQueue.length} aksi menunggu validasi</b></span>` : ''}</div>
        ${userAttendanceRecord?.id ? `<details class="attendance-correction"><summary>Ajukan koreksi catatan</summary><form data-attendance-correction><label>Jam masuk yang benar<input type="time" name="clockIn" value="${safe(String(userAttendanceRecord.clockIn || '').slice(0,5))}" /></label><label>Jam pulang yang benar<input type="time" name="clockOut" value="${safe(String(userAttendanceRecord.clockOut || '').slice(0,5))}" /></label><label>Alasan koreksi<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><button class="module-button secondary" type="submit">Kirim untuk Persetujuan</button></form></details>` : ''}
        ${ownIncompleteRecords.map(record=>`<details class="attendance-correction"><summary>Lengkapi presensi ${safe(record.date)} Â· belum pulang</summary><form data-attendance-correction data-attendance-id="${safe(record.id)}"><label>Jam masuk yang benar<input type="time" name="clockIn" value="${safe(String(record.clock_in || '').slice(0,5))}" /></label><label>Jam pulang yang benar<input type="time" name="clockOut" required /></label><label>Alasan koreksi<textarea name="reason" minlength="5" maxlength="1000" required></textarea></label><button class="module-button secondary" type="submit">Ajukan Koreksi</button></form></details>`).join('')}
        ${localIncompleteRecords.map(record=>`<p class="dialog-desc attendance-incomplete-note">Presensi demo ${safe(record.date || record.dateKey)} belum lengkap. Lengkapi catatan atau ajukan koreksi setelah akun terhubung ke Supabase.</p>`).join('')}
      </section>
      ${isAdmin() ? `<details class="module-card attendance-policy-admin"><summary>Pengaturan Lokasi, Shift, dan Penugasan</summary><form data-attendance-config><div class="dialog-two"><label>Lintang kantor<input type="number" step="any" name="latitude" value="${safe(attendancePolicy.location?.latitude ?? '')}" required /></label><label>Bujur kantor<input type="number" step="any" name="longitude" value="${safe(attendancePolicy.location?.longitude ?? '')}" required /></label></div><div class="dialog-two"><label>Radius kantor (meter)<input type="number" name="radius" min="20" max="5000" value="${safe(attendancePolicy.location?.radius_m || attendancePolicy.location?.radiusM || 150)}" required /></label><label>Nama shift<input name="shiftName" value="${safe(assignedShift?.name || attendancePolicy.shifts?.[0]?.name || 'Shift Pagi')}" required /></label></div><div class="dialog-two"><label>Mulai shift<input type="time" name="startTime" value="${safe(String(assignedShift?.start_time || attendancePolicy.shifts?.[0]?.start_time || '09:00').slice(0,5))}" required /></label><label>Selesai shift<input type="time" name="endTime" value="${safe(String(assignedShift?.end_time || attendancePolicy.shifts?.[0]?.end_time || '17:00').slice(0,5))}" required /></label></div><div class="dialog-two"><label>Toleransi terlambat (menit)<input type="number" name="tolerance" min="0" max="240" value="${safe(assignedShift?.tolerance_minutes || 15)}" /></label><label>Tetapkan shift kepada karyawan<select name="employeeId" required>${employeeData.map(person=>`<option value="EMP-${getEmployeeId(person)}">${safe(person[0])} Â· ${safe(person[2])}</option>`).join('')}</select></label></div><button class="module-button primary" type="submit">Simpan Kebijakan</button><small>Perubahan lokasi dan shift hanya tersimpan di Supabase saat terhubung. Atasan dapat menetapkan shift untuk karyawan di departemennya.</small></form></details>` : ''}
      ${userProfile.role === 'Supervisor' ? `<details class="module-card attendance-policy-admin"><summary>Tetapkan Shift Tim</summary><form data-attendance-assignment><label>Karyawan<select name="employeeId" required><option value="__department__">Seluruh tim ? ${safe(userProfile.department)}</option>${employeeData.filter(person=>person[2]===userProfile.department).map(person=>`<option value="EMP-${getEmployeeId(person)}">${safe(person[0])}</option>`).join('')}</select></label><label>Shift<select name="shiftId" required>${(attendancePolicy.shifts||[]).map(shift=>`<option value="${safe(shift.id)}">${safe(shift.name)} ? ${safe(String(shift.start_time).slice(0,5))}?${safe(String(shift.end_time).slice(0,5))}</option>`).join('')}</select></label><button class="module-button primary" type="submit">Simpan Penugasan</button></form></details>` : ''}
      ${(isAdmin() || userProfile.role === 'Supervisor') ? `<section class="module-card attendance-review-panel"><div class="module-card-head"><h2>Persetujuan Absensi</h2><span class="toolbar-note">${attendanceReviewQueue.corrections.length} koreksi Â· ${attendanceReviewQueue.overtime.length} lembur</span></div>${attendanceReviewQueue.corrections.map(request=>`<article class="attendance-review-item"><span><strong>${safe(request.attendance_records?.employee_name || 'Karyawan')}</strong><small>Koreksi: ${safe(JSON.stringify(request.requested_values || {}))} Â· ${safe(request.reason)}</small></span><button class="module-button secondary" data-action="attendance-review-correction" data-id="${safe(request.id)}" data-decision="rejected">Tolak</button><button class="module-button primary" data-action="attendance-review-correction" data-id="${safe(request.id)}" data-decision="approved">Setujui</button></article>`).join('')}${attendanceReviewQueue.overtime.map(record=>`<article class="attendance-review-item"><span><strong>${safe(record.employee_name)} Â· ${safe(record.date)}</strong><small>Lembur ${safe(record.overtime)}</small></span><button class="module-button secondary" data-action="attendance-review-overtime" data-id="${safe(record.id)}" data-decision="false">Tolak</button><button class="module-button primary" data-action="attendance-review-overtime" data-id="${safe(record.id)}" data-decision="true">Setujui</button></article>`).join('')}${!attendanceReviewQueue.corrections.length && !attendanceReviewQueue.overtime.length ? '<p class="dialog-desc">Tidak ada koreksi atau lembur yang menunggu persetujuan.</p>' : ''}</section>` : ''}
      ${section('Daftar Kehadiran', `
        <div class="module-toolbar">
          <label class="module-search">âŒ• <input data-filter="attendance" placeholder="Cari karyawan" /></label>
          <div class="filter-dropdown-wrap">
            <button class="date-filter" data-action="attendance-filter" id="attendanceFilterBtn">${moduleView?.dataset?.attFilter || 'Semua Status'} <span>âŒ„</span></button>
            <div class="filter-dropdown-menu" id="attendanceFilterDropdown" style="display:none">
              <button type="button" class="filter-opt-btn" data-action="set-att-filter" data-status="Semua Status">Semua Status</button>
              <button type="button" class="filter-opt-btn" data-action="set-att-filter" data-status="Tepat Waktu">Tepat Waktu</button>
              <button type="button" class="filter-opt-btn" data-action="set-att-filter" data-status="Terlambat">Terlambat</button>
              <button type="button" class="filter-opt-btn" data-action="set-att-filter" data-status="Cuti">Cuti</button>
              <button type="button" class="filter-opt-btn" data-action="set-att-filter" data-status="Tidak Hadir">Tidak Hadir</button>
            </div>
          </div>
          <span class="toolbar-note">Sort by:</span>
          <select id="attendanceSortSelect"><option value="0">Nama</option><option value="1">Jabatan</option><option value="4">Masuk - Pulang</option><option value="7">Status</option></select>
          <div class="module-toolbar-actions" style="margin-left:auto; display:flex; gap:8px;">
            <button class="module-button secondary" data-action="export-attendance">Unduh Laporan</button>
          </div>
        </div>
        <div class="module-table-wrap">
          <table class="module-table attendance-full-table">
            <thead>
              <tr>
                <th class="sortable" data-col="0">Nama â†•</th>
                <th class="sortable" data-col="1">Jabatan â†•</th>
                <th class="sortable" data-col="2">Tanggal â†•</th>
                <th class="sortable" data-col="3">Model Kerja â†•</th>
                <th class="sortable" data-col="4">Masuk - Pulang â†•</th>
                <th class="sortable" data-col="5">Durasi Bersih â†•</th>
                <th class="sortable" data-col="6">Lembur â†•</th>
                <th class="sortable" data-col="7">Status â†•</th>
              </tr>
            </thead>
            <tbody>${attendanceRows}</tbody>
          </table>
        </div>
        <div class="pagination-row">
          <label>Show <select><option>10</option></select> of ${allAttendanceItems.length} results</label>
          <div><button>â€¹</button><button class="page-current">1</button><button>2</button><button>â€º</button></div>
        </div>
      `)}
    `;
  }

  // 8. PERFORMANCE MODULE
  if (key === 'performance') {
    return `
      <div class="performance-top-grid">
        ${section('Team Performance', `<div class="team-bars">${['Jan','Feb','Mar','Apr','May','Jun'].map((m, i) => `<span><b>${78 + i * 2}%</b><i style="height:${65 + i * 4}%"></i><small>${m}</small></span>`).join('')}</div>`)}
        ${section('Performance by Category', `<div class="category-bars">${[['Team Work','90%'],['Work Quality','86%'],['Problem-Solving','82%'],['Time Management','76%']].map(([name, val]) => `<div><span>${name}<b>4.5/5 â€” ${val}</b></span><i></i></div>`).join('')}</div>`)}
        ${section('Average Performance', '<div class="performance-gauge"><strong>87.5%</strong><small>Total Score</small><b>â†— +3.8%</b></div>')}
      </div>
      <div class="performance-lower-grid">
        ${section('Employee Performance', `
          <div class="module-toolbar">
            <select><option>This Month</option><option>Last Month</option></select>
            <button class="module-button primary" data-action="create-review" style="margin-left:auto">ï¼‹ New Review Cycle</button>
          </div>
          <div class="module-table-wrap">
            <table class="module-table">
              <thead><tr><th>Name</th><th>Job Title</th><th>Teamwork</th><th>Work Quality</th><th>Problem Solving</th><th>Time Management</th><th>Score</th></tr></thead>
              <tbody>${performanceRows}</tbody>
            </table>
          </div>
        `)}
        ${reviewCycleData.length ? section('Periode Penilaian', `<div class="performer-list">${reviewCycleData.map(cycle => `<p><span><strong>${safe(cycle.name)}</strong><small>${safe(cycle.type)} Â· Dibuat ${safe(cycle.createdAt)}</small></span><b>${safe(cycle.status)}</b></p>`).join('')}</div>`) : ''}
        <aside>
          ${section('Top Performers', `<div class="performer-list">${employeeData.slice(0, 5).map((p, i) => `<p>${avatar(p[0], `p${i + 1}`)}<span><strong>${p[0]}</strong><small>${p[3]}</small></span><b>${92 - i}/100</b></p>`).join('')}</div>`)}
          ${section('Time Management Alerts', `<div class="performer-list">${employeeData.slice(2, 5).map((p) => `<p>${avatar(p[0], 'p3')}<span><strong>${p[0]}</strong><small>Low on-time rate for deliverables this month.</small></span></p>`).join('')}</div>`)}
        </aside>
      </div>
    `;
  }

  // 9. PAYROLL MODULE
  if (key === 'payroll') {
    return `
      <div class="payroll-stats">
        <article><span>Total Salary</span><strong>${formatIDR(352000)}</strong><small>+5.4% from May</small></article>
        <article><span>Total Allowances</span><strong>${formatIDR(15000)}</strong><small>+3.6% from May</small></article>
        <article><span>Total Overtime</span><strong>${formatIDR(4800)}</strong><small>+2.3% from May</small></article>
        <article><span>Total Incentives</span><strong>${formatIDR(6500)}</strong><small>+4.9% from May</small></article>
      </div>
      <div class="payroll-chart-grid">
        ${section('Payroll Overview', `
          <div class="payroll-lines">
            <i></i><i></i><i></i><i></i>
            <svg viewBox="0 0 600 140" preserveAspectRatio="none">
              <path d="M0 80 C60 40 90 80 140 60 S210 80 260 45 S320 60 370 55 S440 20 500 32 S550 15 600 23"/>
              <path d="M0 110 C70 90 100 120 160 105 S240 112 300 100 S400 125 470 98 S540 120 600 105"/>
            </svg>
          </div>
          <div class="chart-month-labels">Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec</div>
        `)}
        ${section('Payroll Breakdown', `
          <strong class="payroll-breakdown-total">${formatIDR(378300)} <small>Total Pay This Month</small></strong>
          <div class="payroll-breakdown-bar"></div>
          <div class="payroll-legend">
            <span>Salary Â· 89.0%<small>${formatIDR(352000)}</small></span>
            <span>Allowances Â· 3.8%<small>${formatIDR(15000)}</small></span>
            <span>Deductions Â· 4.0%<small>${formatIDR(16200)}</small></span>
            <span>Incentives Â· 2.0%<small>${formatIDR(7900)}</small></span>
            <span>Overtime Â· 1.2%<small>${formatIDR(4800)}</small></span>
          </div>
        `)}
      </div>
      ${section('Payroll List', `
        <div class="module-toolbar">
          <label class="module-search">âŒ• <input data-filter="payroll" placeholder="Search employee, ID, etc" /></label>
          <button class="date-filter" data-action="payroll-filter">Filter <span>âŒ„</span></button>
          <div class="module-toolbar-actions" style="margin-left:auto; display:flex; gap:8px;">
            <button class="module-button primary" data-action="new-payrun">ï¼‹ New Pay Run</button>
            <button class="module-button secondary" data-action="export-payroll">â‡© Export report</button>
          </div>
        </div>
        <div class="module-table-wrap">
          <table class="module-table payroll-table">
            <thead>
              <tr>
                <th>Name</th><th>Job Title</th><th>Date</th><th>Salary</th><th>Allowances</th><th>Overtime</th><th>Incentive</th><th>Deduction</th><th>Total</th><th>Status</th><th>Payslip</th>
              </tr>
            </thead>
            <tbody>
              ${employeeData.map((p, i) => `
                <tr>
                  <td>
                    <button class="employee-link" data-action="view-employee" data-name="${safe(p[0])}">
                      ${avatar(p[0], `p${i % 9 + 1}`)}
                      <span><strong>${safe(p[0])}</strong><small>EMP-${getEmployeeId(p)}</small></span>
                    </button>
                  </td>
                  <td>${safe(p[3])}</td>
                  <td>28 Jun 35</td>
                  <td>${formatIDR(3200 - (i % 6) * 110)}</td>
                  <td>${formatIDR(300 - (i % 5) * 10)}</td>
                  <td>${formatIDR(80)}</td>
                  <td>${formatIDR(150)}</td>
                  <td>${formatIDR(120)}</td>
                  <td><b>${formatIDR(3590 - (i % 6) * 95)}</b></td>
                  <td><span class="status ontime">Paid</span></td>
                  <td><button class="module-button secondary" data-action="show-payslip" data-name="${safe(p[0])}">Slip Gaji</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="pagination-row">
          <label>Menampilkan ${employeeData.length} data penggajian</label>
        </div>
      `)}
      ${payRunData.length ? section('Riwayat Persiapan Gaji', `<div class="performer-list">${payRunData.map(run => `<p><span><strong>${safe(run.period)}</strong><small>Tanggal pembayaran ${safe(run.paymentDate)} Â· ${run.employeeCount} karyawan Â· Total ${formatIDR(run.total)}</small></span><b>${safe(run.status)}</b></p>`).join('')}</div>`) : ''}
    `;
  }

  // 10. LEAVE MANAGEMENT MODULE
  if (key === 'leave') {
    const totalApproved = leaveRequests.filter(r => r.status === 'Approved').length;
    const totalPending = leaveRequests.filter(r => r.status === 'Pending').length;
    const totalRejected = leaveRequests.filter(r => r.status === 'Rejected').length;

    return `
      <div class="leave-stats">
        <article class="highlight"><span>Total On Leave (Today)</span><strong>${totalApproved} <small>Employees</small></strong><em>Aktif disetujui</em></article>
        <article><span>Menunggu Persetujuan</span><strong>${totalPending} <small>Permintaan</small></strong><em>Perlu ditinjau</em></article>
        <article><span>Ditolak</span><strong>${totalRejected} <small>Permintaan</small></strong><em>Bulan ini</em></article>
        <article><span>Total Pengajuan</span><strong>${leaveRequests.length} <small>Pengajuan</small></strong><em>Terekam di sistem</em></article>
      </div>
      ${section('Leave Activity & Approval', `
        <div class="module-toolbar">
          <label class="module-search">âŒ• <input data-filter="leave" placeholder="Search employee, reason, etc" /></label>
          <button class="date-filter" data-action="leave-filter">Filter <span>âŒ„</span></button>
          <div class="module-toolbar-actions" style="margin-left:auto; display:flex; gap:8px;">
            <button class="module-button primary" data-action="request-leave">ï¼‹ Request Leave</button>
          </div>
        </div>
        <div class="module-table-wrap">
          <table class="module-table leave-table">
            <thead>
              <tr><th></th><th>Name</th><th>Job Title</th><th>Type</th><th>Submit Date</th><th>Period</th><th>Duration</th><th>Reason</th><th>Status &amp; Action</th></tr>
            </thead>
            <tbody>
              ${leaveRequests.map((req) => `
                <tr data-leave-id="${req.id}">
                  <td><input type="checkbox" /></td>
                  <td>
                    <button class="employee-link" data-action="view-employee" data-name="${safe(req.name)}">
                      ${avatar(req.name, 'p2')}<strong>${safe(req.name)}</strong>
                    </button>
                  </td>
                  <td>${safe(req.title)}</td>
                  <td>${safe(req.type)}</td>
                  <td>${safe(req.submitDate)}</td>
                  <td>${safe(req.period)}</td>
                  <td>${safe(req.duration)}</td>
                  <td>${safe(req.reason)}</td>
                  <td>
                    ${req.status === 'Pending' ? `
                      <span class="request-actions">
                        <button data-action="approve-request" data-id="${req.id}" title="Setujui Cuti">Setujui</button>
                        <button data-action="decline-request" data-id="${req.id}" title="Tolak Cuti">Tolak</button>
                      </span>
                    ` : `
                      <span class="status ${req.status === 'Approved' ? 'ontime' : 'absent'}">${safe(req.status)}</span>
                    `}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `)}
    `;
  }

  // 11. RECRUITMENT MODULE
  if (key === 'recruitment') {
    const totalApplicants = applicantsData.length;
    const interviewed = applicantsData.filter(a => a.stage === 'Interview Scheduled' || a.stage === 'Final Interview').length;
    const hired = applicantsData.filter(a => a.stage === 'Hired').length;

    return `
      <div class="recruitment-workspace">
        <div class="recruitment-main">
          <div class="recruitment-top-row">
            <div class="recruitment-summary">
              <article class="applicant-total">
                <i class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="18" height="18" x="3" y="3" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg></i>
                <div class="applicant-total-bottom">
                  <strong>${totalApplicants} <small class="trend-badge">+8.2%</small></strong>
                  <span>Total Applicants</span>
                  <small class="muted-note">vs last month</small>
                </div>
              </article>
              <div class="recruitment-stat-stack">
                <article class="stat-mini-card">
                  <div class="stat-mini-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
                  <div class="stat-mini-text">
                    <span>Interviewed</span>
                    <strong>${interviewed}</strong>
                  </div>
                  <span class="stat-badge">28.8% of applicants</span>
                </article>
                <article class="stat-mini-card">
                  <div class="stat-mini-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></div>
                  <div class="stat-mini-text">
                    <span>Hired</span>
                    <strong>${hired}</strong>
                  </div>
                  <span class="stat-badge">8.2% of applicants</span>
                </article>
              </div>
            </div>

            <section class="module-card recruitment-chart-card">
              <div class="module-card-head">
                <h2>Application</h2>
                <button class="date-filter">Last 6 Months âŒ„</button>
              </div>
              <div class="application-trend-wrap">
                <div class="trend-y-axis">
                  <span>200</span><span>150</span><span>100</span><span>50</span><span>0</span>
                </div>
                <div class="trend-plot">
                  <svg viewBox="0 0 300 110" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="recruitmentTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#0962ea" stop-opacity="0.25"/>
                        <stop offset="100%" stop-color="#0962ea" stop-opacity="0.0"/>
                      </linearGradient>
                    </defs>
                    <path class="trend-fill" fill="url(#recruitmentTrendFill)" d="M0 65 Q40 68 75 52 T150 28 T225 45 T300 32 L300 110 L0 110 Z"/>
                    <path class="trend-stroke" fill="none" stroke="#0962ea" stroke-width="2.5" d="M0 65 Q40 68 75 52 T150 28 T225 45 T300 32"/>
                    <circle cx="75" cy="52" r="3.5" fill="#0962ea" stroke="#fff" stroke-width="1.5"/>
                    <circle cx="150" cy="28" r="3.5" fill="#0962ea" stroke="#fff" stroke-width="1.5"/>
                    <circle cx="225" cy="45" r="3.5" fill="#0962ea" stroke="#fff" stroke-width="1.5"/>
                    <circle cx="300" cy="32" r="3.5" fill="#0962ea" stroke="#fff" stroke-width="1.5"/>
                  </svg>
                  <div class="chart-month-labels">
                    <span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div class="recruitment-mid-row">
            <section class="module-card vacancies-card">
              <div class="module-card-head">
                <h2>Current Vacancies</h2>
                <button class="date-filter">Filter âŒ„</button>
              </div>
              <div class="vacancy-grid">
                <article class="vacancy-box">
                  <strong>UI Designer</strong>
                  <div class="vacancy-meta">
                    <span>Full-Time</span>
                    <span>Remote</span>
                    <span>18 Pelamar</span>
                  </div>
                </article>
                <article class="vacancy-box">
                  <strong>Sales Manager</strong>
                  <div class="vacancy-meta">
                    <span>Full-Time</span>
                    <span>On-Site</span>
                    <span>15 Pelamar</span>
                  </div>
                </article>
                <article class="vacancy-box">
                  <strong>HR Assistant</strong>
                  <div class="vacancy-meta">
                    <span>Internship</span>
                    <span>On-Site</span>
                    <span>10 Pelamar</span>
                  </div>
                </article>
                <article class="vacancy-box">
                  <strong>Data Analyst</strong>
                  <div class="vacancy-meta">
                    <span>Full-Time</span>
                    <span>Hybrid</span>
                    <span>22 Pelamar</span>
                  </div>
                </article>
              </div>
            </section>

            <section class="module-card department-app-card">
              <div class="module-card-head">
                <h2>Application by Department</h2>
                <button class="kebab">Â·Â·Â·</button>
              </div>
              <div class="department-bars">
                ${[['Human Resources',19],['Marketing',27],['Product Design',31],['R&D',22],['Operations',28],['Customer Service',19]].map(([n,v], idx) => `
                  <span>
                    <b>${v}</b>
                    <i style="height:${v * 2.4}px" class="${idx === 4 ? 'dark-bar' : ''}"></i>
                    <small>${n}</small>
                  </span>
                `).join('')}
              </div>
            </section>
          </div>

          <section class="module-card applicants-card">
            <div class="module-card-head">
              <h2>Applicants</h2>
              <div class="applicant-tabs">
                ${['All','Application Received','Interview Scheduled','Final Interview','Test Completed','Hired'].map((x, i) => `
                  <button class="${i === 0 ? 'active' : ''}" data-stage="${x}">${x}</button>
                `).join('')}
              </div>
            </div>
            <div class="module-toolbar">
              <label class="module-search">âŒ• <input data-filter="recruitment" placeholder="Search applicant" /></label>
              <button class="module-button primary" data-action="add-candidate">ï¼‹ Add Applicant</button>
            </div>
            <div class="module-table-wrap">
              <table class="module-table applicants-table">
                <thead>
                  <tr><th>Name</th><th>Job Title</th><th>Applied Date</th><th>Work Model</th><th>Status (Stage)</th><th>Aksi</th></tr>
                </thead>
                <tbody>
                  ${applicantsData.map((cand, i) => {
                    const deptMap = {
                      'UI Designer': 'Product Design',
                      'Sales Manager': 'Operations',
                      'Data Analyst': 'R&D',
                      'Customer Support': 'Customer Service',
                      'HR Assistant': 'Human Resources',
                      'Full-stack Engineer': 'Technology',
                      'Desainer UI': 'Product Design',
                      'Sales Manajer': 'Operations',
                      'Analis Data': 'R&D',
                      'Asisten SDM': 'Human Resources'
                    };
                    const parts = (cand.type || '').split(' ');
                    const workType = parts[0] || 'Full-Time';
                    const workMode = parts.slice(1).join(' ');
                    return `
                    <tr data-app-stage="${safe(cand.stage)}">
                      <td>
                        <div style="display:flex;align-items:center;gap:10px;">
                          ${avatar(cand.name, `p${i + 1}`)}
                          <div>
                            <strong style="display:block;font-size:13.5px;color:#0f172a;">${safe(cand.name)}</strong>
                            <small style="display:block;color:#64748b;font-size:12px;margin-top:1px;">${safe(cand.email)}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong style="display:block;font-size:13.5px;color:#0f172a;">${safe(cand.position)}</strong>
                        <small style="display:block;color:#64748b;font-size:12px;margin-top:1px;">${deptMap[cand.position] || 'Divisi Terkait'}</small>
                      </td>
                      <td><span style="color:#475569;font-size:13px;">${safe(cand.appliedDate)}</span></td>
                      <td>
                        <div style="display:flex;align-items:center;gap:6px;">
                          <span style="color:#334155;font-weight:500;font-size:13px;">${workType}</span>
                          ${workMode ? `<span class="work-mode-pill">${workMode}</span>` : ''}
                        </div>
                      </td>
                      <td>
                        <div style="display:flex;flex-direction:column;gap:4px;">
                          <span class="status ontime" style="width:fit-content;">${safe(cand.stage)}</span>
                          <div class="stage-steps-mini">
                            <i class="done">1</i><i class="${cand.stage !== 'Application Received' ? 'done' : ''}">2</i><i class="${cand.stage === 'Final Interview' || cand.stage === 'Hired' ? 'done' : ''}">3</i><i class="${cand.stage === 'Hired' ? 'done' : ''}">4</i>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div class="row-actions-group">
                          <button class="btn-action-icon" data-action="advance-candidate-stage" data-id="${cand.id}" title="Lanjutkan Tahap"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>
                          <button class="btn-action-icon danger" data-action="delete-candidate" data-id="${cand.id}" title="Hapus Pelamar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                        </div>
                      </td>
                    </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside class="recruitment-side">
          <section class="module-card">
            <div class="module-card-head">
              <h2>Applicant Resources</h2>
              <button class="kebab">Â·Â·Â·</button>
            </div>
            <div class="resource-bars">
              <div class="resource-row">
                <div class="resource-label"><span>Job Portal</span><b>57.5% <i>84</i></b></div>
                <div class="resource-track"><span style="width:57.5%"></span></div>
              </div>
              <div class="resource-row">
                <div class="resource-label"><span>Company Website</span><b>20.5% <i>30</i></b></div>
                <div class="resource-track"><span style="width:20.5%"></span></div>
              </div>
              <div class="resource-row">
                <div class="resource-label"><span>Employee Referral</span><b>15.1% <i>22</i></b></div>
                <div class="resource-track"><span style="width:15.1%"></span></div>
              </div>
              <div class="resource-row">
                <div class="resource-label"><span>Social Media (LinkedIn)</span><b>6.9% <i>10</i></b></div>
                <div class="resource-track"><span style="width:6.9%"></span></div>
              </div>
              <div class="resource-scale">
                <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
              </div>
            </div>
          </section>

          <section class="module-card">
            <div class="module-card-head">
              <h2>Schedules</h2>
              <button class="kebab">Â·Â·Â·</button>
            </div>
            <div class="mini-schedule-box">
              <div class="mini-schedule-head">
                <button class="cal-nav-btn">â€¹</button>
                <strong>June 2035</strong>
                <button class="cal-nav-btn">â€º</button>
              </div>
              <div class="mini-weekdays-row">
                <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
              </div>
              <div class="mini-days-row">
                <span>17</span><span>18</span><span>19</span><span class="active-day">20</span><span>21</span><span>22</span><span>23</span>
              </div>
            </div>

            <div class="recruitment-events">
              <article class="rec-event-item">
                <div class="event-indicator dot-blue"></div>
                <div class="event-info">
                  <small>09:45 AM</small>
                  <strong>Online Test Review</strong>
                  <span>Lala Wijaya â€¢ Data Analyst</span>
                </div>
              </article>
              <article class="rec-event-item">
                <div class="event-indicator dot-blue"></div>
                <div class="event-info">
                  <small>01:00 PM</small>
                  <strong>First Interview</strong>
                  <span>William Hartono â€¢ UI Designer</span>
                </div>
              </article>
              <article class="rec-event-item">
                <div class="event-indicator dot-navy"></div>
                <div class="event-info">
                  <small>02:30 PM</small>
                  <strong>HR Interview</strong>
                  <span>Arifin Maulana â€¢ Customer Support</span>
                </div>
              </article>
              <article class="rec-event-item">
                <div class="event-indicator dot-blue"></div>
                <div class="event-info">
                  <small>03:10 PM</small>
                  <strong>Final Interview</strong>
                  <span>Fanny Rizal â€¢ Sales Manager</span>
                </div>
              </article>
            </div>
          </section>
        </aside>
      </div>
    `;
  }

  // 11. KPI & TARGETS MODULE
  if (key === 'kpi') {
    const activeTab = moduleView?.dataset.kpiTab || 'kpi-indicators';
    const account = getActiveAccount();
    const isAdminUser = isAdmin();
    const supervisorDept = isSupervisor() ? getActiveDepartment() : null;

    // RBAC: Supervisors only see their department's KPI
    const visibleKpi = supervisorDept ? kpiData.filter(k => k.dept === supervisorDept) : kpiData;

    const totalKpi = visibleKpi.length;
    const exceededCount = visibleKpi.filter(k => k.status === 'Exceeded').length;
    const onTrackCount = visibleKpi.filter(k => k.status === 'On-Track').length;
    const atRiskCount = visibleKpi.filter(k => k.status === 'At Risk').length;

    // Calculate score for each KPI
    const calculatedKpi = visibleKpi.map(k => {
      const score = calculateKpiScore(k);
      return { ...k, score: Math.round(score * 10) / 10 };
    });

    const totalWeight = calculatedKpi.reduce((acc, k) => acc + (Number(k.weight) || 0), 0) || 1;
    const overallScore = Math.round((calculatedKpi.reduce((acc, k) => acc + (k.score * (Number(k.weight) || 0)), 0) / totalWeight) * 10) / 10;

    // RBAC: Supervisors only see their department in dept scores
    const visibleDepts = supervisorDept ? departmentsData.filter(d => d.name === supervisorDept) : departmentsData;
    const deptScores = visibleDepts.map(dept => {
      const items = calculatedKpi.filter(k => k.dept === dept.name);
      if (!items.length) return { dept: dept.name, score: 90, count: 0, head: dept.head, code: dept.code, id: dept.id, budget: dept.budget, description: dept.description };
      const avg = Math.round((items.reduce((acc, k) => acc + k.score, 0) / items.length) * 10) / 10;
      return { dept: dept.name, score: avg, count: items.length, head: dept.head, code: dept.code, id: dept.id, budget: dept.budget, description: dept.description };
    });

    // Role badge color
    const roleBadgeClass = isAdminUser ? 'role-badge-admin' : 'role-badge-supervisor';
    const roleLabel = isAdminUser ? 'Administrator' : `Supervisor â€” ${safe(account.department)}`;

    // Active account switcher options
    const accountOptions = userAccounts.filter(u => u.status === 'Active').map(u =>
      `<option value="${u.id}" ${u.id === activeAccountId ? 'selected' : ''}>${safe(u.name)} (${u.role}${u.role === 'Supervisor' ? ' â€” ' + u.department : ''})</option>`
    ).join('');

    // User management tab content (admin only)
    const adminCount = userAccounts.filter(u => u.role === 'Admin').length;
    const spvCount = userAccounts.filter(u => u.role === 'Supervisor').length;

    return `
      <div class="kpi-overview-layout">
        <!-- Active Account Banner & Role Switcher -->
        <div class="active-account-banner">
          <div class="account-info-row">
            <img src="https://randomuser.me/api/portraits/${account.avatar}.jpg" alt="" class="account-banner-avatar" onerror="this.style.display='none'" />
            <div class="account-banner-text">
              <strong>${safe(account.name)}</strong>
              <span class="${roleBadgeClass}">${roleLabel}</span>
            </div>
          </div>
          ${authenticatedSupabaseSession ? '' : `<div class="account-switcher-row">
            <label>Masuk Sebagai:</label>
            <select id="accountSwitcher" data-action="switch-account">${accountOptions}</select>
          </div>`}
        </div>

        <!-- Sub-nav Tabs -->
        <div class="kpi-tabs-bar">
          <button class="kpi-tab-btn ${activeTab === 'kpi-indicators' ? 'active' : ''}" data-action="switch-kpi-tab" data-tab="kpi-indicators">
            <span>Target &amp; Indikator KPI</span> (${totalKpi})
          </button>
          ${isAdminUser ? `<button class="kpi-tab-btn ${activeTab === 'kpi-divisions' ? 'active' : ''}" data-action="switch-kpi-tab" data-tab="kpi-divisions">
            <span>Kelola Divisi &amp; Departemen</span> (${departmentsData.length})
          </button>` : ''}
          ${isAdminUser ? `<button class="kpi-tab-btn ${activeTab === 'kpi-users' ? 'active' : ''}" data-action="switch-kpi-tab" data-tab="kpi-users">
            <span>Manajemen Pengguna</span> (${userAccounts.length})
          </button>` : ''}
        </div>

        ${activeTab === 'kpi-users' && isAdminUser ? `
          <!-- TAB 3: MANAJEMEN PENGGUNA (USER MANAGEMENT) -->
          <div class="kpi-stat-grid" style="grid-template-columns:repeat(3,1fr)">
            <article class="kpi-stat-card highlight">
              <div class="kpi-stat-head"><span>Total Pengguna Sistem</span><b>${userAccounts.length}</b></div>
              <strong>${userAccounts.length} <small>Akun</small></strong>
              <p>Terdaftar dalam sistem Kharisma Hub</p>
            </article>
            <article class="kpi-stat-card">
              <div class="kpi-stat-head"><span>Administrator</span><span class="status ontime">Admin</span></div>
              <strong style="color:#0962ea">${adminCount} <small>Akun</small></strong>
              <p>Akses penuh ke semua modul &amp; divisi</p>
            </article>
            <article class="kpi-stat-card">
              <div class="kpi-stat-head"><span>Supervisor Divisi</span><span class="status leave">Supervisor</span></div>
              <strong style="color:#0284c7">${spvCount} <small>Akun</small></strong>
              <p>Kelola KPI tim divisi masing-masing</p>
            </article>
          </div>

          <section class="module-card">
            <div class="module-card-head">
              <div>
                <h2>Daftar Akun Pengguna &amp; Role Supervisor</h2>
                <p style="margin:2px 0 0;font-size:12px;color:#64748b">Kelola akun Admin, Atasan, dan Karyawan. Karyawan ditautkan melalui email kantor.</p>
              </div>
              <div class="module-heading-actions">
                <button class="module-button primary" data-action="new-user-account">ï¼‹ Tambah Akun Baru</button>
              </div>
            </div>

            <div class="module-table-wrap">
              <table class="module-table user-accounts-table">
                <thead>
                  <tr>
                    <th>Pengguna</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Departemen</th>
                    <th>Jabatan</th>
                    <th>Status</th>
                    <th>Login Terakhir</th>
                    <th style="min-width:115px">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  ${userAccounts.map((u, i) => `
                    <tr data-user-id="${u.id}">
                      <td>
                        <div style="display:flex;align-items:center;gap:8px;">
                          ${avatar(u.name, 'p' + ((i % 9) + 1))}
                          <strong style="font-size:13px;color:#0f172a">${safe(u.name)}</strong>
                        </div>
                      </td>
                      <td><span style="color:#475569;font-size:12.5px">${safe(u.email)}</span></td>
                      <td><span class="status ${u.role === 'Admin' ? 'ontime' : 'leave'}">${safe(roleLabel(u.role))}</span></td>
                      <td><strong style="font-size:13px">${safe(u.department)}</strong></td>
                      <td><span style="color:#475569;font-size:12.5px">${safe(u.title || 'â€”')}</span></td>
                      <td><span class="status ${u.status === 'Active' ? 'ontime' : u.status === 'Pending' ? 'leave' : 'late'}">${safe(u.status === 'Pending' ? 'Menunggu aktivasi' : u.status === 'Inactive' ? 'Nonaktif' : 'Aktif')}</span></td>
                      <td><span style="color:#64748b;font-size:12px">${safe(u.lastLogin || 'â€”')}</span></td>
                      <td>
                        <div class="row-actions-group">
                          <button class="btn-action-icon" data-action="edit-user-account" data-id="${u.id}" title="Edit Akun Pengguna"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          ${u.status === 'Pending' ? `<button class="btn-action-icon" data-action="resend-invite-user" data-id="${u.id}" data-email="${safe(u.email)}" title="Kirim Ulang Undangan Email"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>` : ''}
                          <button class="btn-action-icon" data-action="reset-password-user" data-id="${u.id}" data-email="${safe(u.email)}" title="Kirim Email Reset Kata Sandi"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button>
                          ${u.id !== 'usr-admin' && u.id !== authenticatedSupabaseSession?.user?.id ? `
                            <button class="btn-action-icon ${u.status === 'Inactive' ? 'success' : 'warning'}" data-action="toggle-status-user" data-id="${u.id}" title="${u.status === 'Inactive' ? 'Aktifkan Akun' : 'Nonaktifkan Akun'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></button>
                            <button class="btn-action-icon danger" data-action="delete-user-account" data-id="${u.id}" title="Hapus Permanen Akun"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
                          ` : ''}
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            <div class="pagination-row">
              <label>Menampilkan ${userAccounts.length} akun pengguna terdaftar</label>
            </div>
          </section>

          <section class="module-card" style="margin-top:16px">
            <div class="module-card-head">
              <h2>Panduan Role &amp; Hak Akses</h2>
            </div>
            <div class="role-guide-grid">
              <div class="role-guide-card">
                <div class="role-guide-icon admin-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
                <h3>Administrator</h3>
                <ul>
                  <li>Akses penuh ke seluruh modul dan data</li>
                  <li>Mengelola divisi, KPI, dan pengguna</li>
                  <li>Melihat laporan seluruh departemen</li>
                  <li>Menambah/menghapus akun supervisor</li>
                </ul>
              </div>
              <div class="role-guide-card">
                <div class="role-guide-icon supervisor-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/></svg></div>
                <h3>Supervisor Divisi</h3>
                <ul>
                  <li>Melihat dan mengelola KPI divisi sendiri</li>
                  <li>Update realisasi dan capaian tim</li>
                  <li>Tidak dapat mengubah divisi lain</li>
                  <li>Tidak dapat mengelola akun pengguna</li>
                </ul>
              </div>
            </div>
          </section>
        ` : activeTab === 'kpi-divisions' && isAdminUser ? `
          <!-- TAB 2: MANAJEMEN DIVISI (CRUD DIVISI) -->
          <section class="module-card dept-management-section">
            <div class="module-card-head">
              <div>
                <h2>Direktori &amp; Manajemen Divisi</h2>
                <p style="margin:2px 0 0;font-size:12px;color:#64748b">Kelola struktur departemen, penanggung jawab/kepala divisi, alokasi anggaran, dan target pencapaian.</p>
              </div>
              <div class="module-heading-actions">
                <button class="module-button primary" data-action="new-division">ï¼‹ Tambah Divisi Baru</button>
              </div>
            </div>

            <div class="dept-cards-grid">
              ${deptScores.map(d => `
                <article class="dept-manage-card" data-dept-id="${d.id}">
                  <div class="dept-card-top">
                    <span class="dept-badge-icon">${safe(d.code || d.dept.slice(0, 2).toUpperCase())}</span>
                    <div class="dept-card-titles">
                      <h3>${safe(d.dept)}</h3>
                      <span class="dept-budget-tag">${safe(d.budget || 'Anggaran Operasional')}</span>
                    </div>
                  </div>
                  <p class="dept-card-desc">${safe(d.description || 'Divisi operasional bisnis terintegrasi di Kharisma Hub.')}</p>
                  
                  <div class="dept-lead-row">
                    <span class="meta-label">Kepala Divisi (PIC):</span>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
                      ${avatar(d.head || 'Lead', 'p1')}
                      <strong>${safe(d.head || 'Belum Ditentukan')}</strong>
                    </div>
                  </div>

                  <div class="dept-meta-grid">
                    <div class="dept-meta-box">
                      <span>Target KPI</span>
                      <b>${d.count} Indikator</b>
                    </div>
                    <div class="dept-meta-box">
                      <span>Rata-Rata Capaian</span>
                      <b style="color:${d.score >= 95 ? '#0962ea' : d.score >= 85 ? '#0284c7' : '#d97706'}">${d.score}%</b>
                    </div>
                  </div>

                  <div class="dept-card-track-wrap">
                    <div class="kpi-mini-track">
                      <span style="width:${Math.min(100, Math.max(0, d.score))}%" class="${d.score >= 95 ? 'top-fill' : d.score >= 85 ? 'good-fill' : 'warn-fill'}"></span>
                    </div>
                  </div>

                  <div class="dept-card-actions">
                    <button class="dept-action-link" data-action="view-dept-kpi" data-dept="${safe(d.dept)}">Lihat KPI</button>
                    <button class="dept-btn-small" data-action="edit-division" data-id="${d.id}" title="Edit Data Divisi">Edit</button>
                    <button class="dept-btn-small danger" data-action="delete-division" data-id="${d.id}" data-name="${safe(d.dept)}" title="Hapus Divisi">Hapus</button>
                  </div>
                </article>
              `).join('')}
            </div>
          </section>
        ` : `
          <!-- TAB 1: TARGET & INDIKATOR KPI (CRUD KPI) -->
          ${supervisorDept ? `
            <div class="supervisor-scope-banner">
              
              <div>
                <strong>Mode Supervisor â€” Divisi: ${safe(supervisorDept)}</strong>
                <p>Anda hanya melihat target KPI yang terkait dengan divisi ${safe(supervisorDept)}. Untuk melihat seluruh data, masuk sebagai Administrator.</p>
              </div>
            </div>
          ` : ''}
          <div class="kpi-stat-grid">
            <article class="kpi-stat-card highlight">
              <div class="kpi-stat-head">
                <span>Rata-Rata Capaian KPI${supervisorDept ? ' (' + safe(supervisorDept) + ')' : ''}</span>
                <span class="status ${overallScore >= 90 ? 'ontime' : overallScore >= 75 ? 'leave' : 'late'}">${overallScore >= 90 ? 'Sangat Baik' : 'Cukup'}</span>
              </div>
              <strong>${overallScore}%</strong>
              <p>Target Bobot Kumulatif ${supervisorDept ? 'Divisi' : 'Perusahaan'} (${totalWeight}%)</p>
            </article>
            <article class="kpi-stat-card">
              <div class="kpi-stat-head"><span>Total Indikator KPI</span><b>${totalKpi}</b></div>
              <strong>${totalKpi} <small>Indikator</small></strong>
              <p>${supervisorDept ? 'Divisi ' + safe(supervisorDept) : 'Tersebar di ' + departmentsData.length + ' Divisi Perusahaan'}</p>
            </article>
            <article class="kpi-stat-card">
              <div class="kpi-stat-head"><span>Melampaui Target (Exceeded)</span><span class="status ontime">Exceeded</span></div>
              <strong style="color:#0962ea">${exceededCount} <small>KPI</small></strong>
              <p>${Math.round((exceededCount / Math.max(1, totalKpi)) * 100)}% dari total seluruh target</p>
            </article>
            <article class="kpi-stat-card">
              <div class="kpi-stat-head"><span>Perlu Perhatian (At Risk)</span><span class="status ${atRiskCount > 0 ? 'late' : 'ontime'}">Perlu Evaluasi</span></div>
              <strong style="color:${atRiskCount > 0 ? '#d97706' : '#0962ea'}">${atRiskCount} <small>KPI</small></strong>
              <p>Memerlukan mitigasi &amp; akselerasi</p>
            </article>
          </div>

          <section class="module-card kpi-dept-summary-card">
            <div class="module-card-head">
              <h2>Capaian KPI Berdasarkan Departemen</h2>
              <div class="module-heading-actions">
                <span class="toolbar-note">Periode:</span>
                <select class="module-select" id="kpiPeriodSelect"><option>Q4 2026</option><option>Q3 2026</option><option>Semester 2 2026</option><option>Tahun 2026</option></select>
              </div>
            </div>
            <div class="kpi-dept-bars-grid">
              ${deptScores.map(d => `
                <div class="kpi-dept-bar-item">
                  <div class="kpi-dept-bar-label">
                    <strong>${safe(d.dept)}</strong>
                    <span><b>${d.score}%</b> (${d.count} KPI)</span>
                  </div>
                  <div class="kpi-dept-track">
                    <span class="kpi-dept-fill ${d.score >= 95 ? 'top-fill' : d.score >= 90 ? 'good-fill' : 'warn-fill'}" style="width:${Math.min(100, Math.max(0, d.score))}%"></span>
                  </div>
                </div>
              `).join('')}
            </div>
          </section>

          <section class="module-card kpi-list-card">
            <div class="module-card-head">
              <h2>Daftar Target &amp; Indikator Kinerja (KPI)</h2>
              <div class="module-heading-actions">
                <label class="module-search">âŒ• <input data-filter="kpi" id="kpiSearchInput" placeholder="Cari indikator KPI, PIC, atau divisi..." /></label>
                ${!supervisorDept ? `<div class="filter-dropdown-wrap">
                  <button class="date-filter" data-action="kpi-dept-filter" id="kpiDeptFilterBtn">${moduleView.dataset.kpiDeptFilter || 'Semua Divisi'} <span>âŒ„</span></button>
                </div>` : ''}
                <div class="filter-dropdown-wrap">
                  <button class="date-filter" data-action="kpi-status-filter" id="kpiStatusFilterBtn">${moduleView.dataset.kpiStatusFilter || 'Semua Status'} <span>âŒ„</span></button>
                </div>
                ${isAdminUser ? `<button class="module-button primary" data-action="new-kpi">ï¼‹ Tambah KPI Baru</button>` : ''}
                <button class="module-button secondary" data-action="export-kpi">Export Laporan</button>
              </div>
            </div>

            <div class="module-table-wrap">
              <table class="module-table kpi-table">
                <thead>
                  <tr>
                    <th class="sortable" data-col="0">Indikator KPI â†•</th>
                    <th class="sortable" data-col="1">Departemen &amp; PIC â†•</th>
                    <th class="sortable" data-col="2">Periode â†•</th>
                    <th class="sortable" data-col="3">Bobot â†•</th>
                    <th class="sortable" data-col="4">Target â†•</th>
                    <th class="sortable" data-col="5">Realisasi â†•</th>
                    <th class="sortable" data-col="6">Capaian (%) â†•</th>
                    <th class="sortable" data-col="7">Status â†•</th>
                    <th style="min-width:115px">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  ${calculatedKpi.map((k, i) => `
                    <tr data-kpi-id="${k.id}" data-kpi-dept="${safe(k.dept)}" data-kpi-status="${safe(k.status)}">
                      <td>
                        <div class="kpi-title-cell">
                          <strong>${safe(k.title)}</strong>
                          <small>${safe(k.notes || 'Target kinerja terukur')}</small>
                        </div>
                      </td>
                      <td>
                        <div style="display:flex;align-items:center;gap:8px;">
                          ${avatar(k.pic, `p${(i % 9) + 1}`)}
                          <div>
                            <strong style="display:block;font-size:13px;color:#0f172a;">${safe(k.dept)}</strong>
                            <small style="color:#64748b;font-size:11.5px;">PIC: ${safe(k.pic)}</small>
                          </div>
                        </div>
                      </td>
                      <td><span class="period-pill">${safe(k.period)}</span></td>
                      <td><strong>${k.weight}%</strong></td>
                      <td><span style="font-weight:600;color:#334155">${k.target} ${safe(k.unit)}</span></td>
                      <td><span style="font-weight:700;color:#0962ea">${k.actual !== undefined ? k.actual : 'â€”'} ${safe(k.unit)}</span></td>
                      <td>
                        <div class="kpi-progress-cell">
                          <div class="kpi-progress-val"><b>${k.score}%</b></div>
                          <div class="kpi-mini-track"><span style="width:${Math.min(100, Math.max(0, k.score))}%" class="${k.score >= 100 ? 'top-fill' : k.score >= 85 ? 'good-fill' : 'warn-fill'}"></span></div>
                        </div>
                      </td>
                      <td>
                        <span class="status ${k.status === 'Exceeded' ? 'ontime' : k.status === 'On-Track' ? 'leave' : 'late'}">${safe(k.status)}</span>
                      </td>
                      <td>
                        <div class="row-actions-group">
                          <button class="btn-action-icon" data-action="edit-kpi-progress" data-id="${k.id}" title="Update Realisasi Capaian"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                          ${isAdminUser ? `<button class="btn-action-icon" data-action="edit-kpi-full" data-id="${k.id}" title="Edit Lengkap Parameter KPI"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>` : ''}
                          ${isAdminUser ? `<button class="btn-action-icon danger" data-action="delete-kpi" data-id="${k.id}" title="Hapus KPI"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            <div class="pagination-row">
              <label>Menampilkan ${calculatedKpi.length} target KPI aktif</label>
            </div>
          </section>
        `}
      </div>
    `;
  }

  return '';
}

/* ==========================================================================
   Module Navigation & Multi-Page History Handler
   ========================================================================== */

const keyToFile = {
  dashboard: 'index.html',
  inbox: 'inbox.html',
  calendar: 'calendar.html',
  employees: 'employees.html',
  'employee-grid': 'employees.html?view=grid',
  'employee-details': 'employees.html',
  'employee-add': 'employees.html?action=add',
  attendance: 'attendance.html',
  performance: 'performance.html',
  kpi: 'kpi.html',
  payroll: 'payroll.html',
  leave: 'leave.html',
  recruitment: 'recruitment.html'
};

function resolveRoute(hashString = window.location.hash) {
  const rawFile = window.location.pathname.split('/').pop().toLowerCase();
  const fileName = rawFile.replace(/\.html$/, '') || 'index';
  const fileMap = {
    'index': 'dashboard',
    '': 'dashboard',
    'inbox': 'inbox',
    'calendar': 'calendar',
    'employees': 'employees',
    'attendance': 'attendance',
    'performance': 'performance',
    'kpi': 'kpi',
    'payroll': 'payroll',
    'leave': 'leave',
    'recruitment': 'recruitment'
  };

  const urlParams = new URLSearchParams(window.location.search || '');
  if (fileMap[fileName]) {
    let key = fileMap[fileName];
    if (key === 'employees') {
      if (urlParams.get('view') === 'grid') key = 'employee-grid';
      else if (urlParams.get('action') === 'add') key = 'employee-add';
      else if (urlParams.get('name')) {
        key = 'employee-details';
        selectedEmployeeName = urlParams.get('name');
      }
    }
    return { key, params: urlParams };
  }

  const clean = (hashString || '').replace(/^#\/?/, '').trim();
  const [route, queryString] = clean.split('?');
  const params = new URLSearchParams(queryString || '');
  const validModules = ['dashboard', 'inbox', 'calendar', 'employees', 'employee-grid', 'employee-details', 'employee-add', 'attendance', 'performance', 'kpi', 'payroll', 'leave', 'recruitment'];
  const aliasMap = {
    '': 'dashboard',
    'tasks': 'inbox',
    'schedules': 'leave',
    'candidate': 'recruitment',
    'candidates': 'recruitment',
    'employee': 'employees',
    'targets': 'kpi',
    'target': 'kpi',
    'okr': 'kpi'
  };
  const key = aliasMap[route] || (validModules.includes(route) ? route : 'dashboard');
  return { key, params };
}

function openModule(key, updateUrl = true, params = null) {
  if (authenticatedSupabaseSession && authenticatedUserProfile) {
    const role = authenticatedUserProfile.role;
    const allowed = role === 'Admin'
      ? null
      : role === 'Supervisor'
      ? new Set(['dashboard','calendar','employees','employee-grid','employee-details','attendance','performance','kpi','leave'])
        : new Set(['dashboard','calendar','employees','employee-grid','employee-details','attendance','leave']);
    if (role === 'Employee' && ['employees','employee-grid'].includes(key)) {
      const own = employeeData.find(row => row[5] === authenticatedUserProfile.employee_id || `EMP-${getEmployeeId(row)}` === authenticatedUserProfile.employee_id);
      if (own) { selectedEmployeeName = own[0]; key = 'employee-details'; }
    }
    if (allowed && !allowed.has(key)) {
      showToast('Menu ini tidak tersedia untuk peran akun Anda.');
      key = 'dashboard';
    }
  }
  if (!key.startsWith('employee')) employeeCurrentPage = 1;
  const selectedNav = key.startsWith('employee') ? 'employees' : key;
  
  // Highlight navigation link
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.module === selectedNav);
  });

  if (params?.name) {
    selectedEmployeeName = params.name;
  }

  const currentFile = (window.location.pathname.split('/').pop().toLowerCase() || 'index').replace(/\.html$/, '');
  const targetFile = keyToFile[key] || 'index.html';
  const targetBase = targetFile.split('?')[0].replace(/\.html$/, '');

  // Multi-Page Application (MPA) routing:
  // If target file is different from current page, navigate via browser URL!
  if (targetBase !== currentFile && !window.location.protocol.startsWith('file')) {
    let dest = targetFile;
    if (params && Object.keys(params).length && !targetFile.includes('?')) {
      dest += '?' + new URLSearchParams(params).toString();
    }
    window.location.href = dest;
    return;
  }

  if (key === 'dashboard') {
    if (dashboardView) {
      dashboardView.hidden = false;
      if (moduleView) moduleView.hidden = true;
      const searchInput = document.querySelector('#searchInput');
      if (searchInput) searchInput.value = '';
      const greeting = document.querySelector('.greeting');
      if (greeting) {
        greeting.classList.remove('inbox-heading');
        greeting.innerHTML = `<span>Hello ${safe(userProfile.name)}!</span><strong>Good Morning</strong>`;
      }
      renderDashboardMiniCalendar();
      renderDashboardScheduleList();
      return;
    } else {
      window.location.href = 'index.html';
      return;
    }
  }

  if (!moduleTitles[key]) return;

  if (dashboardView) dashboardView.hidden = true;
  if (moduleView) {
    moduleView.hidden = false;
    moduleView.innerHTML = pageMarkup(key);

    if (key === 'employee-add' && Object.keys(employeeDraft).length) {
      moduleView.querySelectorAll('#employeePageForm [name]').forEach((field) => {
        if (field.type !== 'file' && Object.hasOwn(employeeDraft, field.name)) {
          field.value = employeeDraft[field.name];
        }
      });
    }

    if (key !== 'inbox') {
      moduleView.insertAdjacentHTML('beforeend', '<footer class="page-footer"><strong>Copyright &copy; 2025 Kharisma Group</strong><a href="#privacy">Privacy Policy</a><a href="#terms">Term and conditions</a><a href="#contact">Contact</a><span></span><span class="socials"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l11.733 16h4.267l-11.733-16z"/><path d="M4 20l6.768-6.768m2.464-2.464L20 4"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg></span></footer>');
    }

    moduleView.dataset.page = key;
    setupTablePagination();
    if (key === 'kpi') {
      updateDepartmentDropdowns();
    }

  // Stale-while-revalidate data hydration from Supabase
  if (window.KharismaDB && window.KharismaDB.isConnected) {
    if (key === 'employees' || key === 'employee-grid' || key === 'employee-details') {
      window.KharismaDB.employees.getAll(employeeData).then(remote => {
        Object.assign(employeeProfileOverrides, window.__kharismaEmployeeProfiles || {});
        if (remote?.length) remote.forEach(row => {
          if (row[5] && /^EMP-/.test(row[5])) employeeIdByName.set(row[0], row[5].replace(/^EMP-/, ''));
        });
        persistProfileOverrides();
        if (remote && remote.length && JSON.stringify(remote) !== JSON.stringify(employeeData)) {
          cloudDataHydrating = true;
          employeeData.length = 0;
          remote.forEach(r => employeeData.push(r));
          persistEmployeeData();
          cloudDataHydrating = false;
          if (moduleView && (moduleView.dataset.page === 'employees' || moduleView.dataset.page === 'employee-grid')) {
            moduleView.innerHTML = pageMarkup(moduleView.dataset.page);
          }
        }
      });
    } else if (key === 'kpi') {
      window.KharismaDB.kpi.getAll(kpiData).then(remote => {
        if (remote && remote.length && JSON.stringify(remote) !== JSON.stringify(kpiData)) {
          cloudDataHydrating = true;
          kpiData.length = 0;
          remote.forEach(r => kpiData.push(r));
          persistKpiData();
          cloudDataHydrating = false;
          if (moduleView && moduleView.dataset.page === 'kpi') {
            moduleView.innerHTML = pageMarkup('kpi');
          }
        }
      });
    } else if (key === 'attendance') {
      window.KharismaDB.attendance.getPolicy().then(policy => { attendancePolicy = policy; writeStoredValue('teamhub.attendancePolicy', policy); }).catch(() => {});
      if (userProfile.role === 'Admin' || userProfile.role === 'Supervisor') window.KharismaDB.attendance.getReviewQueue().then(queue => { attendanceReviewQueue = queue; if (moduleView?.dataset.page === 'attendance') { moduleView.innerHTML = pageMarkup('attendance'); setupTablePagination(); } }).catch(() => {});
      window.KharismaDB.attendance.getAll().then(records => {
        cloudAttendanceRecords = records;
        if (moduleView && moduleView.dataset.page === 'attendance') {
          moduleView.innerHTML = pageMarkup('attendance');
          setupTablePagination();
        }
      }).catch(error => {
        cloudAttendanceRecords = [];
        if (moduleView && moduleView.dataset.page === 'attendance') {
          moduleView.innerHTML = pageMarkup('attendance');
          setupTablePagination();
        }
        showToast(`Data presensi cloud belum dapat dimuat: ${error.message || 'kesalahan koneksi'}.`);
      });
    } else if (key === 'leave') {
      window.KharismaDB.leave.getAll(leaveRequests).then(remote => {
        if (remote && remote.length && JSON.stringify(remote) !== JSON.stringify(leaveRequests)) {
          leaveRequests.length = 0;
          remote.forEach(r => leaveRequests.push(r));
          persistLeaveRequests();
          if (moduleView && moduleView.dataset.page === 'leave') {
            moduleView.innerHTML = pageMarkup('leave');
          }
        }
      });
    } else if (key === 'calendar') {
      window.KharismaDB.calendar.getAll(calendarItems).then(remote => {
        if (remote && remote.length && JSON.stringify(remote) !== JSON.stringify(calendarItems)) {
          calendarItems.length = 0;
          remote.forEach(r => calendarItems.push(r));
          persistCalendarItems();
          if (moduleView && moduleView.dataset.page === 'calendar') {
            moduleView.innerHTML = pageMarkup('calendar');
          }
        }
      });
    }
  }

  }

  const greeting = document.querySelector('.greeting');
  if (greeting) {
    greeting.classList.toggle('inbox-heading', key !== 'dashboard');
    if (key === 'inbox') {
      activeMailFolder = 'Inbox';
      unreadOnly = false;
      greeting.innerHTML = '<strong>Inbox</strong><small>Dashboard / Inbox</small>';
      renderInboxPage();
    } else if (key === 'employee-details') {
      greeting.innerHTML = '<button class="employee-detail-back" data-action="back-employees" aria-label="Back to employees">â†</button><span><strong>Employee Details</strong><small>Dashboard / Employees / ' + safe(selectedEmployeeName) + '</small></span>';
    } else {
      greeting.innerHTML = `<strong>${safe(moduleTitles[key][0])}</strong><small>Dashboard / ${safe(moduleTitles[key][0])}</small>`;
    }
  }

  const searchInput = document.querySelector('#searchInput');
  if (searchInput) searchInput.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ==========================================================================
   Payslip Generator & Dialog
   ========================================================================== */

function openPayslipModal(employeeName) {
  const profile = getEmployeeProfile(employeeName);
  const payslipDialog = document.querySelector('#payslipDialog');
  const payslipContent = document.querySelector('#payslipContent');
  if (!payslipDialog || !payslipContent) return;

  const empIndex = employeeData.findIndex(p => p[0] === profile.name);
  const baseNum = 3200000 - Math.max(0, empIndex) * 80000;
  const transportNum = 150000;
  const mealNum = 200000;
  const allowanceNum = 300000;
  const overtimeNum = 80000;
  const totalEarnings = baseNum + transportNum + mealNum + allowanceNum + overtimeNum;

  const bpjsTk = Math.round(baseNum * 0.03);
  const bpjsKes = Math.round(baseNum * 0.01);
  const pph21 = Math.round(baseNum * 0.025);
  const totalDeductions = bpjsTk + bpjsKes + pph21;
  const netPay = totalEarnings - totalDeductions;
  const fmt = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);

  payslipContent.innerHTML = `
    <div class="payslip-sheet">
      <div class="payslip-header">
        <div class="payslip-brand">
          <img src="./LogoKharismaGroup.png" alt="Kharisma Group" style="height:52px;max-width:170px;object-fit:contain;flex-shrink:0;" />
          <div>
            <strong style="color:#0c1e36;font-size:13.5px;letter-spacing:-0.2px;">${safe(appSettings.companyName)}</strong>
            <p style="margin:2px 0 0;font-size:9.5px;color:#64748b">Kharisma Tower Lt. 18, Jl. Gatot Subroto Kav. 52, Jakarta Selatan Â· NPWP: 01.345.678.9-021.000</p>
          </div>
        </div>
        <div class="payslip-title">
          <h3>SLIP GAJI KARYAWAN</h3>
          <span>Periode: Juni 2035 (28 Jun 2035)</span>
        </div>
      </div>

      <div class="payslip-meta-grid">
        <div class="payslip-meta-item"><span>ID Karyawan</span><strong>${safe(profile.id)}</strong></div>
        <div class="payslip-meta-item"><span>Nama Karyawan</span><strong>${safe(profile.name)}</strong></div>
        <div class="payslip-meta-item"><span>Jabatan</span><strong>${safe(profile.title)}</strong></div>
        <div class="payslip-meta-item"><span>Departemen</span><strong>${safe(profile.department)}</strong></div>
        <div class="payslip-meta-item"><span>Status Kepegawaian</span><strong>${safe(profile.employmentType)}</strong></div>
        <div class="payslip-meta-item"><span>Model Kerja</span><strong>${safe(profile.workModel)}</strong></div>
      </div>

      <div class="payslip-breakdown">
        <div>
          <div class="payslip-col-head">A. PENDAPATAN (EARNINGS)</div>
          <div class="payslip-items">
            <div class="payslip-row"><span>Gaji Pokok</span><b>${fmt(baseNum)}</b></div>
            <div class="payslip-row"><span>Tunjangan Tetap</span><b>${fmt(allowanceNum)}</b></div>
            <div class="payslip-row"><span>Uang Makan</span><b>${fmt(mealNum)}</b></div>
            <div class="payslip-row"><span>Uang Transportasi</span><b>${fmt(transportNum)}</b></div>
            <div class="payslip-row"><span>Uang Lembur (Overtime)</span><b>${fmt(overtimeNum)}</b></div>
          </div>
          <div class="payslip-subtotal"><span>Total Pendapatan Kotor</span><b>${fmt(totalEarnings)}</b></div>
        </div>

        <div>
          <div class="payslip-col-head">B. POTONGAN (DEDUCTIONS)</div>
          <div class="payslip-items">
            <div class="payslip-row"><span>BPJS Ketenagakerjaan (3%)</span><b>${fmt(bpjsTk)}</b></div>
            <div class="payslip-row"><span>BPJS Kesehatan (1%)</span><b>${fmt(bpjsKes)}</b></div>
            <div class="payslip-row"><span>Pajak PPh 21</span><b>${fmt(pph21)}</b></div>
            <div class="payslip-row"><span>Potongan Absensi</span><b>Rp0</b></div>
          </div>
          <div class="payslip-subtotal"><span>Total Potongan</span><b>${fmt(totalDeductions)}</b></div>
        </div>
      </div>

      <div class="payslip-total-box">
        <div>
          <span>GAJI BERSIH (TAKE HOME PAY)</span>
          <small style="display:block;opacity:.85;font-size:9.5px;margin-top:2px">Ditransfer ke rekening Bank Central Asia</small>
        </div>
        <strong>${fmt(netPay)}</strong>
      </div>

      <div class="payslip-signatures">
        <div class="payslip-sign-col">
          <span>Dibuat Oleh,</span>
          <div class="payslip-sign-line">${safe(userProfile.name)}<br><small>${safe(userProfile.role)}</small></div>
        </div>
        <div class="payslip-sign-col">
          <span>Diterima Oleh,</span>
          <div class="payslip-sign-line">${safe(profile.name)}<br><small>Karyawan</small></div>
        </div>
      </div>
    </div>
  `;

  document.querySelector('#btnDownloadPayslipCsv').onclick = () => {
    downloadCsv(`slip-gaji-${profile.name.toLowerCase().replace(/\s+/g, '-')}-juni-2035.csv`, [
      ['Komponen', 'Nominal'],
      ['ID Karyawan', profile.id],
      ['Nama', profile.name],
      ['Jabatan', profile.title],
      ['Departemen', profile.department],
      ['Gaji Pokok', baseNum],
      ['Tunjangan Tetap', allowanceNum],
      ['Uang Makan', mealNum],
      ['Uang Transportasi', transportNum],
      ['Uang Lembur', overtimeNum],
      ['Total Pendapatan', totalEarnings],
      ['BPJS Ketenagakerjaan', bpjsTk],
      ['BPJS Kesehatan', bpjsKes],
      ['PPh 21', pph21],
      ['Total Potongan', totalDeductions],
      ['Gaji Bersih', netPay]
    ]);
  };

  payslipDialog.showModal();
}

/* ==========================================================================
   Action Dialog (New Event, Request Leave, Add Candidate, etc)
   ========================================================================== */

const actionDialog = document.querySelector('#actionDialog');
let activeAction = '';

function openActionDialog(action, defaultDay = null) {
  activeAction = action;
  const agendaDefaultDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), Number(defaultDay || selectedDate || 1));
  const today = new Date();
  const config = {
    'new-event': [
      'New Calendar Agenda',
      `<label>Judul Agenda<input name="title" required placeholder="mis. Wawancara Kandidat UI" /></label>
       <label>Kategori<select name="category"><option>Talent Acquisition</option><option>Employee Development</option><option>Workplace Engagement</option></select></label>
       <div class="dialog-two">
         <label>Tanggal<input name="date" type="date" value="${toLocalISODate(agendaDefaultDate)}" required /></label>
         <label>Jam<input name="time" type="time" value="09:00" required /></label>
       </div>
       <label>Lokasi / Tautan<input name="location" placeholder="Ruang Rapat C / Google Meet" /></label>
       <label>Catatan Tambahan<input name="note" placeholder="Catatan singkat agenda" /></label>`
    ],
    'request-leave': [
      'Ajukan Permohonan Cuti',
      `<label>Jenis Cuti<select name="type"><option>Annual Leave (Cuti Tahunan)</option><option>Sick Leave (Cuti Sakit)</option><option>Casual Leave (Cuti Pribadi)</option><option>Other Leave</option></select></label>
       <div class="dialog-two">
         <label>Tanggal Mulai<input name="start" type="date" value="${toLocalISODate(today)}" required /></label>
         <label>Tanggal Selesai<input name="end" type="date" value="${toLocalISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2))}" required /></label>
       </div>
       <label>Alasan Cuti<input name="note" required placeholder="mis. Keperluan keluarga mendesak" /></label>`
    ],
    'add-candidate': [
      'Tambah Kandidat Pelamar',
      `<label>Nama Lengkap<input name="name" required placeholder="Nama pelamar" /></label>
       <label>Email<input name="email" type="email" required placeholder="pelamar@email.com" /></label>
       <div class="dialog-two">
         <label>Posisi Dilamar<select name="position"><option>UI Designer</option><option>Sales Manager</option><option>HR Assistant</option><option>Data Analyst</option><option>Full-stack Engineer</option></select></label>
         <label>Model Kerja<select name="workModel"><option>Full-Time Remote</option><option>Full-Time On-Site</option><option>Full-Time Hybrid</option><option>Internship</option></select></label>
       </div>`
    ],
    'create-review': [
      'Buat Periode Penilaian Kinerja',
      `<label>Nama Periode<input name="cycle" required placeholder="mis. Penilaian Triwulan 4 2026" /></label>
       <label>Jenis Penilaian<select name="type"><option>Performance Review (Kinerja)</option><option>Probation Review (Masa Percobaan)</option><option>Peer Feedback (360 Derajat)</option></select></label>`
    ],
    'new-payrun': [
      'Siapkan Proses Gaji Baru',
      `<label>Periode Gaji<select name="period"><option>Oktober 2026</option><option>November 2026</option><option>Desember 2026</option></select></label>
       <label>Tanggal Pembayaran<input name="paymentDate" type="date" value="${toLocalISODate(today)}" required /></label>
       <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input name="confirm" type="checkbox" required /> Saya mengonfirmasi data absensi &amp; penggajian siap diproses.</label>`
    ]
  }[action];

  if (!config) return;
  document.querySelector('#actionDialogTitle').textContent = config[0];
  document.querySelector('#actionDialogFields').innerHTML = config[1];
  document.querySelector('#actionDialogSubmit').textContent = action === 'request-leave' ? 'Kirim Permohonan' : 'Simpan';
  actionDialog.showModal();
}

/* ==========================================================================
   Mail Page Helper Functions
   ========================================================================== */

function visibleMail() {
  let messages = activeMailFolder === 'Sent' ? sentMail : activeMailFolder === 'Drafts' ? draftMail : inboxData;
  if (activeMailFolder === 'Starred') messages = inboxData.filter((mail) => mail.starred);
  if (activeMailFolder === 'Spam') messages = spamMail;
  if (activeMailFolder === 'Trash') messages = trashedMail;
  if (activeMailFolder === 'Archived') messages = archivedMail;
  if (['HR', 'Leave Requests', 'Interview', 'Admin Notes'].includes(activeMailFolder)) {
    messages = inboxData.filter((mail) => mail.label === activeMailFolder);
  }
  const query = moduleView.querySelector('#mailSearch')?.value.toLowerCase().trim() || '';
  if (unreadOnly && activeMailFolder === 'Inbox') messages = messages.filter((mail) => mail.unread);
  return messages.filter((mail) => `${mail.from} ${mail.subject} ${mail.preview} ${mail.label}`.toLowerCase().includes(query));
}

function renderMailList() {
  const list = moduleView.querySelector('#mailList');
  if (!list) return;
  const messages = visibleMail();
  list.innerHTML = messages.length ? messages.map((mail) => `
    <article class="mail-row ${mail.id === selectedMailId ? 'current' : ''} ${mail.unread ? 'unread' : ''}" data-mail-row="${mail.id}">
      <button class="mail-message" data-action="select-message" data-id="${mail.id}">
        ${avatar(mail.from, mail.color)}
        <span class="mail-message-copy">
          <span class="mail-row-head">
            <strong>${safe(mail.from)}</strong>
            <time>${safe(mail.time)}</time>
          </span>
          <b>${safe(mail.subject)}</b>
          <small>${safe(mail.preview)}</small>
        </span>
      </button>
      <button class="mail-star ${mail.starred ? 'starred' : ''}" data-action="toggle-star" data-id="${mail.id}">â˜†</button>
    </article>
  `).join('') : '<div class="mail-empty">Tidak ada pesan di folder ini.</div>';
}

function renderMailReader() {
  const reader = moduleView.querySelector('#mailReader');
  if (!reader) return;
  const mail = [...inboxData, ...sentMail, ...draftMail, ...archivedMail, ...trashedMail].find((item) => String(item.id) === String(selectedMailId));
  if (!mail) {
    reader.innerHTML = '<div class="mail-empty">Pilih pesan untuk dibaca.</div>';
    return;
  }
  reader.innerHTML = `
    <div class="mail-sender">
      ${avatar(mail.from, mail.color)}
      <div>
        <strong>${safe(mail.from)}</strong>
        <small>${safe(mail.email)}</small>
      </div>
      <time>${safe(mail.date)} - ${safe(mail.time)}</time>
      <button data-action="reply-message">â†¶ &nbsp;Reply</button>
      <button data-action="forward-message">â†— &nbsp;Forward</button>
    </div>
    <h2 class="mail-subject">${safe(mail.subject)}</h2>
    <div class="mail-body">${mail.body.map((line) => `<p>${safe(line)}</p>`).join('')}</div>
  `;
  const recipient = moduleView.querySelector('#mailComposer [name="recipient"]');
  if (recipient && activeMailFolder === 'Inbox') recipient.value = mail.from;
}

function renderInboxPage() {
  renderMailList();
  renderMailReader();
  const count = moduleView.querySelector('#mailCounter');
  if (count) count.textContent = `${Math.max(1, visibleMail().findIndex((mail) => mail.id === selectedMailId) + 1)} dari ${visibleMail().length}`;
  moduleView.querySelectorAll('.folder-button').forEach((folder) => {
    folder.classList.toggle('selected', folder.dataset.folder === activeMailFolder);
  });
}

/* ==========================================================================
   Event Listeners & Dispatchers
   ========================================================================== */

// 1. Navigation links: Native Multi-Page Application (MPA) navigation
// Standard anchor href navigates naturally without event.preventDefault() hijacking.

// 2. Browser history & popstate listener
window.addEventListener('popstate', () => {
  const { key, params } = resolveRoute();
  openModule(key, false, Object.fromEntries(params.entries()));
});
window.addEventListener('hashchange', () => {
  const { key, params } = resolveRoute();
  openModule(key, false, Object.fromEntries(params.entries()));
});

// 3. Header Buttons
document.querySelector('#notificationButton')?.addEventListener('click', () => {
  const dialog = document.querySelector('#notificationsDialog');
  const list = document.querySelector('#notifListContainer');
  if (!dialog || !list) return;
  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-icon">${n.icon}</div>
      <div class="notif-content">
        <strong>${safe(n.title)}</strong>
        <p>${safe(n.message)}</p>
        <time>${safe(n.time)}</time>
      </div>
    </div>
  `).join('');
  dialog.showModal();
});

document.querySelector('#btnMarkAllNotifsRead')?.addEventListener('click', () => {
  notifications.forEach(n => n.read = true);
  persistNotifications();
  document.querySelectorAll('.notif-item').forEach(item => item.classList.remove('unread'));
  showToast('Semua notifikasi ditandai sudah dibaca.');
});

document.querySelector('#settingsButton')?.addEventListener('click', () => {
  const dialog = document.querySelector('#settingsDialog');
  if (!dialog) return;
  document.querySelector('#settingCompanyName').value = appSettings.companyName;
  document.querySelector('#settingCurrency').value = appSettings.currency;
  document.querySelector('#settingTimezone').value = appSettings.timezone;
  document.querySelector('#settingWorkStart').value = appSettings.workStart;
  document.querySelector('#settingWorkEnd').value = appSettings.workEnd;
  document.querySelector('#settingLateTolerance').value = appSettings.lateTolerance;
  const keyInput = document.querySelector('#settingSupabaseAnonKey');
  if (keyInput) keyInput.value = localStorage.getItem('kharisma_supabase_anon_key') || '';
  dialog.showModal();
});

document.querySelector('#settingsForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(e.target);
  appSettings.companyName = data.get('companyName');
  appSettings.currency = data.get('currency');
  appSettings.timezone = data.get('timezone');
  appSettings.workStart = data.get('workStart');
  appSettings.workEnd = data.get('workEnd');
  appSettings.lateTolerance = Number(data.get('lateTolerance')) || 15;
  persistSettings();
  const anonKey = data.get('supabaseAnonKey');
  if (anonKey !== null && window.KharismaSupabase) {
    window.KharismaSupabase.setKey(anonKey);
  }
  document.querySelector('#settingsDialog')?.close();
  showToast('Pengaturan ruang kerja berhasil disimpan.');
});

// Cloud Badge click -> open settings
document.querySelector('#cloudStatusBadge')?.addEventListener('click', () => {
  document.querySelector('#settingsButton')?.click();
});

// Supabase Status Listener
window.addEventListener('kharisma:supabase-status', (e) => {
  const { isConnected, message } = e.detail;
  const badge = document.querySelector('#cloudStatusBadge');
  const text = document.querySelector('#cloudStatusText');
  const help = document.querySelector('#supabaseStatusHelp');

  if (badge && text) {
    badge.className = `cloud-badge ${isConnected ? 'connected' : 'local'}`;
    text.textContent = isConnected ? 'Cloud Aktif' : 'Mode Lokal';
    badge.title = isConnected ? `Supabase Cloud Aktif: ${message}` : 'Mode Lokal â€” Klik untuk menyambungkan Supabase';
  }
  if (help) {
    help.textContent = `Status: ${message}`;
    help.style.color = isConnected ? '#059669' : '#d97706';
  }
});

// Test Supabase Connection Button
document.querySelector('#btnTestSupabase')?.addEventListener('click', async () => {
  const inputKey = document.querySelector('#settingSupabaseAnonKey')?.value;
  if (inputKey && window.KharismaDB) {
    window.KharismaDB.setKey(inputKey);
  }
  if (!window.KharismaDB) return;
  showToast('Menguji koneksi ke Supabase Cloud...');
  const res = await window.KharismaDB.testConnection();
  if (res.ok) {
    showToast(`Sukses: Terhubung ke Supabase (${res.latency || 0}ms)`);
  } else {
    showToast(`Gagal: ${res.message}`);
  }
});

// Bulk Sync to Supabase Button
document.querySelector('#btnSyncSupabase')?.addEventListener('click', async () => {
  if (!window.KharismaDB) return;
  showToast('Memulai sinkronisasi data ke Supabase...');
  const res = await window.KharismaDB.syncAll({
    isAdmin: isAdmin(),
    employees: isAdmin() ? employeeData : [],
    kpis: isAdmin() ? kpiData : kpiData.filter(item => item.dept === getActiveDepartment()),
    getEmployeeId
  });
  if (res.ok) {
    showToast(`Sinkronisasi berhasil: ${res.results.employees} karyawan, ${res.results.kpi} KPI. Presensi memakai antrean verifikasi tersendiri.`);
  } else {
    showToast(`Sinkronisasi tertunda: ${res.message}`);
  }
});

document.querySelector('#profileButton')?.addEventListener('click', () => {
  const dialog = document.querySelector('#userProfileDialog');
  if (!dialog) return;
  syncActiveProfileFromAccount();
  document.querySelector('#profileDisplayName').textContent = userProfile.name;
  document.querySelector('#profileDisplayEmail').textContent = userProfile.email;
  document.querySelector('#profileInputName').value = userProfile.name;
  document.querySelector('#profileInputEmail').value = userProfile.email;
  document.querySelector('#profileInputRole').value = userProfile.role;
  document.querySelector('#profileInputDept').value = userProfile.department;
  dialog.showModal();
});

document.querySelector('#userProfileForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  const account = getActiveAccount();
  const oldName = account.name;
  const oldEmail = account.email;
  const name = String(data.get('userName') || '').trim();
  const email = String(data.get('userEmail') || '').trim();
  if (!name || !email) return showToast('Nama dan email wajib diisi.');
  if (authenticatedSupabaseSession) {
    (async () => {
      const identity = await window.KharismaDB.auth.updateProfile({ name });
      if (identity.error) return showToast(`Profil gagal diperbarui: ${identity.error.message}`);
      const profileResult = await window.KharismaSupabase.client.from('user_profiles').update({ full_name: name }).eq('id', authenticatedSupabaseSession.user.id);
      if (profileResult.error) return showToast(`Profil gagal diperbarui: ${profileResult.error.message}`);
      userProfile.name = name;
      userProfile.email = email;
      account.name = name;
      persistUserProfile();
      syncActiveProfileFromAccount();
      document.querySelector('#userProfileDialog')?.close();
      showToast('Profil berhasil disimpan ke Supabase.');
    })();
    return;
  }
  if (userAccounts.some(u => u.id !== account.id && u.email.toLowerCase() === email.toLowerCase())) {
    return showToast('Email tersebut sudah digunakan akun lain.');
  }
  const employee = findEmployeeByName(oldName) || employeeData.find(row => row[1].toLowerCase() === oldEmail.toLowerCase());
  if (employee && employeeData.some(row => row !== employee && row[1].toLowerCase() === email.toLowerCase())) {
    return showToast('Email tersebut sudah digunakan karyawan lain.');
  }
  if (employee) {
    employee[0] = name;
    employee[1] = email;
    persistEmployeeData();
    syncEmployeeChange(oldName, oldEmail, { name, email });
  } else {
    account.name = name;
    account.email = email;
    persistUserAccounts();
  }
  syncActiveProfileFromAccount(true);
  const greeting = document.querySelector('.greeting');
  if (greeting && !greeting.classList.contains('inbox-heading')) {
    greeting.innerHTML = `<span>Halo, ${safe(userProfile.name)}!</span><strong>Selamat Pagi</strong>`;
  }
  document.querySelector('#userProfileDialog')?.close();
  showToast('Profil pengguna berhasil diperbarui.');
});

// Modal Close triggers
document.addEventListener('click', (event) => {
  if (event.target.matches('[data-close-dialog]')) document.querySelector('#employeeDialog')?.close();
  if (event.target.matches('[data-close-edit-dialog]')) document.querySelector('#editEmployeeDialog')?.close();
  if (event.target.matches('[data-close-action]')) document.querySelector('#actionDialog')?.close();
  if (event.target.matches('[data-close-payslip]')) document.querySelector('#payslipDialog')?.close();
  if (event.target.matches('[data-close-profile]')) document.querySelector('#userProfileDialog')?.close();
  if (event.target.matches('[data-close-notif]')) document.querySelector('#notificationsDialog')?.close();
  if (event.target.matches('[data-close-settings]')) document.querySelector('#settingsDialog')?.close();
  if (event.target.matches('[data-close-kpi-dialog]')) document.querySelector('#kpiDialog')?.close();
  if (event.target.matches('[data-close-update-kpi-dialog]')) document.querySelector('#updateKpiDialog')?.close();
  if (event.target.matches('[data-close-division-dialog]')) document.querySelector('#divisionDialog')?.close();
  if (event.target.matches('[data-close-edit-division-dialog]')) document.querySelector('#editDivisionDialog')?.close();
  if (event.target.matches('[data-close-edit-kpi-dialog]')) document.querySelector('#editKpiDialog')?.close();
  if (event.target.matches('[data-close-user-dialog]')) document.querySelector('#userAccountDialog')?.close();
  if (event.target.matches('[data-close-edit-user-dialog]')) document.querySelector('#editUserAccountDialog')?.close();
  if (event.target.id === 'btnPrintPayslip') window.print();
});

// 4. Quick Add Employee Form Submit
document.querySelector('#employeeForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!isAdmin()) { showToast('Hanya administrator yang dapat menambahkan karyawan.'); return; }
  const form = event.currentTarget;
  const name = form.elements.name.value.trim();
  const email = form.elements.email.value.trim();
  const dept = form.elements.department.value;
  const title = form.elements.title.value.trim();
  const workModel = form.elements.workModel.value;
  const employmentType = form.elements.employmentType.value;
  if (employeeData.some(row => row[1].toLowerCase() === email.toLowerCase())) {
    showToast('Email tersebut sudah digunakan karyawan lain.');
    return;
  }
  employeeData.unshift([name, email, dept, title, 'On-Time']);
  getEmployeeId(name);
  employeeProfileOverrides[name] = { ...(employeeProfileOverrides[name] || {}), workModel, employmentType };
  persistProfileOverrides();
  persistEmployeeData();
  updateEmployeeDatalist();
  form.reset();
  document.querySelector('#employeeDialog')?.close();
  openModule('employees');
  showToast(`${name} berhasil ditambahkan ke direktori karyawan`);
});

// 5. Edit Employee Form Submit
document.querySelector('#editEmployeeForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!isAdmin()) { showToast('Hanya administrator yang dapat mengubah data karyawan.'); return; }
  const form = event.currentTarget;
  const originalName = form.elements.originalName.value;
  const name = form.elements.name.value.trim();
  const email = form.elements.email.value.trim();
  const dept = form.elements.department.value;
  const title = form.elements.title.value.trim();
  const status = form.elements.status.value;
  const previousProfile = employeeProfileOverrides[originalName] || {};
  const workModel = form.elements.workModel?.value || previousProfile.workModel || 'Hybrid';
  const employmentType = form.elements.employmentType?.value || previousProfile.employmentType || 'Full-Time';
  const emailConflict = employeeData.some(row => row[0] !== originalName && row[1].toLowerCase() === email.toLowerCase());
  const accountConflict = userAccounts.some(account => account.name !== originalName && account.email.toLowerCase() === email.toLowerCase());
  if (emailConflict || accountConflict) {
    showToast('Email tersebut sudah digunakan karyawan atau akun lain.');
    return;
  }

  const empIndex = employeeData.findIndex(p => p[0] === originalName);
  let syncInfo = null;
  if (empIndex >= 0) {
    const oldEmail = employeeData[empIndex][1];
    employeeData[empIndex] = [name, email, dept, title, status];
    if (name !== originalName && employeeIdByName.has(originalName)) {
      employeeIdByName.set(name, employeeIdByName.get(originalName));
    }
    employeeProfileOverrides[name] = {
      ...previousProfile,
      gender: form.elements.gender?.value || previousProfile.gender || 'Belum diisi',
      birthDate: form.elements.birthDate?.value.trim() || previousProfile.birthDate || 'Belum diisi',
      phone: form.elements.phone?.value.trim() || previousProfile.phone || 'Belum diisi',
      address: form.elements.address?.value.trim() || previousProfile.address || 'Belum diisi',
      employmentType,
      workModel,
      joinDate: form.elements.joinDate?.value.trim() || previousProfile.joinDate || 'Belum diisi'
    };
    if (name !== originalName) delete employeeProfileOverrides[originalName];
    persistProfileOverrides();
    persistEmployeeData();
    syncInfo = syncEmployeeChange(originalName, oldEmail, { name, email, department: dept });
    updateDepartmentDropdowns();
  }
  document.querySelector('#editEmployeeDialog')?.close();
  openModule(moduleView.dataset.page || 'employees');
  const parts = [];
  if (syncInfo?.kpi) parts.push(`${syncInfo.kpi} KPI`);
  if (syncInfo?.dept) parts.push(`${syncInfo.dept} divisi`);
  if (syncInfo?.users) parts.push(`${syncInfo.users} akun`);
  showToast(`Data karyawan ${name} berhasil diperbarui.${parts.length ? ' Tersinkron ke ' + parts.join(', ') + '.' : ''}`);
});

// 6. Action Form Submit (Add event, leave request, applicant, payrun)
document.querySelector('#actionForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());

  if (activeAction === 'new-event') {
    const timeFormatted = values.time ? new Date(`2000-01-01T${values.time}`).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '09:00 AM';
    const parsedDate = values.date ? getCalendarItemDate({ date: values.date }, calendarDate) : new Date(calendarDate.getFullYear(), calendarDate.getMonth(), selectedDate);
    const day = parsedDate.getDate();
    const isoDate = values.date || `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const newEvent = {
      id: `cal-${Date.now()}`,
      day,
      date: isoDate,
      title: values.title,
      time: timeFormatted,
      location: values.location || 'Ruang Rapat',
      category: values.category || 'Talent Acquisition',
      note: values.note || '',
      tone: values.category === 'Employee Development' ? 1 : (values.category === 'Workplace Engagement' ? 2 : 0)
    };
    calendarItems.unshift(newEvent);
    persistCalendarItems();
    selectedDate = day;
    selectedCalendarEventId = newEvent.id;
    calendarDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1);
    moduleCalendarDate = new Date(calendarDate);
    openModule('calendar');
    const mName = new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(parsedDate);
    showToast(`Agenda "${values.title}" berhasil dijadwalkan pada tanggal ${day} ${mName}.`);
  } else if (activeAction === 'request-leave') {
    const newReq = {
      id: `lv-${Date.now()}`,
      name: userProfile.name,
      title: userProfile.role,
      type: values.type,
      submitDate: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()),
      period: `${values.start} s/d ${values.end}`,
      duration: '3 Days',
      reason: values.note || 'Keperluan pribadi',
      status: 'Pending'
    };
    leaveRequests.unshift(newReq);
    persistLeaveRequests();
    openModule('leave');
    showToast('Permohonan cuti berhasil diajukan dan sedang menunggu tinjauan manajer.');
  } else if (activeAction === 'add-candidate') {
    const newCand = {
      id: `app-${Date.now()}`,
      name: values.name,
      email: values.email,
      position: values.position,
      appliedDate: 'Hari Ini',
      type: values.workModel || 'Full-Time On-Site',
      stage: 'Application Received'
    };
    applicantsData.unshift(newCand);
    persistApplicants();
    openModule('recruitment');
    showToast(`Pelamar baru ${values.name} berhasil didaftarkan ke sistem.`);
  } else if (activeAction === 'new-payrun') {
    const total = employeeData.reduce((sum, person, index) => sum + (3590 - (index % 6) * 95), 0);
    payRunData.unshift({ id: `payrun-${Date.now()}`, period: values.period, paymentDate: values.paymentDate, employeeCount: employeeData.length, total, status: 'Siap ditinjau (demo)', createdAt: new Date().toISOString() });
    persistPayRuns();
    openModule('payroll');
    showToast(`Persiapan gaji ${values.period} tersimpan sebagai data demo. Belum ada transfer dana.`);
  } else if (activeAction === 'create-review') {
    reviewCycleData.unshift({ id: `review-${Date.now()}`, name: values.cycle, type: values.type, status: 'Dibuka (demo)', createdAt: new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date()) });
    persistReviewCycles();
    openModule('performance');
    showToast(`Periode penilaian "${values.cycle}" tersimpan sebagai data demo.`);
  }

  actionDialog.close();
  event.currentTarget.reset();
});

// Sync department dropdown options across modals
function updateDepartmentDropdowns() {
  const optionsHtml = departmentsData.map(d => `<option value="${safe(d.name)}">${safe(d.name)}</option>`).join('');
  document.querySelectorAll('#kpiFormDeptSelect, #editKpiDept, select[name="department"]').forEach(sel => {
    const curVal = sel.value;
    sel.innerHTML = optionsHtml;
    if (curVal && departmentsData.some(d => d.name === curVal)) {
      sel.value = curVal;
    }
  });
  updateEmployeeDatalist();
}

// Employee autocomplete for PIC / Division Head / User Account name fields
function updateEmployeeDatalist() {
  let list = document.querySelector('#employeeNameList');
  if (!list) {
    list = document.createElement('datalist');
    list.id = 'employeeNameList';
    document.body.appendChild(list);
  }
  list.innerHTML = employeeData.map(p => `<option value="${safe(p[0])}">${safe(p[3])} â€” ${safe(p[2])}</option>`).join('');
  document.querySelectorAll('input[name="pic"], input[name="head"], #userAccountForm input[name="name"], #editUserAccountForm input[name="name"]').forEach(inp => {
    inp.setAttribute('list', 'employeeNameList');
    inp.setAttribute('autocomplete', 'off');
  });
}
updateEmployeeDatalist();

// Auto-fill user account email/department/title when the name matches an employee
document.addEventListener('change', (event) => {
  const inp = event.target;
  if (!(inp instanceof HTMLInputElement) || inp.name !== 'name') return;
  const form = inp.closest('#userAccountForm, #editUserAccountForm');
  if (!form) return;
  const emp = findEmployeeByName(inp.value);
  if (!emp) return;
  inp.value = emp[0];
  if (form.elements.email && (!form.elements.email.value || form.id === 'userAccountForm')) form.elements.email.value = emp[1];
  if (form.elements.department && departmentsData.some(d => d.name === emp[2])) form.elements.department.value = emp[2];
  if (form.elements.title && !form.elements.title.value) form.elements.title.value = emp[3];
});

// KPI Form Submissions
document.querySelector('#kpiForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const title = (data.get('title') || '').trim();
  const dept = data.get('dept') || (departmentsData[0]?.name || 'Product Design');
  const pic = (data.get('pic') || '').trim() || userProfile.name;
  const target = Number(data.get('target'));
  const unit = (data.get('unit') || '%').trim();
  const weight = Number(data.get('weight'));
  const period = data.get('period') || 'Q2 2035';
  const lowerIsBetter = data.get('lowerIsBetter') === 'true';

  const newKpi = {
    id: `kpi-${Date.now()}`,
    title,
    dept,
    pic,
    target,
    actual: 0,
    unit,
    weight,
    period,
    lowerIsBetter,
    status: 'At Risk',
    notes: 'Target indikator kinerja baru.'
  };

  kpiData.unshift(newKpi);
  persistKpiData();
  form.reset();
  document.querySelector('#kpiDialog')?.close();
  openModule('kpi');
  showToast(`Indikator KPI "${title}" berhasil ditambahkan.`);
});

document.querySelector('#updateKpiForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('kpiId');
  const actual = Number(data.get('actual')) || 0;
  const notes = (data.get('notes') || '').trim();

  const kpi = kpiData.find(k => k.id === id);
  if (kpi) {
    kpi.actual = actual;
    if (notes) kpi.notes = notes;

    const score = calculateKpiScore(kpi);

    refreshKpiStatus(kpi);

    persistKpiData();
    document.querySelector('#updateKpiDialog')?.close();
    openModule('kpi');
    showToast(`Realisasi KPI "${kpi.title}" diperbarui (${Math.round(score)}% - ${kpi.status}).`);
  }
});

// Full Edit KPI Form Submit
document.querySelector('#editKpiForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('kpiId');
  const title = (data.get('title') || '').trim();
  const dept = data.get('dept');
  const pic = (data.get('pic') || '').trim();
  const target = Number(data.get('target'));
  const actual = Number(data.get('actual')) || 0;
  const unit = (data.get('unit') || '%').trim();
  const weight = Number(data.get('weight'));
  const period = data.get('period');
  const lowerIsBetter = data.get('lowerIsBetter') === 'true';
  const notes = (data.get('notes') || '').trim();

  const kpi = kpiData.find(k => k.id === id);
  if (kpi) {
    kpi.title = title;
    kpi.dept = dept;
    kpi.pic = pic;
    kpi.target = target;
    kpi.actual = actual;
    kpi.unit = unit;
    kpi.weight = weight;
    kpi.period = period;
    kpi.lowerIsBetter = lowerIsBetter;
    kpi.notes = notes;

    const score = calculateKpiScore(kpi);

    refreshKpiStatus(kpi);

    persistKpiData();
    document.querySelector('#editKpiDialog')?.close();
    openModule('kpi');
    showToast(`Perubahan indikator KPI "${title}" berhasil disimpan.`);
  }
});

// Division Form Submit (Create Division)
document.querySelector('#divisionForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = (data.get('name') || '').trim();
  const code = (data.get('code') || '').trim().toUpperCase() || name.slice(0, 3).toUpperCase();
  const head = (data.get('head') || '').trim() || 'PIC Divisi';
  const budget = (data.get('budget') || '').trim() || 'Rp 50.000.000';
  const description = (data.get('description') || '').trim() || 'Divisi operasional bisnis terintegrasi di Kharisma Hub.';

  if (departmentsData.some(d => d.name.toLowerCase() === name.toLowerCase())) {
    showToast(`Divisi dengan nama "${name}" sudah terdaftar.`);
    return;
  }

  const newDept = {
    id: `dept-${Date.now()}`,
    name,
    code,
    head,
    budget,
    description
  };

  departmentsData.push(newDept);
  persistDepartmentsData();
  updateDepartmentDropdowns();
  form.reset();
  document.querySelector('#divisionDialog')?.close();
  openModule('kpi');
  showToast(`Divisi baru "${name}" (${code}) berhasil ditambahkan.`);
});

// Edit Division Form Submit (Update Division)
document.querySelector('#editDivisionForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('deptId');
  const originalName = data.get('originalName');
  const name = (data.get('name') || '').trim();
  const code = (data.get('code') || '').trim().toUpperCase();
  const head = (data.get('head') || '').trim();
  const budget = (data.get('budget') || '').trim();
  const description = (data.get('description') || '').trim();

  const dept = departmentsData.find(d => d.id === id);
  if (dept) {
    dept.name = name;
    dept.code = code;
    dept.head = head;
    dept.budget = budget;
    dept.description = description;

    if (originalName && originalName !== name) {
      syncDepartmentRename(originalName, name);
    }

    persistDepartmentsData();
    updateDepartmentDropdowns();
    document.querySelector('#editDivisionDialog')?.close();
    openModule('kpi');
    showToast(`Data divisi "${name}" berhasil diperbarui.`);
  }
});

// User Account Form Submit (Create Account)
document.querySelector('#userAccountForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = (data.get('name') || '').trim();
  const email = (data.get('email') || '').trim();
  const role = data.get('role') || 'Employee';
  const department = data.get('department');
  const title = (data.get('title') || '').trim();

  if (userAccounts.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    showToast(`Email "${email}" sudah terdaftar di sistem.`);
    return;
  }

  if (authenticatedSupabaseSession) {
    if (!isAdmin()) return showToast('Hanya administrator yang dapat mengundang akun.');
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    window.KharismaAuth.adminRequest('POST', { name, email, role, department, title })
      .then(({ data: invited }) => {
        userAccounts.push({ id: invited.id, name, email, role, department: invited.department || department, title: invited.title || title, employeeId: invited.employee_id || '', status: invited.status || 'Pending', avatar: 'men/32', lastLogin: 'Undangan dikirim' });
        form.reset(); document.querySelector('#userAccountDialog')?.close(); openModule('kpi');
        showToast(`Undangan login berhasil dikirim ke ${email}. Pengguna perlu mengatur kata sandi melalui email.`);
      })
      .catch(error => showToast(error.message))
      .finally(() => { submit.disabled = false; });
    return;
  }

  const newAccount = {
    id: `usr-${Date.now()}`,
    name,
    email,
    role,
    department,
    title,
    status: 'Active',
    avatar: `${Math.random() > 0.5 ? 'women' : 'men'}/${Math.floor(Math.random() * 90) + 10}`,
    lastLogin: 'â€”'
  };

  userAccounts.push(newAccount);
  persistUserAccounts();
  const empAdded = !findEmployeeByName(name);
  if (empAdded) {
    employeeData.unshift([name, email, department, title || role, 'On-Time']);
    persistEmployeeData();
    updateEmployeeDatalist();
  }
  form.reset();
  document.querySelector('#userAccountDialog')?.close();
  openModule('kpi');
  showToast(`Akun demo "${name}" (${roleLabel(role)}) berhasil dibuat.${empAdded ? ' Ditambahkan juga ke direktori karyawan.' : ''}`);
});

// Edit User Account Form Submit
document.querySelector('#editUserAccountForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const id = data.get('userId');
  const name = (data.get('name') || '').trim();
  const email = (data.get('email') || '').trim();
  const role = data.get('role') || 'Supervisor';
  const department = data.get('department');
  const title = (data.get('title') || '').trim();
  const status = data.get('status') || 'Active';

  const usr = userAccounts.find(u => u.id === id);
  if (usr) {
    const oldName = usr.name;
    const oldEmail = usr.email;
    if (authenticatedSupabaseSession) {
      if (!isAdmin()) return showToast('Hanya administrator yang dapat mengubah akun.');
      const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
      window.KharismaAuth.adminRequest('PATCH', { id, name, email, role, department, title, status })
        .then(() => {
          Object.assign(usr, { name, email, role, department, title, status });
          const emp = findEmployeeByName(oldName) || employeeData.find(p => p[1].toLowerCase() === oldEmail.toLowerCase());
          if (emp) { emp[0] = name; emp[1] = email; if (role === 'Supervisor') emp[2] = department; persistEmployeeData(); }
          if (oldName !== name) syncEmployeeChange(oldName, null, { name });
          document.querySelector('#editUserAccountDialog')?.close(); openModule('kpi');
          showToast(`Akun ${name} berhasil diperbarui.`);
        })
        .catch(error => showToast(error.message))
        .finally(() => { submit.disabled = false; });
      return;
    }
    usr.name = name;
    usr.email = email;
    usr.role = role;
    usr.department = department;
    usr.title = title;
    usr.status = status;

    persistUserAccounts();

    // Propagate identity changes back to the employee directory, KPI PIC & division head
    const emp = findEmployeeByName(oldName) || employeeData.find(p => p[1].toLowerCase() === oldEmail.toLowerCase());
    if (emp) {
      emp[0] = name;
      emp[1] = email;
      if (role === 'Supervisor') emp[2] = department;
      if (oldName !== name && employeeIdByName.has(oldName)) employeeIdByName.set(name, employeeIdByName.get(oldName));
      persistEmployeeData();
    }
    if (oldName !== name) syncEmployeeChange(oldName, null, { name });
    updateEmployeeDatalist();
    document.querySelector('#editUserAccountDialog')?.close();
    openModule('kpi');
    showToast(`Data akun "${name}" berhasil diperbarui.`);
  }
});

// Account Switcher â€” listen for change on the #accountSwitcher select
document.addEventListener('change', (event) => {
  if (event.target.id === 'accountSwitcher') {
    const newId = event.target.value;
    const account = userAccounts.find(u => u.id === newId);
    if (account && account.status === 'Active' && isAdmin()) {
      activeAccountId = newId;
      persistActiveAccount();
      syncActiveProfileFromAccount(true);
      // Reset KPI tab filters when switching accounts
      if (moduleView) {
        delete moduleView.dataset.kpiDeptFilter;
        delete moduleView.dataset.kpiStatusFilter;
        moduleView.dataset.kpiTab = 'kpi-indicators';
      }
      openModule('kpi');
      showToast(`Mode simulasi: ${account.name} (${account.role}${account.role === 'Supervisor' ? ' â€” ' + account.department : ''})`);
    } else if (account) {
      event.target.value = activeAccountId;
      showToast('Hanya administrator yang dapat mengganti akun simulasi.');
    }
  }
});

// 7. Global Search Input
document.querySelector('#searchInput')?.addEventListener('input', (event) => {
  const query = event.target.value.toLowerCase().trim();
  if (!moduleView.hidden) {
    const page = moduleView.dataset.page;
    if (page === 'employees' || page === 'employee-grid') {
      const filter = moduleView.querySelector('[data-filter="employees"]');
      if (filter) {
        filter.value = query;
        filter.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      moduleView.querySelectorAll('.module-table tbody tr, .message-row, .employee-card').forEach((row) => {
        row.hidden = query !== '' && !row.textContent.toLowerCase().includes(query);
      });
    }
  } else {
    document.querySelectorAll('#employeeRows tr').forEach((row) => {
      row.hidden = query !== '' && !row.textContent.toLowerCase().includes(query);
    });
  }
});

// Attendance policy and employee self-service forms
document.addEventListener('submit', async (event) => {
  const correctionForm = event.target.closest('[data-attendance-correction]');
  if (correctionForm) {
    event.preventDefault();
    const attendanceId = correctionForm.dataset.attendanceId || userAttendanceRecord?.id;
    if (!attendanceId) { showToast('Koreksi hanya dapat diajukan untuk catatan tersimpan.'); return; }
    const data = new FormData(correctionForm);
    const reason = String(data.get('reason') || '').trim();
    if (!data.get('clockIn') && !data.get('clockOut')) { showToast('Isi jam masuk atau jam pulang yang ingin dikoreksi.'); return; }
    if (reason.length < 5) { showToast('Alasan koreksi minimal 5 karakter.'); return; }
    try {
      await window.KharismaDB.attendance.requestCorrection(attendanceId, { clock_in: data.get('clockIn') || null, clock_out: data.get('clockOut') || null }, reason);
      correctionForm.reset();
      showToast('Permintaan koreksi dikirim kepada atasan untuk ditinjau.');
    } catch (error) { showToast(error.message || 'Permintaan koreksi gagal dikirim.'); }
    return;
  }
  const configForm = event.target.closest('[data-attendance-config]');
  if (configForm) {
    event.preventDefault();
    if (!isAdmin()) { showToast('Hanya admin yang dapat mengubah lokasi kantor dan shift.'); return; }
    const data = new FormData(configForm);
    const office = { name: 'Kantor Utama', latitude: Number(data.get('latitude')), longitude: Number(data.get('longitude')), radius_m: Number(data.get('radius')) };
    const shiftValues = { name: String(data.get('shiftName')).trim(), start_time: data.get('startTime'), end_time: data.get('endTime'), tolerance_minutes: Number(data.get('tolerance') || 0), weekdays: [1,2,3,4,5], enabled: true };
    if (!Number.isFinite(office.latitude) || !Number.isFinite(office.longitude) || office.latitude < -90 || office.latitude > 90 || office.longitude < -180 || office.longitude > 180 || office.radius_m < 20 || office.radius_m > 5000) { showToast('Koordinat atau radius lokasi kantor tidak valid.'); return; }
    try {
      let locationRow = { ...office, id: `local-${Date.now()}` };
      let shiftRow = { ...shiftValues, id: `local-shift-${Date.now()}` };
      if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
        locationRow = await window.KharismaDB.attendance.saveOfficeLocation(office);
        shiftRow = await window.KharismaDB.attendance.saveShift(shiftValues);
      }
      const employeeId = String(data.get('employeeId'));
      if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) await window.KharismaDB.attendance.assignShift(employeeId, shiftRow.id);
      attendancePolicy.location = locationRow;
      attendancePolicy.shifts = [shiftRow, ...(attendancePolicy.shifts || []).filter(shift => shift.id !== shiftRow.id)];
      attendancePolicy.assignments = [...(attendancePolicy.assignments || []).filter(item => item.employee_id !== employeeId), { employee_id: employeeId, shift_id: shiftRow.id }];
      writeStoredValue('teamhub.attendancePolicy', attendancePolicy);
      moduleView.innerHTML = pageMarkup('attendance'); setupTablePagination();
      showToast(window.KharismaDB?.isConnected && authenticatedSupabaseSession ? 'Lokasi, shift, dan penugasan berhasil disimpan.' : 'Kebijakan demo tersimpan di perangkat ini.');
    } catch (error) { showToast(error.message || 'Pengaturan absensi gagal disimpan.'); }
    return;
  }
  const assignmentForm = event.target.closest('[data-attendance-assignment]');
  if (assignmentForm) {
    event.preventDefault();
    if (userProfile.role !== 'Supervisor' && !isAdmin()) { showToast('Akses penetapan shift ditolak.'); return; }
    const data = new FormData(assignmentForm), selectedEmployeeId = String(data.get('employeeId')), shiftId = String(data.get('shiftId'));
    const targetEmployeeIds = selectedEmployeeId === '__department__'
      ? employeeData.filter(person => person[2] === userProfile.department).map(person => `EMP-${getEmployeeId(person)}`)
      : [selectedEmployeeId];
    try {
      if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) await Promise.all(targetEmployeeIds.map(employeeId => window.KharismaDB.attendance.assignShift(employeeId, shiftId)));
      const targets = new Set(targetEmployeeIds);
      attendancePolicy.assignments = [...(attendancePolicy.assignments || []).filter(item => !targets.has(item.employee_id)), ...targetEmployeeIds.map(employee_id => ({ employee_id, shift_id: shiftId }))];
      writeStoredValue('teamhub.attendancePolicy', attendancePolicy);
      moduleView.innerHTML = pageMarkup('attendance'); setupTablePagination(); showToast(window.KharismaDB?.isConnected && authenticatedSupabaseSession ? 'Shift karyawan berhasil diperbarui.' : 'Penugasan demo tersimpan di perangkat ini.');
    } catch (error) { showToast(error.message || 'Penetapan shift gagal.'); }
  }
});

// 8. ModuleView delegation listener for all interactive elements
moduleView.addEventListener('click', async (event) => {
  const btn = event.target.closest('button, [data-action], [data-label], th');
  if (!btn) return;

  const action = btn.dataset?.action;

  // View Employee Detail
  if (action === 'view-employee') {
    selectedEmployeeName = btn.dataset.name || 'Mia Torres';
    const currentFile = window.location.pathname.split('/').pop().toLowerCase() || 'index.html';
    if (currentFile !== 'employees.html' && !window.location.protocol.startsWith('file')) {
      window.location.href = `employees.html?name=${encodeURIComponent(selectedEmployeeName)}`;
    } else {
      if (window.history && window.history.pushState) {
        window.history.pushState(null, '', `employees.html?name=${encodeURIComponent(selectedEmployeeName)}`);
      }
      openModule('employee-details', false, { name: selectedEmployeeName });
    }
    return;
  }

  // Edit Employee
  if (action === 'edit-employee') {
    if (!isAdmin()) { showToast('Hanya administrator yang dapat mengubah data karyawan.'); return; }
    const name = btn.dataset.name;
    const emp = employeeData.find(p => p[0] === name);
    if (!emp) return;
    const dialog = document.querySelector('#editEmployeeDialog');
    const profile = getEmployeeProfile(name);
    const departmentSelect = document.querySelector('#editEmployeeDepartment');
    if (departmentSelect) {
      const departmentOptions = [...new Set([...departmentsData.map(d => d.name), emp[2]])];
      departmentSelect.innerHTML = departmentOptions.map(department => `<option value="${safe(department)}">${safe(department)}</option>`).join('');
    }
    document.querySelector('#editEmployeeOriginalName').value = emp[0];
    document.querySelector('#editEmployeeName').value = emp[0];
    document.querySelector('#editEmployeeEmail').value = emp[1];
    document.querySelector('#editEmployeeDepartment').value = emp[2];
    document.querySelector('#editEmployeeTitle').value = emp[3];
    document.querySelector('#editEmployeeStatus').value = emp[4];
    const setEmployeeField = (selector, value) => { const field = document.querySelector(selector); if (field) field.value = value; };
    setEmployeeField('#editEmployeeWorkModel', profile.workModel);
    setEmployeeField('#editEmployeeGender', profile.gender);
    setEmployeeField('#editEmployeeBirthDate', profile.birthDate === 'Belum diisi' ? '' : profile.birthDate);
    setEmployeeField('#editEmployeePhone', profile.phone === 'Belum diisi' ? '' : profile.phone);
    setEmployeeField('#editEmployeeAddress', profile.address === 'Belum diisi' ? '' : profile.address);
    setEmployeeField('#editEmployeeEmploymentType', profile.employmentType);
    setEmployeeField('#editEmployeeJoinDate', profile.joinDate === 'Belum diisi' ? '' : profile.joinDate);
    dialog.showModal();
    return;
  }

  // Delete Employee
  if (action === 'delete-employee') {
    if (!isAdmin()) { showToast('Hanya administrator yang dapat menghapus karyawan.'); return; }
    const name = btn.dataset.name;
    const links = getEmployeeLinks(name);
    let msg = `Yakin ingin menghapus ${name} dari direktori karyawan?`;
    const warn = [];
    if (links.kpi) warn.push(`PIC pada ${links.kpi} KPI`);
    if (links.dept.length) warn.push(`Kepala divisi ${links.dept.join(', ')}`);
    if (links.users.length) warn.push(`${links.users.length} akun pengguna (akan dinonaktifkan)`);
    if (warn.length) msg += `\n\nData terkait:\n- ${warn.join('\n- ')}`;
    if (confirm(msg)) {
      const idx = employeeData.findIndex(p => p[0] === name);
      if (idx >= 0) {
        const employeeId = `EMP-${getEmployeeId(employeeData[idx])}`;
        if (authenticatedSupabaseSession && links.users.length && window.KharismaAuth?.adminRequest) {
          try {
            for (const account of links.users.filter(item => item.id !== authenticatedSupabaseSession.user.id)) {
              await window.KharismaAuth.adminRequest('PATCH', { id: account.id, status: 'Inactive' });
            }
          } catch (error) {
            showToast(`Karyawan belum dihapus karena akun terkait gagal dinonaktifkan: ${error.message}`);
            return;
          }
        }
        let cloudDeleteQueued = false;
        if (authenticatedSupabaseSession && window.KharismaDB) {
          await employeeCloudWriteQueue;
          const result = await window.KharismaDB.employees.delete(employeeId);
          if (!result?.ok) { showToast(`Karyawan belum dihapus dari cloud: ${result?.error || 'sinkronisasi gagal'}.`); return; }
          cloudDeleteQueued = Boolean(result.queued);
        }
        employeeData.splice(idx, 1);
        persistEmployeeData();
        if (links.users.length) {
          links.users.forEach(u => { if (u.id !== 'usr-admin') u.status = 'Inactive'; });
          persistUserAccounts();
        }
        updateEmployeeDatalist();
        showToast(`${name} telah dihapus dari daftar karyawan.${cloudDeleteQueued ? ' Penghapusan cloud masuk antrean sinkronisasi.' : ''}${links.users.length ? ' Akun terkait dinonaktifkan.' : ''}`);
        openModule(moduleView.dataset.page || 'employees');
      }
    }
    return;
  }

  // Show Payslip Modal
  if (action === 'show-payslip') {
    const name = btn.dataset.name || selectedEmployeeName;
    openPayslipModal(name);
    return;
  }

  // Calendar Month Navigation
  if (action === 'prev-cal-month') {
    selectedCalendarEventId = null;
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    openModule('calendar');
    renderDashboardMiniCalendar();
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate);
    showToast(`Bulan kalender: ${monthName}`);
    return;
  }

  if (action === 'next-cal-month') {
    selectedCalendarEventId = null;
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    openModule('calendar');
    renderDashboardMiniCalendar();
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate);
    showToast(`Bulan kalender: ${monthName}`);
    return;
  }

  // Calendar Day Click
  if (action === 'pick-calendar-day') {
    const day = Number(btn.dataset.day);
    selectedDate = day;
    selectedCalendarEventId = null;
    moduleView.querySelectorAll('.calendar-cell').forEach(cell => cell.classList.remove('active-date'));
    btn.closest('.calendar-cell')?.classList.add('active-date');
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate);
    const heading = moduleView.querySelector('#selectedScheduleDate');
    if (heading) heading.textContent = `${day} ${monthName}`;
    const detailsContainer = moduleView.querySelector('#calendarDetailsList');
    if (detailsContainer) detailsContainer.innerHTML = getCalendarScheduleCards(day);
    renderDashboardMiniCalendar();
    renderDashboardScheduleList(day);
    showToast(`Menampilkan jadwal untuk tanggal ${day} ${monthName}`);
    return;
  }

  // Open Agenda Event
  if (action === 'open-agenda-event') {
    const day = Number(btn.dataset.day) || selectedDate;
    const title = btn.dataset.title;
    selectedCalendarEventId = btn.dataset.id || null;
    selectedDate = day;
    moduleView.querySelectorAll('.calendar-cell').forEach(cell => cell.classList.remove('active-date'));
    btn.closest('.calendar-cell')?.classList.add('active-date');
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate);
    const heading = moduleView.querySelector('#selectedScheduleDate');
    if (heading) heading.textContent = `${day} ${monthName}`;
    const detailsContainer = moduleView.querySelector('#calendarDetailsList');
    if (detailsContainer) detailsContainer.innerHTML = getCalendarScheduleCards(day, selectedCalendarEventId);
    renderDashboardMiniCalendar();
    renderDashboardScheduleList(day);
    showToast(`Detail agenda: ${title} (${day} ${monthName})`);
    return;
  }

  // Delete Calendar Event
  if (action === 'delete-calendar-event') {
    const id = btn.dataset.id;
    const idx = calendarItems.findIndex(item => item.id === id);
    if (idx >= 0) {
      if (String(selectedCalendarEventId) === String(id)) selectedCalendarEventId = null;
      calendarItems.splice(idx, 1);
      persistCalendarItems();
      openModule('calendar');
      showToast('Agenda berhasil dihapus.');
    }
    return;
  }

  // Calendar Category Filter
  if (action === 'calendar-filter') {
    const categories = ['Semua Kategori', 'Talent Acquisition', 'Employee Development', 'Workplace Engagement'];
    const cur = moduleView.dataset.calFilter || 'Semua Kategori';
    const next = categories[(categories.indexOf(cur) + 1) % categories.length];
    moduleView.dataset.calFilter = next;
    btn.innerHTML = `${next === 'Semua Kategori' ? 'Filter' : next} <span>âŒ„</span>`;
    moduleView.querySelectorAll('.calendar-event').forEach(ev => {
      const title = ev.dataset.title;
      const item = calendarItems.find(c => c.title === title);
      ev.style.display = (next === 'Semua Kategori' || item?.category === next) ? '' : 'none';
    });
    showToast(`Filter agenda kalender: ${next}`);
    return;
  }

  // Calendar Mode Toggle
  if (action === 'calendar-mode') {
    const modes = ['Month', 'Week', 'Day'];
    const cur = moduleView.dataset.calMode || 'Month';
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    moduleView.dataset.calMode = next;
    btn.innerHTML = `${next} <span>âŒ„</span>`;
    showToast(`Mode kalender diubah ke: ${next}`);
    return;
  }

  // Collapse Agenda Sidebar
  if (action === 'collapse-agenda') {
    const panel = moduleView.querySelector('.agenda-filters');
    if (panel) {
      const isClosed = panel.style.display === 'none';
      panel.style.display = isClosed ? '' : 'none';
      showToast(isClosed ? 'Panel filter ditampilkan' : 'Panel filter disembunyikan');
    }
    return;
  }

  // Close Schedule Details Panel
  if (action === 'close-schedule-details') {
    const details = moduleView.querySelector('.schedule-details');
    if (details) {
      const isClosed = details.style.display === 'none';
      details.style.display = isClosed ? '' : 'none';
      showToast(isClosed ? 'Detail jadwal ditampilkan' : 'Detail jadwal ditutup');
    }
    return;
  }

  // Leave Approval Actions
  if (action === 'approve-request' || action === 'decline-request') {
    const id = btn.dataset.id;
    const req = leaveRequests.find(r => r.id === id);
    if (req) {
      req.status = action === 'approve-request' ? 'Approved' : 'Rejected';
      persistLeaveRequests();

      if (action === 'approve-request') {
        const existing = calendarItems.find(item => item.id === `cal-leave-${req.id}`);
        if (!existing) {
          calendarItems.unshift({
            id: `cal-leave-${req.id}`,
            day: 19,
            date: '2035-06-19',
            title: `Cuti Disetujui: ${req.name} (${req.type})`,
            time: 'Sepanjang Hari',
            location: req.reason || 'Cuti Pegawai',
            category: 'Workplace Engagement',
            note: `Permohonan cuti disetujui: ${req.period} (${req.duration})`,
            tone: 2
          });
          persistCalendarItems();
        }
      }

      openModule('leave');
      showToast(`Permintaan cuti dari ${req.name} telah ${action === 'approve-request' ? 'disetujui dan disinkronkan ke kalender' : 'ditolak'}.`);
    }
    return;
  }

  // Advance Applicant Stage
  if (action === 'advance-candidate-stage') {
    const id = btn.dataset.id;
    const cand = applicantsData.find(c => c.id === id);
    if (cand) {
      const stages = ['Application Received', 'Interview Scheduled', 'Final Interview', 'Test Completed', 'Hired'];
      const currentIdx = stages.indexOf(cand.stage);
      cand.stage = stages[Math.min(stages.length - 1, currentIdx + 1)];
      persistApplicants();
      openModule('recruitment');
      showToast(`Status pelamar ${cand.name} dimajukan ke: ${cand.stage}`);
    }
    return;
  }

  // Delete Applicant
  if (action === 'delete-candidate') {
    const id = btn.dataset.id;
    const idx = applicantsData.findIndex(c => c.id === id);
    if (idx >= 0) {
      const name = applicantsData[idx].name;
      applicantsData.splice(idx, 1);
      persistApplicants();
      openModule('recruitment');
      showToast(`Pelamar ${name} berhasil dihapus.`);
    }
    return;
  }

  // Add Candidate / Event / Payrun / Review dialogs
  if (['new-event', 'request-leave', 'add-candidate', 'create-review', 'new-payrun'].includes(action)) {
    if (action === 'new-payrun' && !isAdmin()) { showToast('Hanya administrator yang dapat menyiapkan proses gaji.'); return; }
    openActionDialog(action);
    return;
  }

  // Clock-in / Clock-out button in Attendance
  
  // Dashboard Interactive Navigation Cards
  if (action === 'nav-employees') { openModule('employees'); return; }
  if (action === 'nav-attendance') { openModule('attendance'); return; }
  if (action === 'nav-leave') { openModule('leave'); return; }
  if (action === 'nav-recruitment') { openModule('recruitment'); return; }

  // Contextual Kebab Option Actions
  if (action === 'kebab-employees') {
    event.stopPropagation();
    document.querySelector('#employeeDialog')?.showModal();
    return;
  }
  if (action === 'kebab-attendance') {
    event.stopPropagation();
    openModule('attendance');
    return;
  }
  if (action === 'kebab-leave') {
    event.stopPropagation();
    openActionDialog('request-leave');
    return;
  }
  if (action === 'kebab-recruitment') {
    event.stopPropagation();
    openActionDialog('add-candidate');
    return;
  }

  if (action === 'attendance-transition') { await performAttendanceTransition(btn.dataset.transition); return; }
  if (action === 'attendance-review-correction' || action === 'attendance-review-overtime') {
    if (!isAdmin() && userProfile.role !== 'Supervisor') { showToast('Anda tidak memiliki akses persetujuan.'); return; }
    try {
      if (action === 'attendance-review-correction') await window.KharismaDB.attendance.reviewCorrection(btn.dataset.id, btn.dataset.decision, 'Ditinjau melalui aplikasi');
      else await window.KharismaDB.attendance.reviewOvertime(btn.dataset.id, btn.dataset.decision === 'true');
      attendanceReviewQueue = await window.KharismaDB.attendance.getReviewQueue();
      cloudAttendanceRecords = await window.KharismaDB.attendance.getAll();
      moduleView.innerHTML = pageMarkup('attendance'); setupTablePagination();
      showToast('Keputusan persetujuan berhasil disimpan.');
    } catch (error) { showToast(error.message || 'Keputusan tidak dapat disimpan.'); }
    return;
  }
  if (action === 'clock-in') {
    const date = attendanceTodayKey();
    const state = userAttendanceRecord && (userAttendanceRecord.dateKey === date || isActiveOvernightAttendance(userAttendanceRecord)) ? userAttendanceRecord.state : null;
    await performAttendanceTransition(!state ? 'clock_in' : state === 'on_break' ? 'break_end' : state === 'working' ? 'clock_out' : 'clock_in');
    return;
  }

  // Switch Employee Views (Grid / Table)
  if (action === 'employee-grid-view') { openModule('employee-grid'); return; }
  if (action === 'employee-table-view') { openModule('employees'); return; }
  if (action === 'add-employee-page') { openModule('employee-add'); return; }
  if (action === 'back-employees') {
    if (window.history && window.history.pushState) {
      window.history.pushState(null, '', 'employees.html');
    }
    openModule('employees');
    return;
  }

  // Employee Pagination
  if (action === 'employee-page') {
    employeeCurrentPage = Number(btn.dataset.page) || 1;
    openModule('employees');
    const table = moduleView.querySelector('.employees-table');
    if (table) table.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  // Employee Department Quick Filter
  if (action === 'employee-filter') {
    const depts = ['Semua Divisi', 'Product Design', 'Marketing', 'Operations', 'Human Resources', 'Customer Service', 'R&D'];
    const cur = moduleView.dataset.deptFilter || 'Semua Divisi';
    const next = depts[(depts.indexOf(cur) + 1) % depts.length];
    moduleView.dataset.deptFilter = next;
    btn.textContent = next === 'Semua Divisi' ? 'Filter <span>âŒ„</span>' : `${next} <span>âŒ„</span>`;
    moduleView.querySelectorAll('.employees-table tbody tr, .employee-cards .employee-card').forEach(row => {
      row.hidden = next !== 'Semua Divisi' && !row.textContent.includes(next);
    });
    showToast(`Menyaring karyawan: ${next}`);
    return;
  }

  // Attendance Status Filter
  if (action === 'attendance-filter') {
    const menu = moduleView.querySelector('#attendanceFilterDropdown');
    if (menu) {
      menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
    }
    return;
  }

  if (action === 'set-att-filter') {
    const status = btn.dataset.status;
    moduleView.dataset.attFilter = status;
    const filterBtn = moduleView.querySelector('#attendanceFilterBtn');
    if (filterBtn) filterBtn.innerHTML = `${status === 'Semua Status' ? 'Filter' : status} <span>âŒ„</span>`;
    const menu = moduleView.querySelector('#attendanceFilterDropdown');
    if (menu) menu.style.display = 'none';
    moduleView.querySelectorAll('.attendance-full-table tbody tr').forEach(row => {
      const rowStatus = row.querySelector('.status')?.textContent.trim() || '';
      row.hidden = status !== 'Semua Status' && rowStatus !== status;
    });
    showToast(`Filter absensi: ${status}`);
    return;
  }

  // Payroll Filter
  if (action === 'payroll-filter') {
    const statuses = ['Semua', 'Paid', 'Pending'];
    const cur = moduleView.dataset.payFilter || 'Semua';
    const next = statuses[(statuses.indexOf(cur) + 1) % statuses.length];
    moduleView.dataset.payFilter = next;
    btn.textContent = next === 'Semua' ? 'Filter <span>âŒ„</span>' : `${next} <span>âŒ„</span>`;
    moduleView.querySelectorAll('.payroll-table tbody tr').forEach(row => {
      row.hidden = next !== 'Semua' && !row.textContent.includes(next);
    });
    showToast(`Filter status gaji: ${next}`);
    return;
  }

  // Leave Filter
  if (action === 'leave-filter') {
    const statuses = ['Semua', 'Approved', 'Pending', 'Rejected'];
    const cur = moduleView.dataset.lvFilter || 'Semua';
    const next = statuses[(statuses.indexOf(cur) + 1) % statuses.length];
    moduleView.dataset.lvFilter = next;
    btn.textContent = next === 'Semua' ? 'Filter <span>âŒ„</span>' : `${next} <span>âŒ„</span>`;
    moduleView.querySelectorAll('.leave-table tbody tr').forEach(row => {
      row.hidden = next !== 'Semua' && !row.textContent.includes(next);
    });
    showToast(`Filter permohonan cuti: ${next}`);
    return;
  }

  // KPI & Division Actions
  if (action === 'switch-kpi-tab') {
    const targetTab = btn.dataset.tab;
    moduleView.dataset.kpiTab = targetTab;
    openModule('kpi');
    return;
  }

  if (action === 'new-division') {
    const dialog = document.querySelector('#divisionDialog');
    if (dialog) dialog.showModal();
    return;
  }

  if (action === 'edit-division') {
    const id = btn.dataset.id;
    const dept = departmentsData.find(d => d.id === id);
    if (dept) {
      document.querySelector('#editDeptId').value = dept.id;
      document.querySelector('#editDeptOriginalName').value = dept.name;
      document.querySelector('#editDeptName').value = dept.name;
      document.querySelector('#editDeptCode').value = dept.code || '';
      document.querySelector('#editDeptHead').value = dept.head || '';
      document.querySelector('#editDeptBudget').value = dept.budget || '';
      document.querySelector('#editDeptDescription').value = dept.description || '';
      document.querySelector('#editDivisionDialog')?.showModal();
    }
    return;
  }

  if (action === 'delete-division') {
    const id = btn.dataset.id;
    const name = btn.dataset.name;
    const linkedKpi = kpiData.filter(k => k.dept === name);
    const linkedEmployees = employeeData.filter(p => p[2] === name);
    const linkedUsers = userAccounts.filter(u => u.department === name && u.role === 'Supervisor');
    let confirmMsg = `Yakin ingin menghapus divisi "${name}"?`;
    if (linkedKpi.length || linkedEmployees.length || linkedUsers.length) {
      confirmMsg += `\nPerhatian: Ada ${linkedKpi.length} target KPI, ${linkedEmployees.length} karyawan, dan ${linkedUsers.length} akun supervisor di divisi ini.`;
      if (linkedUsers.length) confirmMsg += `\nAkun supervisor divisi ini akan dinonaktifkan.`;
    }
    if (confirm(confirmMsg)) {
      const idx = departmentsData.findIndex(d => d.id === id);
      if (idx >= 0) {
        departmentsData.splice(idx, 1);
        persistDepartmentsData();
        if (linkedUsers.length) {
          linkedUsers.forEach(u => { u.status = 'Inactive'; });
          persistUserAccounts();
          if (linkedUsers.some(u => u.id === activeAccountId)) {
            activeAccountId = 'usr-admin';
            persistActiveAccount();
          }
        }
        updateDepartmentDropdowns();
        openModule('kpi');
        showToast(`Divisi "${name}" berhasil dihapus.`);
      }
    }
    return;
  }

  if (action === 'view-dept-kpi') {
    const deptName = btn.dataset.dept;
    moduleView.dataset.kpiTab = 'kpi-indicators';
    moduleView.dataset.kpiDeptFilter = deptName;
    openModule('kpi');
    showToast(`Menampilkan target KPI divisi: ${deptName}`);
    return;
  }

  if (action === 'new-kpi') {
    updateDepartmentDropdowns();
    const dialog = document.querySelector('#kpiDialog');
    if (dialog) dialog.showModal();
    return;
  }

  if (action === 'edit-kpi-progress') {
    const id = btn.dataset.id;
    const kpi = kpiData.find(k => k.id === id);
    if (kpi) {
      const dialog = document.querySelector('#updateKpiDialog');
      if (dialog) {
        document.querySelector('#updateKpiId').value = kpi.id;
        document.querySelector('#updateKpiTitleBanner').textContent = `${kpi.title} â€” Divisi: ${kpi.dept} (PIC: ${kpi.pic})`;
        document.querySelector('#updateKpiTargetDisplay').value = `${kpi.target} ${kpi.unit}`;
        document.querySelector('#updateKpiActual').value = kpi.actual !== undefined ? kpi.actual : '';
        const notesEl = dialog.querySelector('[name="notes"]');
        if (notesEl) notesEl.value = kpi.notes || '';
        dialog.showModal();
      }
    }
    return;
  }

  if (action === 'edit-kpi-full') {
    const id = btn.dataset.id;
    const kpi = kpiData.find(k => k.id === id);
    if (kpi) {
      updateDepartmentDropdowns();
      document.querySelector('#editKpiId').value = kpi.id;
      document.querySelector('#editKpiTitle').value = kpi.title;
      document.querySelector('#editKpiDept').value = kpi.dept;
      document.querySelector('#editKpiPic').value = kpi.pic;
      document.querySelector('#editKpiTarget').value = kpi.target;
      document.querySelector('#editKpiActualField').value = kpi.actual !== undefined ? kpi.actual : '';
      document.querySelector('#editKpiUnit').value = kpi.unit;
      document.querySelector('#editKpiWeight').value = kpi.weight;
      document.querySelector('#editKpiPeriod').value = kpi.period;
      document.querySelector('#editKpiDirection').value = kpi.lowerIsBetter ? 'true' : 'false';
      document.querySelector('#editKpiNotes').value = kpi.notes || '';
      document.querySelector('#editKpiDialog')?.showModal();
    }
    return;
  }

  if (action === 'delete-kpi') {
    const targetKpi = kpiData.find(item => item.id === btn.dataset.id);
    if (!isAdmin() && targetKpi?.dept !== getActiveDepartment()) { showToast('Anda hanya dapat menghapus KPI divisi sendiri.'); return; }
    const id = btn.dataset.id;
    const idx = kpiData.findIndex(k => k.id === id);
    if (idx >= 0) {
      const title = kpiData[idx].title;
      if (confirm(`Yakin ingin menghapus target KPI "${title}"?`)) {
        let cloudDeleteQueued = false;
        if (authenticatedSupabaseSession && window.KharismaDB) {
          await kpiCloudWriteQueue;
          const result = await window.KharismaDB.kpi.delete(id);
          if (!result?.ok) { showToast(`KPI belum dihapus dari cloud: ${result?.error || 'sinkronisasi gagal'}.`); return; }
          cloudDeleteQueued = Boolean(result.queued);
        }
        kpiData.splice(idx, 1);
        persistKpiData();
        openModule('kpi');
        showToast(`Target KPI "${title}" berhasil dihapus.${cloudDeleteQueued ? ' Penghapusan cloud masuk antrean sinkronisasi.' : ''}`);
      }
    }
    return;
  }

  if (action === 'kpi-dept-filter') {
    const depts = ['Semua Divisi', ...getDepartmentNames()];
    const cur = moduleView.dataset.kpiDeptFilter || 'Semua Divisi';
    const next = depts[(depts.indexOf(cur) + 1) % depts.length];
    moduleView.dataset.kpiDeptFilter = next;
    btn.innerHTML = `${next} <span>âŒ„</span>`;
    const statusFilter = moduleView.dataset.kpiStatusFilter || 'Semua Status';
    moduleView.querySelectorAll('.kpi-table tbody tr').forEach(row => {
      const deptMatch = next === 'Semua Divisi' || row.dataset.kpiDept === next;
      const statusMatch = statusFilter === 'Semua Status' || row.dataset.kpiStatus === statusFilter;
      row.hidden = !deptMatch || !statusMatch;
    });
    showToast(`Filter divisi KPI: ${next}`);
    return;
  }

  if (action === 'kpi-status-filter') {
    const statuses = ['Semua Status', 'Exceeded', 'On-Track', 'At Risk'];
    const cur = moduleView.dataset.kpiStatusFilter || 'Semua Status';
    const next = statuses[(statuses.indexOf(cur) + 1) % statuses.length];
    moduleView.dataset.kpiStatusFilter = next;
    btn.innerHTML = `${next} <span>âŒ„</span>`;
    const deptFilter = moduleView.dataset.kpiDeptFilter || 'Semua Divisi';
    moduleView.querySelectorAll('.kpi-table tbody tr').forEach(row => {
      const deptMatch = deptFilter === 'Semua Divisi' || row.dataset.kpiDept === deptFilter;
      const statusMatch = next === 'Semua Status' || row.dataset.kpiStatus === next;
      row.hidden = !deptMatch || !statusMatch;
    });
    showToast(`Filter status KPI: ${next}`);
    return;
  }

  if (action === 'export-kpi') {
    const headers = ['ID', 'Indikator KPI', 'Departemen', 'PIC', 'Periode', 'Bobot (%)', 'Target', 'Satuan', 'Realisasi Terkini', 'Capaian (%)', 'Status', 'Catatan Progres'];
    const rows = kpiData.map(k => {
      const score = calculateKpiScore(k);
      const scoreFormatted = Math.round(score * 10) / 10;
      return [
        k.id,
        k.title,
        k.dept,
        k.pic,
        k.period,
        `${k.weight}%`,
        k.target,
        k.unit,
        k.actual !== undefined ? k.actual : 'â€”',
        `${scoreFormatted}%`,
        k.status,
        k.notes || 'â€”'
      ];
    });
    downloadCsv('laporan-kpi-kharisma-hub.csv', [headers, ...rows]);
    return;
  }

  // User Account Management Actions
  if (action === 'new-user-account') {
    const dialog = document.querySelector('#userAccountDialog');
    if (dialog) {
      document.querySelector('#userAccountForm')?.reset();
      // Populate department dropdown
      const deptSelect = document.querySelector('#userAcctDept');
      if (deptSelect) {
        deptSelect.innerHTML = departmentsData.map(d => `<option value="${d.name}">${d.name}</option>`).join('');
      }
      // Populate employee dropdown for easy selection
      const empSelect = document.querySelector('#userAcctEmployeeSelect');
      if (empSelect) {
        empSelect.innerHTML = '<option value="">-- Pilih karyawan atau isi manual --</option>' +
          employeeData.map(emp => `<option value="${safe(emp[1])}" data-name="${safe(emp[0])}" data-dept="${safe(emp[2])}" data-title="${safe(emp[3])}">${safe(emp[0])} — ${safe(emp[1])} (${safe(emp[2])})</option>`).join('');
        empSelect.onchange = () => {
          const opt = empSelect.options[empSelect.selectedIndex];
          if (opt && opt.value) {
            const nameInput = document.querySelector('#userAcctName');
            const emailInput = document.querySelector('#userAcctEmail');
            const deptInput = document.querySelector('#userAcctDept');
            const titleInput = document.querySelector('#userAcctTitle');
            if (nameInput) nameInput.value = opt.dataset.name || '';
            if (emailInput) emailInput.value = opt.value;
            if (deptInput && opt.dataset.dept) deptInput.value = opt.dataset.dept;
            if (titleInput && opt.dataset.title) titleInput.value = opt.dataset.title;
          }
        };
      }
      dialog.showModal();
    }
    return;
  }

  if (action === 'edit-user-account') {
    const id = btn.dataset.id;
    const usr = userAccounts.find(u => u.id === id);
    if (usr) {
      const dialog = document.querySelector('#editUserAccountDialog');
      if (dialog) {
        document.querySelector('#editUserAcctId').value = usr.id;
        document.querySelector('#editUserAcctName').value = usr.name;
        document.querySelector('#editUserAcctEmail').value = usr.email;
        document.querySelector('#editUserAcctRole').value = usr.role;
        const deptSelect = document.querySelector('#editUserAcctDept');
        if (deptSelect) {
          deptSelect.innerHTML = departmentsData.map(d => `<option value="${d.name}" ${d.name === usr.department ? 'selected' : ''}>${d.name}</option>`).join('');
        }
        document.querySelector('#editUserAcctTitle').value = usr.title || '';
        document.querySelector('#editUserAcctStatus').value = usr.status || 'Active';
        dialog.showModal();
      }
    }
    return;
  }

  if (action === 'resend-invite-user') {
    const email = btn.dataset.email;
    if (!email) return;
    if (authenticatedSupabaseSession) {
      if (!isAdmin()) return showToast('Hanya administrator yang dapat mengirim ulang undangan.');
      btn.disabled = true;
      window.KharismaAuth.adminRequest('POST', { action: 'resend_invite', email })
        .then(res => showToast(res.message || `Undangan login telah dikirim ulang ke ${email}.`))
        .catch(err => showToast(`Gagal: ${err.message}`))
        .finally(() => { btn.disabled = false; });
    } else {
      showToast(`(Mode Demo) Undangan simulasi dikirim ulang ke ${email}.`);
    }
    return;
  }

  if (action === 'reset-password-user') {
    const email = btn.dataset.email;
    if (!email) return;
    if (!confirm(`Kirim email pemulihan/reset kata sandi ke ${email}?`)) return;
    if (authenticatedSupabaseSession) {
      btn.disabled = true;
      window.KharismaAuth.adminRequest('POST', { action: 'reset_password', email })
        .then(res => showToast(res.message || `Tautan reset kata sandi telah dikirim ke ${email}.`))
        .catch(err => showToast(`Gagal: ${err.message}`))
        .finally(() => { btn.disabled = false; });
    } else {
      showToast(`(Mode Demo) Tautan reset kata sandi dikirim ke ${email}.`);
    }
    return;
  }

  if (action === 'toggle-status-user') {
    const id = btn.dataset.id;
    const usr = userAccounts.find(u => u.id === id);
    if (!usr) return;
    if (id === 'usr-admin' || id === authenticatedSupabaseSession?.user?.id) {
      showToast('Akun administrator yang sedang digunakan tidak dapat dinonaktifkan.');
      return;
    }
    const nextStatus = usr.status === 'Inactive' ? 'Active' : 'Inactive';
    const msg = nextStatus === 'Inactive'
      ? `Nonaktifkan akun "${usr.name}"? Pengguna tidak akan dapat masuk sistem.`
      : `Aktifkan kembali akun "${usr.name}"? Sesi login akan dibuka kembali.`;
    if (!confirm(msg)) return;

    if (authenticatedSupabaseSession) {
      btn.disabled = true;
      window.KharismaAuth.adminRequest('PATCH', { id, status: nextStatus })
        .then(() => {
          usr.status = nextStatus;
          openModule('kpi');
          showToast(`Status akun ${usr.name} diubah menjadi ${nextStatus === 'Active' ? 'Aktif' : 'Nonaktif'}.`);
        })
        .catch(err => showToast(`Gagal mengubah status: ${err.message}`))
        .finally(() => { btn.disabled = false; });
      return;
    }
    usr.status = nextStatus;
    persistUserAccounts();
    openModule('kpi');
    showToast(`Status akun ${usr.name} diubah menjadi ${nextStatus}.`);
    return;
  }

  if (action === 'delete-user-account') {
    const id = btn.dataset.id;
    if (id === 'usr-admin' || id === authenticatedSupabaseSession?.user?.id) {
      showToast(id === authenticatedSupabaseSession?.user?.id ? 'Akun yang sedang digunakan tidak dapat dihapus.' : 'Akun administrator utama tidak dapat dihapus.');
      return;
    }
    const usr = userAccounts.find(u => u.id === id);
    if (!usr) return;
    if (!confirm(`Hapus permanen akun "${usr.name}" (${roleLabel(usr.role)})?\n\nPERINGATAN: Akun login dan data profil pengguna akan dihapus permanen dari sistem!`)) {
      return;
    }
    if (authenticatedSupabaseSession) {
      btn.disabled = true;
      window.KharismaAuth.adminRequest('DELETE', { id })
        .then(() => {
          const idx = userAccounts.findIndex(u => u.id === id);
          if (idx >= 0) userAccounts.splice(idx, 1);
          persistUserAccounts();
          openModule('kpi');
          showToast(`Akun ${usr.name} berhasil dihapus permanen.`);
        })
        .catch(error => showToast(`Gagal: ${error.message}`))
        .finally(() => { btn.disabled = false; });
      return;
    }
    const idx = userAccounts.findIndex(u => u.id === id);
    if (idx >= 0) {
      userAccounts.splice(idx, 1);
      persistUserAccounts();
      openModule('kpi');
      showToast(`Akun "${usr.name}" dihapus dari simulasi lokal.`);
    }
    return;
  }

  // Save Employee Draft in Add Employee Wizard
  if (action === 'save-employee-draft') {
    const form = moduleView.querySelector('#employeePageForm');
    if (form) {
      const data = Object.fromEntries(new FormData(form).entries());
      employeeDraft = data;
      writeStoredValue('teamhub.employeeDraft', data);
      showToast('Draf formulir karyawan berhasil disimpan.');
    }
    return;
  }

  // Applicant Tabs
  const applicantTab = btn.closest('[data-stage]');
  if (applicantTab) {
    moduleView.querySelectorAll('[data-stage]').forEach(t => t.classList.toggle('active', t === applicantTab));
    const stage = applicantTab.dataset.stage;
    moduleView.querySelectorAll('.applicants-table tbody tr').forEach((row) => {
      row.hidden = stage !== 'All' && row.dataset.appStage !== stage;
    });
    return;
  }

  // Export Attendance CSV
  if (action === 'export-attendance') {
    const headers = ['Nama', 'Jabatan', 'Tanggal', 'Model Kerja', 'Jam Kerja', 'Durasi', 'Lembur', 'Status'];
    const source = Array.isArray(cloudAttendanceRecords) ? cloudAttendanceRecords : (userAttendanceRecord ? [userAttendanceRecord] : []);
    const rows = source.map(record => {
      const employee = employeeData.find(person => person[1]?.toLowerCase() === String(record.employee_name || record.name || '').toLowerCase());
      const rawDate = String(record.date || record.dateKey || attendanceTodayKey());
      const date = new Date(`${rawDate.slice(0,10)}T00:00:00+07:00`);
      return [record.employee_name || record.name || userProfile.name, employee?.[3] || 'Karyawan', new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date), record.work_model || record.workModel || 'â€”', `${record.clock_in || record.clockIn || 'â€”'} - ${record.clock_out || record.clockOut || 'Belum pulang'}`, record.duration || 'â€”', record.overtime || 'â€”', record.state && record.state !== 'completed' ? 'Belum Lengkap' : ({ 'On-Time': 'Tepat Waktu', Late: 'Terlambat', 'On Leave': 'Cuti', Absent: 'Tidak Hadir' }[record.status] || record.status || 'â€”')];
    });
    downloadCsv('laporan-kehadiran-kharisma-hub.csv', [headers, ...rows]);
    return;
  }

  // Export Payroll CSV
  if (action === 'export-payroll') {
    const headers = ['Nama Karyawan', 'ID', 'Jabatan', 'Departemen', 'Gaji Pokok', 'Tunjangan', 'Status'];
    const rows = employeeData.map(p => [
      p[0], `EMP-${getEmployeeId(p)}`, p[3], p[2], 'Rp3.200.000', 'Rp300.000', 'Paid'
    ]);
    downloadCsv('laporan-penggajian-kharisma-hub.csv', [headers, ...rows]);
    return;
  }

  // Table pagination
  if (action === 'table-page') {
    showTablePage(btn.dataset.page);
    return;
  }

  // Multi-step Employee Form Navigation
  if (action === 'employee-next-panel' || action === 'employee-prev-panel') {
    const panels = [...moduleView.querySelectorAll('.employee-add-panel')];
    const current = panels.indexOf(btn.closest('.employee-add-panel'));
    panels[Math.max(0, Math.min(panels.length - 1, current + (action === 'employee-next-panel' ? 1 : -1)))]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  /* ---------------- INBOX ACTIONS ---------------- */
  // Select message
  if (action === 'select-message') {
    selectedMailId = Number(btn.dataset.id) || btn.dataset.id;
    const allMails = [...inboxData, ...sentMail, ...draftMail, ...archivedMail, ...trashedMail];
    const target = allMails.find(m => String(m.id) === String(selectedMailId));
    if (target) target.unread = false;
    persistMailbox();
    renderInboxPage();
    return;
  }

  // Toggle star
  if (action === 'toggle-star') {
    const id = btn.dataset.id;
    const allMails = [...inboxData, ...sentMail, ...draftMail, ...archivedMail, ...trashedMail];
    const target = allMails.find(m => String(m.id) === String(id));
    if (target) {
      target.starred = !target.starred;
      persistMailbox();
      btn.classList.toggle('starred', target.starred);
      showToast(target.starred ? 'Pesan ditandai bintang.' : 'Tanda bintang dihapus.');
    }
    return;
  }

  // Archive message
  if (action === 'archive-message') {
    const idx = inboxData.findIndex(m => String(m.id) === String(selectedMailId));
    if (idx >= 0) {
      const [msg] = inboxData.splice(idx, 1);
      archivedMail.unshift(msg);
    }
    persistMailbox();
    const next = visibleMail()[0];
    if (next) selectedMailId = next.id;
    renderInboxPage();
    showToast('Pesan berhasil dipindahkan ke Arsip.');
    return;
  }

  // Delete message
  if (action === 'delete-message') {
    const idx = inboxData.findIndex(m => String(m.id) === String(selectedMailId));
    if (idx >= 0) {
      const [msg] = inboxData.splice(idx, 1);
      trashedMail.unshift(msg);
    }
    persistMailbox();
    const next = visibleMail()[0];
    if (next) selectedMailId = next.id;
    renderInboxPage();
    showToast('Pesan berhasil dipindahkan ke Sampah.');
    return;
  }

  // Print message
  if (action === 'print-message') {
    window.print();
    return;
  }

  // Mail more options
  if (action === 'mail-more') {
    const message = [...inboxData, ...sentMail, ...draftMail, ...archivedMail, ...trashedMail, ...spamMail].find(item => String(item.id) === String(selectedMailId));
    if (!message) { showToast('Pilih pesan terlebih dahulu.'); return; }
    const choice = window.prompt('Opsi pesan:\n1. Tandai belum dibaca/dibaca\n2. Ubah label\n3. Unduh pesan (.txt)');
    if (choice === '1') {
      message.unread = !message.unread;
      persistMailbox(); renderInboxPage();
      showToast(message.unread ? 'Pesan ditandai belum dibaca.' : 'Pesan ditandai sudah dibaca.');
    } else if (choice === '2') {
      const label = window.prompt('Masukkan label: HR, Leave Requests, Interview, atau Admin Notes', message.label || 'HR');
      if (label && ['HR', 'Leave Requests', 'Interview', 'Admin Notes'].includes(label)) {
        message.label = label; persistMailbox(); renderInboxPage(); showToast(`Label pesan diubah menjadi ${label}.`);
      } else if (label) showToast('Label tidak dikenal.');
    } else if (choice === '3') {
      const content = [`Dari: ${message.from} <${message.email}>`, `Tanggal: ${message.date} ${message.time}`, `Subjek: ${message.subject}`, '', ...(message.body || [])].join('\n');
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `${String(message.subject || 'pesan').replace(/[^\p{L}\p{N}-]+/gu, '-')}.txt`; link.click(); URL.revokeObjectURL(url);
      showToast('Pesan diunduh sebagai berkas teks.');
    }
    return;
  }

  // Mail prev / next
  if (action === 'mail-prev' || action === 'mail-next') {
    const mails = visibleMail();
    const curIdx = mails.findIndex(m => String(m.id) === String(selectedMailId));
    if (action === 'mail-prev' && curIdx > 0) {
      selectedMailId = mails[curIdx - 1].id;
      mails[curIdx - 1].unread = false;
      renderInboxPage();
    } else if (action === 'mail-next' && curIdx < mails.length - 1) {
      selectedMailId = mails[curIdx + 1].id;
      mails[curIdx + 1].unread = false;
      renderInboxPage();
    }
    return;
  }

  // Mail back
  if (action === 'mail-back') {
    renderInboxPage();
    showToast('Kembali ke daftar pesan.');
    return;
  }

  // New message button
  if (action === 'new-message') {
    const composer = moduleView.querySelector('#mailComposer');
    if (composer) {
      const toInput = composer.querySelector('[name="recipient"]');
      if (toInput) { toInput.value = ''; toInput.focus(); }
      const bodyEl = composer.querySelector('.compose-body');
      if (bodyEl) bodyEl.innerHTML = '';
      composer.scrollIntoView({ behavior: 'smooth' });
      showToast('Formulir pesan baru siap ditulis.');
    }
    return;
  }

  // Reply message
  if (action === 'reply-message' || action === 'forward-message') {
    const allMails = [...inboxData, ...sentMail, ...draftMail, ...archivedMail, ...trashedMail];
    const currentMail = allMails.find(m => String(m.id) === String(selectedMailId));
    if (currentMail) {
      const composer = moduleView.querySelector('#mailComposer');
      if (composer) {
        const toInput = composer.querySelector('[name="recipient"]');
        const bodyEl = composer.querySelector('.compose-body');
        if (action === 'reply-message') {
          if (toInput) toInput.value = currentMail.email || currentMail.from;
          if (bodyEl) {
            bodyEl.innerHTML = `<br><br><blockquote style="border-left:2px solid #0962ea;padding-left:8px;color:#64748b;font-size:12px">Pada ${currentMail.date}, ${currentMail.from} menulis:<br>${currentMail.body.join('<br>')}</blockquote>`;
            bodyEl.focus();
          }
          showToast(`Membalas pesan dari ${currentMail.from}`);
        } else {
          if (toInput) { toInput.value = ''; toInput.focus(); }
          if (bodyEl) {
            bodyEl.innerHTML = `<br><br><blockquote style="border-left:2px solid #64748b;padding-left:8px;color:#64748b;font-size:12px">---------- Pesan Diteruskan ----------<br>Dari: ${currentMail.from} &lt;${currentMail.email}&gt;<br>Tanggal: ${currentMail.date}<br>Subjek: ${currentMail.subject}<br><br>${currentMail.body.join('<br>')}</blockquote>`;
          }
          showToast('Pesan siap diteruskan. Masukkan alamat penerima.');
        }
        composer.scrollIntoView({ behavior: 'smooth' });
      }
    }
    return;
  }

  // Toggle Cc & Bcc
  if (action === 'toggle-cc') {
    const row = moduleView.querySelector('#composeCcRow');
    if (row) row.style.display = row.style.display === 'none' ? 'flex' : 'none';
    return;
  }
  if (action === 'toggle-bcc') {
    const row = moduleView.querySelector('#composeBccRow');
    if (row) row.style.display = row.style.display === 'none' ? 'flex' : 'none';
    return;
  }

  // Expand Composer
  if (action === 'expand-composer') {
    const composer = moduleView.querySelector('#mailComposer');
    if (composer) {
      composer.classList.toggle('expanded');
      showToast(composer.classList.contains('expanded') ? 'Formulir pesan diperbesar' : 'Ukuran formulir normal');
    }
    return;
  }

  // Formatting actions
  if (action === 'undo-compose') { document.execCommand('undo', false, null); return; }
  if (action === 'redo-compose') { document.execCommand('redo', false, null); return; }
  if (action === 'format-bold') { document.execCommand('bold', false, null); return; }
  if (action === 'format-italic') { document.execCommand('italic', false, null); return; }
  if (action === 'format-underline') { document.execCommand('underline', false, null); return; }

  // Save Draft
  if (action === 'save-draft') {
    const composer = moduleView.querySelector('#mailComposer');
    if (composer) {
      const to = composer.querySelector('[name="recipient"]')?.value.trim() || 'Tanpa Penerima';
      const bodyText = composer.querySelector('.compose-body')?.innerText.trim() || '(Draf kosong)';
      const newDraft = {
        id: `draft-${Date.now()}`,
        from: userProfile.name,
        email: userProfile.email,
        subject: `Draf untuk ${to}`,
        preview: bodyText.slice(0, 60),
        time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        date: 'Hari Ini',
        initials: initials(userProfile.name),
        color: 'avatar-davis',
        label: 'HR',
        body: [bodyText],
        unread: false,
        starred: false
      };
      draftMail.unshift(newDraft);
      persistMailbox();
      showToast('Draf pesan berhasil disimpan.');
    }
    return;
  }

  // Delete Draft
  if (action === 'delete-draft') {
    const draftIndex = draftMail.findIndex(mail => String(mail.id) === String(selectedMailId));
    if (draftIndex >= 0) { draftMail.splice(draftIndex, 1); persistMailbox(); renderInboxPage(); showToast('Draf dihapus.'); return; }
    const composer = moduleView.querySelector('#mailComposer');
    if (composer) {
      const bodyEl = composer.querySelector('.compose-body');
      if (bodyEl) bodyEl.innerHTML = '';
      showToast('Draf dibersihkan.');
    }
    return;
  }

  // Mail Filter Toggle (Unread only)
  if (action === 'mail-filter') {
    unreadOnly = !unreadOnly;
    btn.classList.toggle('active', unreadOnly);
    renderInboxPage();
    showToast(unreadOnly ? 'Menampilkan hanya email belum dibaca' : 'Menampilkan semua email');
    return;
  }

  // Mail Folder Selection
  if (btn.matches('.folder-button')) {
    activeMailFolder = btn.dataset.folder;
    unreadOnly = false;
    const first = visibleMail()[0];
    if (first) selectedMailId = first.id;
    renderInboxPage();
    return;
  }

  // Mail Labels
  const labelBtn = btn.closest('[data-label]');
  if (labelBtn) {
    activeMailFolder = labelBtn.dataset.label;
    unreadOnly = false;
    const first = visibleMail()[0];
    if (first) selectedMailId = first.id;
    renderInboxPage();
    showToast(`Menampilkan label: ${activeMailFolder}`);
    return;
  }

  // Interactive Table Column Header Sorting
  if (btn.tagName === 'TH' && btn.closest('.employees-table')) {
    const colIndex = [...btn.parentElement.children].indexOf(btn);
    // Columns: 0: cb, 1: id, 2: name, 3: title, 4: dept, 5: empType, 6: workModel, 7: joinDate, 8: status
    let sortKey = -1;
    if (colIndex === 1) sortKey = -2; // id
    else if (colIndex === 2) sortKey = 0; // name
    else if (colIndex === 3) sortKey = 3; // title
    else if (colIndex === 4) sortKey = 2; // dept
    else if (colIndex === 8) sortKey = 4; // status

    if (sortKey !== -1) {
      const isAsc = btn.dataset.sortDir !== 'asc';
      btn.dataset.sortDir = isAsc ? 'asc' : 'desc';
      if (sortKey === -2) {
        employeeData.sort((a, b) => isAsc ? getEmployeeId(a).localeCompare(getEmployeeId(b)) : getEmployeeId(b).localeCompare(getEmployeeId(a)));
      } else {
        employeeData.sort((a, b) => isAsc ? a[sortKey].localeCompare(b[sortKey]) : b[sortKey].localeCompare(a[sortKey]));
      }
      openModule('employees');
      showToast(`Tabel diurutkan berdasarkan ${btn.textContent.replace(/[â†•\s]/g, '')} (${isAsc ? 'A-Z' : 'Z-A'})`);
      return;
    }
  }

  // Interactive Attendance Table Column Header Sorting
  if (btn.tagName === 'TH' && btn.closest('.attendance-full-table')) {
    const table = btn.closest('.attendance-full-table');
    const tbody = table.querySelector('tbody');
    const colIndex = Number(btn.dataset.col ?? [...btn.parentElement.children].indexOf(btn));
    const isAsc = btn.dataset.sortDir !== 'asc';

    table.querySelectorAll('th').forEach(th => {
      th.classList.remove('sort-asc', 'sort-desc', 'sort-active-th');
      th.dataset.sortDir = '';
    });
    btn.dataset.sortDir = isAsc ? 'asc' : 'desc';
    btn.classList.add(isAsc ? 'sort-asc' : 'sort-desc', 'sort-active-th');

    const rows = [...tbody.querySelectorAll('tr')];
    rows.sort((rowA, rowB) => {
      const textA = rowA.children[colIndex]?.innerText.trim() || '';
      const textB = rowB.children[colIndex]?.innerText.trim() || '';
      return isAsc ? textA.localeCompare(textB, undefined, { numeric: true }) : textB.localeCompare(textA, undefined, { numeric: true });
    });
    rows.forEach(r => tbody.appendChild(r));
    showToast(`Tabel absensi diurutkan: ${btn.textContent.replace(/[â†•\s]/g, '')} (${isAsc ? 'A-Z' : 'Z-A'})`);
    return;
  }

  // Interactive KPI Table Column Header Sorting
  if (btn.tagName === 'TH' && btn.closest('.kpi-table')) {
    const colIndex = Number(btn.dataset.col ?? [...btn.parentElement.children].indexOf(btn));
    const isAsc = btn.dataset.sortDir !== 'asc';
    btn.dataset.sortDir = isAsc ? 'asc' : 'desc';

    kpiData.sort((a, b) => {
      let valA, valB;
      if (colIndex === 0) { valA = a.title; valB = b.title; }
      else if (colIndex === 1) { valA = a.dept; valB = b.dept; }
      else if (colIndex === 2) { valA = a.period; valB = b.period; }
      else if (colIndex === 3) { valA = Number(a.weight) || 0; valB = Number(b.weight) || 0; }
      else if (colIndex === 4) { valA = Number(a.target) || 0; valB = Number(b.target) || 0; }
      else if (colIndex === 5) { valA = Number(a.actual) || 0; valB = Number(b.actual) || 0; }
      else if (colIndex === 6) {
        valA = calculateKpiScore(a);
        valB = calculateKpiScore(b);
      }
      else if (colIndex === 7) { valA = a.status; valB = b.status; }
      else return 0;

      if (typeof valA === 'number' && typeof valB === 'number') {
        return isAsc ? valA - valB : valB - valA;
      }
      return isAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
    });

    openModule('kpi');
    showToast(`Tabel KPI diurutkan: ${btn.textContent.replace(/[â†•\s]/g, '')} (${isAsc ? 'A-Z' : 'Z-A'})`);
    return;
  }
});

// Filter input inside modules
moduleView.addEventListener('input', (event) => {
  if (event.target.id === 'mailSearch') {
    renderMailList();
    const first = visibleMail()[0];
    if (first) selectedMailId = first.id;
    renderMailReader();
    return;
  }

  const filter = event.target.closest('[data-filter]');
  if (!filter) return;
  const query = filter.value.toLowerCase().trim();
  const filterType = filter.dataset.filter;

  if (filterType === 'employees') {
    if (moduleView.dataset.page === 'employee-grid') {
      moduleView.querySelectorAll('.employee-card').forEach((card) => {
        card.hidden = !card.innerText.toLowerCase().includes(query);
      });
    } else {
      moduleView.querySelectorAll('.employees-table tbody tr').forEach((row) => {
        row.hidden = query !== '' && !row.textContent.toLowerCase().includes(query);
      });
    }
  } else {
    moduleView.querySelectorAll('.module-table tbody tr').forEach((row) => {
      row.hidden = query !== '' && !row.textContent.toLowerCase().includes(query);
    });
  }
});

// Dropdown change listener inside moduleView
moduleView.addEventListener('change', (event) => {
  if (event.target.id === 'attendanceSortSelect') {
    const colIndex = Number(event.target.value);
    const th = moduleView.querySelector(`.attendance-full-table th[data-col="${colIndex}"]`);
    if (th) th.click();
  }
});

// Form Submissions inside moduleView (Employee form & Mail Composer)
moduleView.addEventListener('submit', (event) => {
  if (event.target.id === 'employeePageForm') {
    event.preventDefault();
    if (!isAdmin()) { showToast('Hanya administrator yang dapat menambahkan karyawan.'); return; }
    const data = new FormData(event.target);
    const name = `${data.get('firstName')?.trim() || ''} ${data.get('lastName')?.trim() || ''}`.trim() || 'New Employee';
    const email = data.get('email')?.trim() || `${name.toLowerCase().replace(/\s+/g, '.')}@kharismahub.com`;
    const dept = data.get('department') || 'Product Design';
    const title = data.get('title')?.trim() || 'Staff';

    employeeData.unshift([name, email, dept, title, 'On-Time']);
    getEmployeeId(name);
    persistEmployeeData();
    employeeCurrentPage = 1;
    openModule('employees');
    showToast(`Karyawan baru ${name} berhasil didaftarkan.`);
    return;
  }

  if (event.target.id === 'mailComposer') {
    event.preventDefault();
    const form = event.target;
    const to = form.querySelector('[name="recipient"]')?.value.trim() || 'Penerima';
    const bodyEl = form.querySelector('.compose-body');
    const bodyText = bodyEl?.innerText.trim() || 'Pesan terkirim';
    const newSent = {
      id: `sent-${Date.now()}`,
      from: userProfile.name,
      email: userProfile.email,
      subject: `Pesan untuk ${to}`,
      preview: bodyText.slice(0, 70),
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      date: 'Hari Ini',
      initials: initials(userProfile.name),
      color: 'avatar-davis',
      label: 'HR',
      body: [bodyText],
      unread: false,
      starred: false
    };
    sentMail.unshift(newSent);
    persistMailbox();
    if (bodyEl) bodyEl.innerHTML = '';
    showToast(`Pesan tersimpan di folder Terkirim (demo lokal). Belum dikirim kepada ${to}.`);
    return;
  }
});

/* ==========================================================================
   Global Search Autocomplete & Theme/Mobile Setup
   ========================================================================== */

function setupGlobalSearch() {
  const searchInput = document.querySelector('#searchInput');
  if (!searchInput) return;

  const searchBox = searchInput.closest('.search-box') || searchInput.parentElement;
  if (!searchBox) return;
  searchBox.classList.add('global-search-container');

  let dropdown = document.querySelector('#globalSearchDropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'globalSearchDropdown';
    dropdown.className = 'global-search-dropdown';
    dropdown.style.display = 'none';
    searchBox.appendChild(dropdown);
  }

  searchInput.addEventListener('input', (event) => {
    const query = event.target.value.toLowerCase().trim();
    if (query.length < 2) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
      return;
    }

    const matchedEmployees = employeeData.filter(p => 
      p[0].toLowerCase().includes(query) || p[2].toLowerCase().includes(query) || p[3].toLowerCase().includes(query)
    ).slice(0, 4);

    const matchedCalendar = calendarItems.filter(item => 
      item.title.toLowerCase().includes(query) || (item.location && item.location.toLowerCase().includes(query))
    ).slice(0, 3);

    const matchedLeaves = leaveRequests.filter(req => 
      req.name.toLowerCase().includes(query) || req.type.toLowerCase().includes(query)
    ).slice(0, 3);

    const matchedMails = inboxData.filter(mail => 
      mail.from.toLowerCase().includes(query) || mail.subject.toLowerCase().includes(query)
    ).slice(0, 3);

    const matchedKpis = kpiData.filter(k => 
      k.title.toLowerCase().includes(query) || k.dept.toLowerCase().includes(query) || k.pic.toLowerCase().includes(query)
    ).slice(0, 3);

    const hasResults = matchedEmployees.length || matchedCalendar.length || matchedLeaves.length || matchedMails.length || matchedKpis.length;
    if (!hasResults) {
      dropdown.innerHTML = `<div style="padding:12px;text-align:center;font-size:12px;color:#64748b">Tidak ada hasil pencarian untuk "${safe(query)}"</div>`;
      dropdown.style.display = 'flex';
      return;
    }

    let html = '';
    if (matchedEmployees.length) {
      html += `<div class="search-group-title">Karyawan</div>`;
      matchedEmployees.forEach((p, idx) => {
        html += `
          <button type="button" class="search-result-item" data-search-type="employee" data-name="${safe(p[0])}">
            ${avatar(p[0], `p${(idx % 9) + 1}`)}
            <div class="search-item-info">
              <strong>${safe(p[0])}</strong>
              <small>${safe(p[3])} Â· ${safe(p[2])}</small>
            </div>
            <span class="search-item-badge">Karyawan</span>
          </button>
        `;
      });
    }

    if (matchedKpis.length) {
      html += `<div class="search-group-title">Target &amp; KPI</div>`;
      matchedKpis.forEach(k => {
        html += `
          <button type="button" class="search-result-item" data-search-type="kpi" data-id="${k.id}">
            <div class="search-item-info">
              <strong>${safe(k.title)}</strong>
              <small>${safe(k.dept)} Â· Target: ${k.target} ${safe(k.unit)} Â· ${safe(k.status)}</small>
            </div>
            <span class="search-item-badge" style="background:#e0e7ff;color:#4338ca">KPI</span>
          </button>
        `;
      });
    }

    if (matchedCalendar.length) {
      html += `<div class="search-group-title">Agenda Kalender</div>`;
      matchedCalendar.forEach(item => {
        html += `
          <button type="button" class="search-result-item" data-search-type="calendar" data-day="${item.day}">
            <div class="search-item-info">
              <strong>${safe(item.title)}</strong>
              <small>${item.day} Juni Â· ${safe(item.time)} Â· ${safe(item.location || '')}</small>
            </div>
            <span class="search-item-badge" style="background:#e0f2fe;color:#0369a1">Agenda</span>
          </button>
        `;
      });
    }

    if (matchedLeaves.length) {
      html += `<div class="search-group-title">Cuti &amp; Izin</div>`;
      matchedLeaves.forEach(req => {
        html += `
          <button type="button" class="search-result-item" data-search-type="leave" data-id="${req.id}">
            <div class="search-item-info">
              <strong>${safe(req.name)} (${safe(req.type)})</strong>
              <small>${safe(req.period)} Â· ${safe(req.status)}</small>
            </div>
            <span class="search-item-badge" style="background:#fef3c7;color:#b45309">Cuti</span>
          </button>
        `;
      });
    }

    if (matchedMails.length) {
      html += `<div class="search-group-title">Pesan Inbox</div>`;
      matchedMails.forEach(mail => {
        html += `
          <button type="button" class="search-result-item" data-search-type="inbox" data-id="${mail.id}">
            <div class="search-item-info">
              <strong>${safe(mail.subject)}</strong>
              <small>Dari: ${safe(mail.from)} Â· ${safe(mail.time)}</small>
            </div>
            <span class="search-item-badge" style="background:#f3e8ff;color:#7e22ce">Inbox</span>
          </button>
        `;
      });
    }

    dropdown.innerHTML = html;
    dropdown.style.display = 'flex';
  });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (!item) return;
    const type = item.dataset.searchType;
    dropdown.style.display = 'none';
    searchInput.value = '';

    if (type === 'employee') {
      const name = item.dataset.name;
      selectedEmployeeName = name;
      openModule('employee-details', true, { name });
    } else if (type === 'kpi') {
      openModule('kpi');
    } else if (type === 'calendar') {
      selectedDate = Number(item.dataset.day);
      openModule('calendar');
    } else if (type === 'leave') {
      openModule('leave');
    } else if (type === 'inbox') {
      selectedMailId = Number(item.dataset.id) || item.dataset.id;
      openModule('inbox');
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchBox.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dropdown.style.display = 'none';
  });
}

function setupThemeAndMobile() {
  const savedTheme = localStorage.getItem('teamhub.theme') || 'light';
  if (savedTheme === 'dark') {
    document.body.classList.add('theme-dark');
  }

  const headerActions = document.querySelector('.top-actions') || document.querySelector('.header-actions');
  if (headerActions && !document.querySelector('#themeToggleBtn')) {
    const themeBtn = document.createElement('button');
    themeBtn.type = 'button';
    themeBtn.id = 'themeToggleBtn';
    themeBtn.className = 'top-icon theme-toggle-btn';
    themeBtn.setAttribute('aria-label', 'Toggle Dark Mode');
    themeBtn.title = document.body.classList.contains('theme-dark') ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap';
    themeBtn.innerHTML = document.body.classList.contains('theme-dark') ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

    const userChip = headerActions.querySelector('.user-chip') || headerActions.querySelector('#profileButton');
    if (userChip) {
      headerActions.insertBefore(themeBtn, userChip);
    } else {
      headerActions.appendChild(themeBtn);
    }

    themeBtn.addEventListener('click', () => {
      const isDark = document.body.classList.toggle('theme-dark');
      localStorage.setItem('teamhub.theme', isDark ? 'dark' : 'light');
      themeBtn.innerHTML = isDark ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>' : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      themeBtn.title = isDark ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap';
      showToast(isDark ? 'Mode Gelap (Dark Mode) aktif' : 'Mode Terang (Light Mode) aktif');
    });
  }

  const topbar = document.querySelector('.topbar');
  if (topbar && !document.querySelector('#mobileMenuBtn')) {
    const mobileBtn = document.createElement('button');
    mobileBtn.type = 'button';
    mobileBtn.id = 'mobileMenuBtn';
    mobileBtn.className = 'mobile-menu-btn top-icon';
    mobileBtn.setAttribute('aria-label', 'Menu Navigasi');
    mobileBtn.title = 'Buka Navigasi';
    mobileBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    topbar.prepend(mobileBtn);

    mobileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) {
        const isOpen = sidebar.classList.toggle('mobile-open');
        mobileBtn.innerHTML = isOpen ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
      }
    });

    document.addEventListener('click', (e) => {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar && sidebar.classList.contains('mobile-open') && !sidebar.contains(e.target) && e.target !== mobileBtn) {
        sidebar.classList.remove('mobile-open');
        mobileBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
      }
    });
  }
}

function setupDashboardControls() {
  if (window.__dashboardControlsInitialized) return;
  window.__dashboardControlsInitialized = true;

  setupGlobalSearch();
  setupThemeAndMobile();
  renderDashboardSummary();

  // Calendar month buttons
  document.querySelector('#prevMonth')?.addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderDashboardMiniCalendar();
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate);
    showToast(`Kalender: ${monthName}`);
  });

  document.querySelector('#nextMonth')?.addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderDashboardMiniCalendar();
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate);
    showToast(`Kalender: ${monthName}`);
  });

  document.querySelector('#monthButton')?.addEventListener('click', () => {
    const now = new Date();
    calendarDate = new Date(now.getFullYear(), now.getMonth(), 1);
    selectedDate = now.getDate();
    renderDashboardMiniCalendar();
    renderDashboardScheduleList(selectedDate);
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate);
    showToast(`Kalender disetel ulang ke ${monthName}`);
  });

  document.querySelector('#scheduleDate')?.addEventListener('click', () => {
    openActionDialog('new-event', selectedDate);
  });

  document.querySelector('#attendanceDate')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const states = ['This Month', 'Today', 'This Week'];
    const cur = btn.dataset.state || 'This Month';
    const next = states[(states.indexOf(cur) + 1) % states.length];
    btn.dataset.state = next;
    btn.innerHTML = `${next} <span>âŒ„</span>`;
    showToast(`Filter absensi dasbor: ${next}`);
  });

  document.querySelectorAll('.period-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const periods = ['This Month', 'Last Month', 'Last 6 Months', 'This Year'];
      const cur = btn.dataset.period || 'This Month';
      const next = periods[(periods.indexOf(cur) + 1) % periods.length];
      btn.dataset.period = next;
      btn.innerHTML = `${next} <span>âŒ„</span>`;
      showToast(`Periode data diubah ke: ${next}`);
    });
  });

  document.querySelector('.promo-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    showToast('Kharisma Hub Pro Enterprise: Semua fitur premium telah aktif.');
  });

  // Task list checkboxes persistence in Dashboard
  const savedTasks = readStoredValue('teamhub.dashboardTasks', [false, false, true]);
  document.querySelectorAll('.task-row input[type="checkbox"]').forEach((cb, idx) => {
    if (savedTasks[idx] !== undefined) cb.checked = savedTasks[idx];
    cb.addEventListener('change', () => {
      savedTasks[idx] = cb.checked;
      writeStoredValue('teamhub.dashboardTasks', savedTasks);
      showToast(cb.checked ? 'Tugas ditandai selesai.' : 'Tugas dibuka kembali.');
    });
  });

  // Kebab option menus
  document.addEventListener('click', (event) => {
    const kebab = event.target.closest('.kebab');
    if (kebab) {
      event.stopPropagation();
      const choice = window.prompt('Menu opsi:\n1. Ekspor tabel ke CSV\n2. Cetak halaman\n3. Muat ulang tampilan');
      if (choice === '1') {
        const table = kebab.closest('.module-card')?.querySelector('table') || moduleView?.querySelector('table');
        if (!table) { showToast('Tidak ada tabel pada bagian ini untuk diekspor.'); return; }
        const rows = [...table.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => cell.innerText.trim()));
        const page = moduleView?.dataset.page || 'laporan';
        downloadCsv(`${page}-export.csv`, rows);
      } else if (choice === '2') {
        window.print();
      } else if (choice === '3') {
        const page = moduleView?.dataset.page;
        if (page) openModule(page);
      }
    }
  });
}


// ============================================================================
// Robust Document-Level Delegated Form Handler
// Ensures all forms submit properly across SPA transitions and subpages
// ============================================================================
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!form || !form.id) return;

  // These static dialogs already have dedicated submit handlers above. Letting
  // the event bubble into this delegated fallback submitted the same records a
  // second time (often with the now-reset form values).
  if (['employeeForm', 'editEmployeeForm', 'actionForm', 'kpiForm', 'updateKpiForm', 'editKpiForm', 'divisionForm', 'editDivisionForm', 'userAccountForm', 'editUserAccountForm'].includes(form.id)) return;

  // 1. Employee Form
  if (form.id === 'employeeForm') {
    event.preventDefault();
    const name = (form.elements.name?.value || '').trim();
    const email = (form.elements.email?.value || '').trim();
    const dept = form.elements.department?.value || 'Operations';
    const title = (form.elements.title?.value || '').trim();
    const workModel = form.elements.workModel?.value || 'Hybrid';
    const employmentType = form.elements.employmentType?.value || 'Full-Time';

    if (!name) return;
    employeeData.unshift([name, email, dept, title, 'On-Time']);
    getEmployeeId(name);
    if (!employeeProfileOverrides[name]) employeeProfileOverrides[name] = {};
    employeeProfileOverrides[name].workModel = workModel;
    employeeProfileOverrides[name].employmentType = employmentType;
    persistProfileOverrides();
    persistEmployeeData();
    updateEmployeeDatalist();
    form.reset();
    document.querySelector('#employeeDialog')?.close();
    openModule('employees');
    showToast(`${name} berhasil ditambahkan ke direktori karyawan`);
    return;
  }

  // 2. Edit Employee Form
  if (form.id === 'editEmployeeForm') {
    event.preventDefault();
    const originalName = form.elements.originalName?.value;
    const name = (form.elements.name?.value || '').trim();
    const email = (form.elements.email?.value || '').trim();
    const dept = form.elements.department?.value || 'Operations';
    const title = (form.elements.title?.value || '').trim();
    const status = form.elements.status?.value || 'On-Time';
    const workModel = form.elements.workModel?.value || 'Hybrid';

    const empIndex = employeeData.findIndex(p => p[0] === originalName);
    let syncInfo = null;
    if (empIndex >= 0) {
      const oldEmail = employeeData[empIndex][1];
      employeeData[empIndex] = [name, email, dept, title, status];
      if (name !== originalName && employeeIdByName.has(originalName)) {
        employeeIdByName.set(name, employeeIdByName.get(originalName));
      }
      if (!employeeProfileOverrides[name]) employeeProfileOverrides[name] = {};
      employeeProfileOverrides[name].workModel = workModel;
      persistProfileOverrides();
      persistEmployeeData();
      syncInfo = syncEmployeeChange(originalName, oldEmail, { name, email, department: dept });
      updateDepartmentDropdowns();
    }
    document.querySelector('#editEmployeeDialog')?.close();
    openModule(moduleView.dataset.page || 'employees');
    const parts = [];
    if (syncInfo?.kpi) parts.push(`${syncInfo.kpi} KPI`);
    if (syncInfo?.dept) parts.push(`${syncInfo.dept} divisi`);
    if (syncInfo?.users) parts.push(`${syncInfo.users} akun`);
    showToast(`Data karyawan ${name} berhasil diperbarui.${parts.length ? ' Tersinkron ke ' + parts.join(', ') + '.' : ''}`);
    return;
  }

  // 3. Action Form (Calendar Event, Leave, Candidate, Payrun, Review)
  if (form.id === 'actionForm' || form.id === 'actionDialogForm') {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());

    if (activeAction === 'new-event') {
      const timeFormatted = values.time ? new Date(`2000-01-01T${values.time}`).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '09:00 AM';
      const parsedDate = values.date ? getCalendarItemDate({ date: values.date }, calendarDate) : new Date(calendarDate.getFullYear(), calendarDate.getMonth(), selectedDate);
      const day = parsedDate.getDate();
      const isoDate = values.date || `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const newEvent = {
        id: `cal-${Date.now()}`,
        day,
        date: isoDate,
        title: values.title || 'Agenda Baru',
        time: timeFormatted,
        location: values.location || 'Ruang Rapat',
        category: values.category || 'Talent Acquisition',
        note: values.note || '',
        tone: values.category === 'Employee Development' ? 1 : (values.category === 'Workplace Engagement' ? 2 : 0)
      };
      calendarItems.unshift(newEvent);
      persistCalendarItems();
      selectedDate = day;
      calendarDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1);
      moduleCalendarDate = new Date(calendarDate);
      openModule('calendar');
      const mName = new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(parsedDate);
      showToast(`Agenda "${values.title}" berhasil dijadwalkan pada tanggal ${day} ${mName}.`);
    } else if (activeAction === 'request-leave') {
      const newReq = {
        id: `lv-${Date.now()}`,
        name: userProfile.name,
        title: userProfile.role,
        type: values.type || 'Annual Leave',
        submitDate: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()),
        period: `${values.start || ''} s/d ${values.end || ''}`,
        duration: '3 Days',
        reason: values.note || 'Keperluan pribadi',
        status: 'Pending'
      };
      leaveRequests.unshift(newReq);
      persistLeaveRequests();
      openModule('leave');
      showToast('Permohonan cuti berhasil diajukan dan sedang menunggu persetujuan manajer.');
    } else if (activeAction === 'add-candidate') {
      const newCand = {
        id: `app-${Date.now()}`,
        name: values.name,
        email: values.email,
        position: values.position || 'UI Designer',
        appliedDate: 'Hari Ini',
        type: values.workModel || 'Full-Time On-Site',
        stage: 'Application Received'
      };
      applicantsData.unshift(newCand);
      persistApplicants();
      openModule('recruitment');
      showToast(`Pelamar baru ${values.name} berhasil didaftarkan ke sistem.`);
    } else if (activeAction === 'new-payrun') {
      const total = employeeData.reduce((sum, person, index) => sum + (3590 - (index % 6) * 95), 0);
      payRunData.unshift({ id: `payrun-${Date.now()}`, period: values.period, paymentDate: values.paymentDate, employeeCount: employeeData.length, total, status: 'Siap ditinjau (demo)', createdAt: new Date().toISOString() });
      persistPayRuns();
      openModule('payroll');
      showToast(`Persiapan gaji ${values.period} tersimpan sebagai data demo. Belum ada transfer dana.`);
    } else if (activeAction === 'create-review') {
      reviewCycleData.unshift({ id: `review-${Date.now()}`, name: values.cycle, type: values.type, status: 'Dibuka (demo)', createdAt: new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(new Date()) });
      persistReviewCycles();
      openModule('performance');
      showToast(`Periode penilaian "${values.cycle}" tersimpan sebagai data demo.`);
    }

    document.querySelector('#actionDialog')?.close();
    form.reset();
    return;
  }

  // 4. KPI Form
  if (form.id === 'kpiForm') {
    event.preventDefault();
    const data = new FormData(form);
    const title = (data.get('title') || '').trim();
    const dept = data.get('dept') || (departmentsData[0]?.name || 'Product Design');
    const pic = (data.get('pic') || '').trim() || userProfile.name;
    const target = Number(data.get('target'));
    const unit = (data.get('unit') || '%').trim();
    const weight = Number(data.get('weight'));
    const period = data.get('period') || 'Q2 2035';
    const lowerIsBetter = data.get('lowerIsBetter') === 'true';

    const newKpi = {
      id: `kpi-${Date.now()}`,
      title,
      dept,
      pic,
      target,
      actual: 0,
      unit,
      weight,
      period,
      lowerIsBetter,
      status: 'At Risk',
      notes: 'Target indikator kinerja baru.'
    };

    kpiData.unshift(newKpi);
    persistKpiData();
    form.reset();
    document.querySelector('#kpiDialog')?.close();
    openModule('kpi');
    showToast(`Indikator KPI "${title}" berhasil ditambahkan.`);
    return;
  }

  // 5. Update KPI Progress Form
  if (form.id === 'updateKpiForm') {
    event.preventDefault();
    const data = new FormData(form);
    const id = data.get('kpiId');
    const actual = Number(data.get('actual')) || 0;
    const notes = (data.get('notes') || '').trim();

    const kpi = kpiData.find(k => k.id === id);
    if (kpi) {
      kpi.actual = actual;
      if (notes) kpi.notes = notes;
      const score = refreshKpiStatus(kpi);
      persistKpiData();
      document.querySelector('#updateKpiDialog')?.close();
      openModule('kpi');
      showToast(`Capaian "${kpi.title}" diperbarui menjadi ${actual} ${kpi.unit} (${Math.round(score)}%).`);
    }
    return;
  }

  // 6. Edit KPI Form
  if (form.id === 'editKpiForm') {
    event.preventDefault();
    const data = new FormData(form);
    const id = data.get('kpiId');
    const kpi = kpiData.find(k => k.id === id);
    if (kpi) {
      kpi.title = (data.get('title') || '').trim() || kpi.title;
      kpi.dept = data.get('dept') || kpi.dept;
      kpi.pic = (data.get('pic') || '').trim() || kpi.pic;
      kpi.target = Number(data.get('target'));
      kpi.actual = Number(data.get('actual'));
      kpi.unit = (data.get('unit') || '%').trim();
      kpi.weight = Number(data.get('weight'));
      kpi.period = data.get('period') || kpi.period;
      kpi.lowerIsBetter = data.get('lowerIsBetter') === 'true';
      kpi.notes = (data.get('notes') || '').trim();

      refreshKpiStatus(kpi);

      persistKpiData();
      document.querySelector('#editKpiDialog')?.close();
      openModule('kpi');
      showToast(`Parameter KPI "${kpi.title}" berhasil diperbarui.`);
    }
    return;
  }

  // 7. Division Form
  if (form.id === 'divisionForm') {
    event.preventDefault();
    const data = new FormData(form);
    const name = (data.get('name') || '').trim();
    const code = (data.get('code') || '').trim().toUpperCase();
    const head = (data.get('head') || '').trim();
    const budget = (data.get('budget') || 'Rp 50.000.000').trim();
    const description = (data.get('description') || '').trim();

    if (!name || !code) return;
    const newDept = { id: `dept-${Date.now()}`, name, code, head, budget, description };
    departmentsData.push(newDept);
    persistDepartmentsData();
    form.reset();
    document.querySelector('#divisionDialog')?.close();
    openModule('kpi');
    showToast(`Divisi baru "${name} (${code})" berhasil ditambahkan.`);
    return;
  }

  // 8. Edit Division Form
  if (form.id === 'editDivisionForm') {
    event.preventDefault();
    const data = new FormData(form);
    const id = data.get('deptId');
    const oldName = data.get('originalName');
    const name = (data.get('name') || '').trim();
    const code = (data.get('code') || '').trim().toUpperCase();
    const head = (data.get('head') || '').trim();
    const budget = (data.get('budget') || '').trim();
    const description = (data.get('description') || '').trim();

    const dept = departmentsData.find(d => d.id === id);
    if (dept) {
      dept.name = name;
      dept.code = code;
      dept.head = head;
      dept.budget = budget;
      dept.description = description;

      if (oldName && oldName !== name) {
        kpiData.forEach(k => { if (k.dept === oldName) k.dept = name; });
        persistKpiData();
        employeeData.forEach(p => { if (p[2] === oldName) p[2] = name; });
        persistEmployeeData();
        userAccounts.forEach(u => { if (u.department === oldName) u.department = name; });
        persistUserAccounts();
      }

      persistDepartmentsData();
      document.querySelector('#editDivisionDialog')?.close();
      openModule('kpi');
      showToast(`Data divisi "${name}" berhasil disimpan.`);
    }
    return;
  }
});


/* ==========================================================================
   Initial Application Launch
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  renderDashboardMiniCalendar();
  renderDashboardScheduleList();
  renderDashboardSummary();
  updateNotificationBadge();
  setupDashboardControls();
  const { key, params } = resolveRoute();
  openModule(key, false, Object.fromEntries(params.entries()));
});

// Run immediately in case script loads after DOM ready
renderDashboardMiniCalendar();
renderDashboardScheduleList();
updateNotificationBadge();
setupDashboardControls();
const { key: initialKey, params: initialParams } = resolveRoute();
openModule(initialKey, false, Object.fromEntries(initialParams.entries()));
