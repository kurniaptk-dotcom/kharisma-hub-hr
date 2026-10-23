// Kharisma Hub HR Management - Core Application Script
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

const currentSysDate = new Date();
let calendarDate = new Date(currentSysDate.getFullYear(), currentSysDate.getMonth(), 1);
let moduleCalendarDate = new Date(calendarDate);
let selectedDate = currentSysDate.getDate();
let selectedCalendarEventId = null;

// Cloud sessions are the source of truth whenever authentication is required.
let authenticatedSupabaseSession = null;
let authenticatedUserProfile = null;
let cloudDataHydrating = false;
let employeeCloudWriteQueue = Promise.resolve();
let kpiCloudWriteQueue = Promise.resolve();
function roleLabel(role) { return role === 'Admin' ? 'Administrator' : role === 'Supervisor' ? 'Atasan' : role === 'Employee' ? 'Karyawan' : 'Pengguna'; }
function ensureAdminSidebarLinks(role) {
  const nav = document.querySelector('.main-nav');
  if (!nav) return;
  let divLink = nav.querySelector('[data-module="kpi-divisions"]');
  let usrLink = nav.querySelector('[data-module="kpi-users"]');
  if (!divLink) {
    divLink = document.createElement('a');
    divLink.className = 'nav-link admin-quick-link';
    divLink.href = 'kpi.html?tab=kpi-divisions';
    divLink.dataset.module = 'kpi-divisions';
    divLink.innerHTML = '<span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg></span>Kelola Divisi';
    nav.appendChild(divLink);
  }
  if (!usrLink) {
    usrLink = document.createElement('a');
    usrLink.className = 'nav-link admin-quick-link';
    usrLink.href = 'kpi.html?tab=kpi-users';
    usrLink.dataset.module = 'kpi-users';
    usrLink.innerHTML = '<span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg></span>Manajemen Akun';
    nav.appendChild(usrLink);
  }
  divLink.hidden = role !== 'Admin';
  usrLink.hidden = role !== 'Admin';
}
function applyRoleNavigation(role) {
  ensureAdminSidebarLinks(role);
  const allowed = role === 'Admin'
    ? null
    : role === 'Supervisor'
      ? new Set(['portal','dashboard','calendar','employees','attendance','performance','kpi','leave'])
      : new Set(['portal','calendar','attendance','leave']);
  document.querySelectorAll('.main-nav .nav-link').forEach(link => {
    link.hidden = Boolean(allowed && !allowed.has(link.dataset.module));
  });
  if (role === 'Employee') {
    const rawFile = (window.location.pathname.split('/').pop().toLowerCase() || 'index').replace(/\.html$/, '');
    if (rawFile === 'index' || rawFile === '') {
      window.location.replace('portal.html');
      return;
    }
  }
  document.querySelectorAll('.main-nav .nav-link[data-module="attendance"]').forEach(link => {
    const iconSpan = link.querySelector('.nav-icon');
    const iconHtml = iconSpan ? iconSpan.outerHTML : '<span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>';
    if (role === 'Employee') {
      link.innerHTML = `${iconHtml}Presensi Saya`;
      link.title = 'Portal Presensi Mandiri Karyawan';
    } else {
      link.innerHTML = `${iconHtml}Absensi &amp; Kehadiran`;
      link.title = 'Manajemen Absensi & Kehadiran Tim';
    }
  });
  document.body.dataset.authRole = role || '';
  if (typeof renderDashboardSummary === 'function') renderDashboardSummary();
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

  root.removeAttribute('data-auth-pending');
  root.hidden = false;
  root.inert = false;
  document.body.classList.add('auth-ready');
  document.body.classList.add('auth-active');

  const hydrateScopedData = async () => {
    try {
      cloudDataHydrating = true;
      const [employees, kpis, leaves, attendance, calendar, depts, apps] = await Promise.all([
        window.KharismaDB.employees.getAll([]),
        window.KharismaDB.kpi.getAll([]),
        window.KharismaDB.leave.getAll([]),
        window.KharismaDB.attendance.getAll(),
        window.KharismaDB.calendar.getAll([]),
        window.KharismaDB.departments ? window.KharismaDB.departments.getAll([]) : Promise.resolve([]),
        window.KharismaDB.applicants ? window.KharismaDB.applicants.getAll([]) : Promise.resolve([])
      ]);
      if (employees && employees.length) {
        employeeData.splice(0, employeeData.length, ...employees);
      }
      employeeData.forEach(person => { if (person[5] && /^EMP-/.test(person[5])) employeeIdByName.set(person[0], person[5].replace(/^EMP-/, '')); });
      Object.entries(window.__kharismaEmployeeProfiles || {}).forEach(([empName, cloudProf]) => {
        const existing = employeeProfileOverrides[empName] || {};
        const cleaned = Object.fromEntries(Object.entries(cloudProf || {}).filter(([, v]) => v !== undefined && v !== null));
        employeeProfileOverrides[empName] = { ...existing, ...cleaned };
      });
      if (kpis && kpis.length) kpiData.splice(0, kpiData.length, ...kpis);
      if (leaves && leaves.length) leaveRequests.splice(0, leaveRequests.length, ...leaves);
      if (attendance && attendance.length) cloudAttendanceRecords = attendance;
      if (calendar && calendar.length) calendarItems.splice(0, calendarItems.length, ...calendar);
      if (depts && depts.length) departmentsData.splice(0, departmentsData.length, ...depts);
      if (apps && apps.length) applicantsData.splice(0, applicantsData.length, ...apps);
      persistProfileOverrides();
      persistEmployeeData();
      persistKpiData();
      persistLeaveRequests();
      writeStoredValue('teamhub.calendarItems', calendarItems);
      writeStoredValue('teamhub.departments', departmentsData);
      writeStoredValue('teamhub.applicants', applicantsData);
    } catch (e) {
      console.warn('[KharismaDB] Hydration:', e.message);
    } finally {
      cloudDataHydrating = false;
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

    if (profile && profile.status === 'Pending' && session.access_token) {
      try {
        const actRes = await fetch('/api/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` }
        });
        const actJson = await actRes.json().catch(() => ({}));
        if (actJson?.data) profile = actJson.data;
      } catch {}
    }

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
    const existingAccIdx = userAccounts.findIndex(u => u.id === account.id || (u.email && account.email && u.email.toLowerCase() === account.email.toLowerCase()));
    if (existingAccIdx >= 0) {
      userAccounts[existingAccIdx] = { ...userAccounts[existingAccIdx], ...account };
    } else {
      userAccounts.unshift(account);
    }
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

    window.rehydrateAndRenderCurrentPage = async () => {
      await hydrateScopedData();
      if (document.querySelector('#dashboardView')) {
        if (typeof renderDashboardSummary === 'function') renderDashboardSummary();
        if (typeof renderDashboardMiniCalendar === 'function') renderDashboardMiniCalendar();
        if (typeof renderDashboardScheduleList === 'function') renderDashboardScheduleList();
        if (typeof syncQuickAbsenButtons === 'function') syncQuickAbsenButtons();
      }
      const mv = document.querySelector('#moduleView');
      const curPage = mv?.dataset?.page;
      if (mv && curPage && curPage !== 'dashboard') {
        mv.innerHTML = pageMarkup(curPage);
        if (typeof setupTablePagination === 'function') setupTablePagination();
      }
    };

    // Initial Hydration
    window.rehydrateAndRenderCurrentPage();

    // Realtime Postgres Change Event Listener
    window.addEventListener('kharisma:data-sync', (e) => {
      console.log('[Kharisma Realtime] Update diterima dari database:', e.detail);
      window.rehydrateAndRenderCurrentPage?.();
    });

    // Resilient background auto-sync every 15 seconds to guarantee 100% fresh state
    if (!window.__kharismaAutoSyncInterval) {
      window.__kharismaAutoSyncInterval = setInterval(() => {
        if (authenticatedSupabaseSession && !cloudDataHydrating) {
          window.rehydrateAndRenderCurrentPage?.();
        }
      }, 15000);
    }

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

const defaultAttendancePolicy = {
  location: {
    id: 'default-office-hq',
    name: 'Kantor Pusat PT Kharisma Group Indonesia',
    latitude: -6.208763,
    longitude: 106.845599,
    radius_m: 500
  },
  shifts: [
    {
      id: 'shift-regular',
      name: 'Shift Reguler',
      start_time: appSettings.workStart || '09:00',
      end_time: appSettings.workEnd || '17:00',
      tolerance_minutes: Number(appSettings.lateTolerance || 15),
      weekdays: [1, 2, 3, 4, 5],
      enabled: true
    },
    {
      id: 'shift-morning',
      name: 'Shift Pagi',
      start_time: '08:00',
      end_time: '16:00',
      tolerance_minutes: 10,
      weekdays: [1, 2, 3, 4, 5],
      enabled: true
    }
  ],
  assignments: []
};
let userAttendanceRecord = readStoredValue('teamhub.userAttendance', null);
let attendanceIncompleteHistory = readStoredValue('teamhub.attendanceIncompleteHistory', []);
let cloudAttendanceRecords = null;
let attendancePolicy = readStoredValue('teamhub.attendancePolicy', defaultAttendancePolicy);
if (!attendancePolicy || typeof attendancePolicy !== 'object') {
  attendancePolicy = JSON.parse(JSON.stringify(defaultAttendancePolicy));
}
if (!attendancePolicy.location) {
  attendancePolicy.location = { ...defaultAttendancePolicy.location };
}
if (!Array.isArray(attendancePolicy.shifts) || !attendancePolicy.shifts.length) {
  attendancePolicy.shifts = JSON.parse(JSON.stringify(defaultAttendancePolicy.shifts));
}
if (!Array.isArray(attendancePolicy.assignments)) {
  attendancePolicy.assignments = [];
}
let attendanceReviewQueue = { corrections: [], overtime: [] };
let attendanceActionPending = false;
let attendanceActiveTab = 'team';
const attendanceSyncQueue = readStoredValue('teamhub.attendanceQueue', []);
function attendanceTodayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function attendanceTimeLabel(value) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(value));
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
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}
function attendanceDisplayState(record = userAttendanceRecord) {
  if (!record) return 'Belum Absen';
  if (record.state) return ({ working: 'Sedang Bekerja', on_break: 'Sedang Istirahat', on_overtime: 'Sedang Lembur', completed: 'Selesai' })[record.state] || 'Belum Lengkap';
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
  const activeEmployee = employeeData.find(row => row[1]?.toLowerCase() === userProfile.email.toLowerCase()) || findEmployeeByName(userProfile.name);
  const empProfile = activeEmployee ? getEmployeeProfile(activeEmployee[0]) : null;
  const workModelStr = String(empProfile?.workModel || 'Hybrid');
  const isFlexibleWorker = ['remote', 'hybrid'].includes(workModelStr.toLowerCase());
  const locationPolicy = attendancePolicy.location || defaultAttendancePolicy.location;
  const eventAt = new Date().toISOString();
  attendanceActionPending = true;
  const button = document.querySelector(`[data-action="attendance-transition"][data-transition="${action}"], #clockInBtn`);
  const prevBtnText = button ? button.textContent : '';
  if (button) { button.disabled = true; button.textContent = 'Memeriksa lokasi…'; }
  try {
    let location;
    try {
      location = await getAttendanceLocation();
    } catch {
      // Fallback for desktop browsers without GPS or when geolocation permission is blocked
      location = {
        latitude: Number(locationPolicy.latitude || -6.208763),
        longitude: Number(locationPolicy.longitude || 106.845599),
        accuracy: 25,
        simulated: true
      };
    }
    const distance = locationPolicy
      ? attendanceDistanceMeters(Number(locationPolicy.latitude), Number(locationPolicy.longitude), location.latitude, location.longitude)
      : 0;
    const radiusLimit = Number(locationPolicy?.radius_m || locationPolicy?.radiusM || 500);
    const enforceStrictGeo = Boolean(attendancePolicy.location?.strictGeofence);
    if (enforceStrictGeo && !isFlexibleWorker && distance > radiusLimit) {
      throw new Error(`Anda berada ${Math.round(distance)} m dari kantor, di luar radius ${radiusLimit} m.`);
    }
    location.distance = Math.round(distance);
    location.verified = true;
    location.remote = isFlexibleWorker || distance > radiusLimit;
    location.eventAt = eventAt;
    const date = action === 'clock_in' ? attendanceTodayKey() : (userAttendanceRecord?.dateKey || attendanceTodayKey());
    if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
      try {
        const result = await window.KharismaDB.attendance.transition(action, date, location);
        const row = Array.isArray(result?.data) ? result.data[0] : result?.data;
        if (row?.id) {
          userAttendanceRecord = { id: row.id, employeeId: row.employee_id, name: row.employee_name, dateKey: row.date, date: row.date, workModel: row.work_model, clockIn: row.clock_in, clockOut: row.clock_out || '', clockInAt: row.clock_in_at, clockOutAt: row.clock_out_at, duration: row.duration, overtime: row.overtime, lateMinutes: row.late_minutes, status: row.status, state: row.state, breakSessions: row.break_sessions || [], shiftId: row.shift_id, overtimeApprovalStatus: row.overtime_approval_status, location: { latitude: row.location_latitude, longitude: row.location_longitude, accuracy: row.location_accuracy_m, distance: row.location_distance_m, verified: Boolean(row.location_verified) } };
        }
      } catch {
        // Fallback to local state transition if cloud RPC is not configured yet
      }
    }
    if (!userAttendanceRecord || userAttendanceRecord.dateKey !== date || action !== 'clock_in') {
      const current = userAttendanceRecord?.dateKey === date ? userAttendanceRecord : null;
      const employeeCode = activeEmployee ? `EMP-${getEmployeeId(activeEmployee)}` : 'EMP-0001';
      const assignment = attendancePolicy.assignments?.find(item => item.employee_id === employeeCode);
      const shift = attendancePolicy.shifts?.find(item => item.id === assignment?.shift_id)
        || attendancePolicy.shifts?.[0]
        || { id: 'shift-regular', name: 'Shift Reguler', start_time: appSettings.workStart || '09:00', end_time: appSettings.workEnd || '17:00', tolerance_minutes: Number(appSettings.lateTolerance || 15) };
      const now = new Date(eventAt);
      if (action === 'clock_in') {
        if (current && current.state && current.state !== 'completed') throw new Error('Presensi masuk hari ini sudah tercatat.');
        const [sh, sm] = String(shift.start_time).slice(0, 5).split(':').map(Number);
        const lateMinutes = Math.max(0, attendanceMinutesOfDay(now) - (sh * 60 + sm + Number(shift.tolerance_minutes || 0)));
        userAttendanceRecord = {
          id: `att-${Date.now()}`,
          employeeId: employeeCode,
          name: activeEmployee ? activeEmployee[0] : userProfile.name,
          dateKey: date,
          date: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(now),
          workModel: empProfile?.workModel || 'On-Site',
          clockInAt: now.toISOString(),
          clockIn: attendanceTimeLabel(now),
          clockOut: '',
          state: 'working',
          clockedIn: true,
          breakSessions: [],
          shiftId: shift.id,
          lateMinutes,
          status: lateMinutes > 0 ? 'Late' : 'On-Time',
          duration: 'Sedang Berjalan',
          overtime: '-',
          location
        };
      } else {
        if (!current) throw new Error('Catat presensi masuk terlebih dahulu.');
        const sessions = current.breakSessions || [];
        if (action === 'break_start') {
          if (current.state !== 'working' && current.state !== undefined) throw new Error('Istirahat hanya dapat dimulai saat sedang bekerja.');
          sessions.push({ start: now.toISOString(), end: null });
          current.state = 'on_break';
        } else if (action === 'break_end') {
          if (current.state !== 'on_break') throw new Error('Tidak ada istirahat yang sedang berlangsung.');
          sessions[sessions.length - 1].end = now.toISOString();
          current.state = 'working';
        } else if (action === 'overtime_start') {
          if (current.state === 'on_overtime') throw new Error('Sesi lembur sudah sedang berjalan.');
          current.overtimeStartAt = now.toISOString();
          current.state = 'on_overtime';
          current.overtime = 'Sedang Berjalan';
          current.overtimeApprovalStatus = 'in_progress';
        } else if (action === 'overtime_end') {
          if (current.state !== 'on_overtime') throw new Error('Tidak ada sesi lembur yang sedang berlangsung.');
          const otStart = current.overtimeStartAt ? new Date(current.overtimeStartAt) : new Date(now.getTime() - 3600000);
          const otMinutes = Math.max(1, Math.floor((now - otStart) / 60000));
          current.overtimeEndAt = now.toISOString();
          current.overtime = `${Math.floor(otMinutes / 60)}h ${String(otMinutes % 60).padStart(2, '0')}m`;
          current.overtimeApprovalStatus = 'pending';
          current.state = current.clockOut ? 'completed' : 'working';
          attendanceReviewQueue.overtime.push({
            id: `ot-${Date.now()}`,
            employee_name: current.name || userProfile.name,
            date: current.date,
            overtime: current.overtime,
            status: 'pending'
          });
        } else if (action === 'clock_out') {
          if (current.state === 'on_break') {
            sessions[sessions.length - 1].end = now.toISOString();
          }
          if (current.state === 'on_overtime') {
            const otStart = current.overtimeStartAt ? new Date(current.overtimeStartAt) : new Date(now.getTime() - 3600000);
            const otMinutes = Math.max(1, Math.floor((now - otStart) / 60000));
            current.overtime = `${Math.floor(otMinutes / 60)}h ${String(otMinutes % 60).padStart(2, '0')}m`;
            current.overtimeApprovalStatus = 'pending';
          }
          current.clockOutAt = now.toISOString();
          current.clockOut = attendanceTimeLabel(now);
          current.state = 'completed';
          current.clockedIn = false;
          let minutes = Math.max(1, Math.floor((now - new Date(current.clockInAt)) / 60000));
          sessions.forEach(item => { if (item.end) minutes -= Math.max(0, Math.floor((new Date(item.end) - new Date(item.start)) / 60000)); });
          minutes = Math.max(1, minutes);
          current.duration = `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
          const end = new Date(`${date}T${String(shift.end_time).slice(0, 5)}:00+07:00`);
          if (String(shift.end_time).slice(0, 5) <= String(shift.start_time).slice(0, 5)) end.setDate(end.getDate() + 1);
          const extra = Math.max(0, Math.floor((now - end) / 60000));
          if (!current.overtime || current.overtime === '-' || current.overtime === 'Sedang Berjalan') {
            current.overtime = extra ? `${Math.floor(extra / 60)}h ${String(extra % 60).padStart(2, '0')}m` : '-';
            current.overtimeApprovalStatus = extra ? 'pending' : 'not_required';
          }
        }
        current.breakSessions = sessions;
        current.location = location;
        userAttendanceRecord = current;
      }
    }
    // Synchronize active employee status in employeeData & Dashboard
    if (activeEmployee && userAttendanceRecord?.status) {
      activeEmployee[4] = userAttendanceRecord.status;
      persistEmployeeData();
    }
    persistUserAttendance();
    if (typeof renderDashboardSummary === 'function') renderDashboardSummary();
    if (moduleView && !moduleView.hidden && (moduleView.dataset.page === 'attendance' || moduleView.dataset.page === 'portal')) {
      moduleView.innerHTML = pageMarkup(moduleView.dataset.page);
      setupTablePagination();
      startLiveAttendanceClock();
    }
    const actionToastMap = {
      clock_in: `Presensi masuk berhasil dicatat (${userAttendanceRecord.clockIn}) • Status: ${userAttendanceRecord.status === 'Late' ? 'Terlambat' : 'Tepat Waktu'}`,
      break_start: 'Waktu istirahat dimulai.',
      break_end: 'Selamat kembali bekerja! Waktu istirahat selesai.',
      overtime_start: 'Sesi lembur dimulai! Jam lembur sedang dihitung.',
      overtime_end: `Sesi lembur selesai (${userAttendanceRecord.overtime}). Menunggu persetujuan atasan.`,
      clock_out: `Presensi pulang berhasil dicatat (${userAttendanceRecord.clockOut}) • Durasi kerja: ${userAttendanceRecord.duration}`
    };
    showToast(actionToastMap[action] || `Status presensi diperbarui: ${attendanceDisplayState()}.`);
  } catch (error) {
    showToast(error.message || 'Presensi gagal dicatat. Periksa lokasi lalu coba lagi.');
  } finally {
    attendanceActionPending = false;
    const retryButton = document.querySelector(`[data-action="attendance-transition"][data-transition="${action}"]`);
    if (retryButton) { retryButton.disabled = false; retryButton.textContent = ({ clock_in: 'Absen Masuk', break_start: 'Mulai Istirahat', break_end: 'Kembali Bekerja', clock_out: 'Presensi Pulang' })[action] || prevBtnText || 'Catat Presensi'; }
  }
}
function persistUserAttendance() { writeStoredValue('teamhub.userAttendance', userAttendanceRecord); }

function startLiveAttendanceClock() {
  if (window.__attLiveClockInterval) clearInterval(window.__attLiveClockInterval);
  const update = () => {
    const el = document.querySelector('#attLiveClockDisplay') || document.querySelector('#portalLiveClockDisplay');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
  };
  window.__attLiveClockInterval = setInterval(update, 1000);
  update();
}

function getPersonalAttendanceHistory() {
  const currentAcc = getActiveAccount();
  const ownEmp = getOwnEmployeeRow();
  const myName = String(ownEmp ? ownEmp[0] : (currentAcc ? currentAcc.name : userProfile.name) || 'Karyawan').toLowerCase();
  const myEmpId = ownEmp ? `EMP-${getEmployeeId(ownEmp)}` : (currentAcc?.employeeId || 'EMP-0001');

  const history = [];
  const todayKey = attendanceTodayKey();
  const activeToday = userAttendanceRecord && (userAttendanceRecord.dateKey === todayKey || isActiveOvernightAttendance(userAttendanceRecord))
    ? userAttendanceRecord
    : null;

  if (activeToday) {
    history.push({
      date: activeToday.date || new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()),
      shiftName: 'Shift Reguler',
      clockIn: activeToday.clockIn || '—',
      clockOut: activeToday.clockOut || '—',
      duration: activeToday.duration || (activeToday.clockIn ? 'Sedang Berjalan' : '—'),
      overtime: activeToday.overtime || '—',
      status: activeToday.status === 'Late' ? 'Terlambat' : 'Tepat Waktu',
      workModel: activeToday.workModel || (ownEmp ? ownEmp[4] : 'Di Kantor') || 'Di Kantor',
      isToday: true
    });
  }

  if (Array.isArray(cloudAttendanceRecords)) {
    cloudAttendanceRecords.forEach(r => {
      const match = (r.auth_user_id && authenticatedSupabaseSession && r.auth_user_id === authenticatedSupabaseSession.user.id) ||
        (r.employee_id && r.employee_id === myEmpId) ||
        (r.employee_name && String(r.employee_name).toLowerCase() === myName);
      if (match && (!activeToday || r.date !== activeToday.dateKey)) {
        history.push({
          date: r.date ? new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${r.date}T00:00:00`)) : '23 Okt 2026',
          shiftName: 'Shift Reguler',
          clockIn: r.clock_in || '—',
          clockOut: r.clock_out || '—',
          duration: r.duration || '—',
          overtime: r.overtime || '—',
          status: r.status === 'Late' ? 'Terlambat' : (r.status || 'Tepat Waktu'),
          workModel: r.work_model || 'Di Kantor',
          isToday: false
        });
      }
    });
  }

  const sampleDays = [
    { day: '22 Okt 2026', in: '08:52 AM', out: '05:05 PM', dur: '8h 13m', ot: '0h 05m', st: 'Tepat Waktu', mod: 'Di Kantor' },
    { day: '21 Okt 2026', in: '08:56 AM', out: '05:10 PM', dur: '8h 14m', ot: '0h 10m', st: 'Tepat Waktu', mod: 'Di Kantor' },
    { day: '20 Okt 2026', in: '09:14 AM', out: '05:20 PM', dur: '8h 06m', ot: '0h 20m', st: 'Terlambat', mod: 'Hibrida' },
    { day: '19 Okt 2026', in: '08:48 AM', out: '05:02 PM', dur: '8h 14m', ot: '—', st: 'Tepat Waktu', mod: 'Di Kantor' },
    { day: '16 Okt 2026', in: '08:55 AM', out: '05:08 PM', dur: '8h 13m', ot: '0h 08m', st: 'Tepat Waktu', mod: 'Di Kantor' },
    { day: '15 Okt 2026', in: '08:50 AM', out: '05:04 PM', dur: '8h 14m', ot: '0h 04m', st: 'Tepat Waktu', mod: 'Di Kantor' },
    { day: '14 Okt 2026', in: '08:51 AM', out: '05:03 PM', dur: '8h 12m', ot: '—', st: 'Tepat Waktu', mod: 'Di Kantor' },
    { day: '13 Okt 2026', in: '08:58 AM', out: '05:12 PM', dur: '8h 14m', ot: '0h 12m', st: 'Tepat Waktu', mod: 'Hibrida' },
    { day: '12 Okt 2026', in: '08:49 AM', out: '05:01 PM', dur: '8h 12m', ot: '—', st: 'Tepat Waktu', mod: 'Di Kantor' }
  ];

  sampleDays.forEach(p => {
    if (!history.some(h => h.date === p.day)) {
      history.push({
        date: p.day,
        shiftName: 'Shift Reguler',
        clockIn: p.in,
        clockOut: p.out,
        duration: p.dur,
        overtime: p.ot,
        status: p.st,
        workModel: p.mod,
        isToday: false
      });
    }
  });

  return history;
}


const defaultNotifications = [
  { id: 'notif-1', title: 'Permintaan Cuti Disetujui', message: 'Permintaan cuti sakit dari Lina Armand telah disetujui.', time: '10:32 AM', read: false, icon: '' },
  { id: 'notif-2', title: 'Pelamar Baru Terdaftar', message: 'William Hartono melamar untuk posisi Desainer UI.', time: '09:45 AM', read: false, icon: '' },
  { id: 'notif-3', title: 'Pengingat Agenda Kalender', message: 'Wawancara Desainer Produk dijadwalkan pukul 09:00 AM di Ruang C.', time: '08:00 AM', read: false, icon: '' },
  { id: 'notif-4', title: 'Pembaruan Kebijakan Perusahaan', message: 'Kebijakan cuti tahun 2026 telah diterbitkan oleh HR.', time: 'Kemarin', read: true, icon: '' },
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
    employmentType: 'Full-Time', workModel: 'Hybrid', joinDate: '14 February 2024', leave: [['14','20','Days',70],['10','15','Days',67],['8','24','Hours',33],['3','4','Days',75]],
    score: '86.75%', scoreChange: '+2.05%', hours: '34 h 30 m', salary: formatIDR(3200), allowance: formatIDR(300), monthlyValue: formatIDR(3855), salaryRaw: 3200000, allowanceRaw: 300000
  },
});
function persistProfileOverrides() { writeStoredValue('teamhub.profileOverrides', employeeProfileOverrides); }

function parseNominalIDR(val, fallback) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const digits = Number(val.replace(/[^\d]/g, ''));
    if (Number.isFinite(digits) && digits > 0) return digits < 50000 ? digits * 1000 : digits;
  }
  return fallback;
}

function getEmployeeProfile(name) {
  const employee = employeeData.find((person) => person[0] === name) || employeeData.find((person) => person[0] === 'Mia Torres') || employeeData[0];
  const index = Math.max(0, employeeData.indexOf(employee));
  const id = getEmployeeId(employee);
  const seedIndex = Math.max(0, employeeIds.indexOf(id));
  const employmentTypes = ['Full-Time','Full-Time','Part-Time','Full-Time','Full-Time','Internship','Full-Time','Freelance','Part-Time','Full-Time','Full-Time','Internship'];
  const workModels = ['Hybrid','Remote','On-Site','On-Site','Hybrid','On-Site','Remote','Remote','On-Site','Hybrid','Hybrid','On-Site'];
  const joinDates = ['12 Jan 2024','03 Mar 2024','22 Jul 2024','05 Sep 2023','14 Feb 2024','10 May 2025','19 Nov 2024','06 Apr 2025','27 Jun 2023','08 Aug 2024','15 Apr 2024','20 Feb 2025'];
  const scores = ['92%','90%','81%','80%','86.75%','88%','87%','86%','84%','88%','91%','83%'];
  const salaries = [3200,3100,2900,3300,3200,1500,2900,2200,2500,2900,3400,1800];
  const overrides = employeeProfileOverrides[employee[0]] || {};
  const defaultBaseRp = salaries[seedIndex % salaries.length] * 1000;
  const baseSalaryRp = parseNominalIDR(overrides.salaryRaw ?? overrides.salary, defaultBaseRp);
  const allowanceRp = parseNominalIDR(overrides.allowanceRaw ?? overrides.allowance, 300000);
  const fmtRp = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);
  const rawJoin = overrides.joinDate || joinDates[seedIndex % joinDates.length];
  const cleanJoin = String(rawJoin).replace(/2026/g, '2025').replace(/2024/g, '2024').replace(/2033/g, '2024').replace(/2032/g, '2023');
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
    joinDate: cleanJoin,
    leave: overrides.leave || [['10','20','Days',50],['7','15','Days',47],['4','24','Hours',17],['2','4','Days',50]],
    score: overrides.score || scores[seedIndex % scores.length],
    scoreChange: overrides.scoreChange || '+1.8%',
    hours: overrides.hours || `${30 + (seedIndex % 10)} h ${(seedIndex * 5) % 60} m`,
    salaryRaw: baseSalaryRp,
    allowanceRaw: allowanceRp,
    salary: fmtRp(baseSalaryRp),
    allowance: fmtRp(allowanceRp),
    monthlyValue: fmtRp(baseSalaryRp + allowanceRp + 355000),
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

const _nowYm = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
const defaultCalendarItems = [
  { id: 'cal-1', day: 1, date: `${_nowYm}-01`, title: 'Onboarding Session - New Hires Batch 3', time: '10:00 AM', location: 'HR Room 2B', category: 'Talent Acquisition', note: 'Prepare welcome kits and ID cards', tone: 0 },
  { id: 'cal-2', day: 4, date: `${_nowYm}-04`, title: 'Interview - Product Designer', time: '09:00 AM', location: 'Meeting Room C', category: 'Talent Acquisition', note: 'Review portfolio first', tone: 0 },
  { id: 'cal-3', day: 4, date: `${_nowYm}-04`, title: 'Quarterly Policy Review', time: '03:00 PM', location: 'Conference Room 1A', category: 'Workplace Engagement', note: 'All department heads', tone: 2 },
  { id: 'cal-4', day: 7, date: `${_nowYm}-07`, title: 'Team Communication Workshop', time: '02:00 PM', location: 'Main Training Hall', category: 'Employee Development', note: 'Interactive session', tone: 1 },
  { id: 'cal-5', day: 13, date: `${_nowYm}-13`, title: 'Performance Review Check-in - Marketing Team', time: '01:00 PM', location: 'Notion Review Sheet', category: 'Employee Development', note: 'Q2 deliverables assessment', tone: 1 },
  { id: 'cal-6', day: 15, date: `${_nowYm}-15`, title: 'Recruitment Planning - Targets', time: '11:00 AM', location: 'Meeting Room A', category: 'Talent Acquisition', note: 'Headcount forecast', tone: 0 },
  { id: 'cal-7', day: 18, date: `${_nowYm}-18`, title: 'Remote Work Compliance Briefing', time: '09:30 AM', location: 'Zoom (link in calendar)', category: 'Workplace Engagement', note: 'Mandatory for hybrid & remote staff', tone: 2 },
  { id: 'cal-8', day: 21, date: `${_nowYm}-21`, title: 'New Recruit Introduction', time: '09:00 AM', location: 'HR Room 2B', category: 'Talent Acquisition', note: 'Prepare welcome kits and ID cards', tone: 0 },
  { id: 'cal-9', day: 21, date: `${_nowYm}-21`, title: 'Personal Growth Session - Leadership Track', time: '02:00 PM', location: 'Zoom (link shared via email)', category: 'Employee Development', note: 'Attendees must complete pre-session survey', tone: 1 },
  { id: 'cal-10', day: 22, date: `${_nowYm}-22`, title: 'Upskilling Program: Advanced Excel', time: '03:30 PM', location: 'Computer Lab 1', category: 'Employee Development', note: 'Financial modeling practice', tone: 1 },
  { id: 'cal-11', day: 27, date: `${_nowYm}-27`, title: 'Final Interview - Sales Manager', time: '10:00 AM', location: 'Boardroom 3', category: 'Talent Acquisition', note: 'CEO & HR Director panel', tone: 0 },
  { id: 'cal-12', day: 28, date: `${_nowYm}-28`, title: 'Internal Team-Building Event', time: '08:00 AM', location: 'Kurnia Green Park', category: 'Workplace Engagement', note: 'Sportswear and casual gear', tone: 2 }
];
let calendarItems = readStoredValue('teamhub.calendarItems', defaultCalendarItems).map(item => ({
  ...item,
  date: String(item.date || '').replace(/^2026-\d{2}/, _nowYm).replace(/^2024-\d{2}/, _nowYm)
}));
function persistCalendarItems() {
  writeStoredValue('teamhub.calendarItems', calendarItems);
  if (typeof renderDashboardMiniCalendar === 'function') renderDashboardMiniCalendar();
  if (typeof renderDashboardScheduleList === 'function') renderDashboardScheduleList();
}

/* ==========================================================================
   Leave Requests Store
   ========================================================================== */

const defaultLeaveRequests = [
  { id: 'lv-1', name: 'Lina Armand', title: 'Lab Analyst', type: 'Sick Leave', submitDate: '18 Okt 2026', period: '20-22 Okt 2026', duration: '3 Days', reason: "Doctor\'s note attached", status: 'Approved' },
  { id: 'lv-2', name: 'Jacob Yuen', title: 'Site Supervisor', type: 'Annual Leave', submitDate: '10 Okt 2026', period: '17-21 Okt 2026', duration: '5 Days', reason: 'Family trip', status: 'Approved' },
  { id: 'lv-3', name: 'Anya Rodriguez', title: 'Graphic Designer', type: 'Other Leave', submitDate: '17 Okt 2026', period: '19 Okt 2026', duration: '1 Day', reason: 'Personal matter', status: 'Pending' },
  { id: 'lv-4', name: 'Olivia Mason', title: 'Marketing', type: 'Annual Leave', submitDate: '02 Okt 2026', period: '05-07 Okt 2026', duration: '3 Days', reason: 'Conference attendance', status: 'Approved' },
  { id: 'lv-5', name: 'Sara Kim', title: 'Customer Support', type: 'Sick Leave', submitDate: '14 Okt 2026', period: '15-16 Okt 2026', duration: '2 Days', reason: 'Fever', status: 'Approved' },
  { id: 'lv-6', name: 'Daniel Cheung', title: 'Compliance Specialist', type: 'Annual Leave', submitDate: '01 Okt 2026', period: '10-12 Okt 2026', duration: '3 Days', reason: 'Holiday', status: 'Pending' },
  { id: 'lv-7', name: 'Mia Torres', title: 'HR Officer', type: 'Annual Leave', submitDate: '06 Okt 2026', period: '09-10 Okt 2026', duration: '2 Days', reason: 'Personal retreat', status: 'Approved' },
  { id: 'lv-8', name: 'Ethan Ray', title: 'UI Designer', type: 'Casual Leave', submitDate: '05 Okt 2026', period: '07 Okt 2026', duration: '1 Day', reason: 'Family event', status: 'Rejected' },
  { id: 'lv-9', name: 'Farah Nabila', title: 'Customer Experience Lead', type: 'Sick Leave', submitDate: '11 Okt 2026', period: '12 Okt 2026', duration: '1 Day', reason: 'Headache', status: 'Approved' },
  { id: 'lv-10', name: 'Kelvin Yu', title: 'Training Coordinator', type: 'Other Leave', submitDate: '13 Okt 2026', period: '14 Okt 2026', duration: '1 Day', reason: 'Volunteer program', status: 'Rejected' }
];
let leaveRequests = readStoredValue('teamhub.leaveRequests', defaultLeaveRequests).map(r => ({
  ...r,
  submitDate: String(r.submitDate || '').replace(/2026/g, '2026'),
  period: String(r.period || '').replace(/2026/g, '2026')
}));
function persistLeaveRequests() {
  writeStoredValue('teamhub.leaveRequests', leaveRequests);
  if (typeof renderDashboardSummary === 'function') renderDashboardSummary();
}

/* ==========================================================================
   Applicants Store (Recruitment)
   ========================================================================== */

const defaultApplicants = [
  { id: 'app-1', name: 'William Hartono', email: 'william.hartono@email.com', position: 'UI Designer', appliedDate: '15 Okt 2026', type: 'Full-Time Remote', stage: 'Interview Scheduled' },
  { id: 'app-2', name: 'Fanny Rizal', email: 'fanny.rizal@email.com', position: 'Sales Manager', appliedDate: '12 Okt 2026', type: 'Full-Time On-Site', stage: 'Final Interview' },
  { id: 'app-3', name: 'Lala Wijaya', email: 'lala.wijaya@email.com', position: 'Data Analyst', appliedDate: '14 Okt 2026', type: 'Full-Time Hybrid', stage: 'Test Completed' },
  { id: 'app-4', name: 'Arifin Maulana', email: 'arifin.maulana@email.com', position: 'Customer Support', appliedDate: '13 Okt 2026', type: 'Full-Time On-Site', stage: 'Interview Scheduled' },
  { id: 'app-5', name: 'Clara Mentari', email: 'clara.mentari@email.com', position: 'HR Assistant', appliedDate: '10 Okt 2026', type: 'Full-Time On-Site', stage: 'Application Received' },
  { id: 'app-6', name: 'Bagus Pratama', email: 'bagus.pratama@email.com', position: 'Full-stack Engineer', appliedDate: '16 Okt 2026', type: 'Full-Time Hybrid', stage: 'Application Received' }
];
let applicantsData = readStoredValue('teamhub.applicants', defaultApplicants).map(a => ({
  ...a,
  appliedDate: String(a.appliedDate || '').replace(/2026/g, '2026')
}));
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
  { id: 'kpi-1', title: 'Customer Satisfaction Score (CSAT)', dept: 'Customer Service', pic: 'Olivia Mason', target: 90, actual: 95.2, unit: '%', weight: 25, period: 'Q4 2026', status: 'Exceeded', notes: 'Survei kepuasan pelanggan mencapai rekor tertinggi kuartal ini.' },
  { id: 'kpi-2', title: 'Design System Component Coverage', dept: 'Product Design', pic: 'Ethan Ray', target: 85, actual: 92.4, unit: '%', weight: 30, period: 'Q4 2026', status: 'Exceeded', notes: '45 komponen baru dipublikasikan ke Figma & Storybook.' },
  { id: 'kpi-3', title: 'Employee Retention Rate', dept: 'Human Resources', pic: 'Mia Torres', target: 95, actual: 96.8, unit: '%', weight: 35, period: 'Q4 2026', status: 'Exceeded', notes: 'Turnover turun 2.4% dari bulan lalu dengan program engagement baru.' },
  { id: 'kpi-4', title: 'Qualified B2B Leads Generated', dept: 'Marketing', pic: 'Daniel Cheung', target: 150, actual: 142, unit: 'Leads', weight: 25, period: 'Q4 2026', status: 'On-Track', notes: 'Pipeline lead dari webinar dan LinkedIn Ads berjalan konsisten.' },
  { id: 'kpi-5', title: 'On-Time Project Delivery Rate', dept: 'Operations', pic: 'Jacob Yuen', target: 90, actual: 88.5, unit: '%', weight: 30, period: 'Q4 2026', status: 'On-Track', notes: '18 dari 20 sprint rilis tepat waktu sesuai SLA.' },
  { id: 'kpi-6', title: 'R&D Prototype Lab Tests Completed', dept: 'R&D', pic: 'Lina Armand', target: 20, actual: 16, unit: 'Tests', weight: 20, period: 'Q4 2026', status: 'At Risk', notes: 'Terkendala pengiriman sampel material lab minggu lalu.' },
  { id: 'kpi-7', title: 'First Response Resolution Time', dept: 'Customer Service', pic: 'Farah Nabila', target: 15, actual: 11.5, unit: 'Menit', weight: 20, period: 'Q4 2026', status: 'Exceeded', lowerIsBetter: true, notes: 'Kecepatan respons tiket bantuan rata-rata di bawah 12 menit.' },
  { id: 'kpi-8', title: 'Recruitment Time-to-Hire', dept: 'Human Resources', pic: 'Davis Levin', target: 25, actual: 21, unit: 'Hari', weight: 25, period: 'Q4 2026', status: 'Exceeded', lowerIsBetter: true, notes: 'Waktu rata-rata rekrutmen dipangkas dengan sistem pipeline baru.' },
  { id: 'kpi-9', title: 'Organic Search Traffic Growth', dept: 'Marketing', pic: 'Daniel Cheung', target: 30, actual: 22.5, unit: '%', weight: 20, period: 'Q4 2026', status: 'At Risk', notes: 'Perlu optimasi SEO lanjutan pada landing page produk.' },
  { id: 'kpi-10', title: 'Operational Budget Variance Efficiency', dept: 'Operations', pic: 'Jacob Yuen', target: 5, actual: 3.2, unit: '%', weight: 15, period: 'Q4 2026', status: 'On-Track', lowerIsBetter: true, notes: 'Realisasi anggaran berada di bawah toleransi 5%.' }
];

let kpiData = readStoredValue('teamhub.kpiData', defaultKpiData).map(k => ({
  ...k,
  period: String(k.period || 'Q4 2026').replace(/2026/g, '2026')
}));
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
  { id: 'usr-admin', name: 'Davis Levin', email: 'davis.levin@kharismahub.com', role: 'Admin', department: 'Human Resources', title: 'HR Administrator', status: 'Active', avatar: 'men/32', lastLogin: '2026-10-21 10:24' },
  { id: 'usr-spv-1', name: 'Olivia Mason', email: 'olivia.mason@kharismahub.com', role: 'Supervisor', department: 'Marketing', title: 'Marketing Team Lead', status: 'Active', avatar: 'women/44', lastLogin: '2026-10-21 09:10' },
  { id: 'usr-spv-2', name: 'Ethan Ray', email: 'ethan.ray@kharismahub.com', role: 'Supervisor', department: 'Product Design', title: 'Design Lead', status: 'Active', avatar: 'men/75', lastLogin: '2026-10-20 16:42' },
  { id: 'usr-spv-3', name: 'Jacob Yuen', email: 'jacob.yuen@kharismahub.com', role: 'Supervisor', department: 'Operations', title: 'Operations Lead', status: 'Active', avatar: 'men/47', lastLogin: '2026-10-21 08:30' },
  { id: 'usr-spv-4', name: 'Mia Torres', email: 'mia.torres@kharismahub.com', role: 'Supervisor', department: 'Human Resources', title: 'HR Team Lead', status: 'Active', avatar: 'women/68', lastLogin: '2026-10-21 09:55' },
  { id: 'usr-spv-5', name: 'Farah Nabila', email: 'farah.nabila@kharismahub.com', role: 'Supervisor', department: 'Customer Service', title: 'Customer Service Lead', status: 'Active', avatar: 'women/49', lastLogin: '2026-10-20 14:20' },
  { id: 'usr-spv-6', name: 'Lina Armand', email: 'lina.armand@kharismahub.com', role: 'Supervisor', department: 'R&D', title: 'R&D Lab Lead', status: 'Active', avatar: 'women/17', lastLogin: '2026-10-19 11:15' },
  { id: 'usr-emp-1', name: 'Sara Kim', email: 'sara.kim@kharismahub.com', role: 'Employee', department: 'Customer Service', title: 'Customer Support Intern', status: 'Active', avatar: 'women/26', lastLogin: '2026-10-23 08:30' },
  { id: 'usr-emp-2', name: 'Daniel Cheung', email: 'daniel.cheung@kharismahub.com', role: 'Employee', department: 'Operations', title: 'Compliance Specialist', status: 'Active', avatar: 'men/52', lastLogin: '2026-10-23 08:45' }
];

let userAccounts = readStoredValue('teamhub.userAccounts', defaultUserAccounts).map(u => ({
  ...u,
  lastLogin: String(u.lastLogin || '-').replace(/2026/g, '2026')
}));
function persistUserAccounts() { writeStoredValue('teamhub.userAccounts', userAccounts); }

// Active session - which account is currently "logged in"
let activeAccountId = readStoredValue('teamhub.activeAccountId', 'usr-admin');
function persistActiveAccount() { writeStoredValue('teamhub.activeAccountId', activeAccountId); }
function getActiveAccount() {
  if (authenticatedSupabaseSession && authenticatedUserProfile) {
    return { id: authenticatedUserProfile.id, name: authenticatedUserProfile.full_name || authenticatedSupabaseSession.user.email, email: authenticatedSupabaseSession.user.email, role: authenticatedUserProfile.role, department: authenticatedUserProfile.department || '', title: authenticatedUserProfile.title || roleLabel(authenticatedUserProfile.role), status: authenticatedUserProfile.status, employeeId: authenticatedUserProfile.employee_id || null };
  }
  const acc = userAccounts.find(u => u.id === activeAccountId && u.status !== 'Inactive');
  return acc || userAccounts.find(u => u.role === 'Admin' && u.status === 'Active') || userAccounts.find(u => u.status === 'Active') || userAccounts[0] || defaultUserAccounts[0];
}
function isAdmin() { return getActiveAccount().role === 'Admin'; }
function isSupervisor() { return getActiveAccount().role === 'Supervisor'; }
function isEmployee() { return getActiveAccount().role === 'Employee'; }
function getActiveDepartment() { return getActiveAccount().department; }
function getOwnEmployeeRow() {
  const acc = getActiveAccount();
  return employeeData.find(row =>
    (acc.employeeId && (row[5] === acc.employeeId || `EMP-${getEmployeeId(row)}` === acc.employeeId)) ||
    (acc.email && String(row[1] || '').toLowerCase() === String(acc.email).toLowerCase()) ||
    (acc.name && String(row[0] || '').toLowerCase() === String(acc.name).toLowerCase())
  ) || null;
}
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
    if (roleBadge) roleBadge.textContent = `${roleLabel(userProfile.role)}${userProfile.department ? ` • ${userProfile.department}` : ''}`;
  if (profileInitials) profileInitials.textContent = initials(account.name);
}
syncActiveProfileFromAccount();

/* Cross-module sync: Employee directory ↗ KPI PIC ↗ Division Head ↗ User Accounts */
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
  { id: 1, from: 'Olivia Mason', email: 'olivia.mason@company.com', subject: 'Leave Request Approval', preview: "Hi, I'd like to follow up on my annual leave request for next month, from July 15 to July 19.", time: '10:24 AM', date: '19 Jun', initials: 'OM', color: 'p1', label: 'Leave Requests', body: ["Hi there,", "I'd like to follow up on my annual leave request for the dates 15-19 July.", 'The request is still marked as pending, and I wanted to confirm if any additional documents are needed.', 'Please let me know if you need anything else from my side.', 'Thanks so much!', '- Olivia'], unread: true, starred: false },
  { id: 2, from: 'Ethan Ray', email: 'ethan.ray@company.com', subject: 'Updated Contact Info', preview: "Just a quick heads-up that I've updated my emergency contact details on my profile.", time: '09:40 AM', date: '19 Jun', initials: 'ER', color: 'p2', label: 'HR', body: ['Hi Davis,', "I've updated my emergency contact details on my profile. Please let me know if you need anything else.", 'Thanks,', 'Ethan'], unread: true, starred: false },
  { id: 3, from: 'Lina Armand', email: 'lina.armand@company.com', subject: 'Medical Leave Submission', preview: "I've attached my doctor's note for the requested medical leave from June 20 to June 21.", time: '04:59 PM', date: '18 Jun', initials: 'LA', color: 'p3', label: 'Leave Requests', body: ['Hello,', "I've submitted my medical leave request and attached my doctor's note for the requested dates.", 'Please let me know if you need any additional information.', 'Best,', 'Lina'], unread: false, starred: false },
  { id: 4, from: 'HR Department', email: 'hr@kharismahub.com', subject: 'Performance Review Reminder', preview: 'A reminder to complete your self-assessment form as part of the performance review cycle.', time: '03:11 PM', date: '18 Jun', initials: 'HR', color: 'dark-avatar', label: 'Interview', body: ['Hello team,', 'This is a reminder to complete your self-assessment form as part of the mid-year performance review cycle.', 'Please submit your responses by 28 June.', 'Thank you,', 'HR Department'], unread: false, starred: false },
  { id: 5, from: 'Jacob Yuen', email: 'jacob.yuen@company.com', subject: 'Attendance Clarification', preview: 'Just wanted to clarify my absence earlier today. I experienced a personal emergency and...', time: '09:25 AM', date: '18 Jun', initials: 'JY', color: 'p4', label: 'HR', body: ['Hi Davis,', 'I wanted to clarify my absence earlier today. I experienced a personal emergency and could not check in on time.', 'I have updated my attendance note.', 'Regards,', 'Jacob'], unread: false, starred: true },
  { id: 6, from: 'System Notification', email: 'security@kharismahub.com', subject: 'Password Expiry Alert', preview: 'Your current password will expire in 5 days. To maintain account security, please reset it via...', time: '06:00 PM', date: '17 Jun', initials: 'SN', color: 'amber-avatar', label: 'Admin Notes', body: ['Your password will expire in 5 days.', 'To maintain account security, please visit your account settings and update your password.', 'This is an automated notification.'], unread: false, starred: false },
  { id: 7, from: 'Mia Torres', email: 'mia.torres@company.com', subject: 'Leave Policy Update', preview: 'Please review the newly updated 2026 leave policy document. It includes important updates on...', time: 'Yesterday', date: '16 Okt', initials: 'MT', color: 'p5', label: 'Leave Requests', body: ['Hi everyone,', 'Please review the newly updated 2026 leave policy document. It includes important updates on annual leave and public holidays.', 'The document is available in the team workspace.', 'Best,', 'Mia'], unread: false, starred: false },
];
let activeMailFolder = 'Inbox';
let selectedMailId = 1;
let sentMail = [
  { id: 'sent-1', from: 'Davis Levin', email: 'davis.levin@kharismahub.com', subject: 'June Team Update', preview: 'Sharing the latest people updates for June.', time: '08:20 AM', date: '19 Jun', initials: 'DL', color: 'avatar-davis', label: 'HR', body: ['Hi team,', 'Sharing the latest people updates for June. Please take a look at the calendar for upcoming events.', 'Thanks,', 'Davis'], unread: false, starred: false },
  { id: 'sent-2', from: 'Davis Levin', email: 'davis.levin@kharismahub.com', subject: 'Welcome aboard!', preview: 'We are excited to have you join the Kharisma Hub team.', time: 'Yesterday', date: '18 Jun', initials: 'DL', color: 'avatar-davis', label: 'HR', body: ['Welcome aboard! We are excited to have you join the Kharisma Hub team.', 'Best, Davis'], unread: false, starred: false },
];
let draftMail = [
  { id: 'draft-1', from: 'Davis Levin', email: 'davis.levin@kharismahub.com', subject: 'Draft: July planning', preview: 'A few notes for next month\'s planning meeting...', time: 'Yesterday', date: '18 Jun', initials: 'DL', color: 'avatar-davis', label: 'HR', body: ['A few notes for next month\'s planning meeting...'], unread: false, starred: false },
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
  addPageButton('‹', 0, true);
  for (let page = 1; page <= pageCount; page += 1) addPageButton(String(page), page);
  addPageButton('›', Math.min(2, pageCount), pageCount <= 1);
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
    button.classList.toggle('page-current', Number(button.dataset.page) === nextPage && button.textContent.trim() !== '‹' && button.textContent.trim() !== '›');
    if (button.textContent.trim() === '‹') { button.dataset.page = String(Math.max(1, nextPage - 1)); button.disabled = nextPage === 1; }
    if (button.textContent.trim() === '›') { button.dataset.page = String(Math.min(pageCount, nextPage + 1)); button.disabled = nextPage === pageCount; }
  });
}

/* ==========================================================================
   Calendar Helper Functions
   ========================================================================== */

const weekdays = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
function getCalendarItemDate(item, fallbackDate = (typeof calendarDate !== 'undefined' ? calendarDate : new Date())) {
  const match = String(item?.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const day = Number(item?.day);
  const base = fallbackDate || new Date();
  return Number.isFinite(day) && day > 0
    ? new Date(base.getFullYear(), base.getMonth(), day)
    : null;
}

function toLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function renderDashboardMiniCalendar() {
  const grid = document.querySelector('#calendarGrid');
  if (!grid) return;
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(calendarDate);
  const monthBtn = document.querySelector('#monthButton');
  if (monthBtn) monthBtn.innerHTML = `${monthName} ${year} <span>⌄</span>`;
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
      if (schedBtn) schedBtn.innerHTML = `${day} ${monthName.slice(0, 3)} <span>⌄</span>`;
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
    list.innerHTML = `<div style="padding:14px 10px;text-align:center;color:#64748b;font-size:10px;background:#f8fafc;border-radius:8px">Tidak ada jadwal untuk tanggal ${day} ${monthName}. <button class="date-filter" style="margin-top:6px;display:inline-block" data-action="new-event">+ Tambah Agenda</button></div>`;
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

  const scopedEmployees = isEmployee()
    ? [getOwnEmployeeRow()]
    : isSupervisor()
      ? employeeData.filter(p => p[2] === getActiveDepartment())
      : employeeData;
  const total = scopedEmployees.length;

  // Dynamically render #employeeRows on main dashboard by role scope with clickable profile links
  const dashEmpTbody = document.querySelector('#employeeRows');
  if (dashEmpTbody) {
    const todayStr = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
    const activeRecToday = userAttendanceRecord && (userAttendanceRecord.dateKey === attendanceTodayKey() || isActiveOvernightAttendance(userAttendanceRecord)) ? userAttendanceRecord : null;
    const orderedScoped = [...scopedEmployees];
    if (activeRecToday) {
      const myIdx = orderedScoped.findIndex(p => p && String(p[0]).toLowerCase() === String(activeRecToday.name || userProfile.name).toLowerCase());
      if (myIdx > 0) {
        const [myRow] = orderedScoped.splice(myIdx, 1);
        orderedScoped.unshift(myRow);
      }
    }
    const rowsSource = orderedScoped.filter(Boolean).slice(0, 8);
    dashEmpTbody.innerHTML = rowsSource.map((p, idx) => {
      const prof = getEmployeeProfile(p[0]);
      const isMeToday = activeRecToday && String(p[0]).toLowerCase() === String(activeRecToday.name || userProfile.name).toLowerCase();
      const st = isMeToday ? (activeRecToday.status || p[4] || 'On-Time') : (p[4] || 'On-Time');
      const stClass = st === 'Late' ? 'late' : st === 'On Leave' ? 'leave' : st === 'Absent' ? 'absent' : 'ontime';
      const checkIn = isMeToday ? (activeRecToday.clockIn || '—') : (st === 'On Leave' || st === 'Absent' ? '—' : (idx % 2 === 0 ? '08:55 AM' : '09:04 AM'));
      const checkOut = isMeToday ? (activeRecToday.clockOut || 'Sedang Bekerja') : (st === 'On Leave' || st === 'Absent' ? '—' : (idx % 2 === 0 ? '05:05 PM' : '05:15 PM'));
      return `
        <tr data-dept="${safe(p[2])}" data-status="${safe(st)}">
          <td>
            <button type="button" class="employee-link" data-action="view-employee" data-name="${safe(p[0])}">
              ${avatar(p[0], `p${(idx % 9) + 1}`)}
              <span><strong>${safe(p[0])}</strong><small>${safe(prof.id)}</small></span>
            </button>
          </td>
          <td><strong>${safe(p[3])}</strong><small>${safe(p[2])}</small></td>
          <td>${todayStr}</td>
          <td>${safe(checkIn)}</td>
          <td>${safe(checkOut)}</td>
          <td><span class="status ${stClass}">${safe(st)}</span></td>
        </tr>
      `;
    }).join('');
  }

  // Dynamically update .attendance-totals on dashboard
  const attTotalsEl = document.querySelector('.attendance-totals');
  if (attTotalsEl) {
    const cOnTime = scopedEmployees.filter(p => p[4] === 'On-Time').length;
    const cLate = scopedEmployees.filter(p => p[4] === 'Late').length;
    const cLeave = scopedEmployees.filter(p => p[4] === 'On Leave').length;
    const cAbsent = scopedEmployees.filter(p => p[4] === 'Absent').length;
    attTotalsEl.innerHTML = `<span><b>${cOnTime}</b> Tepat Waktu</span><span><b>${cLate}</b> Terlambat</span><span><b>${cLeave}</b> Cuti</span><span><b>${cAbsent}</b> Tidak Hadir</span>`;
  }

  // Hide Admin-only action buttons on dashboard for non-Admin
  document.querySelectorAll('#dashboardView .kebab[data-action="kebab-employees"], #dashboardView .kebab[data-action="kebab-recruitment"], #dashboardView .kebab[data-action="add-employee"], #dashboardView .kebab[data-action="nav-recruitment"]').forEach(btn => {
    btn.hidden = !isAdmin();
  });

  const getCard = (el) => el?.closest('.summary-card, .stat-card');
  const getCardTitle = (card) => card?.querySelector('.summary-top span, .card-head span');
  const getCardBand = (card) => card?.querySelector('.summary-band, .stat-foot');

  if (isEmployee()) {
    const ownRow = getOwnEmployeeRow();
    const ownProfile = getEmployeeProfile(ownRow[0]);
    const card1 = getCard(totalEmployeesEl);
    const card1Title = getCardTitle(card1);
    const card1Foot = getCardBand(card1);
    const card1Btn = card1?.querySelector('.kebab');
    if (card1Title) card1Title.textContent = 'Profil & Slip Gaji Saya';
    if (totalEmployeesEl) totalEmployeesEl.innerHTML = `${safe(ownProfile.id)} <small>${safe(ownProfile.department)}</small>`;
    if (card1Foot) card1Foot.innerHTML = `Status: <strong>${safe(ownProfile.employmentType)} (${safe(ownProfile.workModel)})</strong>`;
    if (card1Btn) {
      card1Btn.hidden = false;
      card1Btn.dataset.action = 'show-payslip';
      card1Btn.dataset.name = ownRow[0];
      card1Btn.title = 'Lihat Slip Gaji Saya';
    }

    const card2 = getCard(attendanceRateEl);
    const card2Title = getCardTitle(card2);
    const card2Foot = getCardBand(card2);
    if (card2Title) card2Title.textContent = 'Status Kehadiran Saya';
    if (attendanceRateEl) {
      const stateLabel = userAttendanceRecord?.clockIn ? `Masuk ${userAttendanceRecord.clockIn}` : 'Belum Absen';
      attendanceRateEl.innerHTML = `${safe(ownRow[4] || 'On-Time')} <small>${safe(stateLabel)}</small>`;
    }
    if (card2Foot) card2Foot.innerHTML = `Klik untuk membuka <strong>Presensi Mandiri</strong>`;

    const myLeaves = leaveRequests.filter(r => r.name.toLowerCase() === ownRow[0].toLowerCase());
    const myApproved = myLeaves.filter(r => r.status === 'Approved').length;
    const myPending = myLeaves.filter(r => r.status === 'Pending').length;
    const card3 = getCard(leaveRequestsEl);
    const card3Title = getCardTitle(card3);
    if (card3Title) card3Title.textContent = 'Pengajuan Cuti Saya';
    if (leaveRequestsEl) leaveRequestsEl.innerHTML = `${myApproved} <small>Disetujui</small> <b>${myPending}</b> <small>Menunggu</small>`;
    if (leaveBandEl) leaveBandEl.innerHTML = `Anda memiliki <strong>${myLeaves.length} riwayat pengajuan cuti</strong>`;

    const card4 = getCard(applicantsEl);
    const card4Title = getCardTitle(card4);
    const card4Btn = card4?.querySelector('.kebab');
    if (card4) card4.dataset.action = 'nav-calendar';
    if (card4Title) card4Title.textContent = 'Agenda Bulan Ini';
    if (card4Btn) {
      card4Btn.hidden = false;
      card4Btn.dataset.action = 'nav-calendar';
      card4Btn.title = 'Buka Kalender';
    }
    const monthEvents = calendarItems.filter(item => {
      const d = getCalendarItemDate(item);
      return d && d.getFullYear() === calendarDate.getFullYear() && d.getMonth() === calendarDate.getMonth();
    }).length;
    if (applicantsEl) applicantsEl.innerHTML = `${monthEvents} <small>Agenda Terjadwal</small>`;
    if (applicantsBandEl) applicantsBandEl.innerHTML = `Terdapat <strong>${monthEvents} jadwal kegiatan</strong> bulan ini`;
  } else {
    if (totalEmployeesEl) totalEmployeesEl.innerHTML = `${total} <small>${isSupervisor() ? `Tim ${safe(getActiveDepartment())}` : 'Karyawan'}</small>`;
    if (empTotalEl) empTotalEl.innerHTML = `${total} <small>Karyawan</small>`;

    const onTimeCount = scopedEmployees.filter(p => p[4] === 'On-Time').length;
    const lateCount = scopedEmployees.filter(p => p[4] === 'Late').length;
    const leaveCount = scopedEmployees.filter(p => p[4] === 'On Leave').length;
    const rate = total ? Math.round((onTimeCount / total) * 100) : 92;

    if (attendanceRateEl) {
      attendanceRateEl.innerHTML = `${rate}% <small>Hadir — <b>${leaveCount}</b> Cuti, ${lateCount} Terlambat</small>`;
    }

    const scopedLeaves = isSupervisor()
      ? leaveRequests.filter(r => {
          const emp = findEmployeeByName(r.name);
          return emp && emp[2] === getActiveDepartment();
        })
      : leaveRequests;
    const approvedLeave = scopedLeaves.filter(r => r.status === 'Approved').length;
    const pendingLeave = scopedLeaves.filter(r => r.status === 'Pending').length;
    if (leaveRequestsEl) {
      leaveRequestsEl.innerHTML = `${approvedLeave} <small>Disetujui</small> <b>${pendingLeave}</b> <small>Menunggu Tinjauan</small>`;
    }
    if (leaveBandEl) {
      leaveBandEl.innerHTML = `Anda telah mengajukan <strong>${scopedLeaves.length} permintaan cuti</strong> bulan ini`;
    }

    if (isSupervisor()) {
      const deptKpis = kpiData.filter(k => (k.dept || k.department) === getActiveDepartment());
      const card4 = getCard(applicantsEl);
      const card4Title = getCardTitle(card4);
      const card4Btn = card4?.querySelector('.kebab');
      if (card4) card4.dataset.action = 'nav-kpi';
      if (card4Title) card4Title.textContent = 'Target KPI Divisi';
      if (card4Btn) {
        card4Btn.hidden = false;
        card4Btn.dataset.action = 'nav-kpi';
      }
      if (applicantsEl) applicantsEl.innerHTML = `${deptKpis.length} <small>KPI Aktif</small>`;
      if (applicantsBandEl) applicantsBandEl.innerHTML = `Divisi <strong>${safe(getActiveDepartment())}</strong> memiliki ${deptKpis.length} KPI`;
    } else {
      const appCount = applicantsData.length;
      if (applicantsEl) {
        applicantsEl.innerHTML = `${appCount} <small>Kandidat</small>`;
      }
      if (applicantsBandEl) {
        applicantsBandEl.innerHTML = `Tim Anda memiliki <strong>${appCount} kandidat pelamar aktif</strong>`;
      }
    }
  }

  // Update employment breakdown using getEmployeeProfile
  if (empTotalEl) empTotalEl.innerHTML = `${total} <small>Karyawan</small>`;
  const fullTime = scopedEmployees.filter(p => getEmployeeProfile(p[0]).employmentType === 'Full-Time').length;
  const partTime = scopedEmployees.filter(p => getEmployeeProfile(p[0]).employmentType === 'Part-Time').length;
  const intern = scopedEmployees.filter(p => getEmployeeProfile(p[0]).employmentType === 'Internship').length;
  const freelance = Math.max(0, total - fullTime - partTime - intern);

    const legend = document.querySelector('.employment-legend');
  if (legend) {
    legend.innerHTML = `
      <div><i class="legend-full"></i><span><strong>Penuh Waktu</strong><small>${total ? Math.round((fullTime/total)*100) : 75}% - ${fullTime} Karyawan</small></span></div>
      <div><i class="legend-part"></i><span><strong>Paruh Waktu</strong><small>${total ? Math.round((partTime/total)*100) : 15}% - ${partTime} Karyawan</small></span></div>
      <div><i class="legend-free"></i><span><strong>Lepas/Kontrak</strong><small>${total ? Math.round((freelance/total)*100) : 10}% - ${freelance} Karyawan</small></span></div>
      <div><i class="legend-intern"></i><span><strong>Magang</strong><small>${total ? Math.round((intern/total)*100) : 0}% - ${intern} Karyawan</small></span></div>
    `;
  }

  // Dynamically sync Dashboard Laporan Kehadiran & Kinerja Tim widgets
  const reportScoreEl = document.querySelector('#reports .report-score');
  if (reportScoreEl) {
    const presentCount = scopedEmployees.filter(p => p[4] === 'On-Time' || p[4] === 'Late').length;
    const pct = total ? Math.round((presentCount / total) * 100) : 92;
    reportScoreEl.innerHTML = `${pct}% <span>↗ +1.54%</span>`;
  }
  const perfScoreEl = document.querySelector('#performance .performance-score');
  if (perfScoreEl && kpiData.length) {
    const scopedKpis = isSupervisor() ? kpiData.filter(k => (k.dept || k.department) === getActiveDepartment()) : kpiData;
    const activeKpis = scopedKpis.length ? scopedKpis : kpiData;
    const avgKpi = (activeKpis.reduce((sum, k) => sum + calculateKpiScore(k), 0) / activeKpis.length).toFixed(2);
    perfScoreEl.textContent = `${avgKpi}%`;
  }
  // Sync Quick Self-Attendance bar on Dashboard if present
  const dashQaBadge = document.querySelector('#dashQaStatusBadge');
  const dashQaSubtext = document.querySelector('#dashQaSubtext');
  const dashQaClockBtn = document.querySelector('#dashQaClockBtn');
  if (dashQaBadge && dashQaSubtext && dashQaClockBtn) {
    const policy = getAttendancePolicy();
    const rec = userAttendanceRecord;
    if (rec && rec.clockIn && !rec.clockOut) {
      dashQaBadge.textContent = `Sedang Bekerja (Masuk ${rec.clockIn})`;
      dashQaBadge.classList.add('active');
      dashQaSubtext.textContent = `Status: ${rec.status || 'On-Time'} · Durasi berjalan: ${rec.duration || 'Aktif'} · Jangan lupa Clock-Out saat selesai bekerja.`;
      dashQaClockBtn.textContent = 'Pulang Kerja (Clock Out)';
      dashQaClockBtn.dataset.action = 'clock-out';
    } else if (rec && rec.clockIn && rec.clockOut) {
      dashQaBadge.textContent = `Selesai (${rec.clockIn} - ${rec.clockOut})`;
      dashQaBadge.classList.add('active');
      dashQaSubtext.textContent = `Presensi hari ini telah lengkap · Durasi kerja: ${rec.duration || '-'} · Lembur: ${rec.overtime || '-'}.`;
      dashQaClockBtn.textContent = 'Buka Rekap Presensi';
      dashQaClockBtn.dataset.action = 'nav-attendance';
    } else {
      dashQaBadge.textContent = 'Belum Check-In';
      dashQaBadge.classList.remove('active');
      dashQaSubtext.textContent = `Shift Reguler (${policy.workStart || '09:00'} - ${policy.workEnd || '17:00'}) · Klik tombol di kanan untuk mencatat jam masuk/pulang secara langsung.`;
      dashQaClockBtn.textContent = 'Masuk Kerja (Clock In)';
      dashQaClockBtn.dataset.action = 'clock-in';
    }
  }
  if (typeof syncQuickAbsenButtons === 'function') syncQuickAbsenButtons();
  if (typeof renderDashboardSatisfaction === 'function') renderDashboardSatisfaction();
  if (typeof renderDashboardTasks === 'function') renderDashboardTasks();
  if (typeof renderDashboardActivities === 'function') renderDashboardActivities();
}

function renderDashboardSatisfaction() {
  const scoreEl = document.querySelector('#dashSatisfactionScore');
  const ratingEl = document.querySelector('#dashSatisfactionRating');
  const needleEl = document.querySelector('#dashSatisfactionGaugeNeedle');
  const noteEl = document.querySelector('#dashSatisfactionNote');
  const listEl = document.querySelector('#dashSatisfactionList');
  if (!scoreEl && !listEl) return;

  let avgKpi = 90;
  if (kpiData && kpiData.length) {
    const totalScore = kpiData.reduce((sum, k) => sum + Math.min(100, calculateKpiScore(k)), 0);
    avgKpi = Math.round(totalScore / kpiData.length);
  }
  const onTimeCount = employeeData.filter(p => p[4] === 'On-Time').length;
  const attRate = employeeData.length ? Math.round((onTimeCount / employeeData.length) * 100) : 90;
  const overallScore = Math.min(99, Math.max(65, Math.round((avgKpi * 0.6) + (attRate * 0.4))));
  const rating = (overallScore / 20).toFixed(1);

  if (scoreEl) scoreEl.textContent = `${overallScore}%`;
  if (ratingEl) ratingEl.textContent = `${rating}/5`;
  if (needleEl) {
    const deg = Math.round(((overallScore / 100) * 180) - 90);
    needleEl.style.transform = `rotate(${deg}deg)`;
  }
  if (noteEl) {
    noteEl.innerHTML = overallScore >= 85
      ? 'Performa dan sentimen tim terukur <strong>sangat positif &amp; produktif</strong>'
      : 'Performa tim stabil dengan beberapa area <strong>peningkatan target</strong>';
  }

  if (listEl) {
    const categories = [
      { name: 'Kompensasi & Tunjangan', base: 88 },
      { name: 'Budaya & Kolaborasi Tim', base: 92 },
      { name: 'Keseimbangan Kerja & Waktu', base: 86 },
      { name: 'Peluang Pertumbuhan Karier', base: 89 }
    ];
    listEl.innerHTML = categories.map(cat => {
      const score = Math.min(98, Math.max(70, Math.round(cat.base * (overallScore / 90))));
      const stars = '★'.repeat(Math.round(score / 20));
      return `<div><span><strong>${cat.name}</strong><small>${score}% Kepuasan</small></span><b class="stars">${stars} <small>${(score / 20).toFixed(1)}/5</small></b></div>`;
    }).join('');
  }
}

function renderDashboardTasks() {
  const container = document.querySelector('#dashTasksContainer');
  if (!container) return;

  const pendingLeaves = leaveRequests.filter(r => r.status === 'Pending').length;
  const appCount = applicantsData.length;
  const todayEvents = calendarItems.filter(item => {
    const d = getCalendarItemDate(item);
    return d && d.getDate() === calendarDate.getDate() && d.getMonth() === calendarDate.getMonth();
  });
  const lateCount = employeeData.filter(p => p[4] === 'Late').length;

  const storedDone = readStoredValue('teamhub.completedTasks', {});

  const taskList = [];
  if (pendingLeaves > 0) {
    taskList.push({
      id: 'task-leave-review',
      title: `Tinjau ${pendingLeaves} permohonan cuti yang menunggu verifikasi`,
      category: 'Manajemen Cuti',
      date: 'Hari ini'
    });
  }
  if (appCount > 0) {
    taskList.push({
      id: 'task-applicant-review',
      title: `Evaluasi ${appCount} berkas kandidat pelamar di pipeline rekrutmen`,
      category: 'Talent Acquisition',
      date: 'Hari ini'
    });
  }
  if (todayEvents.length > 0) {
    taskList.push({
      id: `task-event-${todayEvents[0].id || 0}`,
      title: `Hadiri agenda: ${todayEvents[0].title}`,
      category: todayEvents[0].category || 'Kalender Kerja',
      date: todayEvents[0].time || 'Hari ini'
    });
  }
  if (lateCount > 0) {
    taskList.push({
      id: 'task-late-followup',
      title: `Tindak lanjuti ${lateCount} catatan keterlambatan presensi tim`,
      category: 'Presensi & Disiplin',
      date: 'Pagi ini'
    });
  }
  taskList.push({
    id: 'task-sync-data',
    title: 'Periksa kelengkapan jam kerja & sinkronisasi presensi harian',
    category: 'Operasional SDM',
    date: 'Hari ini'
  });
  taskList.push({
    id: 'task-kpi-check',
    title: 'Tinjau pencapaian target KPI divisi kuartal berjalan',
    category: 'Manajemen Kinerja',
    date: 'Bulan ini'
  });

  const topTasks = taskList.slice(0, 3);
  container.innerHTML = topTasks.map(t => {
    const isChecked = Boolean(storedDone[t.id]);
    return `
      <label class="task-row">
        <input type="checkbox" data-task-id="${t.id}" ${isChecked ? 'checked' : ''} />
        <span>
          <strong style="${isChecked ? 'text-decoration:line-through;color:#94a3b8' : ''}">${safe(t.title)}</strong>
          <small><i>${safe(t.category)}</i><time>${safe(t.date)}</time></small>
        </span>
      </label>
    `;
  }).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(box => {
    box.addEventListener('change', (e) => {
      const taskId = e.target.dataset.taskId;
      const doneMap = readStoredValue('teamhub.completedTasks', {});
      doneMap[taskId] = e.target.checked;
      writeStoredValue('teamhub.completedTasks', doneMap);
      const titleSpan = e.target.closest('label')?.querySelector('strong');
      if (titleSpan) {
        titleSpan.style.textDecoration = e.target.checked ? 'line-through' : 'none';
        titleSpan.style.color = e.target.checked ? '#94a3b8' : '';
      }
    });
  });
}

function renderDashboardActivities() {
  const container = document.querySelector('#dashActivitiesContainer');
  if (!container) return;

  const activities = [];

  leaveRequests.slice(0, 3).forEach((r, i) => {
    activities.push({
      name: r.employee_name || r.name || 'Karyawan',
      action: r.status === 'Approved' ? `Permohonan cuti (${r.type || 'Tahunan'}) telah disetujui` : `Mengajukan permohonan cuti (${r.type || 'Tahunan'})`,
      time: r.submit_date || r.date || 'Hari ini',
      avatarIdx: (i % 5) + 1
    });
  });

  if (userAttendanceRecord && userAttendanceRecord.clockIn) {
    activities.push({
      name: userAttendanceRecord.name || userProfile.name,
      action: userAttendanceRecord.clockOut
        ? `Telah menyelesaikan jam kerja (${userAttendanceRecord.clockIn} - ${userAttendanceRecord.clockOut})`
        : `Mencatat presensi masuk kantor (${userAttendanceRecord.clockIn})`,
      time: userAttendanceRecord.date || 'Hari ini',
      avatarIdx: 1
    });
  }

  applicantsData.slice(0, 2).forEach((a, i) => {
    activities.push({
      name: a.name || 'Pelamar',
      action: `Mendaftar untuk posisi ${a.position || 'Staf'}`,
      time: a.applied_date || 'Hari ini',
      avatarIdx: (i % 4) + 2
    });
  });

  if (activities.length < 3 && employeeData.length) {
    const e1 = employeeData[0];
    activities.push({
      name: e1[0],
      action: `Status kehadiran aktif (${e1[4] || 'On-Time'}) di divisi ${e1[2]}`,
      time: 'Hari ini',
      avatarIdx: 3
    });
  }

  const topActs = activities.slice(0, 3);
  container.innerHTML = topActs.map(act => `
    <div class="activity-row">
      <i class="avatar p${act.avatarIdx}">${initials(act.name)}</i>
      <p><strong>${safe(act.name)}</strong> ${safe(act.action)}<small>${safe(act.time)}</small></p>
    </div>
  `).join('');
}

/* ==========================================================================
   Navigation & Routing Engine
   ========================================================================== */

const dashboardView = document.querySelector('#dashboardView');
const moduleView = document.querySelector('#moduleView');
const moduleTitles = {
  portal: ['Portal Karyawan', 'Layanan mandiri karyawan: Presensi, Pengajuan Izin & Cuti, Slip Gaji, dan Informasi Kerja.'],
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
        <button class="module-button primary" data-action="new-event">+ Tambah Agenda</button>
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
        <dt>Catatan</dt><dd>${safe(ev.note || '-')}</dd>
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

  const peopleRows = employeeData.slice((employeeCurrentPage - 1) * employeePageSize, employeeCurrentPage * employeePageSize).map((p, i) => {
    const empProf = getEmployeeProfile(p[0]);
    const statusLabel = p[4] === 'On-Time' ? 'Active' : p[4];
    return `
    <tr data-dept="${safe(p[2])}" data-status="${safe(statusLabel)}">
      <td><input type="checkbox" aria-label="Select ${safe(p[0])}" /></td>
      <td>${safe(empProf.id)}</td>
      <td>
        <button class="employee-link" data-action="view-employee" data-name="${safe(p[0])}">
          ${avatar(p[0], `p${i % 9 + 1}`)}
          <strong>${safe(p[0])}</strong>
        </button>
      </td>
      <td>${safe(p[3])}</td>
      <td>${safe(p[2])}</td>
      <td><span class="employment-pill">${safe(empProf.employmentType)}</span></td>
      <td>${safe(empProf.workModel)}</td>
      <td>${safe(empProf.joinDate)}</td>
      <td><span class="status ${p[4] === 'Absent' ? 'absent' : p[4] === 'On Leave' ? 'leave' : 'ontime'}">${safe(statusLabel)}</span></td>
      <td>
        ${isAdmin() ? `
        <div class="row-actions-group">
          <button class="btn-action-icon" data-action="edit-employee" data-name="${safe(p[0])}" title="Edit Data Karyawan"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="btn-action-icon danger" data-action="delete-employee" data-name="${safe(p[0])}" title="Hapus Karyawan"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>` : '<span class="toolbar-note">-</span>'}
      </td>
    </tr>
  `;
  }).join('');

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
  const todayFormatted = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
  const scopedAttendanceEmployees = isEmployee()
    ? [getOwnEmployeeRow()].filter(Boolean)
    : isSupervisor()
      ? employeeData.filter(p => p[2] === getActiveDepartment())
      : employeeData;

  const cloudByEmpName = new Map();
  if (Array.isArray(cloudAttendanceRecords)) {
    cloudAttendanceRecords.forEach(record => {
      if (record.date === todayAttendanceKey || !cloudByEmpName.has(String(record.employee_name || '').toLowerCase())) {
        cloudByEmpName.set(String(record.employee_name || '').toLowerCase(), record);
      }
    });
  }

  let activeUserIncluded = false;
  scopedAttendanceEmployees.forEach((p, i) => {
    const rawName = p[0];
    const empId = `EMP-${getEmployeeId(p)}`;
    const empProf = getEmployeeProfile(rawName);
    const isActiveUser = rawName.toLowerCase() === String(userProfile.name || '').toLowerCase()
      || (p[1] && p[1].toLowerCase() === String(userProfile.email || '').toLowerCase());
    const cloudRec = cloudByEmpName.get(rawName.toLowerCase());

    if (isActiveUser && userAttendanceRecord) {
      activeUserIncluded = true;
      allAttendanceItems.unshift({
        name: `${rawName} (Anda)`,
        rawName,
        id: userAttendanceRecord.employeeId || empId,
        title: p[3] || userProfile.role,
        dept: p[2] || userProfile.department,
        date: userAttendanceRecord.date || todayFormatted,
        workModel: userAttendanceRecord.workModel || empProf.workModel || 'On-Site',
        checkInOut: `${userAttendanceRecord.clockIn || '-'} - ${userAttendanceRecord.clockOut || 'Aktif'}`,
        duration: userAttendanceRecord.duration || 'Sedang Berjalan',
        overtime: userAttendanceRecord.overtime || '-',
        status: userAttendanceRecord.status || p[4] || 'On-Time',
        avatarIdx: (i % 9) + 1,
        isUser: true
      });
    } else if (cloudRec) {
      const recDate = cloudRec.date ? new Date(`${cloudRec.date}T00:00:00`) : new Date();
      allAttendanceItems.push({
        name: isActiveUser ? `${rawName} (Anda)` : rawName,
        rawName,
        id: cloudRec.employee_id || empId,
        title: p[3] || 'Karyawan',
        dept: p[2] || cloudRec.department || '',
        date: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(recDate),
        workModel: cloudRec.work_model || empProf.workModel || 'On-Site',
        checkInOut: `${cloudRec.clock_in || '-'} - ${cloudRec.clock_out || 'Aktif'}`,
        duration: cloudRec.duration || '-',
        overtime: cloudRec.overtime || '-',
        status: cloudRec.status || p[4] || 'On-Time',
        avatarIdx: (i % 9) + 1,
        isUser: isActiveUser
      });
      if (isActiveUser) activeUserIncluded = true;
    } else {
      const st = p[4] || 'On-Time';
      const isOff = st === 'On Leave' || st === 'Absent';
      const checkInTimes = ['08:52 AM', '09:14 AM', '08:56 AM', '08:48 AM', '09:02 AM', '08:55 AM', '09:18 AM', '08:50 AM'];
      const checkOutTimes = ['05:05 PM', '05:20 PM', '05:10 PM', '05:02 PM', '05:30 PM', '05:08 PM', '05:25 PM', '05:04 PM'];
      const durations = ['8h 13m', '8h 06m', '8h 14m', '8h 14m', '8h 28m', '8h 13m', '8h 07m', '8h 14m'];
      const overtimes = ['0h 05m', '0h 20m', '0h 10m', '-', '0h 30m', '-', '0h 25m', '-'];
      allAttendanceItems.push({
        name: isActiveUser ? `${rawName} (Anda)` : rawName,
        rawName,
        id: empId,
        title: p[3],
        dept: p[2],
        date: todayFormatted,
        workModel: empProf.workModel || ['On-Site', 'Hybrid', 'Remote'][i % 3],
        checkInOut: isOff ? '-' : `${st === 'Late' ? '09:18 AM' : checkInTimes[i % checkInTimes.length]} - ${checkOutTimes[i % checkOutTimes.length]}`,
        duration: isOff ? '-' : durations[i % durations.length],
        overtime: isOff ? '-' : overtimes[i % overtimes.length],
        status: st,
        avatarIdx: (i % 9) + 1,
        isUser: isActiveUser
      });
      if (isActiveUser) activeUserIncluded = true;
    }
  });

  if (userAttendanceRecord && !activeUserIncluded) {
    allAttendanceItems.unshift({
      name: `${userProfile.name} (Anda)`,
      rawName: userProfile.name,
      id: userAttendanceRecord.employeeId || 'EMP-0001',
      title: userProfile.role || 'HR Administrator',
      dept: userProfile.department || 'Human Resources',
      date: userAttendanceRecord.date || todayFormatted,
      workModel: userAttendanceRecord.workModel || 'On-Site',
      checkInOut: `${userAttendanceRecord.clockIn || '-'} - ${userAttendanceRecord.clockOut || 'Aktif'}`,
      duration: userAttendanceRecord.duration || 'Sedang Berjalan',
      overtime: userAttendanceRecord.overtime || '-',
      status: userAttendanceRecord.status || 'On-Time',
      avatarIdx: 1,
      isUser: true
    });
  }

  const attendanceRows = allAttendanceItems.map((item) => {
    const stNorm = item.status === 'Tepat Waktu' ? 'On-Time' : item.status === 'Terlambat' ? 'Late' : item.status === 'Cuti' ? 'On Leave' : item.status === 'Tidak Hadir' ? 'Absent' : item.status;
    const badgeClass = stNorm === 'On-Time' ? 'ontime' : stNorm === 'Late' ? 'late' : stNorm === 'Absent' ? 'absent' : stNorm === 'Belum Lengkap' ? 'incomplete' : 'leave';
    const dotClass = stNorm === 'Absent' ? 'offline' : stNorm === 'On Leave' ? 'away' : 'online';
    const lateIcon = stNorm === 'Late' ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px;margin-right:4px"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>` : '';
    return `
    <tr class="${item.isUser ? 'user-attendance-row' : ''}" data-status="${safe(stNorm)}">
      <td>
        <button class="employee-link" data-action="view-employee" data-name="${safe(item.rawName)}">
          <span class="att-avatar-wrap">${avatar(item.rawName, `p${item.avatarIdx}`)}<i class="att-online-dot ${dotClass}"></i></span>
          <span><strong>${safe(item.name)}</strong><small>${safe(item.id)}</small></span>
        </button>
      </td>
      <td><strong>${safe(item.title)}</strong><small>${safe(item.dept)}</small></td>
      <td>${safe(item.date)}</td>
      <td>${safe(item.workModel)}</td>
      <td>${safe(item.checkInOut)}</td>
      <td>${safe(item.duration)}</td>
      <td>${safe(item.overtime)}</td>
      <td><span class="status ${badgeClass}">${lateIcon}${safe(stNorm)}</span></td>
      <td class="att-action-cell"><button type="button" class="kebab att-row-kebab" data-action="view-employee" data-name="${safe(item.rawName)}" title="Lihat Detail ${safe(item.rawName)}">•••</button></td>
    </tr>
  `;
  }).join('');

  const getEmployeeDynamicPerfScore = (empName, idx) => {
    const empKpis = kpiData.filter(k => String(k.pic || '').toLowerCase() === empName.toLowerCase());
    if (empKpis.length) {
      const avg = Math.round(empKpis.reduce((sum, k) => sum + calculateKpiScore(k), 0) / empKpis.length);
      return Math.max(50, Math.min(100, avg));
    }
    return [92, 90, 81, 80, 89, 88, 87, 86][idx % 8] || 85;
  };

  const performanceRows = employeeData.slice(0, 8).map((p, i) => {
    const dynamicScore = getEmployeeDynamicPerfScore(p[0], i);
    const scaleFive = (dynamicScore / 20).toFixed(1);
    return `
    <tr>
      <td><button type="button" class="employee-link" data-action="view-employee" data-name="${safe(p[0])}">${avatar(p[0], `p${i + 1}`)} <strong>${safe(p[0])}</strong></button></td>
      <td>${safe(p[3])}</td>
      <td>${[4.7, 4.6, 4.2, 4.1, 4.6, 4.5, 4.4, 4.5][i]}</td>
      <td>${scaleFive}</td>
      <td>${[4.4, 4.4, 4.1, 4.0, 4.3, 4.2, 4.2, 4.0][i]}</td>
      <td>${[4.4, 4.3, 3.5, 3.6, 4.1, 4.0, 3.9, 4.0][i]}</td>
      <td><strong>${dynamicScore}%</strong></td>
    </tr>
  `;
  }).join('');

  // 1. INBOX MODULE
  if (key === 'inbox') {
    return `
      <div class="inbox-workspace">
        <aside class="mail-folders">
          <button class="module-button primary compose-new" data-action="new-message">+ &nbsp;Tulis Pesan</button>
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
            <label class="mail-search"><span class="search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><input id="mailSearch" placeholder="Cari email" aria-label="Cari email" /></label>
            <button class="mail-filter-button" data-action="mail-filter" aria-label="Filter email"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg></button>
          </div>
          <div class="mail-list" id="mailList"></div>
        </section>
        <section class="mail-detail-pane">
          <div class="mail-detail-toolbar">
            <div>
              <button data-action="mail-back" aria-label="Back">‹</button>
              <button data-action="archive-message" aria-label="Archive"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="21 8 21 21 3 21 3 8"/><rect width="22" height="5" x="1" y="3" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/></svg></button>
              <button data-action="delete-message" aria-label="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
              <button data-action="print-message" aria-label="Print"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/></svg></button>
              <button data-action="mail-more" aria-label="More">•••</button>
            </div>
            <span id="mailCounter">1 from 36</span>
            <button data-action="mail-prev" aria-label="Previous email">‹</button>
            <button data-action="mail-next" aria-label="Next email">›</button>
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
              <button type="button" data-action="undo-compose" aria-label="Undo">↩</button>
              <button type="button" data-action="redo-compose" aria-label="Redo">↪</button>
              <button type="button" data-action="format-font" title="Ganti Font">Sans Serif ⌄</button><button type="button" data-action="format-size" title="Ukuran Teks">Aa ⌄</button>
              <button type="button" data-action="format-bold"><b>B</b></button>
              <button type="button" data-action="format-italic"><i>I</i></button>
              <button type="button" data-action="format-underline"><u>U</u></button>
              <button type="button" data-action="format-align" title="Perataan Teks">≡ ⌄</button><button type="button" data-action="format-list" title="Daftar Poin">⚙ ⌄</button>
            </div>
            <div class="compose-body" contenteditable="true" role="textbox" aria-label="Message body" data-placeholder="Type something..."></div>
            <div class="compose-actions">
              <button class="send-button" type="submit">Send Message <span>⌄</span></button>
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
          <div class="agenda-head"><strong>Filter</strong><button data-action="collapse-agenda">&times;</button></div>
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
              <button class="cal-nav-btn" data-action="prev-cal-month" title="Bulan Sebelumnya">‹</button>
              <button class="month-title" id="calendarBoardMonth" data-action="reset-cal-month" title="Kembali ke Bulan Ini">${new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate)} <span>⌄</span></button>
              <button class="cal-nav-btn" data-action="next-cal-month" title="Bulan Berikutnya">›</button>
            </div>
            <div>
              <button class="date-filter" data-action="calendar-filter">Filter <span>⌄</span></button>
              <button class="date-filter" data-action="calendar-mode">${moduleView?.dataset?.calMode || 'Month'} <span>⌄</span></button>
              <button class="module-button primary" data-action="new-event">+ New Agenda</button>
            </div>
          </div>
          <div class="calendar-weekdays">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(x => `<span>${x}</span>`).join('')}</div>
          <div class="calendar-month-grid">${calendarDays}</div>
        </section>
        <aside class="schedule-details">
          <div class="agenda-head">
            <span><strong>Details Schedule</strong><small id="selectedScheduleDate">${selectedDate} ${new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate)}</small></span>
            <button data-action="close-schedule-details">&times;</button>
          </div>
          <div id="calendarDetailsList">${getCalendarScheduleCards(selectedDate)}</div>
        </aside>
      </div>
    `;
  }

  // 3. EMPLOYEES TABLE MODULE
  if (key === 'employees') {
    const deptCounts = departmentsData.slice(0, 6).map((d, idx) => {
      const cnt = employeeData.filter(p => p[2] === d.name).length;
      const pct = employeeData.length ? Math.round((cnt / employeeData.length) * 100) : 0;
      return `<div><i class="dept-color c${idx % 6}"></i><span>${safe(d.name)}<small>${cnt} - <b>${pct}%</b></small></span></div>`;
    }).join('');
    return `
      <div class="employee-overview">
        <div class="employee-stat-grid">
          <article class="employee-stat highlight"><span>Total Employees</span><strong>${employeeData.length}</strong><small>+1.6% <em>dari bulan lalu</em></small></article>
          <article class="employee-stat"><span>New Employees (This Month)</span><strong>7</strong><small>+5.8% <em>dari bulan lalu</em></small></article>
          <article class="employee-stat"><span>Turnover Rate</span><strong>3.1%</strong><small>−2.4% <em>dari bulan lalu</em></small></article>
          <article class="employee-stat"><span>Resigned Employees</span><strong>4</strong><small>+2.1% <em>dari bulan lalu</em></small></article>
        </div>
        <section class="department-card">
          <div class="module-card-head"><h2>Departments</h2><button class="date-filter" data-action="dept-period-filter">This Month ⌄</button></div>
          <div class="department-content">
            <div class="department-donut"><strong>${departmentsData.length}</strong><small>Departments</small></div>
            <div class="department-legend">
              ${deptCounts}
            </div>
          </div>
        </section>
      </div>
      <section class="module-card employee-list-card">
        <div class="module-card-head">
          <h2>Employee List</h2>
          <div class="module-heading-actions">
            <label class="module-search"><span class="search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><input data-filter="employees" placeholder="Search employee" /></label>
            <button class="date-filter" data-action="employee-filter">Filter <span>⌄</span></button>
            <span class="toolbar-note">Sort by:</span>
            <select class="module-select" data-select="employee-sort"><option value="Name">Name</option><option value="Join Date">Join Date</option><option value="Department">Department</option></select>
            ${isAdmin() ? `<button class="module-button primary" data-action="add-employee-page">New Employee</button>` : ''}
            <button class="module-button secondary view-grid-button" data-action="employee-grid-view" title="Tampilan Grid"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></button>
          </div>
        </div>
        <div class="module-table-wrap">
          <table class="module-table employees-table">
            <thead>
              <tr>
                <th><input type="checkbox" data-select-all="employees" aria-label="Select all" /></th>
                <th>ID Karyawan <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th>Nama <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th>Jabatan <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th>Departemen <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th>Jenis Kepegawaian <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th>Model Kerja <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th>Tanggal Bergabung <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th>Status <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
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
        <label class="module-search"><span class="search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><input data-filter="employees" placeholder="Search employee" /></label>
        <button class="date-filter" data-action="employee-filter"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg> Filter <span>⌄</span></button>
        <select data-select="grid-dept"><option value="All Department">All Department</option>${departmentsData.map(d => `<option value="${safe(d.name)}">${safe(d.name)}</option>`).join('')}</select>
        <select data-select="grid-position"><option value="All Position">All Position</option><option value="Designer">Designer</option><option value="Manager">Manager</option><option value="Executive">Executive</option><option value="Engineer">Engineer</option><option value="Analyst">Analyst</option><option value="Officer">Officer</option><option value="Supervisor">Supervisor</option></select>
        <span></span><small>Sort by:</small>
        <select data-select="employee-sort"><option value="Name">Name</option><option value="Join Date">Join Date</option></select>
        ${isAdmin() ? `<button class="module-button primary" data-action="add-employee-page">New Employee</button>` : ''}
        <button class="module-button secondary" data-action="employee-table-view" title="Tampilan Tabel"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>
      </div>
      <div class="employee-cards">
        ${employeeData.map((p, i) => {
          const empProf = getEmployeeProfile(p[0]);
          const statusLabel = p[4] === 'On-Time' ? 'Active' : p[4];
          return `
          <article class="employee-card" data-dept="${safe(p[2])}" data-status="${safe(statusLabel)}">
            <button class="employee-card-main" data-action="view-employee" data-name="${safe(p[0])}">
              ${avatar(p[0], `p${i % 9 + 1}`)}
              <small>${safe(empProf.id)}</small>
              <strong>${safe(p[0])}</strong>
            </button>
            <div>
              <small>Job Title</small><span>${safe(p[3])}</span>
              <small>Department</small><span>${safe(p[2])}</span>
            </div>
            <footer>
              <i>${safe(empProf.employmentType)}</i>
              <i>${safe(empProf.workModel)}</i>
              <span class="status ${p[4] === 'Absent' ? 'absent' : p[4] === 'On Leave' ? 'leave' : 'ontime'}">${safe(p[4])}</span>
              ${isAdmin() ? `
              <div style="margin-left:auto;display:flex;gap:4px">
                <button class="btn-action-icon" data-action="edit-employee" data-name="${safe(p[0])}" title="Edit"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="btn-action-icon danger" data-action="delete-employee" data-name="${safe(p[0])}" title="Hapus"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
              </div>` : ''}
            </footer>
          </article>
        `;
        }).join('')}
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
              ${isAdmin() ? `<button class="module-button primary" data-action="edit-employee" data-name="${safe(profile.name)}" style="flex:1">Edit Karyawan</button>` : ''}
              <button class="module-button secondary" data-action="show-payslip" data-name="${safe(profile.name)}" title="Lihat Slip Gaji" style="flex:1">Slip Gaji</button>
            </div>
            <div class="employee-social">
              <span>Social Media:</span>
              <a href="#linkedin" data-action="open-social" data-platform="LinkedIn" data-name="${safe(profile.name)}" aria-label="LinkedIn">in</a>
              <a href="#x" aria-label="X">ð•</a>
              <a href="#instagram" data-action="open-social" data-platform="Instagram" data-name="${safe(profile.name)}" aria-label="Instagram"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg></a>
            </div>
          </section>
          <section class="module-card employee-personal-card">
            <div class="module-card-head"><h2>Personal Info</h2><button class="kebab" aria-label="Personal info options">•••</button></div>
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
            <div class="module-card-head"><h2>Performance Overview</h2><select data-select="emp-perf-period"><option value="Last Year">Last Year</option><option value="This Year">This Year</option></select></div>
            <div class="detail-performance-score"><strong>${safe(profile.score)}</strong><span>↗ ${safe(profile.scoreChange)} Increased by last year</span></div>
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
                <span class="detail-chart-tooltip">Sep 2026<strong>80.5%</strong></span>
                <div class="detail-months"><span>Jan</span><span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span><span>Aug</span><span>Sep</span><span>Oct</span><span>Nov</span><span>Dec</span></div>
              </div>
            </div>
          </section>
          <div class="employee-detail-work-grid">
            <section class="module-card hours-logged-card">
              <div class="module-card-head"><h2>Hours Logged</h2><select data-select="emp-hours-period"><option value="This Week">This Week</option><option value="Last Week">Last Week</option></select></div>
              <strong class="detail-hours-score">${safe(profile.hours)}</strong>
              <div class="logged-hours-chart">
                ${[80,66,43,86,57,84,84].map((height, i) => `
                  <div><small>${['8:00','7:30','4:00','8:30','5:00','8:00','8:00'][i]}</small><i style="height:${height}%"></i><span>${['M','T','W','T','F','S','S'][i]}</span></div>
                `).join('')}
              </div>
            </section>
            <section class="module-card employee-documents-card">
              <div class="module-card-head"><h2>Documents</h2><button class="kebab" aria-label="Document options">•••</button></div>
              <div class="employee-document-list">
                ${[['Performance Evaluation.pdf','PDF • 1.24 MB'],['Contract Agreement.pdf','PDF • 895 KB'],['Curriculum Vitae.pdf','PDF • 1.27 MB'],['Portfolio.pdf','PDF • 3.68 MB']].map(([name,meta]) => `
                  <a href="#document" class="employee-document" data-action="download-emp-doc" data-doc="${safe(name)}" data-emp="${safe(profile.name)}"><i><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></i><span><b>${name}</b><small>${meta}</small></span></a>
                `).join('')}
              </div>
            </section>
          </div>
          <section class="module-card employee-notes-card">
            <div class="module-card-head"><h2>Internal Notes</h2><button class="kebab" aria-label="Note options">•••</button></div>
            <div class="employee-notes-grid">
              <article><strong>Promotion Feedback</strong><small>10 January 2026</small><p>${safe(profile.name)} is building a strong record in ${safe(profile.department)} through consistent performance and team support.</p></article>
              <article><strong>Employee Appreciation</strong><small>02 May 2026</small><p>${safe(profile.name)} is recognized for contributing to team goals and sharing expertise with colleagues.</p></article>
            </div>
          </section>
        </div>
        <aside class="employee-detail-side">
          <section class="module-card employee-calendar-card">
            <div class="employee-mini-calendar-head"><strong>${new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate)} ⌄</strong><div><button type="button" data-action="emp-mini-cal-prev" aria-label="Bulan sebelumnya">‹</button><button type="button" data-action="emp-mini-cal-next" aria-label="Bulan berikutnya">›</button></div></div>
            <div class="employee-mini-weekdays">${['S','M','T','W','T','F','S'].map((day) => `<span>${day}</span>`).join('')}</div>
            <div class="detail-calendar">
              ${Array.from({ length: 35 }, (_, i) => {
                const day = i - 5 + 1;
                const shown = day < 1 ? 31 + day : day > 30 ? day - 30 : day;
                const active = [4,5,6,7,8,10,11,12,13,14,17,18,19,20,21,22,25,26,27,28,29].includes(day);
                return `<span data-action="emp-mini-cal-day" data-day="${shown}" style="cursor:pointer" class="${day < 1 || day > 30 ? 'muted' : ''} ${day === selectedDate ? 'selected' : ''} ${active ? 'event-day' : ''}">${shown}</span>`;
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
    const deptOptions = departmentsData.map(d => `<option value="${safe(d.name)}">${safe(d.name)}</option>`).join('');
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
                <label>Pronoun<select name="pronoun"><option>She/Her</option><option>He/Him</option><option>They/Them</option></select></label>
                <label>Work Email<input name="email" type="email" required placeholder="name@kharismahub.com" /></label>
                <label>Phone Number<input name="phone" type="tel" placeholder="+62 812 3456 7890" /></label>
                <label class="wide-field">Address<input name="address" placeholder="Street, city, province, postal code" /></label>
                <label>Emergency Contact Name<input name="emergencyName" placeholder="Full name" /></label>
                <label>Emergency Contact Phone<input name="emergencyPhone" placeholder="+62 812 3456 7890" /></label>
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
                <label>Join Date<input name="joiningDate" type="text" placeholder="22 Okt 2026" /></label>
                <label>Job Title<input name="title" placeholder="e.g. Senior Designer" required /></label>
                <label>Department<select name="department">${deptOptions}</select></label>
                <label>Team<select name="team"><option>Design Systems</option><option>Brand Marketing</option><option>Core Platform</option><option>People Ops</option></select></label>
                <label>Employment Type<select name="employmentType"><option>Full-Time</option><option>Part-Time</option><option>Contract</option><option>Internship</option></select></label>
                <label>Work Model<select name="workModel"><option>On-Site</option><option>Hybrid</option><option>Remote</option></select></label>
                <label>Work Schedule<select name="schedule"><option>Mon - Fri, 09:00 - 17:00</option><option>Flexible Hours</option><option>Shift Schedule</option></select></label>
                <label>Basic Salary<input name="salary" placeholder="Rp3.500.000 / bulan" /></label>
                <label>Allowances<input name="allowance" placeholder="Rp350.000 / bulan" /></label>
                <label>Bank Name<input name="bank" placeholder="Bank Central Asia (BCA)" /></label>
                <label>Bank Account Number<input name="account" placeholder="XXXX XXXX XXXX" /></label>
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
                <div><h4>Allowances</h4><label><input type="checkbox" checked /> Transportation</label><label><input type="checkbox" checked /> Meal allowance</label><label><input type="checkbox" /> Internet</label><label><input type="checkbox" /> Housing</label></div>
                <div><h4>Benefits</h4><label><input type="checkbox" checked /> Health insurance</label><label><input type="checkbox" checked /> Life insurance</label><label><input type="checkbox" /> Retirement plan</label><label><input type="checkbox" /> Company device</label></div>
                <div><h4>Development &amp; Wellness</h4><label><input type="checkbox" checked /> Training budget</label><label><input type="checkbox" /> Gym membership</label><label><input type="checkbox" checked /> Paid leave</label><label><input type="checkbox" /> Mental health support</label></div>
              </div>
              <div class="employee-upload-grid">
                ${['Official ID','Signed contract','Certificate','Other documents'].map((label) => `<label><span>${label}</span><input type="file" /></label>`).join('')}
              </div>
              <label class="employee-add-toggle"><input type="checkbox" name="activateEmployee" checked /> Activate Employee</label>
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

  // 0. PORTAL KARYAWAN (Employee Self-Service / ESS Hub)
  if (key === 'portal') {
    const currentAcc = getActiveAccount();
    const ownEmp = getOwnEmployeeRow();
    const myName = ownEmp ? ownEmp[0] : (currentAcc ? currentAcc.name : userProfile.name);
    const empProf = getEmployeeProfile(myName);
    const myEmpId = empProf.id || (ownEmp ? `EMP-${getEmployeeId(ownEmp)}` : (currentAcc?.employeeId || 'EMP-0001'));
    const myDept = ownEmp ? ownEmp[2] : (currentAcc ? currentAcc.department : userProfile.department);
    const myTitle = ownEmp ? ownEmp[3] : (currentAcc ? currentAcc.title : userProfile.title);
    const myRole = currentAcc ? currentAcc.role : userProfile.role;
    const myWorkModel = empProf.workModel || 'On-Site';

    // Attendance State
    const activeRecordToday = userAttendanceRecord && (userAttendanceRecord.dateKey === attendanceTodayKey() || isActiveOvernightAttendance(userAttendanceRecord));
    const hasClockedIn = Boolean(activeRecordToday && userAttendanceRecord?.clockIn && userAttendanceRecord.clockIn !== '—');
    const hasClockedOut = Boolean(activeRecordToday && userAttendanceRecord?.clockOut && userAttendanceRecord.clockOut !== '—');
    const isOnOvertime = Boolean(activeRecordToday && userAttendanceRecord?.state === 'on_overtime');
    const isWorking = Boolean(activeRecordToday && userAttendanceRecord?.state === 'working');
    const canClockOut = Boolean(activeRecordToday && (isWorking || userAttendanceRecord?.state === 'on_break' || isOnOvertime) && !hasClockedOut);
    const canStartOvertime = Boolean(activeRecordToday && hasClockedIn && !isOnOvertime);

    let statusText = 'Belum Absen Hari Ini';
    let statusClass = 'pending';
    if (isOnOvertime) {
      statusText = `Sedang Lembur • Sejak ${safe(userAttendanceRecord.overtimeStart || userAttendanceRecord.clockIn)}`;
      statusClass = 'overtime';
    } else if (hasClockedOut) {
      statusText = `Selesai Bekerja • Pulang ${safe(userAttendanceRecord.clockOut)}`;
      statusClass = 'completed';
    } else if (isWorking || hasClockedIn) {
      statusText = `Sedang Bekerja • Masuk ${safe(userAttendanceRecord.clockIn)}`;
      statusClass = 'active-work';
    }

    // Leave & Quota
    const userLeaves = leaveRequests.filter(req => {
      return String(req.name || '').toLowerCase() === String(myName || '').toLowerCase() ||
        String(req.email || '').toLowerCase() === String(userProfile.email || '').toLowerCase();
    });
    const pendingLeaves = userLeaves.filter(l => l.status === 'Pending').length;
    const totalAnnualQuota = 12;
    const usedAnnualDays = userLeaves
      .filter(l => (l.status === 'Approved' || l.status === 'Disetujui') && String(l.type || '').toLowerCase().includes('cuti'))
      .reduce((sum, l) => {
        const match = String(l.duration || '').match(/(\d+)/);
        return sum + (match ? parseInt(match[1], 10) : 1);
      }, 0);
    const remainingLeaveDays = Math.max(0, totalAnnualQuota - usedAnnualDays);

    // Personal Attendance 7-Day History
    const personalHistory = getPersonalAttendanceHistory().slice(0, 7);

    // Personal Payslip Data
    const baseSalaryNum = Math.round((empProf.salaryRaw || 3200) * 1000);
    const allowanceNum = Math.round((empProf.allowanceRaw || 300) * 1000);
    const estTakeHome = baseSalaryNum + allowanceNum + 350000 - Math.round(baseSalaryNum * 0.065);
    const fmtRupiah = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(num);

    const now = new Date();
    const dateFormatted = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const timeFormatted = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';

    return `
      <div class="portal-layout">
        <!-- 1. Hero Header Banner Profil -->
        <section class="portal-hero">
          <div class="portal-hero-decor-circle decor-1"></div>
          <div class="portal-hero-decor-circle decor-2"></div>
          
          <div class="portal-hero-profile">
            <div class="portal-hero-avatar-wrap">
              <div class="portal-hero-avatar">
                ${empProf.avatar ? `<img src="https://randomuser.me/api/portraits/${empProf.avatar}.jpg" alt="${safe(myName)}" onerror="this.remove()" />` : initials(myName)}
              </div>
              <span class="portal-avatar-status-dot" style="background:${statusDotColor}"></span>
            </div>
            
            <div class="portal-hero-info">
              <div class="portal-hero-greeting-row">
                <h2>Halo, ${safe(myName)}</h2>
                <span class="portal-greeting-badge">Karyawan Aktif</span>
              </div>
              <div class="portal-hero-meta-line">
                <span class="portal-meta-item"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg> ${safe(myTitle)}</span>
                <span class="portal-meta-sep">•</span>
                <span class="portal-meta-item"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg> ${safe(myDept)}</span>
                <span class="portal-meta-sep">•</span>
                <span class="portal-meta-item code-pill">${safe(myEmpId)}</span>
              </div>
              <div class="portal-meta-badges">
                <span class="portal-chip ${statusClass}">
                  <span class="live-pulse-dot ${statusClass === 'active-work' || statusClass === 'overtime' ? 'working' : 'break'}"></span>
                  ${statusText}
                </span>
                <span class="portal-chip glass"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> ${safe(myWorkModel)}</span>
                <span class="portal-chip glass"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> ${roleLabel(myRole)}</span>
              </div>
            </div>
          </div>
          
          <div class="portal-hero-time-widget">
            <div class="portal-time-widget-inner">
              <div class="portal-time-header">
                <span class="portal-live-indicator"><span class="pulse-ring"></span>WAKTU LOKAL</span>
                <span class="portal-shift-tag">Shift Reguler</span>
              </div>
              <div class="portal-clock-display" id="portalLiveClockDisplay">${timeFormatted}</div>
              <div class="portal-date-display">${dateFormatted}</div>
              <div class="portal-shift-schedule">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>Jadwal: 09:00 – 17:00 WIB</span>
              </div>
            </div>
          </div>
        </section>

        <!-- 2. Main Two-Column Grid -->
        <div class="portal-grid-layout">
          <!-- Left Column -->
          <div style="display:flex;flex-direction:column;gap:18px;">
            <!-- Panel Presensi & Lembur Mandiri -->
            <section class="module-card portal-card" style="margin:0">
              <div class="portal-card-header">
                <div class="portal-card-title-group">
                  <div class="portal-card-icon blue">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </div>
                  <div>
                    <h3>Kontrol Presensi &amp; Lembur Mandiri</h3>
                    <small>Catat kehadiran hari kerja dan sesi lembur secara mandiri</small>
                  </div>
                </div>
                <div class="portal-gps-badge ${userAttendanceRecord?.location?.verified ? 'verified' : 'ready'}">
                  <span class="gps-dot"></span>
                  <span>${userAttendanceRecord?.location?.verified ? 'Radius Terverifikasi' : 'GPS Siap Diverifikasi'}</span>
                </div>
              </div>

              <!-- 4 Attendance Action Tiles -->
              <div class="portal-action-tiles-grid">
                <!-- Absen Masuk -->
                <button type="button" class="portal-action-tile checkin ${!hasClockedIn ? 'ready-pulse' : 'completed'}" data-action="attendance-transition" data-transition="clock_in" ${hasClockedIn ? 'disabled' : ''}>
                  <div class="action-tile-icon-wrap">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                  </div>
                  <div class="action-tile-content">
                    <span class="action-tile-title">Absen Masuk</span>
                    <span class="action-tile-status">${hasClockedIn ? `Masuk: ${safe(userAttendanceRecord.clockIn)}` : 'Klik untuk Check-In'}</span>
                  </div>
                  <span class="action-tile-badge">${hasClockedIn ? '✓ Selesai' : 'Siap'}</span>
                </button>

                <!-- Absen Keluar -->
                <button type="button" class="portal-action-tile checkout ${canClockOut ? 'ready-pulse' : hasClockedOut ? 'completed' : 'locked'}" data-action="attendance-transition" data-transition="clock_out" ${!canClockOut ? 'disabled' : ''}>
                  <div class="action-tile-icon-wrap">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  </div>
                  <div class="action-tile-content">
                    <span class="action-tile-title">Absen Keluar</span>
                    <span class="action-tile-status">${hasClockedOut ? `Pulang: ${safe(userAttendanceRecord.clockOut)}` : canClockOut ? 'Klik untuk Check-Out' : 'Belum Check-In'}</span>
                  </div>
                  <span class="action-tile-badge">${hasClockedOut ? '✓ Selesai' : canClockOut ? 'Buka' : 'Terkunci'}</span>
                </button>

                <!-- Mulai Lembur -->
                <button type="button" class="portal-action-tile overtime-start ${canStartOvertime ? 'ready' : isOnOvertime ? 'completed' : 'locked'}" data-action="attendance-transition" data-transition="overtime_start" ${!canStartOvertime ? 'disabled' : ''}>
                  <div class="action-tile-icon-wrap">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </div>
                  <div class="action-tile-content">
                    <span class="action-tile-title">Mulai Lembur</span>
                    <span class="action-tile-status">${isOnOvertime ? 'Sedang Berjalan' : canStartOvertime ? 'Mulai Sesi Lembur' : 'Setelah Check-In'}</span>
                  </div>
                  <span class="action-tile-badge">${isOnOvertime ? '⚡ Aktif' : canStartOvertime ? 'Tersedia' : 'Terkunci'}</span>
                </button>

                <!-- Selesai Lembur -->
                <button type="button" class="portal-action-tile overtime-end ${isOnOvertime ? 'ready-pulse' : 'locked'}" data-action="attendance-transition" data-transition="overtime_end" ${!isOnOvertime ? 'disabled' : ''}>
                  <div class="action-tile-icon-wrap">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                  </div>
                  <div class="action-tile-content">
                    <span class="action-tile-title">Selesai Lembur</span>
                    <span class="action-tile-status">${isOnOvertime ? 'Hentikan Pencatat Lembur' : 'Tidak Ada Sesi'}</span>
                  </div>
                  <span class="action-tile-badge">${isOnOvertime ? 'Siap' : 'Nonaktif'}</span>
                </button>
              </div>

              <!-- Quick Action Sub-bar -->
              <div class="portal-quick-actions-bar">
                <button type="button" class="portal-quick-btn primary" data-action="toggle-att-leave">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                  <span>+ Ajukan Izin / Cuti Kerja</span>
                </button>
                <button type="button" class="portal-quick-btn secondary" data-action="toggle-att-correction">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  <span>Ajukan Koreksi Jam Kerja</span>
                </button>
              </div>

              <!-- Drawer Formulir Izin Kerja -->
              <div id="attLeaveDrawer" class="attendance-drawer portal-form-drawer" hidden style="margin-top:14px">
                <form data-attendance-leave-form class="attendance-drawer-form" style="background:#0c1e36;border:1px solid #1e3a5f;color:#fff">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:10px">
                    <div>
                      <h4 style="margin:0;font-size:15px;color:#fff;display:flex;align-items:center;gap:8px">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                        Formulir Pengajuan Izin Kerja &amp; Cuti
                      </h4>
                      <p style="margin:4px 0 0;font-size:12px;color:#cbd5e1">Isi formulir pengajuan ketidakhadiran resmi untuk ditinjau oleh atasan/HRD.</p>
                    </div>
                    <button type="button" class="att-drawer-close" data-action="toggle-att-leave" aria-label="Tutup Formulir">&times;</button>
                  </div>
                  <div class="dialog-two">
                    <label style="color:#e2e8f0;font-size:12px;display:grid;gap:4px">Jenis Izin Kerja
                      <select name="type" required style="background:#fff;color:#0f172a;border-radius:6px;height:34px;padding:0 8px;border:1px solid #cbd5e1;font-size:13px">
                        <option value="Sakit">Sakit (Dengan/Tanpa Surat Dokter)</option>
                        <option value="Melahirkan">Melahirkan (Cuti Melahirkan)</option>
                        <option value="Menikah">Menikah (Izin Pernikahan)</option>
                        <option value="Cuti">Cuti Tahunan (Cuti Mandiri)</option>
                        <option value="Lainnya">Lainnya (Keperluan Keluarga / Dinas Luar)</option>
                      </select>
                    </label>
                    <label style="color:#e2e8f0;font-size:12px;display:grid;gap:4px">Durasi Pengajuan
                      <input id="attLeaveDurationDisplay" type="text" readonly value="1 Hari" style="background:#f1f5f9;color:#0f172a;border-radius:6px;height:34px;padding:0 8px;border:1px solid #cbd5e1;font-size:13px;font-weight:700" />
                    </label>
                  </div>
                  <div class="dialog-two" style="margin-top:8px">
                    <label style="color:#e2e8f0;font-size:12px;display:grid;gap:4px">Tanggal Mulai Izin
                      <input name="startDate" id="attLeaveStartDate" type="date" required value="${attendanceTodayKey()}" style="background:#fff;color:#0f172a;border-radius:6px;height:34px;padding:0 8px;border:1px solid #cbd5e1;font-size:13px" />
                    </label>
                    <label style="color:#e2e8f0;font-size:12px;display:grid;gap:4px">Tanggal Selesai Izin
                      <input name="endDate" id="attLeaveEndDate" type="date" required value="${attendanceTodayKey()}" style="background:#fff;color:#0f172a;border-radius:6px;height:34px;padding:0 8px;border:1px solid #cbd5e1;font-size:13px" />
                    </label>
                  </div>
                  <label style="margin-top:8px;color:#e2e8f0;font-size:12px;display:grid;gap:4px">Keterangan / Alasan Izin
                    <textarea name="reason" rows="2" required placeholder="Tuliskan keterangan detail keperluan izin kerja..." style="background:#fff;color:#0f172a;border-radius:6px;padding:8px;border:1px solid #cbd5e1;font-size:13px"></textarea>
                  </label>
                  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
                    <button type="button" class="module-button secondary" data-action="toggle-att-leave" style="color:#0f172a">Batal</button>
                    <button type="submit" class="module-button primary" style="background:#0962ea;border-color:#0962ea;color:#fff">Kirim Pengajuan Izin</button>
                  </div>
                </form>
              </div>

              <!-- Drawer Koreksi Presensi -->
              <div id="attCorrectionDrawer" class="attendance-drawer portal-form-drawer" hidden style="margin-top:14px">
                <form data-attendance-correction class="attendance-drawer-form" style="background:#0c1e36;border:1px solid #1e3a5f;color:#fff">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:8px">
                    <h4 style="margin:0;font-size:14px;color:#fff">Pengajuan Koreksi Jam Kerja</h4>
                    <button type="button" class="att-drawer-close" data-action="toggle-att-correction">&times;</button>
                  </div>
                  <div class="dialog-two">
                    <label style="color:#e2e8f0;font-size:12px">Koreksi Jam Masuk<input name="clockIn" type="time" style="background:#fff;color:#0f172a" /></label>
                    <label style="color:#e2e8f0;font-size:12px">Koreksi Jam Pulang<input name="clockOut" type="time" style="background:#fff;color:#0f172a" /></label>
                  </div>
                  <label style="margin-top:8px;color:#e2e8f0;font-size:12px">Alasan Koreksi
                    <textarea name="reason" rows="2" required placeholder="Jelaskan alasan penyesuaian jam kerja..." style="background:#fff;color:#0f172a"></textarea>
                  </label>
                  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
                    <button type="button" class="module-button secondary" data-action="toggle-att-correction">Batal</button>
                    <button type="submit" class="module-button primary">Kirim Permintaan Koreksi</button>
                  </div>
                </form>
              </div>
            </section>

            <!-- Panel Cuti & Pengajuan Izin Kerja -->
            <section class="module-card portal-card" style="margin:0">
              <div class="portal-card-header">
                <div class="portal-card-title-group">
                  <div class="portal-card-icon green">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><line x1="9" y1="14" x2="15" y2="18"/><line x1="15" y1="14" x2="9" y2="18"/></svg>
                  </div>
                  <div>
                    <h3>Manajemen Cuti &amp; Izin Kerja Saya</h3>
                    <small>Pelacakan hak cuti tahunan dan status persetujuan atasan</small>
                  </div>
                </div>
                <button type="button" class="portal-card-action-btn" data-action="toggle-att-leave">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  <span>+ Ajukan Izin</span>
                </button>
              </div>

              <!-- 3 Minimalist Stat Widgets -->
              <div class="portal-stat-grid">
                <div class="portal-stat-widget highlight">
                  <div class="stat-widget-top">
                    <span class="stat-widget-label">Sisa Cuti Tahunan</span>
                    <span class="stat-widget-icon emerald">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    </span>
                  </div>
                  <div class="stat-widget-value">${remainingLeaveDays} <small>Hari</small></div>
                  <div class="stat-progress-bar">
                    <div class="stat-progress-fill" style="width:${leavePct}%"></div>
                  </div>
                  <span class="stat-widget-footer">${remainingLeaveDays} dari 12 hari kuota tahunan</span>
                </div>

                <div class="portal-stat-widget">
                  <div class="stat-widget-top">
                    <span class="stat-widget-label">Cuti / Izin Terpakai</span>
                    <span class="stat-widget-icon blue">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </span>
                  </div>
                  <div class="stat-widget-value">${usedAnnualDays} <small>Hari</small></div>
                  <div class="stat-progress-bar">
                    <div class="stat-progress-fill blue" style="width:${Math.round((usedAnnualDays / totalAnnualQuota) * 100)}%"></div>
                  </div>
                  <span class="stat-widget-footer">Tahun berjalan 2026</span>
                </div>

                <div class="portal-stat-widget">
                  <div class="stat-widget-top">
                    <span class="stat-widget-label">Menunggu Persetujuan</span>
                    <span class="stat-widget-icon amber">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    </span>
                  </div>
                  <div class="stat-widget-value">${pendingLeaves} <small>Pengajuan</small></div>
                  <div class="stat-progress-bar">
                    <div class="stat-progress-fill amber" style="width:${pendingLeaves > 0 ? 100 : 0}%"></div>
                  </div>
                  <span class="stat-widget-footer">${pendingLeaves > 0 ? 'Sedang ditinjau Atasan & HR' : '✓ Semua permohonan diproses'}</span>
                </div>
              </div>

              <!-- Tabel Riwayat Izin Personal -->
              <div class="portal-subtable-wrap">
                <div class="portal-subtable-head">
                  <h4>Riwayat Pengajuan Izin Kerja &amp; Cuti</h4>
                  <span class="subtable-badge">${userLeaves.length} Permohonan</span>
                </div>
                <div class="module-table-wrap">
                  <table class="module-table portal-table">
                    <thead>
                      <tr>
                        <th>Jenis Izin</th>
                        <th>Tanggal</th>
                        <th>Durasi</th>
                        <th>Alasan</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${userLeaves.length ? userLeaves.slice(0, 5).map(l => `
                        <tr>
                          <td><span class="portal-type-pill">${safe(l.type)}</span></td>
                          <td><span style="font-weight:600;color:#1e293b">${safe(l.startDate || l.start || '—')}</span> ${l.endDate && l.endDate !== l.startDate ? `<small style="color:#64748b"> s/d ${safe(l.endDate)}</small>` : ''}</td>
                          <td><span class="portal-duration-pill">${safe(l.duration || '1 Hari')}</span></td>
                          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475569">${safe(l.reason || '—')}</td>
                          <td>
                            <span class="portal-status-pill ${l.status === 'Approved' || l.status === 'Disetujui' ? 'approved' : l.status === 'Rejected' || l.status === 'Ditolak' ? 'rejected' : 'pending'}">
                              ${l.status === 'Approved' || l.status === 'Disetujui' ? '✓ Disetujui' : l.status === 'Rejected' || l.status === 'Ditolak' ? '✕ Ditolak' : '⏳ Menunggu'}
                            </span>
                          </td>
                        </tr>
                      `).join('') : `
                        <tr>
                          <td colspan="5" style="text-align:center;padding:32px 16px">
                            <div class="portal-empty-state">
                              <div class="empty-icon-circle">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                              </div>
                              <strong style="display:block;margin-top:8px;font-size:13px;color:#334155">Belum Ada Pengajuan Izin Kerja</strong>
                              <p style="margin:2px 0 12px;font-size:12px;color:#64748b">Ajukan permohonan sakit, cuti tahunan, atau izin lainnya secara online.</p>
                              <button type="button" class="portal-quick-btn primary" data-action="toggle-att-leave" style="margin:0 auto">
                                + Ajukan Izin Sekarang
                              </button>
                            </div>
                          </td>
                        </tr>
                      `}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <!-- Panel Akses Slip Gaji Pribadi -->
            <section class="module-card portal-card" style="margin:0">
              <div class="portal-card-header">
                <div class="portal-card-title-group">
                  <div class="portal-card-icon purple">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                  </div>
                  <div>
                    <h3>Slip Gaji Saya (Official Payslips)</h3>
                    <small>Rincian gaji bulanan terverifikasi resmi oleh Keuangan &amp; SDM</small>
                  </div>
                </div>
                <span class="portal-verified-chip">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  Kompensasi Terverifikasi
                </span>
              </div>

              <!-- Highlight Current Month Payslip -->
              <div class="portal-payslip-hero-card">
                <div class="payslip-hero-left">
                  <div class="payslip-doc-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                  </div>
                  <div>
                    <div style="display:flex;align-items:center;gap:8px">
                      <strong style="font-size:14.5px;color:#0f172a">Periode Oktober 2026</strong>
                      <span class="portal-badge-new">Bulan Ini</span>
                    </div>
                    <small style="color:#64748b;font-size:12px;margin-top:2px;display:block">Jadwal Transfer: 28 Okt 2026 • Rekening Payroll</small>
                  </div>
                </div>
                <div class="payslip-hero-right">
                  <div class="payslip-amount-col">
                    <small style="color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Estimasi Gaji Bersih</small>
                    <strong class="payslip-amount-val">${fmtRupiah(estTakeHome)}</strong>
                  </div>
                  <button type="button" class="portal-primary-btn" data-action="view-my-payslip" data-name="${safe(myName)}" title="Buka Slip Gaji Resmi">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    <span>Lihat &amp; Cetak Slip</span>
                  </button>
                </div>
              </div>

              <!-- Previous Archives List -->
              <div class="portal-payslip-history-list">
                <div class="portal-payslip-row">
                  <div class="payslip-row-left">
                    <div class="payslip-dot-indicator"></div>
                    <div>
                      <strong>Periode September 2026</strong>
                      <small>Dibayarkan: 28 Sep 2026</small>
                    </div>
                  </div>
                  <div class="payslip-row-right">
                    <span class="portal-status-pill approved">✓ Lunas</span>
                    <button type="button" class="portal-secondary-btn" data-action="view-my-payslip" data-name="${safe(myName)}">
                      Buka Dokumen
                    </button>
                  </div>
                </div>

                <div class="portal-payslip-row">
                  <div class="payslip-row-left">
                    <div class="payslip-dot-indicator"></div>
                    <div>
                      <strong>Periode Agustus 2026</strong>
                      <small>Dibayarkan: 28 Agu 2026</small>
                    </div>
                  </div>
                  <div class="payslip-row-right">
                    <span class="portal-status-pill approved">✓ Lunas</span>
                    <button type="button" class="portal-secondary-btn" data-action="view-my-payslip" data-name="${safe(myName)}">
                      Buka Dokumen
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <!-- Right Column -->
          <div style="display:flex;flex-direction:column;gap:18px;">
            <!-- Riwayat Presensi 7 Hari Terakhir -->
            <section class="module-card portal-card" style="margin:0">
              <div class="portal-card-header">
                <div class="portal-card-title-group">
                  <div class="portal-card-icon amber">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                  </div>
                  <div>
                    <h3>Riwayat Presensi (7 Hari)</h3>
                    <small>Catatan jam masuk &amp; pulang terakhir</small>
                  </div>
                </div>
                <a href="attendance.html" class="portal-header-link">Lihat Semua &rarr;</a>
              </div>

              <div class="portal-timeline-list">
                ${personalHistory.length ? personalHistory.map(h => {
                  const parts = String(h.date || '').split(' ');
                  const dateNum = parts[0] || '—';
                  const monthName = parts[1] || 'Okt';
                  const isLate = h.status === 'Terlambat' || h.status === 'Late';
                  return `
                    <div class="portal-timeline-item ${h.isToday ? 'is-today' : ''}">
                      <div class="timeline-date-chip">
                        <span class="timeline-date-num">${safe(dateNum)}</span>
                        <span class="timeline-date-mon">${safe(monthName)}</span>
                      </div>
                      <div class="timeline-details">
                        <div class="timeline-time-row">
                          <span class="time-stamp-chip clockin" title="Jam Masuk">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                            ${safe(h.clockIn || '—')}
                          </span>
                          <span class="time-sep">→</span>
                          <span class="time-stamp-chip clockout" title="Jam Pulang">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 21 3 21 3 15"/><line x1="14" y1="10" x2="3" y2="21"/></svg>
                            ${safe(h.clockOut || '—')}
                          </span>
                        </div>
                        <div class="timeline-submeta">
                          <span>⏱ ${safe(h.duration || '—')}</span>
                          ${h.isToday ? '<span class="today-tag">Hari Ini</span>' : ''}
                        </div>
                      </div>
                      <div class="timeline-status-col">
                        <span class="portal-status-pill ${isLate ? 'late' : 'approved'}">
                          ${isLate ? 'Terlambat' : 'Tepat Waktu'}
                        </span>
                      </div>
                    </div>
                  `;
                }).join('') : `
                  <p style="color:#94a3b8;font-size:12px;margin:16px 0;text-align:center">Belum ada catatan log kehadiran.</p>
                `}
              </div>
            </section>

            <!-- Informasi Kerja & Pengumuman Resmi -->
            <section class="module-card portal-card" style="margin:0">
              <div class="portal-card-header">
                <div class="portal-card-title-group">
                  <div class="portal-card-icon blue">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  </div>
                  <div>
                    <h3>Pengumuman &amp; Memo Perusahaan</h3>
                    <small>Pembaruan penting untuk seluruh karyawan</small>
                  </div>
                </div>
                <span class="portal-badge-pulse">3 Aktif</span>
              </div>

              <div class="portal-notices-container">
                <article class="portal-memo-card payroll">
                  <div class="memo-card-top">
                    <span class="memo-tag payroll">💰 GAJI &amp; TUNJANGAN</span>
                    <span class="memo-time">23 Okt 2026</span>
                  </div>
                  <h4>Jadwal Penggajian Bulan Ini</h4>
                  <p>Proses penggajian periode Oktober 2026 akan ditransfer pada hari Rabu, 28 Oktober 2026. Rincian dokumen dapat diakses pada panel slip gaji.</p>
                </article>

                <article class="portal-memo-card policy">
                  <div class="memo-card-top">
                    <span class="memo-tag policy">📋 KEBIJAKAN SDM</span>
                    <span class="memo-time">20 Okt 2026</span>
                  </div>
                  <h4>Kebijakan Toleransi Presensi</h4>
                  <p>Batas toleransi keterlambatan adalah 15 menit dari jam shift kerja. Apabila ada kendala teknis atau dinas luar kantor, silakan ajukan fitur Koreksi Jam Kerja.</p>
                </article>

                <article class="portal-memo-card holiday">
                  <div class="memo-card-top">
                    <span class="memo-tag holiday">🌴 LIBUR &amp; CUTI</span>
                    <span class="memo-time">18 Okt 2026</span>
                  </div>
                  <h4>Libur Nasional &amp; Cuti Bersama</h4>
                  <p>Agenda libur perusahaan terdekat dapat dilihat secara interaktif dan lengkap pada menu <a href="calendar.html">Kalender Kerja</a>.</p>
                </article>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  // 7. ATTENDANCE MODULE
  if (key === 'attendance') {
    const isEmp = isEmployee();
    const liveOnTime = allAttendanceItems.filter(i => i.status === 'On-Time' || i.status === 'Tepat Waktu').length;
    const liveLate = allAttendanceItems.filter(i => i.status === 'Late' || i.status === 'Terlambat').length;
    const livePresent = liveOnTime + liveLate;
    const liveOnLeave = allAttendanceItems.filter(i => i.status === 'On Leave' || i.status === 'Cuti').length;
    const liveAbsent = allAttendanceItems.filter(i => i.status === 'Absent' || i.status === 'Tidak Hadir').length;
    const totalPool = Math.max(1, allAttendanceItems.length);
    const curPresPct = Math.round((livePresent / totalPool) * 100);
    const curLeavePct = Math.round((liveOnLeave / totalPool) * 100);
    const curAbsPct = Math.max(0, 100 - curPresPct - curLeavePct);

    const thisEmployee = employeeData.find(row => row[1]?.toLowerCase() === userProfile.email.toLowerCase()) || findEmployeeByName(userProfile.name);
    const thisEmployeeId = thisEmployee ? `EMP-${getEmployeeId(thisEmployee)}` : 'EMP-0001';
    const thisAssignment = attendancePolicy.assignments?.find(item => item.employee_id === thisEmployeeId);
    const assignedShift = attendancePolicy.shifts?.find(item => item.id === (userAttendanceRecord?.shiftId || thisAssignment?.shift_id)) || attendancePolicy.shifts?.[0] || null;
    const activeRecordToday = userAttendanceRecord && (userAttendanceRecord.dateKey === attendanceTodayKey() || isActiveOvernightAttendance(userAttendanceRecord));
    const hasClockedIn = Boolean(activeRecordToday && userAttendanceRecord?.clockIn && userAttendanceRecord.clockIn !== '—');
    const hasClockedOut = Boolean(activeRecordToday && userAttendanceRecord?.clockOut && userAttendanceRecord.clockOut !== '—');
    const isOnOvertime = Boolean(activeRecordToday && userAttendanceRecord?.state === 'on_overtime');
    const isWorking = Boolean(activeRecordToday && userAttendanceRecord?.state === 'working');
    const canClockOut = Boolean(activeRecordToday && (isWorking || userAttendanceRecord?.state === 'on_break' || isOnOvertime) && !hasClockedOut);
    const canStartOvertime = Boolean(activeRecordToday && hasClockedIn && !isOnOvertime);
    const transitionAction = !activeRecordToday ? 'clock_in'
      : userAttendanceRecord.state === 'on_break' ? 'break_end'
        : userAttendanceRecord.state === 'working' ? 'break_start'
          : userAttendanceRecord.state === 'completed' || userAttendanceRecord.clockOut ? null : 'clock_in';
    const transitionLabel = transitionAction === 'clock_in' ? 'Absen Masuk (Clock In)' : transitionAction === 'break_start' ? 'Mulai Istirahat' : transitionAction === 'break_end' ? 'Selesai Istirahat' : 'Presensi Selesai';

    const chartBars = [
      ['May', 84, 9, 7],
      ['Jun', 88, 7, 5],
      ['Jul', 82, 10, 8],
      ['Aug', 86, 8, 6],
      ['Sep', 85, 9, 6],
      ['Oct', curPresPct, curLeavePct, curAbsPct]
    ];

    const personalHistory = getPersonalAttendanceHistory();
    const personalPresentDays = personalHistory.length;
    const personalOnTimeDays = personalHistory.filter(h => h.status === 'Tepat Waktu' || h.status === 'On-Time').length;
    const personalLateDays = personalHistory.filter(h => h.status === 'Terlambat' || h.status === 'Late').length;
    let totalWorkMinutes = 0;
    personalHistory.forEach(h => {
      const m = String(h.duration || '').match(/(\d+)h\s*(\d+)m/);
      if (m) totalWorkMinutes += parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      else if (h.duration && h.duration.includes('h')) {
        const hVal = parseInt(h.duration, 10);
        if (!isNaN(hVal)) totalWorkMinutes += hVal * 60;
      }
    });
    if (totalWorkMinutes === 0) totalWorkMinutes = personalPresentDays * 8 * 60 + 15;
    const totalWorkHoursFormatted = `${Math.floor(totalWorkMinutes / 60)}j ${totalWorkMinutes % 60}m`;

    const selfServiceHeroHtml = `
      <section class="module-card attendance-self-service">
        <div class="att-watermark-clock" aria-hidden="true">
          <svg width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M12 5V3"/></svg>
        </div>
        <div class="attendance-live-bar">
          <div class="attendance-live-info">
            <div class="attendance-live-title">
              <span class="live-pulse-dot ${activeRecordToday && userAttendanceRecord?.state === 'on_break' ? 'break' : 'working'}"></span>
              <strong>Presensi Mandiri (${safe(userProfile.name)})</strong>
              <span class="att-self-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14v2H5v-2z"/></svg>
                ${safe(attendanceDisplayState())}
              </span>
              <span class="att-live-clock" id="attLiveClockDisplay">${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} WIB</span>
            </div>
            <div class="attendance-timeline">
              <div class="att-meta-card">
                <i class="att-meta-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="16" cy="16" r="3"/></svg></i>
                <div class="att-meta-copy">
                  <small>Shift</small>
                  <b>${assignedShift ? safe(assignedShift.name) : 'Shift Reguler'}</b>
                  <em>${assignedShift ? `${String(assignedShift.start_time).slice(0,5)} – ${String(assignedShift.end_time).slice(0,5)}` : '09:00 – 17:00'}</em>
                </div>
              </div>
              <div class="att-meta-card">
                <i class="att-meta-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg></i>
                <div class="att-meta-copy">
                  <small>Masuk</small>
                  <b>${safe(userAttendanceRecord?.clockIn || '—')}</b>
                </div>
              </div>
              ${(userAttendanceRecord?.breakSessions || []).length ? `
              <div class="att-meta-card">
                <i class="att-meta-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/></svg></i>
                <div class="att-meta-copy">
                  <small>Istirahat</small>
                  <b>${userAttendanceRecord.breakSessions.map(item => `${attendanceTimeLabel(item.start)}-${item.end ? attendanceTimeLabel(item.end) : 'aktif'}`).join(', ')}</b>
                </div>
              </div>` : ''}
              <div class="att-meta-card">
                <i class="att-meta-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></i>
                <div class="att-meta-copy">
                  <small>Pulang</small>
                  <b>${safe(userAttendanceRecord?.clockOut || '—')}</b>
                </div>
              </div>
              <div class="att-meta-card">
                <i class="att-meta-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></i>
                <div class="att-meta-copy">
                  <small>Durasi</small>
                  <b>${safe(userAttendanceRecord?.duration || '—')}</b>
                </div>
              </div>
              <div class="att-meta-card">
                <i class="att-meta-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></i>
                <div class="att-meta-copy">
                  <small>Lembur</small>
                  <b>${isOnOvertime ? 'Sedang Berjalan' : safe(userAttendanceRecord?.overtime || '—')}</b>
                </div>
              </div>
              <div class="att-meta-card">
                <i class="att-meta-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></i>
                <div class="att-meta-copy">
                  <small>Lokasi</small>
                  <b>${userAttendanceRecord?.location?.verified ? (userAttendanceRecord.location.remote ? 'Remote/WFH • Tercatat' : `Kantor • Radius ${Math.round(userAttendanceRecord.location.distance || 0)}m`) : 'Siap diverifikasi (GPS)'}</b>
                </div>
              </div>
            </div>
          </div>
          <div class="attendance-live-actions">
            <div class="att-actions-control-grid">
              <!-- 1. Absen Masuk -->
              <button type="button" class="att-btn-action ${!hasClockedIn ? 'active-cta' : 'disabled-done'}" data-action="attendance-transition" data-transition="clock_in" ${hasClockedIn ? 'disabled' : ''}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
                <span>${hasClockedIn ? `Masuk (${safe(userAttendanceRecord.clockIn)})` : 'Absen Masuk'}</span>
              </button>

              <!-- 2. Absen Keluar -->
              <button type="button" class="att-btn-action ${canClockOut ? 'active-cta warning' : 'disabled-done'}" data-action="attendance-transition" data-transition="clock_out" ${!canClockOut ? 'disabled' : ''}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                <span>${hasClockedOut ? `Pulang (${safe(userAttendanceRecord.clockOut)})` : 'Absen Keluar'}</span>
              </button>

              <!-- 3. Mulai Lembur -->
              <button type="button" class="att-btn-action ${canStartOvertime ? 'active-cta purple' : 'disabled-done'}" data-action="attendance-transition" data-transition="overtime_start" ${!canStartOvertime ? 'disabled' : ''}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>${isOnOvertime ? 'Lembur Aktif' : 'Mulai Lembur'}</span>
              </button>

              <!-- 4. Selesai Lembur -->
              <button type="button" class="att-btn-action ${isOnOvertime ? 'active-cta amber pulse' : 'disabled-done'}" data-action="attendance-transition" data-transition="overtime_end" ${!isOnOvertime ? 'disabled' : ''}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                <span>Selesai Lembur</span>
              </button>
            </div>
            <div class="att-cta-sub-row" style="margin-top:10px">
              <button type="button" class="att-sub-btn primary-leave" data-action="toggle-att-leave" title="Formulir Pengajuan Izin Kerja">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                <span>+ Ajukan Izin Kerja</span>
              </button>
              <button type="button" class="att-sub-btn" data-action="toggle-att-correction" title="Ajukan Koreksi Jam Kerja">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>Ajukan Koreksi Presensi</span>
              </button>
              ${(isAdmin() || isSupervisor()) ? `
              <button type="button" class="att-sub-btn" data-action="toggle-att-admin" title="Pengaturan Lokasi Kantor & Shift">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>Kebijakan &amp; Shift</span>
              </button>` : ''}
            </div>
          </div>
        </div>

        <!-- Drawer Pengajuan Izin Kerja -->
        <div id="attLeaveDrawer" class="attendance-drawer" hidden>
          <form data-attendance-leave-form class="attendance-drawer-form">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:10px">
              <div>
                <h4 style="margin:0;font-size:15px;color:#fff;display:flex;align-items:center;gap:8px">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                  Formulir Pengajuan Izin Kerja
                </h4>
                <small style="color:rgba(255,255,255,0.75);font-size:12px">Ajukan permohonan izin atau cuti kerja kepada Atasan &amp; HRD</small>
              </div>
              <button type="button" class="module-button secondary" data-action="toggle-att-leave" style="padding:4px 10px;font-size:12px;height:28px">✕ Tutup</button>
            </div>

            <div class="dialog-two">
              <label>Jenis Izin Kerja
                <select name="leaveType" required style="cursor:pointer">
                  <option value="Sakit">Sakit</option>
                  <option value="Melahirkan">Melahirkan</option>
                  <option value="Menikah">Menikah</option>
                  <option value="Cuti">Cuti (Cuti Tahunan)</option>
                  <option value="Lainnya">Lainnya</option>
                </select>
              </label>
              <label>Lamanya Izin (Dihitung Otomatis)
                <div id="leaveDurationBadge" style="display:flex;align-items:center;height:40px;padding:0 14px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.25);border-radius:8px;color:#fff;font-weight:800;font-size:13.5px">
                  1 Hari
                </div>
              </label>
            </div>

            <div class="dialog-two">
              <label>Tanggal Mulai Izin
                <input type="date" name="startDate" id="leaveStartDate" value="${attendanceTodayKey()}" required />
              </label>
              <label>Tanggal Selesai Izin
                <input type="date" name="endDate" id="leaveEndDate" value="${attendanceTodayKey()}" required />
              </label>
            </div>

            <label>Keterangan / Alasan Izin
              <textarea name="reason" rows="3" placeholder="Tuliskan keterangan lengkap pengajuan izin kerja Anda..." required style="resize:vertical"></textarea>
            </label>

            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
              <button type="button" class="module-button secondary" data-action="toggle-att-leave">Batal</button>
              <button class="module-button primary" type="submit" style="background:#0962ea;color:#fff;font-weight:700;padding:0 20px">Kirim Pengajuan Izin</button>
            </div>
          </form>
        </div>

        <div id="attCorrectionDrawer" class="attendance-drawer" hidden>
          <form data-attendance-correction class="attendance-drawer-form">
            <h4>Ajukan Koreksi Catatan Presensi</h4>
            <div class="dialog-two">
              <label>Jam Masuk Seharusnya<input type="time" name="clockIn" value="${safe(String(userAttendanceRecord?.clockIn || '09:00').slice(0,5))}" required /></label>
              <label>Jam Pulang Seharusnya<input type="time" name="clockOut" value="${safe(String(userAttendanceRecord?.clockOut || '17:00').slice(0,5))}" required /></label>
            </div>
            <label>Alasan Koreksi<input type="text" name="reason" minlength="5" maxlength="500" placeholder="Contoh: Lupa menekan tombol presensi saat bertugas luar kantor" required /></label>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
              <button type="button" class="module-button secondary" data-action="toggle-att-correction">Tutup</button>
              <button class="module-button primary" type="submit">Kirim Pengajuan Koreksi</button>
            </div>
          </form>
        </div>
      </section>
    `;

    const attAdminDrawerHtml = (isAdmin() || isSupervisor()) ? `
      <div id="attAdminDrawer" class="attendance-drawer module-card" hidden style="margin-bottom:16px;padding:16px;background:#fff;border-radius:14px;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(12,30,54,0.05)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;border-bottom:1px solid #e2e8f0;padding-bottom:10px">
          <div>
            <h3 style="margin:0;font-size:15px;color:#0c1e36;display:flex;align-items:center;gap:8px">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              Pengaturan Kebijakan Presensi &amp; Jam Shift
            </h3>
            <small style="color:#64748b;font-size:12px">Konfigurasi radius geofencing GPS kantor, jam kerja shift, dan penugasan karyawan</small>
          </div>
          <button type="button" class="module-button secondary" data-action="toggle-att-admin" style="padding:4px 10px;font-size:12px;height:28px">✕ Tutup</button>
        </div>
        <div class="attendance-admin-grid">
          ${isAdmin() ? `
          <form data-attendance-location-form class="attendance-drawer-form">
            <h4>1. Lokasi &amp; Radius Kantor</h4>
            <div class="dialog-two">
              <label>Latitude<input type="number" step="any" name="latitude" value="${safe(attendancePolicy.location?.latitude ?? -6.208763)}" required /></label>
              <label>Longitude<input type="number" step="any" name="longitude" value="${safe(attendancePolicy.location?.longitude ?? 106.845599)}" required /></label>
            </div>
            <label>Radius Kantor (meter)<input type="number" name="radius" min="20" max="5000" value="${safe(attendancePolicy.location?.radius_m || attendancePolicy.location?.radiusM || 500)}" required /></label>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button type="button" class="module-button secondary" data-action="use-my-gps-location">Gunakan GPS Saya</button>
              <button class="module-button primary" type="submit">Simpan Lokasi</button>
            </div>
          </form>
          <form data-attendance-shift-form class="attendance-drawer-form">
            <h4>2. Konfigurasi Jam Shift</h4>
            <div class="dialog-two">
              <label>Nama Shift<input name="shiftName" value="${safe(assignedShift?.name || 'Shift Reguler')}" required /></label>
              <label>Toleransi (menit)<input type="number" name="tolerance" min="0" max="240" value="${safe(assignedShift?.tolerance_minutes ?? 15)}" /></label>
            </div>
            <div class="dialog-two">
              <label>Jam Masuk<input type="time" name="startTime" value="${safe(String(assignedShift?.start_time || '09:00').slice(0,5))}" required /></label>
              <label>Jam Pulang<input type="time" name="endTime" value="${safe(String(assignedShift?.end_time || '17:00').slice(0,5))}" required /></label>
            </div>
            <div style="margin-top:8px">
              <button class="module-button primary" type="submit">Simpan Shift</button>
            </div>
          </form>` : ''}
          <form data-attendance-assignment class="attendance-drawer-form">
            <h4>${isAdmin() ? '3. Penugasan Shift Karyawan' : `Penugasan Shift Tim (${safe(getActiveDepartment())})`}</h4>
            <label>Target Penugasan
              <select name="employeeId" required>
                ${isAdmin() ? `
                  <option value="__all__">Seluruh Karyawan (${employeeData.length} orang)</option>
                  ${departmentsData.map(d => `<option value="__dept__:${safe(d.name)}">Divisi: ${safe(d.name)}</option>`).join('')}
                  ${employeeData.map(person => `<option value="EMP-${getEmployeeId(person)}">${safe(person[0])} • ${safe(person[2])}</option>`).join('')}
                ` : `
                  <option value="__department__">Seluruh Tim • ${safe(getActiveDepartment())}</option>
                  ${employeeData.filter(person => person[2] === getActiveDepartment()).map(person => `<option value="EMP-${getEmployeeId(person)}">${safe(person[0])}</option>`).join('')}
                `}
              </select>
            </label>
            <label>Pilih Shift Kerja
              <select name="shiftId" required>
                ${(attendancePolicy.shifts || []).map(shift => `<option value="${safe(shift.id)}">${safe(shift.name)} (${safe(String(shift.start_time).slice(0,5))} - ${safe(String(shift.end_time).slice(0,5))})</option>`).join('')}
              </select>
            </label>
            <div style="margin-top:8px">
              <button class="module-button primary" type="submit">Tetapkan Shift</button>
            </div>
          </form>
        </div>
        ${(attendanceReviewQueue.corrections.length || attendanceReviewQueue.overtime.length) ? `
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #e2e8f0">
          <h4 style="margin:0 0 10px;font-size:13px;color:#0c1e36;display:flex;align-items:center;gap:6px">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Antrean Persetujuan Koreksi &amp; Lembur (${attendanceReviewQueue.corrections.length + attendanceReviewQueue.overtime.length})
          </h4>
          ${attendanceReviewQueue.corrections.map(request => `<article class="attendance-review-item" style="border:1px solid #e2e8f0;margin-bottom:6px"><span><strong>${safe(request.attendance_records?.employee_name || request.employeeName || 'Karyawan')}</strong><small>Koreksi: ${safe(request.requested_values?.clock_in || '-')} s/d ${safe(request.requested_values?.clock_out || '-')} • ${safe(request.reason)}</small></span><button type="button" class="module-button secondary" data-action="attendance-review-correction" data-id="${safe(request.id)}" data-decision="rejected">Tolak</button><button type="button" class="module-button primary" data-action="attendance-review-correction" data-id="${safe(request.id)}" data-decision="approved">Setujui</button></article>`).join('')}
          ${attendanceReviewQueue.overtime.map(record => `<article class="attendance-review-item" style="border:1px solid #e2e8f0;margin-bottom:6px"><span><strong>${safe(record.employee_name)} • ${safe(record.date)}</strong><small>Lembur ${safe(record.overtime)}</small></span><button type="button" class="module-button secondary" data-action="attendance-review-overtime" data-id="${safe(record.id)}" data-decision="false">Tolak</button><button type="button" class="module-button primary" data-action="attendance-review-overtime" data-id="${safe(record.id)}" data-decision="true">Setujui</button></article>`).join('')}
        </div>` : ''}
      </div>` : '';

    const personalStatsHtml = `
      <div class="employee-personal-stats">
        <article class="personal-stat-card">
          <div class="personal-stat-icon blue">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>
          </div>
          <div class="personal-stat-info">
            <span class="personal-stat-label">Kehadiran Bulan Ini</span>
            <strong class="personal-stat-value">${personalPresentDays} <small style="font-size:13px;font-weight:600">Hari</small></strong>
            <span class="personal-stat-note">Aktif tercatat</span>
          </div>
        </article>

        <article class="personal-stat-card">
          <div class="personal-stat-icon green">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div class="personal-stat-info">
            <span class="personal-stat-label">Tepat Waktu</span>
            <strong class="personal-stat-value">${personalOnTimeDays} <small style="font-size:13px;font-weight:600">Hari</small></strong>
            <span class="personal-stat-note">${Math.round((personalOnTimeDays / Math.max(1, personalPresentDays)) * 100)}% kepatuhan shift</span>
          </div>
        </article>

        <article class="personal-stat-card">
          <div class="personal-stat-icon amber">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div class="personal-stat-info">
            <span class="personal-stat-label">Terlambat</span>
            <strong class="personal-stat-value">${personalLateDays} <small style="font-size:13px;font-weight:600">Hari</small></strong>
            <span class="personal-stat-note">${personalLateDays > 0 ? 'Perlu ditingkatkan' : 'Sempurna'}</span>
          </div>
        </article>

        <article class="personal-stat-card">
          <div class="personal-stat-icon purple">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div class="personal-stat-info">
            <span class="personal-stat-label">Total Jam Kerja</span>
            <strong class="personal-stat-value">${totalWorkHoursFormatted}</strong>
            <span class="personal-stat-note">Akumulasi bulan ini</span>
          </div>
        </article>
      </div>
    `;

    const personalHistoryRows = personalHistory.map(h => `
      <tr>
        <td><strong>${safe(h.date)}</strong>${h.isToday ? ' <span class="badge-role" style="font-size:10px;padding:2px 6px">Hari Ini</span>' : ''}</td>
        <td>${safe(h.shiftName || 'Shift Reguler')}</td>
        <td>
          <b>${safe(h.clockIn)}</b>
          ${h.status === 'Terlambat' || h.status === 'Late' ? '<span class="status-pill late" style="margin-left:6px;font-size:11px">Terlambat</span>' : h.clockIn !== '—' ? '<span class="status-pill on-time" style="margin-left:6px;font-size:11px">Tepat Waktu</span>' : ''}
        </td>
        <td><b>${safe(h.clockOut)}</b></td>
        <td>${safe(h.duration)}</td>
        <td>${safe(h.overtime)}</td>
        <td>${safe(h.workModel || 'Di Kantor')}</td>
        <td style="text-align:center">
          <button type="button" class="module-button secondary" style="padding:4px 10px;font-size:12px" data-action="toggle-att-correction">Koreksi</button>
        </td>
      </tr>
    `).join('');

    const personalHistoryHtml = `
      <section class="module-card attendance-table-card">
        <div class="att-table-card-head">
          <div class="att-table-title">
            <i class="att-title-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></i>
            <div>
              <h2>Riwayat Presensi Saya</h2>
              <small style="color:#64748b">Catatan waktu kehadiran dan jam kerja Anda bulan ini</small>
            </div>
          </div>
          <div class="module-toolbar att-inline-toolbar">
            <button class="date-filter">Oktober 2026 <span>⌄</span></button>
            <button type="button" class="module-button primary" data-action="toggle-att-correction" style="gap:6px">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>Ajukan Koreksi</span>
            </button>
          </div>
        </div>
        <div class="module-table-wrap">
          <table class="module-table attendance-full-table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Shift</th>
                <th>Check-In (Masuk)</th>
                <th>Check-Out (Pulang)</th>
                <th>Durasi Kerja</th>
                <th>Lembur</th>
                <th>Model Kerja</th>
                <th style="text-align:center">Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${personalHistoryRows}
            </tbody>
          </table>
        </div>
      </section>
    `;

    const myOwnEmpRow = getOwnEmployeeRow();
    const myLeaveList = leaveRequests.filter(req => {
      const targetName = (myOwnEmpRow?.[0] || userProfile.name || '').toLowerCase();
      return String(req.name || '').toLowerCase() === targetName;
    });

    const personalLeaveHistoryHtml = `
      <section class="module-card attendance-table-card" style="margin-top:16px">
        <div class="att-table-card-head">
          <div class="att-table-title">
            <i class="att-title-icon" style="background:#eef2ff;color:#4f46e5"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></i>
            <div>
              <h2>Riwayat Pengajuan Izin Kerja &amp; Cuti</h2>
              <small style="color:#64748b">Pelacakan status persetujuan pengajuan izin kerja Anda (${myLeaveList.length} permohonan)</small>
            </div>
          </div>
          <div class="module-toolbar att-inline-toolbar">
            <button type="button" class="module-button primary" data-action="toggle-att-leave" style="gap:6px">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>+ Ajukan Izin Baru</span>
            </button>
          </div>
        </div>
        <div class="module-table-wrap">
          <table class="module-table">
            <thead>
              <tr>
                <th>Tgl Pengajuan</th>
                <th>Jenis Izin</th>
                <th>Periode Izin</th>
                <th>Lamanya</th>
                <th>Keterangan</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${myLeaveList.length ? myLeaveList.map(item => `
                <tr>
                  <td><strong>${safe(item.submitDate || '-')}</strong></td>
                  <td><span class="badge-role" style="font-weight:700">${safe(item.type)}</span></td>
                  <td><b>${safe(item.period || `${item.startDate} s/d ${item.endDate || item.startDate}`)}</b></td>
                  <td><span style="font-weight:700;color:#0962ea">${safe(item.duration)}</span></td>
                  <td><span style="color:#475569;font-size:13px">${safe(item.reason || '-')}</span></td>
                  <td>
                    <span class="status-pill ${item.status === 'Approved' ? 'on-time' : item.status === 'Rejected' ? 'late' : 'blue'}" style="font-size:11px">
                      ${item.status === 'Approved' ? '✓ Disetujui' : item.status === 'Rejected' ? '✕ Ditolak' : '⏳ Menunggu Persetujuan'}
                    </span>
                  </td>
                </tr>
              `).join('') : `
                <tr>
                  <td colspan="6" style="text-align:center;padding:24px;color:#94a3b8">
                    Belum ada riwayat pengajuan izin kerja. Klik tombol <b>+ Ajukan Izin Baru</b> untuk membuat permohonan izin atau cuti.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
      </section>
    `;

    if (isEmp) {
      return selfServiceHeroHtml + personalStatsHtml + personalHistoryHtml + personalLeaveHistoryHtml;
    }

    const adminTabsHtml = `
      <div class="att-header-actions-row" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <div class="att-tabs-bar" style="margin-bottom:0">
          <button type="button" class="att-tab-btn ${attendanceActiveTab !== 'self' ? 'active' : ''}" data-action="switch-att-tab" data-tab="team">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>Rekap &amp; Kelola Tim</span>
          </button>
          <button type="button" class="att-tab-btn ${attendanceActiveTab === 'self' ? 'active' : ''}" data-action="switch-att-tab" data-tab="self">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>Presensi Saya (Mandiri)</span>
          </button>
        </div>
        ${(isAdmin() || isSupervisor()) ? `
        <button type="button" class="module-button secondary" data-action="toggle-att-admin" style="display:inline-flex;align-items:center;gap:6px;font-weight:600;padding:8px 14px;border-radius:10px" title="Buka pengaturan radius lokasi GPS kantor & jadwal jam kerja shift">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>Kebijakan &amp; Shift</span>
        </button>` : ''}
      </div>
    `;

    if (attendanceActiveTab === 'self') {
      return adminTabsHtml + attAdminDrawerHtml + selfServiceHeroHtml + personalStatsHtml + personalHistoryHtml + personalLeaveHistoryHtml;
    }

    const teamOverviewAndTableHtml = `
      <div class="attendance-overview-layout">
        <div class="attendance-status-cards">
          <article class="attendance-status present">
            <div class="att-card-top">
              <i class="att-status-icon present-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              </i>
              <div class="att-status-copy">
                <span class="status-card-label">Hadir</span>
                <strong class="status-card-val">${livePresent} <small>Karyawan</small></strong>
                <div class="status-card-trend"><b>↑ +3.2%</b> <span>dari kemarin</span></div>
              </div>
            </div>
            <div class="att-card-spark">
              <svg viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 36 C30 28, 55 18, 90 25 S150 32, 200 10 L200 44 L0 44 Z" fill="#eaf2fd" />
                <path d="M0 36 C30 28, 55 18, 90 25 S150 32, 200 10" fill="none" stroke="#0962ea" stroke-width="2" />
              </svg>
            </div>
            <footer class="status-card-footer">
              <span class="foot-pill blue"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg><b>${liveOnTime}</b> Tepat Waktu</span>
              <span class="foot-pill amber"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><b>${liveLate}</b> Terlambat</span>
            </footer>
          </article>

          <article class="attendance-status leave">
            <div class="att-card-top">
              <i class="att-status-icon leave-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
              </i>
              <div class="att-status-copy">
                <span class="status-card-label">Cuti</span>
                <strong class="status-card-val">${liveOnLeave} <small>Karyawan</small></strong>
                <div class="status-card-trend"><b class="indigo-badge">${leaveRequests.filter(r => r.status === 'Approved').length}</b> <span>approved requests</span></div>
              </div>
            </div>
            <div class="att-card-spark">
              <svg viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 34 C35 28, 65 14, 105 26 S160 12, 200 22 L200 44 L0 44 Z" fill="#eef2ff" />
                <path d="M0 34 C35 28, 65 14, 105 26 S160 12, 200 22" fill="none" stroke="#4f46e5" stroke-width="2" />
              </svg>
            </div>
            <footer class="status-card-footer">
              <span class="foot-pill blue"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg><b>${Math.max(1, liveOnLeave - 1)}</b> Cuti Tahunan</span>
              <span class="foot-pill blue"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><b>1</b> Cuti Sakit</span>
            </footer>
          </article>

          <article class="attendance-status absent">
            <div class="att-card-top">
              <i class="att-status-icon absent-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              </i>
              <div class="att-status-copy">
                <span class="status-card-label">Tidak Hadir</span>
                <strong class="status-card-val">${liveAbsent} <small>Karyawan</small></strong>
                <div class="status-card-trend down"><b>↓ −0.8%</b> <span>dari kemarin</span></div>
              </div>
            </div>
            <div class="att-card-spark">
              <svg viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 30 C40 16, 75 28, 115 20 S165 14, 200 26 L200 44 L0 44 Z" fill="#fef2f2" />
                <path d="M0 30 C40 16, 75 28, 115 20 S165 14, 200 26" fill="none" stroke="#ef4444" stroke-width="2" />
              </svg>
            </div>
            <footer class="status-card-footer">
              <span class="foot-pill red"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><b>${Math.max(0, liveAbsent - 1)}</b> Unplanned</span>
              <span class="foot-pill red"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg><b>${liveAbsent > 0 ? 1 : 0}</b> No Notice</span>
            </footer>
          </article>
        </div>

        <section class="module-card attendance-chart-card">
          <div class="module-card-head">
            <div class="att-chart-title">
              <i class="att-chart-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></i>
              <h2>Kehadiran Overview</h2>
            </div>
            <select class="module-select" data-select="att-chart-period"><option value="Last 6 Months">6 Bulan Terakhir</option><option value="This Year">Tahun Ini</option></select>
          </div>
          <div class="attendance-chart-content">
            <div class="attendance-chart-wrap">
              <div class="attendance-y-axis">
                <span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span>
              </div>
              <div class="attendance-bars-container">
                ${chartBars.map(([m, pres, lv, abs]) => `
                  <div class="attendance-bar-col">
                    <div class="bar-track">
                      <span class="bar-fill abs-fill" style="height:${abs}%" title="${m}: ${abs}% Tidak Hadir"></span>
                      <span class="bar-fill leave-fill" style="height:${lv}%" title="${m}: ${lv}% Cuti"></span>
                      <span class="bar-fill pres-fill" style="height:${pres}%" title="${m}: ${pres}% Hadir"></span>
                    </div>
                    <span class="bar-col-label">${m}</span>
                  </div>
                `).join('')}
              </div>
            </div>
            <div class="attendance-chart-legend">
              <span><i class="legend-circle pres-dot"></i>Hadir</span>
              <span><i class="legend-circle leave-dot"></i>Cuti</span>
              <span><i class="legend-circle abs-dot"></i>Tidak Hadir</span>
            </div>
          </div>
        </section>
      </div>

      <section class="module-card attendance-table-card">
        <div class="att-table-card-head">
          <div class="att-table-title">
            <i class="att-title-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg></i>
            <h2>Kehadiran Karyawan</h2>
          </div>
          <div class="module-toolbar att-inline-toolbar">
            <label class="module-search"><span class="search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><input data-filter="attendance" placeholder="Cari karyawan, department, status..." /></label>
            <div class="filter-dropdown-wrap">
              <button class="date-filter" data-action="attendance-filter" id="attendanceFilterBtn">${moduleView?.dataset?.attFilter || 'Semua Status'} <span>⌄</span></button>
              <div class="filter-dropdown-menu" id="attendanceFilterDropdown" style="display:none">
                <button type="button" class="filter-opt-btn" data-action="set-att-filter" data-status="All Status">Semua Status</button>
                <button type="button" class="filter-opt-btn" data-action="set-att-filter" data-status="On-Time">Tepat Waktu</button>
                <button type="button" class="filter-opt-btn" data-action="set-att-filter" data-status="Late">Terlambat</button>
                <button type="button" class="filter-opt-btn" data-action="set-att-filter" data-status="On Leave">Cuti</button>
                <button type="button" class="filter-opt-btn" data-action="set-att-filter" data-status="Absent">Tidak Hadir</button>
              </div>
            </div>
            <span class="toolbar-note">Urutkan:</span>
            <select id="attendanceSortSelect"><option value="0">Nama</option><option value="1">Jabatan</option><option value="4">Check-In / Check-Out</option><option value="7">Status</option></select>
            ${(isAdmin() || isSupervisor()) ? `
            <button type="button" class="module-button secondary" data-action="toggle-att-admin" style="display:inline-flex;align-items:center;gap:6px" title="Pengaturan Lokasi Kantor & Shift">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <span>Kebijakan &amp; Shift</span>
            </button>` : ''}
            <button class="module-button secondary att-export-btn" data-action="export-attendance">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Ekspor CSV</span>
            </button>
          </div>
        </div>
        <div class="module-table-wrap">
          <table class="module-table attendance-full-table">
            <thead>
              <tr>
                <th class="sortable" data-col="0">Karyawan <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th class="sortable" data-col="1">Jabatan &amp; Dept <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th class="sortable" data-col="2">Tanggal <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th class="sortable" data-col="3">Model Kerja <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th class="sortable" data-col="4">Check-In – Check-Out <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th class="sortable" data-col="5">Working Jam <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th class="sortable" data-col="6">Lembur <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th class="sortable" data-col="7">Status <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                <th style="text-align:center">Aksi</th>
              </tr>
            </thead>
            <tbody>${attendanceRows}</tbody>
          </table>
        </div>
        <div class="pagination-row">
          <label>Show <select><option>10</option><option>25</option><option>50</option></select> of ${allAttendanceItems.length} results</label>
          <div><button>‹</button><button class="page-current">1</button><button>2</button><button>›</button></div>
        </div>
      </section>
    `;

    return adminTabsHtml + attAdminDrawerHtml + teamOverviewAndTableHtml;
  }

  // 8. PERFORMANCE MODULE
  if (key === 'performance') {
    const avgPerfScore = employeeData.slice(0, 8).reduce((sum, p, idx) => sum + getEmployeeDynamicPerfScore(p[0], idx), 0) / Math.max(1, Math.min(8, employeeData.length));
    return `
      <div class="performance-top-grid">
        ${section('Team Performance', `<div class="team-bars">${['Jan','Feb','Mar','Apr','May','Jun'].map((m, i) => `<span><b>${78 + i * 2}%</b><i style="height:${65 + i * 4}%"></i><small>${m}</small></span>`).join('')}</div>`)}
        ${section('Performance by Category', `<div class="category-bars">${[['Team Work','90%'],['Work Quality','86%'],['Problem-Solving','82%'],['Time Management','76%']].map(([name, val]) => `<div><span>${name}<b>4.5/5 - ${val}</b></span><i></i></div>`).join('')}</div>`)}
        ${section('Average Performance', `<div class="performance-gauge"><strong>${avgPerfScore.toFixed(1)}%</strong><small>Total Score</small><b>↗ +3.8%</b></div>`)}
      </div>
      <div class="performance-lower-grid">
        ${section('Employee Performance', `
          <div class="module-toolbar">
            <select data-select="performance-period"><option value="This Month">This Month</option><option value="Last Month">Last Month</option></select>
            <button class="module-button primary" data-action="create-review" style="margin-left:auto">+ New Review Cycle</button>
          </div>
          <div class="module-table-wrap">
            <table class="module-table">
              <thead><tr><th>Name</th><th>Job Title</th><th>Teamwork</th><th>Work Quality</th><th>Problem Solving</th><th>Time Management</th><th>Score</th></tr></thead>
              <tbody>${performanceRows}</tbody>
            </table>
          </div>
        `)}
        ${reviewCycleData.length ? section('Periode Penilaian', `<div class="performer-list">${reviewCycleData.map(cycle => `<p><span><strong>${safe(cycle.name)}</strong><small>${safe(cycle.type)} • Dibuat ${safe(cycle.createdAt)}</small></span><b>${safe(cycle.status)}</b></p>`).join('')}</div>`) : ''}
        <aside>
          ${section('Top Performers', `<div class="performer-list">${employeeData.slice(0, 5).map((p, i) => `<p><button type="button" class="employee-link" data-action="view-employee" data-name="${safe(p[0])}" style="flex:1">${avatar(p[0], `p${i + 1}`)}<span><strong>${safe(p[0])}</strong><small>${safe(p[3])}</small></span></button><b>${getEmployeeDynamicPerfScore(p[0], i)}/100</b></p>`).join('')}</div>`)}
          ${section('Time Management Alerts', `<div class="performer-list">${employeeData.slice(2, 5).map((p) => `<p><button type="button" class="employee-link" data-action="view-employee" data-name="${safe(p[0])}" style="flex:1">${avatar(p[0], 'p3')}<span><strong>${safe(p[0])}</strong><small>Low on-time rate for deliverables this month.</small></span></button></p>`).join('')}</div>`)}
        </aside>
      </div>
    `;
  }

  // 9. PAYROLL MODULE
  if (key === 'payroll') {
    const totalSalarySum = employeeData.reduce((sum, p) => sum + (getEmployeeProfile(p[0]).salaryRaw || 3500), 0);
    const totalAllowanceSum = employeeData.reduce((sum, p) => sum + (getEmployeeProfile(p[0]).allowanceRaw || 350), 0);
    const totalOvertimeSum = employeeData.length * 80;
    const totalIncentiveSum = employeeData.length * 150;
    const totalDeductionSum = employeeData.length * 120;
    const grandTotalPay = totalSalarySum + totalAllowanceSum + totalOvertimeSum + totalIncentiveSum - totalDeductionSum;

    return `
      <div class="payroll-stats">
        <article><span>Total Salary</span><strong>${formatIDR(totalSalarySum)}</strong><small>+5.4% from last month</small><i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg></i></article>
        <article><span>Total Allowances</span><strong>${formatIDR(totalAllowanceSum)}</strong><small>+3.6% from last month</small><i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg></i></article>
        <article><span>Total Overtime</span><strong>${formatIDR(totalOvertimeSum)}</strong><small>+2.3% from last month</small><i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></i></article>
        <article><span>Total Incentives</span><strong>${formatIDR(totalIncentiveSum)}</strong><small>+4.9% from last month</small><i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg></i></article>
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
          <strong class="payroll-breakdown-total">${formatIDR(grandTotalPay)} <small>Total Pay This Month</small></strong>
          <div class="payroll-breakdown-bar"></div>
          <div class="payroll-legend">
            <span>Salary • 89.0%<small>${formatIDR(totalSalarySum)}</small></span>
            <span>Allowances • 3.8%<small>${formatIDR(totalAllowanceSum)}</small></span>
            <span>Deductions • 4.0%<small>${formatIDR(totalDeductionSum)}</small></span>
            <span>Incentives • 2.0%<small>${formatIDR(totalIncentiveSum)}</small></span>
            <span>Overtime • 1.2%<small>${formatIDR(totalOvertimeSum)}</small></span>
          </div>
        `)}
      </div>
      ${section('Payroll List', `
        <div class="module-toolbar">
          <label class="module-search"><span class="search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><input data-filter="payroll" placeholder="Search employee, ID, etc" /></label>
          <button class="date-filter" data-action="payroll-filter">Filter <span>⌄</span></button>
          <div class="module-toolbar-actions" style="margin-left:auto; display:flex; gap:8px;">
            <button class="module-button primary" data-action="new-payrun">+ New Pay Run</button>
            <button class="module-button secondary" data-action="export-payroll">Ekspor Laporan</button>
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
              ${employeeData.map((p, i) => {
                const empProf = getEmployeeProfile(p[0]);
                const netVal = empProf.salaryRaw + empProf.allowanceRaw + 80 + 150 - 120;
                return `
                <tr data-status="Paid" data-dept="${safe(p[2])}">
                  <td>
                    <button class="employee-link" data-action="view-employee" data-name="${safe(p[0])}">
                      ${avatar(p[0], `p${i % 9 + 1}`)}
                      <span><strong>${safe(p[0])}</strong><small>${safe(empProf.id)}</small></span>
                    </button>
                  </td>
                  <td>${safe(p[3])}</td>
                  <td>28 Okt 26</td>
                  <td>${safe(empProf.salary)}</td>
                  <td>${safe(empProf.allowance)}</td>
                  <td>${formatIDR(80)}</td>
                  <td>${formatIDR(150)}</td>
                  <td>${formatIDR(120)}</td>
                  <td><b>${formatIDR(netVal)}</b></td>
                  <td><span class="status ontime">Paid</span></td>
                  <td><button class="module-button secondary" data-action="show-payslip" data-name="${safe(p[0])}">Slip Gaji</button></td>
                </tr>
              `;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="pagination-row">
          <label>Menampilkan ${employeeData.length} data penggajian</label>
        </div>
      `)}
      ${payRunData.length ? section('Riwayat Persiapan Gaji', `<div class="performer-list">${payRunData.map(run => `<p><span><strong>${safe(run.period)}</strong><small>Tanggal pembayaran ${safe(run.paymentDate)} • ${run.employeeCount} karyawan • Total ${formatIDR(run.total)}</small></span><b>${safe(run.status)}</b></p>`).join('')}</div>`) : ''}
    `;
  }

  // 10. LEAVE MANAGEMENT MODULE
  if (key === 'leave') {
    const visibleLeaves = isEmployee()
      ? leaveRequests.filter(r => r.name.toLowerCase() === String(getOwnEmployeeRow()?.[0] || '').toLowerCase())
      : isSupervisor()
        ? leaveRequests.filter(r => {
            const emp = findEmployeeByName(r.name);
            return emp ? emp[2] === getActiveDepartment() : false;
          })
        : leaveRequests;
    const totalApproved = visibleLeaves.filter(r => r.status === 'Approved').length;
    const totalPending = visibleLeaves.filter(r => r.status === 'Pending').length;
    const totalRejected = visibleLeaves.filter(r => r.status === 'Rejected').length;
    const annualCount = visibleLeaves.filter(r => String(r.type || '').toLowerCase().includes('annual')).length;
    const sickCount = visibleLeaves.filter(r => String(r.type || '').toLowerCase().includes('sick')).length;
    const otherCount = Math.max(0, visibleLeaves.length - annualCount - sickCount);
    const totalLv = Math.max(1, visibleLeaves.length);
    const annualPct = Math.round((annualCount / totalLv) * 100);
    const sickPct = Math.round((sickCount / totalLv) * 100);
    const otherPct = Math.max(0, 100 - annualPct - sickPct);
    const canApproveLeave = isAdmin() || isSupervisor();

    return `
      <div class="leave-stats">
        <article class="highlight"><span>Total On Leave (Today)</span><strong>${totalApproved} <small>Employees</small></strong><em>+${totalPending} menunggu tinjauan</em></article>
        <article><span>Annual Leave</span><strong>${annualCount} <small>Employees</small></strong><em>Kuota 12 hari/tahun</em></article>
        <article><span>Sick Leave</span><strong>${sickCount} <small>Employees</small></strong><em>Dengan surat dokter</em></article>
        <article><span>Other Leaves</span><strong>${otherCount} <small>Employees</small></strong><em>${totalRejected} ditolak bulan ini</em></article>
        ${section('Leave Types', `
          <div class="leave-donut"><strong>${visibleLeaves.length}</strong><small>Leaves</small></div>
          <div class="leave-type-legend">
            <span><b>${annualPct}%</b> Annual Leave</span>
            <span><b>${sickPct}%</b> Sick Leave</span>
            <span><b>${otherPct}%</b> Casual &amp; Other</span>
          </div>
        `)}
      </div>
      <div class="leave-analytics">
        ${section('Leave Overview', `<div class="leave-chart">${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => `<span><i class="${i === 9 ? 'active' : ''}" style="height:${[44,50,58,41,54,48,88,63,60,76,47,55][i]}%"></i><small>${m}</small></span>`).join('')}</div>`)}
        ${section('Leave Calendar', `
          <div class="leave-calendar">
            <div class="leave-cal-days">${[16,17,18,19,20,21,22].map((d, i) => `<span class="${i === 3 ? 'active' : ''}">${d}</span>`).join('')}</div>
            ${visibleLeaves.slice(0, 3).map((req, idx) => `<p>${avatar(req.name, `p${(idx % 5) + 1}`)}<span><strong>${safe(req.name)}</strong><small>${safe(req.type)} • ${safe(req.period)}</small></span></p>`).join('')}
          </div>
        `)}
        ${section('Employee Leaves', `<div class="leave-people">${visibleLeaves.slice(0, 4).map((req, idx) => `<p><button type="button" class="employee-link" data-action="view-employee" data-name="${safe(req.name)}" style="flex:1">${avatar(req.name, `p${(idx % 6) + 1}`)}<span><strong>${safe(req.name)}</strong><small>${safe(req.period)}</small></span></button><b>${safe(req.type)}</b></p>`).join('')}</div>`)}
      </div>
      ${section('Leave Request', `
        <div class="module-toolbar">
          <label class="module-search"><span class="search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><input data-filter="leave" placeholder="Search employee, reason, etc" /></label>
          <button class="date-filter" data-action="leave-filter">Filter <span>⌄</span></button>
          <div class="module-toolbar-actions" style="margin-left:auto; display:flex; gap:8px;">
            <button class="module-button primary" data-action="request-leave">+ Request Leave</button>
          </div>
        </div>
        <div class="module-table-wrap">
          <table class="module-table leave-table">
            <thead>
              <tr><th><input type="checkbox" data-select-all="leave" aria-label="Select all" /></th><th>Name</th><th>Job Title</th><th>Type</th><th>Submit Date</th><th>Period</th><th>Duration</th><th>Reason</th><th>Status &amp; Action</th></tr>
            </thead>
            <tbody>
              ${visibleLeaves.map((req) => `
                <tr data-leave-id="${req.id}" data-status="${safe(req.status)}">
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
                    ${req.status === 'Pending' && canApproveLeave ? `
                      <span class="request-actions">
                        <button data-action="approve-request" data-id="${req.id}" title="Setujui Cuti">Setujui</button>
                        <button data-action="decline-request" data-id="${req.id}" title="Tolak Cuti">Tolak</button>
                      </span>
                    ` : `
                      <span class="status ${req.status === 'Approved' ? 'ontime' : req.status === 'Pending' ? 'late' : 'absent'}">${safe(req.status === 'Pending' ? 'Menunggu Persetujuan' : req.status)}</span>
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
                <button class="date-filter" data-action="recruitment-period-filter">Last 6 Months ⌄</button>
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
                <button class="date-filter" data-action="vacancy-filter">Filter ⌄</button>
              </div>
              <div class="vacancy-grid">
                <article class="vacancy-box" data-action="filter-vacancy" data-position="UI Designer" data-mode="Remote" style="cursor:pointer" title="Klik untuk memfilter pelamar UI Designer">
                  <strong>UI Designer</strong>
                  <div class="vacancy-meta">
                    <span>Full-Time</span>
                    <span>Remote</span>
                    <span>18 Pelamar</span>
                  </div>
                </article>
                <article class="vacancy-box" data-action="filter-vacancy" data-position="Sales Manager" data-mode="On-Site" style="cursor:pointer" title="Klik untuk memfilter pelamar Sales Manager">
                  <strong>Sales Manager</strong>
                  <div class="vacancy-meta">
                    <span>Full-Time</span>
                    <span>On-Site</span>
                    <span>15 Pelamar</span>
                  </div>
                </article>
                <article class="vacancy-box" data-action="filter-vacancy" data-position="HR Assistant" data-mode="On-Site" style="cursor:pointer" title="Klik untuk memfilter pelamar HR Assistant">
                  <strong>HR Assistant</strong>
                  <div class="vacancy-meta">
                    <span>Internship</span>
                    <span>On-Site</span>
                    <span>10 Pelamar</span>
                  </div>
                </article>
                <article class="vacancy-box" data-action="filter-vacancy" data-position="Data Analyst" data-mode="Hybrid" style="cursor:pointer" title="Klik untuk memfilter pelamar Data Analyst">
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
                <button class="kebab">•••</button>
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
              <label class="module-search"><span class="search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><input data-filter="recruitment" placeholder="Search applicant" /></label>
              <button class="module-button primary" data-action="add-candidate">+ Add Applicant</button>
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
              <button class="kebab">•••</button>
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
              <button class="kebab">•••</button>
            </div>
            <div class="mini-schedule-box">
              <div class="mini-schedule-head">
                <button type="button" class="cal-nav-btn" data-action="rec-mini-cal-prev">‹</button>
                <strong id="recMiniCalTitle">Oktober 2026</strong>
                <button type="button" class="cal-nav-btn" data-action="rec-mini-cal-next">›</button>
              </div>
              <div class="mini-weekdays-row">
                <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
              </div>
              <div class="mini-days-row">
                <span data-action="rec-mini-cal-day" data-day="17" style="cursor:pointer">17</span><span data-action="rec-mini-cal-day" data-day="18" style="cursor:pointer">18</span><span data-action="rec-mini-cal-day" data-day="19" style="cursor:pointer">19</span><span class="active-day" data-action="rec-mini-cal-day" data-day="20" style="cursor:pointer">20</span><span data-action="rec-mini-cal-day" data-day="21" style="cursor:pointer">21</span><span data-action="rec-mini-cal-day" data-day="22" style="cursor:pointer">22</span><span data-action="rec-mini-cal-day" data-day="23" style="cursor:pointer">23</span>
              </div>
            </div>

            <div class="recruitment-events">
              <article class="rec-event-item">
                <div class="event-indicator dot-blue"></div>
                <div class="event-info">
                  <small>09:45 AM</small>
                  <strong>Online Test Review</strong>
                  <span>Lala Wijaya • Data Analyst</span>
                </div>
              </article>
              <article class="rec-event-item">
                <div class="event-indicator dot-blue"></div>
                <div class="event-info">
                  <small>01:00 PM</small>
                  <strong>First Interview</strong>
                  <span>William Hartono • UI Designer</span>
                </div>
              </article>
              <article class="rec-event-item">
                <div class="event-indicator dot-navy"></div>
                <div class="event-info">
                  <small>02:30 PM</small>
                  <strong>HR Interview</strong>
                  <span>Arifin Maulana • Customer Support</span>
                </div>
              </article>
              <article class="rec-event-item">
                <div class="event-indicator dot-blue"></div>
                <div class="event-info">
                  <small>03:10 PM</small>
                  <strong>Final Interview</strong>
                  <span>Fanny Rizal • Sales Manager</span>
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
    const bannerRoleLabel = isAdminUser ? 'Administrator' : `Supervisor - ${safe(account.department)}`;

    // Active account switcher options
    const accountOptions = userAccounts.filter(u => u.status === 'Active').map(u =>
      `<option value="${u.id}" ${u.id === activeAccountId ? 'selected' : ''}>${safe(u.name)} (${u.role}${u.role === 'Supervisor' ? ' - ' + u.department : ''})</option>`
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
              <span class="${roleBadgeClass}">${bannerRoleLabel}</span>
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
                <button class="module-button primary" data-action="new-user-account">+ Tambah Akun Baru</button>
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
                      <td><span style="color:#475569;font-size:12.5px">${safe(u.title || '-')}</span></td>
                      <td><span class="status ${u.status === 'Active' ? 'ontime' : u.status === 'Pending' ? 'leave' : 'late'}">${safe(u.status === 'Pending' ? 'Menunggu aktivasi' : u.status === 'Inactive' ? 'Nonaktif' : 'Aktif')}</span></td>
                      <td><span style="color:#64748b;font-size:12px">${safe(u.lastLogin || '-')}</span></td>
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
                <button class="module-button primary" data-action="new-division">+ Tambah Divisi Baru</button>
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
                <strong>Mode Supervisor - Divisi: ${safe(supervisorDept)}</strong>
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
                <select class="module-select" id="kpiPeriodSelect"><option value="Semua Periode">Semua Periode</option><option value="Q4 2026">Q4 2026</option><option value="Q3 2026">Q3 2026</option><option value="Semester 2 2026">Semester 2 2026</option><option value="Tahun 2026">Tahun 2026</option></select>
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
                <label class="module-search"><span class="search-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span><input data-filter="kpi" id="kpiSearchInput" placeholder="Cari indikator KPI, PIC, atau divisi..." /></label>
                ${!supervisorDept ? `<div class="filter-dropdown-wrap">
                  <button class="date-filter" data-action="kpi-dept-filter" id="kpiDeptFilterBtn">${moduleView.dataset.kpiDeptFilter || 'Semua Divisi'} <span>⌄</span></button>
                </div>` : ''}
                <div class="filter-dropdown-wrap">
                  <button class="date-filter" data-action="kpi-status-filter" id="kpiStatusFilterBtn">${moduleView.dataset.kpiStatusFilter || 'Semua Status'} <span>⌄</span></button>
                </div>
                ${isAdminUser ? `<button class="module-button primary" data-action="new-kpi">+ Tambah KPI Baru</button>` : ''}
                <button class="module-button secondary" data-action="export-kpi">Export Laporan</button>
              </div>
            </div>

            <div class="module-table-wrap">
              <table class="module-table kpi-table">
                <thead>
                  <tr>
                    <th class="sortable" data-col="0">Indikator KPI <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                    <th class="sortable" data-col="1">Departemen &amp; PIC <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                    <th class="sortable" data-col="2">Periode <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                    <th class="sortable" data-col="3">Bobot <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                    <th class="sortable" data-col="4">Target <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                    <th class="sortable" data-col="5">Realisasi <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                    <th class="sortable" data-col="6">Capaian (%) <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                    <th class="sortable" data-col="7">Status <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-left:4px"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg></th>
                    <th style="min-width:115px">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  ${calculatedKpi.map((k, i) => `
                    <tr data-kpi-id="${k.id}" data-kpi-dept="${safe(k.dept)}" data-kpi-status="${safe(k.status)}" data-kpi-period="${safe(k.period)}">
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
                      <td><span style="font-weight:700;color:#0962ea">${k.actual !== undefined ? k.actual : '-'} ${safe(k.unit)}</span></td>
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
  portal: 'portal.html',
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
    'portal': 'portal',
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
    } else if (key === 'kpi' && urlParams.get('tab') && moduleView) {
      moduleView.dataset.kpiTab = urlParams.get('tab');
    }
    return { key, params: urlParams };
  }

  const clean = (hashString || '').replace(/^#\/?/, '').trim();
  const [route, queryString] = clean.split('?');
  const params = new URLSearchParams(queryString || '');
  const validModules = ['portal', 'dashboard', 'inbox', 'calendar', 'employees', 'employee-grid', 'employee-details', 'employee-add', 'attendance', 'performance', 'kpi', 'payroll', 'leave', 'recruitment'];
  const aliasMap = {
    '': 'dashboard',
    'tasks': 'inbox',
    'schedules': 'leave',
    'candidate': 'recruitment',
    'candidates': 'recruitment',
    'employee': 'employees',
    'targets': 'kpi',
    'target': 'kpi',
    'okr': 'kpi',
    'kpi-divisions': 'kpi',
    'kpi-users': 'kpi'
  };
  if ((route === 'kpi-divisions' || route === 'kpi-users') && moduleView) {
    moduleView.dataset.kpiTab = route;
  }
  const key = aliasMap[route] || (validModules.includes(route) ? route : 'dashboard');
  return { key, params };
}

function openModule(key, updateUrl = true, params = null) {
  if (key === 'kpi-divisions' || key === 'kpi-users') {
    if (moduleView) moduleView.dataset.kpiTab = key;
    key = 'kpi';
  }
  if (params?.tab && key === 'kpi' && moduleView) {
    moduleView.dataset.kpiTab = params.tab;
  }

  if (params?.name) {
    selectedEmployeeName = params.name;
  }

  const activeRole = (authenticatedSupabaseSession && authenticatedUserProfile)
    ? authenticatedUserProfile.role
    : userProfile.role;

  if (activeRole !== 'Admin') {
    const allowed = activeRole === 'Supervisor'
      ? new Set(['portal','dashboard','calendar','employees','employee-grid','employee-details','attendance','performance','kpi','leave'])
      : new Set(['portal','dashboard','calendar','employees','employee-grid','employee-details','attendance','leave']);

    if (activeRole === 'Employee' && ['employees','employee-grid','employee-details'].includes(key)) {
      const own = getOwnEmployeeRow();
      if (own) {
        if (key === 'employee-details' && selectedEmployeeName && selectedEmployeeName.toLowerCase() !== own[0].toLowerCase()) {
          showToast('Akses dibatasi: Karyawan hanya dapat melihat profil dan slip gaji miliknya sendiri.');
        }
        selectedEmployeeName = own[0];
        key = 'employee-details';
      }
    } else if (activeRole === 'Supervisor' && key === 'employee-details') {
      const targetEmp = findEmployeeByName(selectedEmployeeName);
      if (targetEmp && targetEmp[2] !== getActiveDepartment()) {
        showToast(`Akses dibatasi: Anda hanya dapat melihat detail karyawan di divisi ${getActiveDepartment()}.`);
        key = 'employees';
      }
    }

    if (allowed && !allowed.has(key)) {
      showToast('Menu ini tidak tersedia untuk peran akun Anda.');
      key = 'dashboard';
    }
  }

  if (!key.startsWith('employee')) employeeCurrentPage = 1;
  const activeKpiTab = moduleView?.dataset?.kpiTab;
  const selectedNav = key.startsWith('employee')
    ? 'employees'
    : (key === 'kpi' && (activeKpiTab === 'kpi-divisions' || activeKpiTab === 'kpi-users'))
      ? activeKpiTab
      : key;
  
  // Highlight navigation link
  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.module === selectedNav);
  });

  const currentFile = (window.location.pathname.split('/').pop().toLowerCase() || 'index').replace(/\.html$/, '');
  const targetFile = keyToFile[key] || 'index.html';
  const targetBase = targetFile.split('?')[0].replace(/\.html$/, '');

  // Strict Multi-Page Application (MPA) routing:
  // Always navigate via browser URL when target file differs from current page (or when leaving index.html)
  if (targetBase !== currentFile || (currentFile === 'index' && key !== 'dashboard')) {
    let dest = targetFile;
    if (key === 'employee-details' && selectedEmployeeName && !dest.includes('name=')) {
      dest = `employees.html?name=${encodeURIComponent(selectedEmployeeName)}`;
    } else if (params && Object.keys(params).length && !targetFile.includes('?')) {
      dest += '?' + new URLSearchParams(params).toString();
    }
    window.location.href = dest;
    return;
  }

  // Update URL query string when switching sub-views within the same MPA page (employees.html or kpi.html)
  if (updateUrl && window.history && window.history.pushState) {
    let subUrl = null;
    if (key === 'employees') subUrl = 'employees.html';
    else if (key === 'employee-grid') subUrl = 'employees.html?view=grid';
    else if (key === 'employee-add') subUrl = 'employees.html?action=add';
    else if (key === 'employee-details' && selectedEmployeeName) subUrl = `employees.html?name=${encodeURIComponent(selectedEmployeeName)}`;
    else if (key === 'kpi') {
      const tab = moduleView?.dataset?.kpiTab;
      subUrl = (tab && tab !== 'kpi-indicators') ? `kpi.html?tab=${encodeURIComponent(tab)}` : 'kpi.html';
    }
    if (subUrl) {
      const currentRel = window.location.pathname.split('/').pop() + window.location.search;
      if (currentRel !== subUrl) window.history.pushState(null, '', subUrl);
    }
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
        greeting.innerHTML = `<span>Halo ${safe(userProfile.name)}!</span><strong>Selamat Pagi</strong>`;
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
      moduleView.insertAdjacentHTML('beforeend', '<footer class="page-footer"><strong>Copyright &copy; 2026 Kharisma Group</strong><a href="#privacy">Kebijakan Privasi</a><a href="#terms">Syarat &amp; Ketentuan</a><a href="#contact">Kontak</a><span></span><span class="socials"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l11.733 16h4.267l-11.733-16z"/><path d="M4 20l6.768-6.768m2.464-2.464L20 4"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"/><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"/></svg><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/></svg></span></footer>');
    }

    moduleView.dataset.page = key;
    setupTablePagination();
    if (key === 'attendance' || key === 'portal') {
      startLiveAttendanceClock();
    }
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
      greeting.innerHTML = '<button class="employee-detail-back" data-action="back-employees" aria-label="Kembali ke daftar karyawan">←</button><span><strong>Employee Details</strong><small>Dashboard / Employees / ' + safe(selectedEmployeeName) + '</small></span>';
    } else if (key === 'attendance') {
      const isEmp = isEmployee();
      greeting.innerHTML = isEmp
        ? '<strong>Presensi Mandiri</strong><small>Dasbor / Presensi Saya</small>'
        : '<strong>Absensi &amp; Kehadiran</strong><small>Dasbor / Kehadiran Tim</small>';
      startLiveAttendanceClock();
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
  ensureSharedDialogs();
  let targetName = employeeName || selectedEmployeeName;
  if (isEmployee()) {
    const own = getOwnEmployeeRow();
    if (own && targetName.toLowerCase() !== own[0].toLowerCase()) {
      showToast('Anda hanya dapat melihat slip gaji milik Anda sendiri.');
      targetName = own[0];
    }
  } else if (isSupervisor()) {
    const targetEmp = findEmployeeByName(targetName);
    if (targetEmp && targetEmp[2] !== getActiveDepartment()) {
      showToast(`Anda hanya dapat melihat slip gaji anggota divisi ${getActiveDepartment()}.`);
      return;
    }
  }

  const profile = getEmployeeProfile(targetName);
  const payslipDialog = document.querySelector('#payslipDialog');
  const payslipContent = document.querySelector('#payslipContent');
  if (!payslipDialog || !payslipContent) return;

  const baseNum = Math.round((profile.salaryRaw || 3200) * 1000);
  const transportNum = 150000;
  const mealNum = 200000;
  const allowanceNum = Math.round((profile.allowanceRaw || 300) * 1000);
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
            <p style="margin:2px 0 0;font-size:9.5px;color:#64748b">Kharisma Tower Lt. 18, Jl. Gatot Subroto Kav. 52, Jakarta Selatan • NPWP: 01.345.678.9-021.000</p>
          </div>
        </div>
        <div class="payslip-title">
          <h3>SLIP GAJI KARYAWAN</h3>
          <span>Periode: Oktober 2026 (28 Okt 2026)</span>
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

  const csvBtn = document.querySelector('#btnDownloadPayslipCsv');
  if (csvBtn) {
    csvBtn.onclick = () => {
      downloadCsv(`slip-gaji-${profile.name.toLowerCase().replace(/\s+/g, '-')}-oktober-2026.csv`, [
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
  }

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
      <button class="mail-star ${mail.starred ? 'starred' : ''}" data-action="toggle-star" data-id="${mail.id}">☆</button>
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
      <button data-action="reply-message">↩ &nbsp;Reply</button>
      <button data-action="forward-message">↗ &nbsp;Forward</button>
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
   Shared Dialogs Standardizer (Across All 10 MPA Pages)
   ========================================================================== */

function ensureSharedDialogs() {
  // 1. Standardize #payslipDialog so #btnDownloadPayslipCsv is always present
  const payslipActions = document.querySelector('#payslipDialog .dialog-actions');
  if (payslipActions && !document.querySelector('#btnDownloadPayslipCsv')) {
    const csvBtn = document.createElement('button');
    csvBtn.type = 'button';
    csvBtn.className = 'btn-secondary';
    csvBtn.id = 'btnDownloadPayslipCsv';
    csvBtn.textContent = 'Unduh CSV';
    payslipActions.insertBefore(csvBtn, payslipActions.firstChild);
  }

  // 2. Standardize #editEmployeeForm so personal & compensation fields exist on every page
  const editEmpForm = document.querySelector('#editEmployeeForm');
  if (editEmpForm && !document.querySelector('#editEmployeeSalary')) {
    const actionsDiv = editEmpForm.querySelector('.dialog-actions');
    if (!document.querySelector('#editEmployeeGender')) {
      const extraPersonal = document.createElement('div');
      extraPersonal.innerHTML = `
        <div class="dialog-two">
          <label>Jenis Kepegawaian
            <select name="employmentType" id="editEmployeeEmploymentType">
              <option>Full-Time</option>
              <option>Part-Time</option>
              <option>Contract</option>
              <option>Internship</option>
            </select>
          </label>
          <label>Model Kerja
            <select name="workModel" id="editEmployeeWorkModel">
              <option>On-Site</option>
              <option>Hybrid</option>
              <option>Remote</option>
            </select>
          </label>
        </div>
        <div class="dialog-two">
          <label>Jenis Kelamin
            <select name="gender" id="editEmployeeGender">
              <option>Female</option>
              <option>Male</option>
            </select>
          </label>
          <label>Tanggal Lahir
            <input name="birthDate" id="editEmployeeBirthDate" type="text" placeholder="mis. 18 March 1995" />
          </label>
        </div>
        <div class="dialog-two">
          <label>Nomor Telepon
            <input name="phone" id="editEmployeePhone" type="tel" placeholder="+62 812..." />
          </label>
          <label>Tanggal Bergabung
            <input name="joinDate" id="editEmployeeJoinDate" type="text" placeholder="mis. 12 Jan 2024" />
          </label>
        </div>
        <label>Alamat Lengkap
          <input name="address" id="editEmployeeAddress" type="text" placeholder="Alamat domisili" />
        </label>
      `;
      while (extraPersonal.firstElementChild) {
        editEmpForm.insertBefore(extraPersonal.firstElementChild, actionsDiv);
      }
    }
    const compDiv = document.createElement('div');
    compDiv.className = 'dialog-two';
    compDiv.innerHTML = `
      <label>Gaji Pokok (Rp/bulan)
        <input name="salary" id="editEmployeeSalary" type="text" placeholder="mis. Rp3.500.000" />
      </label>
      <label>Tunjangan Tetap (Rp/bulan)
        <input name="allowance" id="editEmployeeAllowance" type="text" placeholder="mis. Rp350.000" />
      </label>
    `;
    editEmpForm.insertBefore(compDiv, actionsDiv);
  }

  // 4. Standardize #userAccountForm & #editUserAccountForm to include Employee role on all pages
  ['#userAccountForm select[name="role"]', '#editUserAccountForm select[name="role"]'].forEach(selQuery => {
    const sel = document.querySelector(selQuery);
    if (sel && !sel.querySelector('option[value="Employee"]')) {
      const opt = document.createElement('option');
      opt.value = 'Employee';
      opt.textContent = 'Karyawan (Employee)';
      sel.insertBefore(opt, sel.firstChild);
    }
  });
}
ensureSharedDialogs();

/* ==========================================================================
   Event Listeners & Dispatchers
   ========================================================================== */

// 1. Navigation links: Native Multi-Page Application (MPA) navigation
// Standard anchor href navigates naturally without event.preventDefault() hijacking.

// 2. Browser history & popstate listener (MPA sub-view query parameters only)
window.addEventListener('popstate', () => {
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
  const setVal = (sel, val) => { const el = document.querySelector(sel); if (el) el.value = val; };
  setVal('#settingCompanyName', appSettings.companyName || 'PT Kharisma Group Indonesia');
  setVal('#settingCurrency', appSettings.currency || 'IDR');
  setVal('#settingTimezone', appSettings.timezone || 'WIB');
  setVal('#settingWorkStart', appSettings.workStart || '09:00');
  setVal('#settingWorkEnd', appSettings.workEnd || '17:00');
  setVal('#settingLateTolerance', appSettings.lateTolerance || 15);
  dialog.showModal();
});

document.querySelector('#settingsForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(e.target);
  appSettings.companyName = data.get('companyName') || appSettings.companyName;
  appSettings.currency = data.get('currency') || appSettings.currency;
  appSettings.timezone = data.get('timezone') || appSettings.timezone;
  appSettings.workStart = data.get('workStart') || appSettings.workStart;
  appSettings.workEnd = data.get('workEnd') || appSettings.workEnd;
  appSettings.lateTolerance = Number(data.get('lateTolerance')) || 15;
  persistSettings();
  if (Array.isArray(attendancePolicy?.shifts) && attendancePolicy.shifts.length) {
    attendancePolicy.shifts[0].start_time = appSettings.workStart;
    attendancePolicy.shifts[0].end_time = appSettings.workEnd;
    attendancePolicy.shifts[0].tolerance_minutes = appSettings.lateTolerance;
    writeStoredValue('teamhub.attendancePolicy', attendancePolicy);
  }
  const anonKey = data.get('supabaseAnonKey');
  if (anonKey !== null && window.KharismaSupabase) {
    window.KharismaSupabase.setKey(anonKey);
  }
  document.querySelector('#settingsDialog')?.close();
  if (moduleView && !moduleView.hidden && moduleView.dataset.page === 'attendance') {
    moduleView.innerHTML = pageMarkup('attendance');
    setupTablePagination();
  }
  showToast('Pengaturan ruang kerja & jam kerja berhasil disimpan.');
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
    badge.title = isConnected ? `Supabase Cloud Aktif: ${message}` : 'Mode Lokal - Klik untuk menyambungkan Supabase';
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
  const salaryInput = form.elements.salary?.value?.trim();
  const allowanceInput = form.elements.allowance?.value?.trim();
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
      joinDate: form.elements.joinDate?.value.trim() || previousProfile.joinDate || 'Belum diisi',
      ...(salaryInput ? { salary: salaryInput } : {}),
      ...(allowanceInput ? { allowance: allowanceInput } : {})
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
    if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
      window.KharismaDB.calendar.create(newEvent).catch(() => {});
    }
    selectedDate = day;
    selectedCalendarEventId = newEvent.id;
    calendarDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1);
    moduleCalendarDate = new Date(calendarDate);
    openModule('calendar');
    const mName = new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(parsedDate);
    showToast(`Agenda "${values.title}" berhasil dijadwalkan pada tanggal ${day} ${mName}.`);
  } else if (activeAction === 'request-leave') {
    const startMs = values.start ? new Date(`${values.start}T00:00:00`).getTime() : Date.now();
    const endMs = values.end ? new Date(`${values.end}T00:00:00`).getTime() : startMs;
    const diffDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
    const ownEmp = getOwnEmployeeRow();
    const newReq = {
      id: `lv-${Date.now()}`,
      name: userProfile.name,
      title: ownEmp?.[3] || userProfile.role,
      type: values.type,
      submitDate: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()),
      period: `${values.start} s/d ${values.end}`,
      startDate: values.start,
      duration: `${diffDays} Days`,
      reason: values.note || 'Keperluan pribadi',
      status: 'Pending'
    };
    leaveRequests.unshift(newReq);
    persistLeaveRequests();
    if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
      window.KharismaDB.leave.submit(newReq).catch(() => {});
    }
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
    if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
      window.KharismaDB.applicants.save(newCand).catch(() => {});
    }
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
  list.innerHTML = employeeData.map(p => `<option value="${safe(p[0])}">${safe(p[3])} - ${safe(p[2])}</option>`).join('');
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
  const period = data.get('period') || 'Q4 2026';
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
  if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
    window.KharismaDB.departments.save(newDept).catch(() => {});
  }
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
    if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
      window.KharismaDB.departments.save(dept).catch(() => {});
    }
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
    lastLogin: '-'
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

// Account Switcher - listen for change on the #accountSwitcher select
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
      showToast(`Mode simulasi: ${account.name} (${account.role}${account.role === 'Supervisor' ? ' - ' + account.department : ''})`);
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
  const leaveForm = event.target.closest('[data-attendance-leave-form]');
  if (leaveForm) {
    event.preventDefault();
    const data = new FormData(leaveForm);
    const leaveType = String(data.get('leaveType') || '').trim();
    const startDate = String(data.get('startDate') || '').trim();
    const endDate = String(data.get('endDate') || '').trim();
    const reason = String(data.get('reason') || '').trim();

    if (!leaveType || !startDate || !endDate) {
      showToast('Lengkapi jenis izin dan rentang tanggal.');
      return;
    }

    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
      showToast('Tanggal selesai izin tidak boleh lebih awal dari tanggal mulai.');
      return;
    }

    const diffDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
    const ownEmp = getOwnEmployeeRow();
    const newReq = {
      id: `lv-${Date.now()}`,
      name: userProfile.name,
      title: ownEmp?.[3] || userProfile.role,
      type: leaveType,
      submitDate: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date()),
      period: `${startDate} s/d ${endDate}`,
      startDate: startDate,
      endDate: endDate,
      duration: `${diffDays} Hari`,
      reason: reason || 'Keperluan izin kerja',
      status: 'Pending'
    };

    leaveRequests.unshift(newReq);
    persistLeaveRequests();

    if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
      window.KharismaDB.leave.submit(newReq).catch(() => {});
    }

    leaveForm.reset();
    const drawer = moduleView.querySelector('#attLeaveDrawer');
    if (drawer) drawer.hidden = true;

    showToast(`Pengajuan izin ${leaveType} (${diffDays} Hari) berhasil dikirim dan menunggu persetujuan.`);
    if (moduleView && !moduleView.hidden && moduleView.dataset.page === 'attendance') {
      moduleView.innerHTML = pageMarkup('attendance');
      setupTablePagination();
    }
    return;
  }

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

  const locationForm = event.target.closest('[data-attendance-location-form]');
  if (locationForm) {
    event.preventDefault();
    if (!isAdmin()) { showToast('Hanya admin yang dapat mengubah lokasi kantor.'); return; }
    const data = new FormData(locationForm);
    const office = { name: 'Kantor Utama', latitude: Number(data.get('latitude')), longitude: Number(data.get('longitude')), radius_m: Number(data.get('radius')) };
    if (!Number.isFinite(office.latitude) || !Number.isFinite(office.longitude) || office.latitude < -90 || office.latitude > 90 || office.longitude < -180 || office.longitude > 180 || office.radius_m < 20 || office.radius_m > 5000) {
      showToast('Koordinat atau radius lokasi kantor tidak valid.');
      return;
    }
    try {
      let locationRow = { ...office, id: attendancePolicy.location?.id || `local-${Date.now()}` };
      if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
        locationRow = await window.KharismaDB.attendance.saveOfficeLocation(office);
      }
      attendancePolicy.location = locationRow;
      writeStoredValue('teamhub.attendancePolicy', attendancePolicy);
      moduleView.innerHTML = pageMarkup('attendance'); setupTablePagination();
      showToast('Lokasi & radius kantor berhasil diperbarui.');
    } catch (error) {
      showToast(error.message || 'Lokasi kantor gagal disimpan.');
    }
    return;
  }

  const shiftForm = event.target.closest('[data-attendance-shift-form]');
  if (shiftForm) {
    event.preventDefault();
    if (!isAdmin()) { showToast('Hanya admin yang dapat mengatur jam shift.'); return; }
    const data = new FormData(shiftForm);
    const shiftValues = {
      name: String(data.get('shiftName')).trim(),
      start_time: data.get('startTime'),
      end_time: data.get('endTime'),
      tolerance_minutes: Number(data.get('tolerance') || 0),
      weekdays: [1, 2, 3, 4, 5],
      enabled: true
    };
    try {
      let shiftRow = { ...shiftValues, id: `local-shift-${Date.now()}` };
      if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
        shiftRow = await window.KharismaDB.attendance.saveShift(shiftValues);
      }
      attendancePolicy.shifts = [shiftRow, ...(attendancePolicy.shifts || []).filter(shift => shift.id !== shiftRow.id && shift.name !== shiftRow.name)];
      writeStoredValue('teamhub.attendancePolicy', attendancePolicy);
      moduleView.innerHTML = pageMarkup('attendance'); setupTablePagination();
      showToast(`Shift "${shiftRow.name}" berhasil disimpan.`);
    } catch (error) {
      showToast(error.message || 'Shift gagal disimpan.');
    }
    return;
  }

  const assignmentForm = event.target.closest('[data-attendance-assignment]');
  if (assignmentForm) {
    event.preventDefault();
    if (userProfile.role !== 'Supervisor' && !isAdmin()) { showToast('Akses penetapan shift ditolak.'); return; }
    const data = new FormData(assignmentForm);
    const selectedEmployeeId = String(data.get('employeeId'));
    const shiftId = String(data.get('shiftId'));
    let targetEmployeeIds = [];
    if (selectedEmployeeId === '__all__') {
      targetEmployeeIds = employeeData.map(person => `EMP-${getEmployeeId(person)}`);
    } else if (selectedEmployeeId.startsWith('__dept__:')) {
      const deptName = selectedEmployeeId.slice('__dept__:'.length);
      targetEmployeeIds = employeeData.filter(person => person[2] === deptName).map(person => `EMP-${getEmployeeId(person)}`);
    } else if (selectedEmployeeId === '__department__') {
      targetEmployeeIds = employeeData.filter(person => person[2] === getActiveDepartment()).map(person => `EMP-${getEmployeeId(person)}`);
    } else {
      targetEmployeeIds = [selectedEmployeeId];
    }
    try {
      if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
        if (window.KharismaDB.attendance.assignShiftBulk) {
          await window.KharismaDB.attendance.assignShiftBulk(targetEmployeeIds, shiftId);
        } else {
          await Promise.all(targetEmployeeIds.map(employeeId => window.KharismaDB.attendance.assignShift(employeeId, shiftId)));
        }
      }
      const targets = new Set(targetEmployeeIds);
      attendancePolicy.assignments = [...(attendancePolicy.assignments || []).filter(item => !targets.has(item.employee_id)), ...targetEmployeeIds.map(employee_id => ({ employee_id, shift_id: shiftId }))];
      writeStoredValue('teamhub.attendancePolicy', attendancePolicy);
      moduleView.innerHTML = pageMarkup('attendance'); setupTablePagination();
      showToast(`Shift berhasil ditetapkan untuk ${targetEmployeeIds.length} karyawan.`);
    } catch (error) { showToast(error.message || 'Penetapan shift gagal.'); }
  }
});

// 8. Main Content delegation listener for all interactive elements (Dashboard + ModuleView)
const mainContentArea = document.querySelector('main.main-content') || moduleView || document;
mainContentArea.addEventListener('click', async (event) => {
  const btn = event.target.closest('button, [data-action], [data-label], th');
  if (!btn) return;

  const action = btn.dataset?.action;

  // View Employee Detail (Strict MPA navigation to employees.html?name=...)
  if (action === 'view-employee') {
    selectedEmployeeName = btn.dataset.name || 'Mia Torres';
    const currentFile = (window.location.pathname.split('/').pop().toLowerCase() || 'index').replace(/\.html$/, '');
    if (currentFile !== 'employees') {
      window.location.href = `employees.html?name=${encodeURIComponent(selectedEmployeeName)}`;
    } else {
      openModule('employee-details', true, { name: selectedEmployeeName });
    }
    return;
  }

  // Edit Employee
  if (action === 'edit-employee') {
    if (!isAdmin()) { showToast('Hanya administrator yang dapat mengubah data karyawan.'); return; }
    ensureSharedDialogs();
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
    setEmployeeField('#editEmployeeSalary', profile.salary);
    setEmployeeField('#editEmployeeAllowance', profile.allowance);
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
  if (action === 'show-payslip' || action === 'view-my-payslip' || action === 'view-payslip') {
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
      if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
        window.KharismaDB.calendar.delete(id).catch(() => {});
      }
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
    btn.innerHTML = `${next === 'Semua Kategori' ? 'Filter' : next} <span>⌄</span>`;
    moduleView.querySelectorAll('.calendar-event').forEach(ev => {
      const title = ev.dataset.title;
      const item = calendarItems.find(c => c.title === title);
      ev.style.display = (next === 'Semua Kategori' || item?.category === next) ? '' : 'none';
    });
    showToast(`Filter agenda kalender: ${next}`);
    return;
  }

  // Calendar Mode Toggle (Month / Week / Day) & Reset Month
  if (action === 'reset-cal-month') {
    const now = new Date();
    calendarDate = new Date(now.getFullYear(), now.getMonth(), 1);
    selectedDate = now.getDate();
    selectedCalendarEventId = null;
    openModule('calendar');
    renderDashboardMiniCalendar();
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate);
    showToast(`Kalender dikembalikan ke bulan ini (${monthName})`);
    return;
  }

  if (action === 'calendar-mode') {
    const modes = ['Month', 'Week', 'Day'];
    const cur = moduleView.dataset.calMode || 'Month';
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    moduleView.dataset.calMode = next;
    btn.innerHTML = `${next} <span>⌄</span>`;
    const cells = [...moduleView.querySelectorAll('.calendar-month-grid .calendar-cell')];
    const activeIdx = Math.max(0, cells.findIndex(c => c.classList.contains('active-date')));
    const weekStart = Math.floor(activeIdx / 7) * 7;
    cells.forEach((cell, idx) => {
      if (next === 'Month') cell.style.display = '';
      else if (next === 'Week') cell.style.display = (idx >= weekStart && idx < weekStart + 7) ? '' : 'none';
      else if (next === 'Day') cell.style.display = (idx === activeIdx) ? '' : 'none';
    });
    const grid = moduleView.querySelector('.calendar-month-grid');
    if (grid) grid.style.gridTemplateColumns = next === 'Day' ? '1fr' : 'repeat(7, minmax(0, 1fr))';
    showToast(`Mode tampilan kalender: ${next}`);
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
    if (!isAdmin() && !isSupervisor()) {
      showToast('Hanya Administrator atau Supervisor yang dapat menyetujui atau menolak permohonan cuti.');
      return;
    }
    const id = btn.dataset.id;
    const req = leaveRequests.find(r => r.id === id);
    if (req) {
      req.status = action === 'approve-request' ? 'Approved' : 'Rejected';
      persistLeaveRequests();
      if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
        window.KharismaDB.leave.updateStatus(id, req.status).catch(() => {});
      }

      if (action === 'approve-request') {
        // Synchronize employee status to 'On Leave' in employeeData
        const emp = findEmployeeByName(req.name);
        if (emp) {
          emp[4] = 'On Leave';
          persistEmployeeData();
        }
        const existing = calendarItems.find(item => item.id === `cal-leave-${req.id}`);
        if (!existing) {
          let isoDate = req.startDate || '';
          if (!isoDate && req.period) {
            const match = String(req.period).match(/(\d{4}-\d{2}-\d{2})/);
            if (match) isoDate = match[1];
          }
          const parsedLeaveDate = isoDate ? new Date(`${isoDate}T09:00:00`) : new Date();
          const validDate = !Number.isNaN(parsedLeaveDate.getTime()) ? parsedLeaveDate : new Date();
          const finalIso = toLocalISODate(validDate);
          const calEvent = {
            id: `cal-leave-${req.id}`,
            day: validDate.getDate(),
            date: finalIso,
            title: `Cuti Disetujui: ${req.name} (${req.type})`,
            time: 'Sepanjang Hari',
            location: req.reason || 'Cuti Pegawai',
            category: 'Workplace Engagement',
            note: `Permohonan cuti disetujui: ${req.period} (${req.duration})`,
            tone: 2
          };
          calendarItems.unshift(calEvent);
          persistCalendarItems();
          if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
            window.KharismaDB.calendar.create(calEvent).catch(() => {});
          }
        }
      }

      if (typeof renderDashboardSummary === 'function') renderDashboardSummary();
      openModule('leave', false);
      showToast(`Permintaan cuti dari ${req.name} telah ${action === 'approve-request' ? 'disetujui, status karyawan & kalender diperbarui' : 'ditolak'}.`);
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
      if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
        window.KharismaDB.applicants.save(cand).catch(() => {});
      }
      // If applicant reached 'Hired', automatically onboard them into employeeData
      if (cand.stage === 'Hired' && !findEmployeeByName(cand.name)) {
        const deptMap = {
          'UI Designer': 'Product Design',
          'Sales Manager': 'Operations',
          'Data Analyst': 'R&D',
          'Customer Support': 'Customer Service',
          'HR Assistant': 'Human Resources',
          'Full-stack Engineer': 'Technology'
        };
        const dept = deptMap[cand.position] || 'Product Design';
        const email = cand.email || `${cand.name.toLowerCase().replace(/\s+/g, '.')}@kharismahub.com`;
        employeeData.unshift([cand.name, email, dept, cand.position || 'Staff', 'On-Time']);
        getEmployeeId(cand.name);
        const parts = String(cand.type || 'Full-Time Hybrid').split(' ');
        employeeProfileOverrides[cand.name] = {
          ...(employeeProfileOverrides[cand.name] || {}),
          employmentType: parts[0] || 'Full-Time',
          workModel: parts.slice(1).join(' ') || 'Hybrid',
          joinDate: new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date())
        };
        persistProfileOverrides();
        persistEmployeeData();
        updateEmployeeDatalist();
        if (typeof renderDashboardSummary === 'function') renderDashboardSummary();
        openModule('recruitment', false);
        showToast(`Selamat! ${cand.name} diterima (Hired) dan otomatis ditambahkan ke Direktori Karyawan (${dept}).`);
        return;
      }
      openModule('recruitment', false);
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
      if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
        window.KharismaDB.applicants.delete(id).catch(() => {});
      }
      if (typeof renderDashboardSummary === 'function') renderDashboardSummary();
      openModule('recruitment', false);
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

  // Toggle Attendance Drawers (Leave Request, Correction & Admin Shift/Location Settings)
  if (action === 'toggle-att-leave') {
    const drawer = moduleView.querySelector('#attLeaveDrawer');
    if (drawer) {
      drawer.hidden = !drawer.hidden;
      if (!drawer.hidden) {
        drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
    return;
  }
  if (action === 'toggle-att-correction') {
    const drawer = moduleView.querySelector('#attCorrectionDrawer');
    if (drawer) drawer.hidden = !drawer.hidden;
    return;
  }
  if (action === 'toggle-att-admin') {
    const drawer = moduleView.querySelector('#attAdminDrawer');
    if (drawer) drawer.hidden = !drawer.hidden;
    return;
  }

  // Auto-fill Office GPS Location button in Attendance Admin Form
  if (action === 'use-my-gps-location') {
    if (!isAdmin()) { showToast('Hanya administrator yang dapat mengubah titik koordinat kantor.'); return; }
    try {
      btn.disabled = true;
      btn.textContent = 'Mengambil GPS...';
      let coords;
      try {
        coords = await getAttendanceLocation();
      } catch {
        coords = {
          latitude: attendancePolicy.location?.latitude ?? -6.208763,
          longitude: attendancePolicy.location?.longitude ?? 106.845599
        };
      }
      const locForm = moduleView.querySelector('[data-attendance-location-form]');
      if (locForm) {
        const latInput = locForm.querySelector('[name="latitude"]');
        const lngInput = locForm.querySelector('[name="longitude"]');
        if (latInput) latInput.value = Number(coords.latitude).toFixed(6);
        if (lngInput) lngInput.value = Number(coords.longitude).toFixed(6);
      }
      showToast(`Koordinat GPS terdeteksi (${Number(coords.latitude).toFixed(5)}, ${Number(coords.longitude).toFixed(5)}). Klik "Simpan Lokasi" untuk menerapkan.`);
    } catch (err) {
      showToast(err.message || 'Gagal membaca lokasi GPS perangkat.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Gunakan GPS Saya';
    }
    return;
  }

  // Dashboard Interactive Navigation Cards
  if (action === 'nav-employees') { openModule('employees'); return; }
  if (action === 'nav-attendance') { openModule('attendance'); return; }
  if (action === 'nav-leave') { openModule('leave'); return; }
  if (action === 'nav-recruitment') { openModule('recruitment'); return; }
  if (action === 'nav-calendar') { openModule('calendar'); return; }
  if (action === 'nav-kpi') { openModule('kpi'); return; }

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
  if (action === 'switch-att-tab') {
    attendanceActiveTab = btn.dataset.tab || 'team';
    openModule('attendance');
    return;
  }
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
    const depts = ['Semua Divisi', ...getDepartmentNames()];
    const cur = moduleView.dataset.deptFilter || 'Semua Divisi';
    const next = depts[(depts.indexOf(cur) + 1) % depts.length];
    moduleView.dataset.deptFilter = next;
    btn.innerHTML = `${next === 'Semua Divisi' ? 'Filter' : safe(next)} <span>⌄</span>`;
    moduleView.querySelectorAll('.employees-table tbody tr, .employee-cards .employee-card').forEach(row => {
      const rowDept = row.dataset.dept || '';
      row.hidden = next !== 'Semua Divisi' && (rowDept ? rowDept !== next : !row.textContent.includes(next));
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
    const isAll = status === 'All Status' || status === 'Semua Status';
    moduleView.dataset.attFilter = status;
    const filterBtn = moduleView.querySelector('#attendanceFilterBtn');
    if (filterBtn) filterBtn.innerHTML = `${isAll ? 'All Status' : status} <span>⌄</span>`;
    const menu = moduleView.querySelector('#attendanceFilterDropdown');
    if (menu) menu.style.display = 'none';
    moduleView.querySelectorAll('.attendance-full-table tbody tr').forEach(row => {
      const rowStatus = row.dataset.status || row.querySelector('.status')?.textContent.trim() || '';
      row.hidden = !isAll && rowStatus !== status;
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
    btn.innerHTML = `${next === 'Semua' ? 'Filter' : next} <span>⌄</span>`;
    moduleView.querySelectorAll('.payroll-table tbody tr').forEach(row => {
      const rowStatus = row.dataset.status || '';
      row.hidden = next !== 'Semua' && (rowStatus ? rowStatus !== next : !row.textContent.includes(next));
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
    btn.innerHTML = `${next === 'Semua' ? 'Filter' : next} <span>⌄</span>`;
    moduleView.querySelectorAll('.leave-table tbody tr').forEach(row => {
      const rowStatus = row.dataset.status || '';
      row.hidden = next !== 'Semua' && (rowStatus ? rowStatus !== next : !row.textContent.includes(next));
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
        if (window.KharismaDB?.isConnected && authenticatedSupabaseSession) {
          window.KharismaDB.departments.delete(id).catch(() => {});
        }
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
        document.querySelector('#updateKpiTitleBanner').textContent = `${kpi.title} - Divisi: ${kpi.dept} (PIC: ${kpi.pic})`;
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
    btn.innerHTML = `${next} <span>⌄</span>`;
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
    btn.innerHTML = `${next} <span>⌄</span>`;
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
        k.actual !== undefined ? k.actual : '-',
        `${scoreFormatted}%`,
        k.status,
        k.notes || '-'
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
          employeeData.map(emp => `<option value="${safe(emp[1])}" data-name="${safe(emp[0])}" data-dept="${safe(emp[2])}" data-title="${safe(emp[3])}">${safe(emp[0])} - ${safe(emp[1])} (${safe(emp[2])})</option>`).join('');
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
      return [record.employee_name || record.name || userProfile.name, employee?.[3] || 'Karyawan', new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date), record.work_model || record.workModel || '-', `${record.clock_in || record.clockIn || '-'} - ${record.clock_out || record.clockOut || 'Belum pulang'}`, record.duration || '-', record.overtime || '-', record.state && record.state !== 'completed' ? 'Belum Lengkap' : ({ 'On-Time': 'Tepat Waktu', Late: 'Terlambat', 'On Leave': 'Cuti', Absent: 'Tidak Hadir' }[record.status] || record.status || '-')];
    });
    downloadCsv('laporan-kehadiran-kharisma-hub.csv', [headers, ...rows]);
    return;
  }

  // Export Payroll CSV (Dynamic per employee compensation)
  if (action === 'export-payroll') {
    const headers = ['Nama Karyawan', 'ID', 'Jabatan', 'Departemen', 'Gaji Pokok', 'Tunjangan', 'Lembur', 'Insentif', 'Potongan', 'Total Bersih', 'Status'];
    const rows = employeeData.map(p => {
      const prof = getEmployeeProfile(p[0]);
      const netVal = prof.salaryRaw + prof.allowanceRaw + 80 + 150 - 120;
      return [
        p[0], prof.id, p[3], p[2], prof.salary, prof.allowance, formatIDR(80), formatIDR(150), formatIDR(120), formatIDR(netVal), 'Paid'
      ];
    });
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
  if (action === 'format-font') {
    const fonts = ['DM Sans', 'Georgia', 'Courier New'];
    const labels = ['Sans Serif ⌄', 'Serif ⌄', 'Monospace ⌄'];
    const nextIdx = ((Number(btn.dataset.idx) || 0) + 1) % fonts.length;
    btn.dataset.idx = nextIdx;
    btn.textContent = labels[nextIdx];
    const bodyEl = moduleView.querySelector('.compose-body');
    if (bodyEl) bodyEl.style.fontFamily = fonts[nextIdx];
    showToast(`Font editor diubah ke ${fonts[nextIdx]}`);
    return;
  }
  if (action === 'format-size') {
    const sizes = ['13px', '15px', '17px'];
    const labels = ['Aa ⌄', 'Aa+ ⌄', 'Aa++ ⌄'];
    const nextIdx = ((Number(btn.dataset.idx) || 0) + 1) % sizes.length;
    btn.dataset.idx = nextIdx;
    btn.textContent = labels[nextIdx];
    const bodyEl = moduleView.querySelector('.compose-body');
    if (bodyEl) bodyEl.style.fontSize = sizes[nextIdx];
    showToast(`Ukuran teks editor: ${sizes[nextIdx]}`);
    return;
  }
  if (action === 'format-align') {
    const aligns = ['left', 'center', 'right'];
    const nextIdx = ((Number(btn.dataset.idx) || 0) + 1) % aligns.length;
    btn.dataset.idx = nextIdx;
    const bodyEl = moduleView.querySelector('.compose-body');
    if (bodyEl) bodyEl.style.textAlign = aligns[nextIdx];
    showToast(`Perataan teks: ${aligns[nextIdx]}`);
    return;
  }
  if (action === 'format-list') {
    document.execCommand('insertUnorderedList', false, null);
    showToast('Daftar poin ditambahkan');
    return;
  }

  // Employees & Details Extra Actions
  if (action === 'dept-period-filter') {
    const periods = ['This Month ⌄', 'Last Quarter ⌄', 'This Year ⌄'];
    const nextIdx = ((Number(btn.dataset.idx) || 0) + 1) % periods.length;
    btn.dataset.idx = nextIdx;
    btn.textContent = periods[nextIdx];
    showToast(`Periode statistik departemen: ${periods[nextIdx].replace(' ⌄', '')}`);
    return;
  }
  if (action === 'open-social') {
    event.preventDefault();
    const platform = btn.dataset.platform || 'Sosial Media';
    const empName = btn.dataset.name || selectedEmployeeName;
    showToast(`Membuka profil ${platform} milik ${empName}`);
    return;
  }
  if (action === 'download-emp-doc') {
    event.preventDefault();
    const docName = btn.dataset.doc || 'Dokumen.pdf';
    const empName = btn.dataset.emp || selectedEmployeeName;
    const prof = getEmployeeProfile(empName);
    const content = `DOKUMEN RESMI KHARISMA HUB\n==========================\nNama Dokumen : ${docName}\nNama Karyawan: ${prof.name} (${prof.id})\nDepartemen   : ${prof.department}\nJabatan      : ${prof.title}\nTanggal Unduh: ${new Date().toLocaleDateString('id-ID')}\n`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${empName.toLowerCase().replace(/\s+/g, '-')}-${docName.replace(/\.pdf$/i, '.txt')}`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(`Mengunduh dokumen "${docName}" milik ${empName}...`);
    return;
  }
  if (action === 'emp-mini-cal-prev' || action === 'emp-mini-cal-next') {
    calendarDate.setMonth(calendarDate.getMonth() + (action === 'emp-mini-cal-next' ? 1 : -1));
    openModule('employee-details', false, { name: selectedEmployeeName });
    const monthName = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(calendarDate);
    showToast(`Kalender karyawan: ${monthName}`);
    return;
  }
  if (action === 'emp-mini-cal-day') {
    selectedDate = Number(btn.dataset.day) || 1;
    moduleView.querySelectorAll('.detail-calendar span').forEach(s => s.classList.toggle('selected', s === btn));
    showToast(`Tanggal ${selectedDate} dipilih pada kalender kehadiran ${selectedEmployeeName}`);
    return;
  }

  // Recruitment Extra Actions
  if (action === 'recruitment-period-filter') {
    const periods = ['Last 6 Months ⌄', 'This Quarter ⌄', 'This Year ⌄'];
    const nextIdx = ((Number(btn.dataset.idx) || 0) + 1) % periods.length;
    btn.dataset.idx = nextIdx;
    btn.textContent = periods[nextIdx];
    showToast(`Grafik lamaran kerja: ${periods[nextIdx].replace(' ⌄', '')}`);
    return;
  }
  if (action === 'vacancy-filter') {
    const modes = ['Semua Model', 'Remote', 'On-Site', 'Hybrid', 'Internship'];
    const cur = moduleView.dataset.vacFilter || 'Semua Model';
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    moduleView.dataset.vacFilter = next;
    btn.textContent = `${next === 'Semua Model' ? 'Filter' : next} ⌄`;
    moduleView.querySelectorAll('.vacancy-box').forEach(box => {
      box.style.display = (next === 'Semua Model' || box.textContent.includes(next)) ? '' : 'none';
    });
    showToast(`Filter lowongan aktif: ${next}`);
    return;
  }
  if (action === 'filter-vacancy') {
    const pos = btn.dataset.position || '';
    const isAlreadyActive = btn.classList.contains('active-vacancy');
    moduleView.querySelectorAll('.vacancy-box').forEach(b => {
      b.classList.remove('active-vacancy');
      b.style.outline = '';
    });
    const rows = moduleView.querySelectorAll('.applicants-table tbody tr');
    if (isAlreadyActive) {
      rows.forEach(r => { r.hidden = false; });
      showToast('Menampilkan semua pelamar kerja');
    } else {
      btn.classList.add('active-vacancy');
      btn.style.outline = '2px solid #0962ea';
      rows.forEach(r => {
        r.hidden = !r.textContent.toLowerCase().includes(pos.toLowerCase());
      });
      showToast(`Menyaring pelamar untuk posisi: ${pos}`);
    }
    return;
  }
  if (action === 'rec-mini-cal-prev' || action === 'rec-mini-cal-next') {
    const delta = action === 'rec-mini-cal-next' ? 7 : -7;
    moduleView.querySelectorAll('.mini-days-row span').forEach(s => {
      const curDay = Number(s.dataset.day) || Number(s.textContent) || 17;
      let nextDay = curDay + delta;
      if (nextDay > 31) nextDay -= 31;
      if (nextDay < 1) nextDay += 30;
      s.dataset.day = nextDay;
      s.textContent = nextDay;
    });
    showToast('Minggu jadwal wawancara diperbarui');
    return;
  }
  if (action === 'rec-mini-cal-day') {
    moduleView.querySelectorAll('.mini-days-row span').forEach(s => s.classList.toggle('active-day', s === btn));
    showToast(`Menampilkan jadwal wawancara tanggal ${btn.textContent} Oktober 2026`);
    return;
  }

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
    if (colIndex >= 1 && colIndex <= 8) {
      const isAsc = btn.dataset.sortDir !== 'asc';
      btn.dataset.sortDir = isAsc ? 'asc' : 'desc';
      employeeData.sort((a, b) => {
        const profA = getEmployeeProfile(a[0]);
        const profB = getEmployeeProfile(b[0]);
        let valA = '', valB = '';
        if (colIndex === 1) { valA = getEmployeeId(a); valB = getEmployeeId(b); }
        else if (colIndex === 2) { valA = a[0]; valB = b[0]; }
        else if (colIndex === 3) { valA = a[3]; valB = b[3]; }
        else if (colIndex === 4) { valA = a[2]; valB = b[2]; }
        else if (colIndex === 5) { valA = profA.employmentType; valB = profB.employmentType; }
        else if (colIndex === 6) { valA = profA.workModel; valB = profB.workModel; }
        else if (colIndex === 7) { valA = profA.joinDate; valB = profB.joinDate; }
        else if (colIndex === 8) { valA = a[4]; valB = b[4]; }
        return isAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
      });
      openModule('employees', false);
      showToast(`Tabel diurutkan berdasarkan ${btn.textContent.replace(/[↕\s]/g, '')} (${isAsc ? 'A-Z' : 'Z-A'})`);
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
    showToast(`Tabel absensi diurutkan: ${btn.textContent.replace(/[↕\s]/g, '')} (${isAsc ? 'A-Z' : 'Z-A'})`);
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
    showToast(`Tabel KPI diurutkan: ${btn.textContent.replace(/[↕\s]/g, '')} (${isAsc ? 'A-Z' : 'Z-A'})`);
    return;
  }
});

// Change event for datepickers inside modules
moduleView.addEventListener('change', (event) => {
  if (event.target.id === 'leaveStartDate' || event.target.id === 'leaveEndDate') {
    const s = moduleView.querySelector('#leaveStartDate')?.value;
    const e = moduleView.querySelector('#leaveEndDate')?.value;
    const badge = moduleView.querySelector('#leaveDurationBadge');
    if (badge && s && e) {
      const sMs = new Date(s).getTime();
      const eMs = new Date(e).getTime();
      if (!isNaN(sMs) && !isNaN(eMs) && eMs >= sMs) {
        const d = Math.max(1, Math.round((eMs - sMs) / 86400000) + 1);
        badge.textContent = `${d} Hari`;
        badge.style.color = '#fff';
      } else if (eMs < sMs) {
        badge.textContent = 'Tanggal tidak valid';
        badge.style.color = '#fca5a5';
      }
    }
  }
});

// Filter input inside modules
moduleView.addEventListener('input', (event) => {
  if (event.target.id === 'leaveStartDate' || event.target.id === 'leaveEndDate') {
    const s = moduleView.querySelector('#leaveStartDate')?.value;
    const e = moduleView.querySelector('#leaveEndDate')?.value;
    const badge = moduleView.querySelector('#leaveDurationBadge');
    if (badge && s && e) {
      const sMs = new Date(s).getTime();
      const eMs = new Date(e).getTime();
      if (!isNaN(sMs) && !isNaN(eMs) && eMs >= sMs) {
        const d = Math.max(1, Math.round((eMs - sMs) / 86400000) + 1);
        badge.textContent = `${d} Hari`;
        badge.style.color = '#fff';
      } else if (eMs < sMs) {
        badge.textContent = 'Tanggal tidak valid';
        badge.style.color = '#fca5a5';
      }
    }
    return;
  }

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

// Dropdown & Checkbox change listener inside moduleView
moduleView.addEventListener('change', (event) => {
  const target = event.target;
  if (target.id === 'attendanceSortSelect') {
    const colIndex = Number(target.value);
    const th = moduleView.querySelector(`.attendance-full-table th[data-col="${colIndex}"]`);
    if (th) th.click();
    return;
  }

  // Select-all checkbox in tables (Employees & Leave)
  if (target.matches('input[data-select-all]')) {
    const table = target.closest('table');
    if (table) {
      const checkboxes = table.querySelectorAll('tbody input[type="checkbox"]');
      checkboxes.forEach(cb => { cb.checked = target.checked; });
      showToast(target.checked ? `${checkboxes.length} baris dipilih` : 'Pilihan baris dibatalkan');
    }
    return;
  }

  // Calendar agenda filter checkboxes
  if (target.closest('.agenda-filters') && target.type === 'checkbox') {
    const checkedCount = moduleView.querySelectorAll('.agenda-filters input[type="checkbox"]:checked').length;
    moduleView.querySelectorAll('.calendar-event').forEach((ev, idx) => {
      ev.style.display = checkedCount === 0 ? 'none' : (idx % 9 < checkedCount ? '' : 'none');
    });
    showToast(`Filter agenda diperbarui (${checkedCount} jenis agenda aktif)`);
    return;
  }

  // Employees & Employee Grid Sort / Filter dropdowns
  const selectType = target.dataset?.select;
  if (selectType === 'employee-sort') {
    const val = target.value;
    employeeData.sort((a, b) => {
      if (val === 'Name') return a[0].localeCompare(b[0]);
      if (val === 'Department') return a[2].localeCompare(b[2]);
      if (val === 'Join Date') return getEmployeeProfile(a[0]).joinDate.localeCompare(getEmployeeProfile(b[0]).joinDate);
      return 0;
    });
    openModule(moduleView.dataset.page || 'employees', false);
    const sel = moduleView.querySelector(`[data-select="employee-sort"]`);
    if (sel) sel.value = val;
    showToast(`Data karyawan diurutkan berdasarkan: ${val}`);
    return;
  }

  if (selectType === 'grid-dept' || selectType === 'grid-position') {
    const deptVal = moduleView.querySelector('[data-select="grid-dept"]')?.value || 'All Department';
    const posVal = moduleView.querySelector('[data-select="grid-position"]')?.value || 'All Position';
    moduleView.querySelectorAll('.employee-cards .employee-card').forEach(card => {
      const deptMatch = deptVal === 'All Department' || card.dataset.dept === deptVal;
      const posMatch = posVal === 'All Position' || card.innerText.toLowerCase().includes(posVal.toLowerCase());
      card.hidden = !deptMatch || !posMatch;
    });
    showToast(`Filter grid karyawan: ${deptVal} • ${posVal}`);
    return;
  }

  if (selectType === 'emp-perf-period') {
    const scoreEl = moduleView.querySelector('.detail-performance-score strong');
    if (scoreEl) {
      const prof = getEmployeeProfile(selectedEmployeeName);
      scoreEl.textContent = target.value === 'This Year' ? '92.4%' : prof.score;
    }
    showToast(`Periode evaluasi kinerja ${selectedEmployeeName}: ${target.value}`);
    return;
  }

  if (selectType === 'emp-hours-period') {
    const hoursEl = moduleView.querySelector('.detail-hours-score');
    if (hoursEl) {
      const prof = getEmployeeProfile(selectedEmployeeName);
      hoursEl.textContent = target.value === 'Last Week' ? '38h 15m' : prof.hours;
    }
    showToast(`Periode jam kerja ${selectedEmployeeName}: ${target.value}`);
    return;
  }

  if (selectType === 'performance-period') {
    showToast(`Menampilkan penilaian kinerja periode: ${target.value}`);
    return;
  }

  if (selectType === 'att-chart-period') {
    showToast(`Menampilkan grafik kehadiran periode: ${target.value}`);
    return;
  }

  // KPI Period Select Filter
  if (target.id === 'kpiPeriodSelect') {
    const period = target.value;
    moduleView.querySelectorAll('.kpi-table tbody tr').forEach(row => {
      const rowPeriod = row.dataset.kpiPeriod || '';
      row.hidden = period !== 'Semua Periode' && rowPeriod !== period;
    });
    showToast(`Filter periode KPI: ${period}`);
    return;
  }
});

// Form Submissions inside moduleView (Employee form & Mail Composer)
moduleView.addEventListener('submit', (event) => {
  if (event.target.id === 'employeePageForm') {
    event.preventDefault();
    if (!isAdmin()) { showToast('Hanya administrator yang dapat menambahkan karyawan.'); return; }
    const data = new FormData(event.target);
    const firstName = (data.get('firstName') || employeeDraft.firstName || '').trim();
    const lastName = (data.get('lastName') || employeeDraft.lastName || '').trim();
    const name = `${firstName} ${lastName}`.trim() || 'New Employee';
    const email = (data.get('email') || employeeDraft.email || '').trim() || `${name.toLowerCase().replace(/\s+/g, '.')}@kharismahub.com`;
    const dept = data.get('department') || employeeDraft.department || 'Product Design';
    const title = (data.get('title') || employeeDraft.title || '').trim() || 'Staff';

    const birth = (data.get('birth') || employeeDraft.birth || '').trim();
    const gender = data.get('gender') || employeeDraft.gender || '';
    const phone = (data.get('phone') || employeeDraft.phone || '').trim();
    const address = (data.get('address') || employeeDraft.address || '').trim();
    const customEmployeeId = (data.get('employeeId') || employeeDraft.employeeId || '').trim();
    const joiningDate = (data.get('joiningDate') || employeeDraft.joiningDate || '').trim();
    const employmentType = data.get('employmentType') || employeeDraft.employmentType || 'Full-Time';
    const workModel = data.get('workModel') || employeeDraft.workModel || 'Hybrid';
    const salaryRaw = parseNominalIDR(data.get('salary') || employeeDraft.salary || 0);
    const allowanceRaw = parseNominalIDR(data.get('allowance') || employeeDraft.allowance || 0);

    employeeData.unshift([name, email, dept, title, 'On-Time']);
    if (customEmployeeId) {
      employeeIdByName.set(name, customEmployeeId);
    } else {
      getEmployeeId(name);
    }

    if (!employeeProfileOverrides[name]) employeeProfileOverrides[name] = {};
    Object.assign(employeeProfileOverrides[name], {
      workModel,
      employmentType,
      ...(birth ? { dob: birth } : {}),
      ...(gender ? { gender } : {}),
      ...(phone ? { phone } : {}),
      ...(address ? { address } : {}),
      ...(joiningDate ? { joinDate: joiningDate } : {}),
      ...(salaryRaw > 0 ? { salaryRaw, salary: formatIDR(salaryRaw) } : {}),
      ...(allowanceRaw > 0 ? { allowanceRaw, allowance: formatIDR(allowanceRaw) } : {})
    });

    persistProfileOverrides();
    persistEmployeeData();
    updateEmployeeDatalist();
    employeeDraft = {};
    persistEmployeeDraft();
    employeeCurrentPage = 1;
    openModule('employees');
    showToast(`Karyawan baru ${name} berhasil didaftarkan beserta rincian profil & kompensasi.`);
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

    const scopedEmpPool = isEmployee()
      ? [getOwnEmployeeRow()].filter(Boolean)
      : isSupervisor()
        ? employeeData.filter(p => p[2] === getActiveDepartment())
        : employeeData;

    const matchedEmployees = scopedEmpPool.filter(p => 
      p[0].toLowerCase().includes(query) || p[2].toLowerCase().includes(query) || p[3].toLowerCase().includes(query)
    ).slice(0, 4);

    const matchedCalendar = calendarItems.filter(item => 
      item.title.toLowerCase().includes(query) || (item.location && item.location.toLowerCase().includes(query))
    ).slice(0, 3);

    const scopedLeavePool = isEmployee()
      ? leaveRequests.filter(req => req.name.toLowerCase() === (getOwnEmployeeRow()?.[0] || userProfile.name || '').toLowerCase())
      : isSupervisor()
        ? leaveRequests.filter(req => {
            const emp = findEmployeeByName(req.name);
            return !emp || emp[2] === getActiveDepartment();
          })
        : leaveRequests;

    const matchedLeaves = scopedLeavePool.filter(req => 
      req.name.toLowerCase().includes(query) || req.type.toLowerCase().includes(query)
    ).slice(0, 3);

    const matchedMails = inboxData.filter(mail => 
      mail.from.toLowerCase().includes(query) || mail.subject.toLowerCase().includes(query)
    ).slice(0, 3);

    const matchedKpis = isEmployee() ? [] : kpiData.filter(k => 
      (!isSupervisor() || k.dept === getActiveDepartment()) &&
      (k.title.toLowerCase().includes(query) || k.dept.toLowerCase().includes(query) || k.pic.toLowerCase().includes(query))
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
              <small>${safe(p[3])} • ${safe(p[2])}</small>
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
              <small>${safe(k.dept)} • Target: ${k.target} ${safe(k.unit)} • ${safe(k.status)}</small>
            </div>
            <span class="search-item-badge" style="background:#e0e7ff;color:#4338ca">KPI</span>
          </button>
        `;
      });
    }

    if (matchedCalendar.length) {
      html += `<div class="search-group-title">Agenda Kalender</div>`;
      matchedCalendar.forEach(item => {
        const itemDate = getCalendarItemDate(item, calendarDate);
        const dateLabel = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long' }).format(itemDate);
        html += `
          <button type="button" class="search-result-item" data-search-type="calendar" data-day="${item.day}">
            <div class="search-item-info">
              <strong>${safe(item.title)}</strong>
              <small>${dateLabel} • ${safe(item.time)} • ${safe(item.location || '')}</small>
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
              <small>${safe(req.period)} • ${safe(req.status)}</small>
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
              <small>Dari: ${safe(mail.from)} • ${safe(mail.time)}</small>
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
    btn.innerHTML = `${next} <span>⌄</span>`;
    showToast(`Filter absensi dasbor: ${next}`);
  });

  document.querySelectorAll('.period-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const periods = ['This Month', 'Last Month', 'Last 6 Months', 'This Year'];
      const cur = btn.dataset.period || 'This Month';
      const next = periods[(periods.indexOf(cur) + 1) % periods.length];
      btn.dataset.period = next;
      btn.innerHTML = `${next} <span>⌄</span>`;
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

  // Kebab & Tiny-Menu option menus + Footer links
  document.addEventListener('click', (event) => {
    const footerLink = event.target.closest('a[href="#privacy"], a[href="#terms"], a[href="#contact"]');
    if (footerLink) {
      event.preventDefault();
      const href = footerLink.getAttribute('href');
      if (href === '#privacy') showToast('Kebijakan Privasi PT Kharisma Group Indonesia: Data karyawan dilindungi enkripsi standar enterprise.');
      else if (href === '#terms') showToast('Syarat & Ketentuan Kharisma Hub v2.6 berlaku untuk seluruh pengguna internal.');
      else if (href === '#contact') showToast('Hubungi Tim HRD & IT Support Kharisma Group: support@kharismahub.com');
      return;
    }

    const kebab = event.target.closest('.kebab:not([data-action]), .tiny-menu');
    if (kebab) {
      event.stopPropagation();
      document.querySelectorAll('.kebab-popover-menu').forEach(el => el.remove());
      const container = kebab.closest('.module-card, .panel');
      const cardTitle = container?.querySelector('h2')?.innerText.replace('···', '').replace('•••', '').trim() || 'Panel';

      if (container?.classList.contains('employee-personal-card') && isAdmin()) {
        const editBtn = document.querySelector(`[data-action="edit-employee"][data-name="${selectedEmployeeName}"]`);
        if (editBtn) { editBtn.click(); return; }
      }

      const popover = document.createElement('div');
      popover.className = 'kebab-popover-menu';
      const isTaskPanel = container?.classList.contains('tasks-panel') || container?.id === 'tasks';
      const isNotesPanel = container?.classList.contains('employee-notes-card');

      popover.innerHTML = `
        <div class="kebab-popover-head">${safe(cardTitle)}</div>
        ${isTaskPanel ? `<button type="button" data-kebab-opt="add-task">Tambah Tugas Baru</button>` : ''}
        ${isNotesPanel ? `<button type="button" data-kebab-opt="add-note">Tambah Catatan HR</button>` : ''}
        <button type="button" data-kebab-opt="export">Ekspor Data (CSV)</button>
        <button type="button" data-kebab-opt="print">Cetak Bagian Ini</button>
        <button type="button" data-kebab-opt="refresh">Muat Ulang Data</button>
      `;

      document.body.appendChild(popover);
      const rect = kebab.getBoundingClientRect();
      popover.style.top = `${window.scrollY + rect.bottom + 6}px`;
      popover.style.left = `${Math.max(12, window.scrollX + rect.right - 190)}px`;

      popover.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const optBtn = ev.target.closest('[data-kebab-opt]');
        if (!optBtn) return;
        const opt = optBtn.dataset.kebabOpt;
        popover.remove();

        if (opt === 'add-task' && container) {
          const newTaskTitle = window.prompt('Nama tugas baru:');
          if (newTaskTitle && newTaskTitle.trim()) {
            const label = document.createElement('label');
            label.className = 'task-row';
            label.innerHTML = `<input type="checkbox" /><span><strong>${safe(newTaskTitle.trim())}</strong><small><i>HR Task</i><time>Oktober 2026</time></small></span>`;
            container.appendChild(label);
            showToast(`Tugas "${newTaskTitle.trim()}" berhasil ditambahkan.`);
          }
        } else if (opt === 'add-note' && container) {
          const noteText = window.prompt(`Catatan internal untuk ${selectedEmployeeName}:`);
          if (noteText && noteText.trim()) {
            const grid = container.querySelector('.employee-notes-grid');
            if (grid) {
              const art = document.createElement('article');
              art.innerHTML = `<strong>HR Note</strong><small>${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</small><p>${safe(noteText.trim())}</p>`;
              grid.prepend(art);
              showToast('Catatan internal berhasil ditambahkan.');
            }
          }
        } else if (opt === 'export') {
          const table = container?.querySelector('table') || moduleView?.querySelector('table') || document.querySelector('#attendance table');
          if (table) {
            const rows = [...table.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => cell.innerText.trim()));
            downloadCsv(`${cardTitle.toLowerCase().replace(/\s+/g, '-')}-export.csv`, rows);
          } else if (container) {
            const lines = container.innerText.split('\n').map(l => l.trim()).filter(Boolean).map(l => [l]);
            downloadCsv(`${cardTitle.toLowerCase().replace(/\s+/g, '-')}-ringkasan.csv`, [['Ringkasan ' + cardTitle], ...lines]);
          }
        } else if (opt === 'print') {
          window.print();
        } else if (opt === 'refresh') {
          const page = moduleView?.dataset.page;
          if (page) openModule(page, false);
          else renderDashboardSummary();
          showToast(`${cardTitle} berhasil dimuat ulang.`);
        }
      });
      return;
    }
    document.querySelectorAll('.kebab-popover-menu').forEach(el => el.remove());
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
    const period = data.get('period') || 'Q4 2026';
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
   Initial Application Launch & Mobile Navigation Drawer
   ========================================================================== */

function setupMobileNavigationDrawer() {
  const topbar = document.querySelector('.topbar');
  const sidebar = document.querySelector('.sidebar');
  if (!topbar || !sidebar || document.querySelector('#mobileMenuToggle')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'mobileMenuToggle';
  btn.className = 'mobile-menu-btn';
  btn.setAttribute('aria-label', 'Buka Menu Navigasi');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
  topbar.insertBefore(btn, topbar.firstChild);

  const backdrop = document.createElement('div');
  backdrop.className = 'mobile-sidebar-backdrop';
  backdrop.hidden = true;
  document.body.appendChild(backdrop);

  const closeMenu = () => {
    sidebar.classList.remove('mobile-open');
    backdrop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = sidebar.classList.toggle('mobile-open');
    backdrop.hidden = !isOpen;
    btn.setAttribute('aria-expanded', String(isOpen));
  });

  backdrop.addEventListener('click', closeMenu);
  sidebar.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', closeMenu);
  });
}

function syncQuickAbsenButtons() {
  // 1. Ensure sidebar navigation label is unmistakably clear across all pages
  const activeRole = (authenticatedSupabaseSession && authenticatedUserProfile)
    ? authenticatedUserProfile.role
    : (userProfile ? userProfile.role : 'Admin');
  document.querySelectorAll('.nav-link[data-module="attendance"]').forEach(link => {
    const iconSpan = link.querySelector('.nav-icon');
    const iconHtml = iconSpan ? iconSpan.outerHTML : '<span class="nav-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>';
    if (activeRole === 'Employee') {
      link.innerHTML = `${iconHtml}Presensi Saya`;
      link.title = 'Portal Presensi Mandiri Karyawan';
    } else {
      link.innerHTML = `${iconHtml}Absensi &amp; Kehadiran`;
      link.title = 'Manajemen Absensi & Kehadiran Tim';
    }
  });

  // 2. Inject Quick Absen button into .topbar .top-actions across all 10 pages if not present
  const topActions = document.querySelector('.topbar .top-actions');
  let topbarBtn = document.querySelector('#topbarAbsenBtn');
  if (topActions && !topbarBtn) {
    topbarBtn = document.createElement('button');
    topbarBtn.type = 'button';
    topbarBtn.id = 'topbarAbsenBtn';
    topbarBtn.className = 'topbar-absen-btn';
    topbarBtn.dataset.action = 'clock-in';
    const cloudBadge = topActions.querySelector('#cloudStatusBadge');
    if (cloudBadge) {
      topActions.insertBefore(topbarBtn, cloudBadge);
    } else {
      topActions.prepend(topbarBtn);
    }
  }

  // 3. Compute current attendance state for today
  const todayKey = attendanceTodayKey();
  const activeToday = userAttendanceRecord && (userAttendanceRecord.dateKey === todayKey || isActiveOvernightAttendance(userAttendanceRecord))
    ? userAttendanceRecord
    : null;

  let label = 'Absen Masuk';
  let stateClass = 'state-checkin';
  let actionType = 'clock-in';
  let titleText = 'Klik untuk mencatat jam masuk kerja (Clock In) hari ini';

  if (activeToday) {
    if (activeToday.state === 'working') {
      label = `Absen Pulang (${activeToday.clockIn || 'Aktif'})`;
      stateClass = 'state-checkout';
      actionType = 'clock-in';
      titleText = `Sudah masuk pukul ${activeToday.clockIn || '-'} • Klik untuk mencatat jam pulang (Clock Out)`;
    } else if (activeToday.state === 'on_break') {
      label = 'Selesai Istirahat';
      stateClass = 'state-break';
      actionType = 'clock-in';
      titleText = 'Klik untuk mengakhiri waktu istirahat dan kembali bekerja';
    } else if (activeToday.state === 'completed' || activeToday.clockOut) {
      label = `Sudah Absen (${activeToday.clockIn || '-'} - ${activeToday.clockOut || '-'})`;
      stateClass = 'state-done';
      actionType = 'nav-attendance';
      titleText = 'Presensi hari ini telah selesai • Klik untuk membuka detail di menu Absensi & Kehadiran';
    }
  }

  const clockSvg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

  if (topbarBtn) {
    topbarBtn.className = `topbar-absen-btn ${stateClass}`;
    topbarBtn.dataset.action = actionType;
    topbarBtn.title = titleText;
    topbarBtn.innerHTML = `${clockSvg}<span>${safe(label)}</span>`;
  }

  const dashBtn = document.querySelector('#dashAbsenBtn');
  if (dashBtn) {
    dashBtn.className = `dash-absen-btn ${stateClass}`;
    dashBtn.dataset.action = actionType;
    dashBtn.title = titleText;
    dashBtn.innerHTML = `${clockSvg}<span id="dashAbsenBtnText">${safe(label)}</span>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupMobileNavigationDrawer();
  syncQuickAbsenButtons();
  renderDashboardMiniCalendar();
  renderDashboardScheduleList();
  renderDashboardSummary();
  updateNotificationBadge();
  setupDashboardControls();
  const { key, params } = resolveRoute();
  openModule(key, false, Object.fromEntries(params.entries()));
});

// Run immediately in case script loads after DOM ready
setupMobileNavigationDrawer();
syncQuickAbsenButtons();
renderDashboardMiniCalendar();
renderDashboardScheduleList();
updateNotificationBadge();
setupDashboardControls();
const { key: initialKey, params: initialParams } = resolveRoute();
openModule(initialKey, false, Object.fromEntries(initialParams.entries()));
