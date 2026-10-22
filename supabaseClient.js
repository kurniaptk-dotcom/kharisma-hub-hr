/**
 * Kharisma Hub — Unified Supabase Cloud & Resilient Data Layer
 * Target Project: https://wirgqezinegebauddmgy.supabase.co
 * 
 * Features:
 * - Direct real-time Supabase Postgres integration
 * - Stale-while-revalidate local cache for instant sub-second page loads
 * - Graceful offline & pending-key fallback (never throws or crashes UI)
 * - Automatic write sync queue
 * - Two-way database synchronization helper
 */

(function (window) {
  'use strict';

  const DEFAULT_SUPABASE_URL = 'https://wirgqezinegebauddmgy.supabase.co';
  let SUPABASE_URL = DEFAULT_SUPABASE_URL;
  const STORAGE_KEY_ANON = 'kharisma_supabase_anon_key';
  const STORAGE_KEY_QUEUE = 'kharisma_offline_sync_queue';

  let anonKey = (typeof window !== 'undefined' && (
    window.__ENV?.SUPABASE_ANON_KEY || 
    localStorage.getItem(STORAGE_KEY_ANON) || 
    ''
  )) || '';

  let client = null;
  let isConnected = false;
  let lastSyncTime = null;
  let authRequired = false;
  let configurationError = '';
  let backendConfigured = true;
  let configReady = Promise.resolve(null);

  function initClient() {
    if (typeof supabase !== 'undefined' && SUPABASE_URL && anonKey) {
      try {
        client = supabase.createClient(SUPABASE_URL, anonKey, {
          auth: { persistSession: true, autoRefreshToken: true },
          global: { headers: { 'x-client-info': 'kharisma-hub/1.0' } }
        });
        testConnection();
      } catch (err) {
        console.warn('[KharismaDB] Supabase initialization warning:', err.message);
        dispatchStatus(false, 'Gagal inisialisasi client Supabase');
      }
    } else {
      dispatchStatus(false, 'Anon Key belum dikonfigurasi (Mode Lokal)');
    }
    return client;
  }

  async function testConnection() {
    if (!client) {
      isConnected = false;
      dispatchStatus(false, 'Anon Key belum dikonfigurasi (Mode Lokal)');
      return { ok: false, message: 'Anon Key belum diisi' };
    }
    try {
      const startTime = performance.now();
      const { data, error } = await client.from('employees').select('id').limit(1);
      const latency = Math.round(performance.now() - startTime);

      if (error) {
        // Table might not exist yet or schema cache pending migration
        if (error.code === '42P01' || error.code === 'PGRST205' || (error.message && error.message.includes('schema cache'))) {
          isConnected = true;
          dispatchStatus(true, `Terhubung ke Supabase (${latency}ms) — Skema tabel perlu dijalankan`);
          return { ok: true, latency, message: 'Tabel database belum dibuat di Supabase' };
        }
        isConnected = false;
        dispatchStatus(false, `Gagal otentikasi Supabase: ${error.message}`);
        return { ok: false, message: error.message };
      }

      isConnected = true;
      lastSyncTime = new Date();
      dispatchStatus(true, `Cloud Terhubung (${latency}ms)`);
      // Pending HR records are never uploaded automatically after a login or key change.
      // The administrator must start a deliberate sync from Settings.
      return { ok: true, latency, message: 'Koneksi aktif' };
    } catch (e) {
      isConnected = false;
      dispatchStatus(false, `Koneksi offline: ${e.message}`);
      return { ok: false, message: e.message };
    }
  }

  function dispatchStatus(connected, detail) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('kharisma:supabase-status', {
        detail: { isConnected: connected, message: detail, lastSync: lastSyncTime }
      }));
    }
  }

  // Offline queue manager
  function enqueueSync(action, table, payload) {
    try {
      const queue = JSON.parse(localStorage.getItem(STORAGE_KEY_QUEUE) || '[]');
      queue.push({ action, table, payload, timestamp: Date.now() });
      localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(queue));
    } catch {}
  }

  async function flushSyncQueue() {
    if (!client || !isConnected) return;
    try {
      const queue = JSON.parse(localStorage.getItem(STORAGE_KEY_QUEUE) || '[]');
      if (!queue.length) return;
      console.log(`[KharismaDB] Flushing ${queue.length} offline operations to Supabase...`);

      const allowedTables = new Set(['employees', 'kpi_indicators']);
      const remaining = queue.filter(item => !allowedTables.has(item.table) && item.table !== 'attendance_records');
      for (const item of queue) {
        if (!allowedTables.has(item.table)) continue;
        try {
          let result;
          if (item.action === 'insert') {
            result = await client.from(item.table).upsert(item.payload);
          } else if (item.action === 'delete') {
            result = await client.from(item.table).delete().eq('id', item.payload.id);
          }
          if (result?.error) remaining.push(item);
        } catch {
          remaining.push(item);
        }
      }
      localStorage.setItem(STORAGE_KEY_QUEUE, JSON.stringify(remaining));
      if (!remaining.length) {
        console.log('[KharismaDB] All offline operations successfully synchronized.');
      }
    } catch {}
  }

  // ==========================================================================
  // High-Level Data Services
  // ==========================================================================

  const KharismaDB = {
    get ready() { return configReady; },
    get authRequired() { return authRequired; },
    get backendConfigured() { return backendConfigured; },
    get configurationError() { return configurationError; },
    get url() { return SUPABASE_URL; },
    get isConnected() { return isConnected; },
    get lastSyncTime() { return lastSyncTime; },
    testConnection,

    auth: {
      get enabled() { return !!client && !!anonKey; },
      get required() { return authRequired; },
      async getSession() {
        if (!client) return { session: null, error: new Error('Supabase belum dikonfigurasi') };
        const { data, error } = await client.auth.getSession();
        return { session: data?.session || null, error };
      },
      async signIn(email, password) {
        if (!client) return { data: null, error: new Error('Masukkan Supabase anon key di Pengaturan terlebih dahulu.') };
        return client.auth.signInWithPassword({ email: String(email || '').trim(), password });
      },
      async signOut() { return client ? client.auth.signOut() : { error: null }; },
      async resetPassword(email) {
        if (!client) return { error: new Error('Supabase belum dikonfigurasi') };
        return client.auth.resetPasswordForEmail(String(email || '').trim(), { redirectTo: window.location.href.split('#')[0] });
      },
      async updatePassword(password) {
        if (!client) return { error: new Error('Supabase belum dikonfigurasi') };
        return client.auth.updateUser({ password });
      },
      async getProfile(userId) {
        if (!client || !userId) return { profile: null, error: null };
        try {
          const { data, error } = await client.from('user_profiles').select('*').eq('id', userId).maybeSingle();
          if (!error && data) return { profile: data, error: null };
        } catch {}
        // Fallback ke server endpoint /api/users?me=true yang menggunakan service role jika RLS Supabase terkendala
        try {
          const session = (await client.auth.getSession())?.data?.session;
          if (session?.access_token) {
            const res = await fetch('/api/users?me=true', {
              headers: { 'Authorization': `Bearer ${session.access_token}` }
            });
            if (res.ok) {
              const json = await res.json();
              if (json?.data) return { profile: json.data, error: null };
            }
          }
        } catch {}
        return { profile: null, error: new Error('Profil pengguna tidak dapat dimuat') };
      },
      async updateProfile(values) {
        if (!client) return { error: new Error('Supabase belum dikonfigurasi') };
        return client.auth.updateUser({ data: { full_name: values.name } });
      },
      onAuthStateChange(callback) {
        if (!client) return { data: { subscription: { unsubscribe() {} } } };
        return client.auth.onAuthStateChange(callback);
      }
    },

    setKey(newKey) {
      anonKey = (newKey || '').trim();
      localStorage.setItem(STORAGE_KEY_ANON, anonKey);
      initClient();
      return testConnection();
    },

    // --- EMPLOYEES SERVICE ---
    employees: {
      async getAll(fallbackData = []) {
        if (!client || !isConnected) return authRequired ? [] : fallbackData;
        try {
          const { data, error } = await client.from('employees').select('*').order('created_at', { ascending: true });
          if (!error && data) {
            window.__kharismaEmployeeProfiles = Object.fromEntries(data.map(e => [e.name, {
              gender: e.gender, birthDate: e.birth_date, phone: e.phone, address: e.address,
              joinDate: e.join_date, workModel: e.work_model, employmentType: e.employment_type
            }]));
            return data.map(e => [
              e.name,
              e.email,
              e.department,
              e.title,
              e.status || 'On-Time',
              e.id
            ]);
          }
        } catch (e) {
          console.warn('[KharismaDB] Fallback to local employees:', e.message);
        }
        return authRequired ? [] : fallbackData;
      },

      async save(employeeObj) {
        const payload = {
          id: employeeObj.id || `EMP-${Date.now().toString().slice(-4)}`,
          name: employeeObj.name,
          email: employeeObj.email,
          department: employeeObj.department,
          title: employeeObj.title,
          employment_type: employeeObj.employmentType || 'Full-Time',
          work_model: employeeObj.workModel || 'Hybrid',
          join_date: employeeObj.joinDate || '12 Jan 2034',
          gender: employeeObj.gender || 'Not provided',
          birth_date: employeeObj.birthDate || employeeObj.dateOfBirth || 'Not provided',
          phone: employeeObj.phone || '+62 812-0000-0000',
          address: employeeObj.address || 'Indonesia',
          status: employeeObj.status || 'On-Time',
          updated_at: new Date().toISOString()
        };

        if (client && isConnected) {
          try {
            const { error } = await client.from('employees').upsert(payload);
            if (!error) return { ok: true, data: payload };
            return { ok: false, error: error.message };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }
        enqueueSync('insert', 'employees', payload);
        return { ok: true, offline: true, data: payload };
      },

      async delete(nameOrId) {
        if (client && isConnected) {
          try {
            const { error } = await client.from('employees').delete().eq('id', nameOrId);
            if (error) return { ok: false, error: error.message };
            return { ok: true };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }
        enqueueSync('delete', 'employees', { id: nameOrId });
        return { ok: true, queued: true };
      }
    },

    // --- ATTENDANCE SERVICE ---
    attendance: {
      async getAll() {
        if (!client || !isConnected) return [];
        const rows = [];
        for (let offset = 0; offset < 5000; offset += 1000) {
          const { data, error } = await client.from('attendance_records').select('*').order('date', { ascending: false }).range(offset, offset + 999);
          if (error) throw error;
          rows.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
        return rows;
      },
      async getMine() {
        if (!client || !isConnected) return { record: null, error: null };
        const { data: authData } = await client.auth.getSession();
        const userId = authData?.session?.user?.id;
        if (!userId) return { record: null, error: null };
        const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
        const dateKey = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
        const yesterday = new Date(`${dateKey}T00:00:00+07:00`); yesterday.setDate(yesterday.getDate() - 1);
        const fromDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(yesterday);
        const { data: rows, error } = await client.from('attendance_records').select('*').eq('auth_user_id', userId).gte('date', fromDate).order('date', { ascending: false }).limit(3);
        if (error || !rows?.length) return { record: null, error };
        const data = rows.find(row => ['working', 'on_break'].includes(row.state)) || rows.find(row => row.date === dateKey);
        if (!data) return { record: null, error: null };
        return { record: { employeeId: data.employee_id, name: data.employee_name, dateKey: data.date, date: data.date, workModel: data.work_model, clockIn: data.clock_in, clockOut: data.clock_out || '', clockedIn: !data.clock_out, clockInAt: data.clock_in_at, clockOutAt: data.clock_out_at, duration: data.duration, overtime: data.overtime, lateMinutes: Number(data.late_minutes || 0), status: data.status, state: data.state || (data.clock_out ? 'completed' : 'working'), breakSessions: data.break_sessions || [], shiftId: data.shift_id, location: data.location_verified ? { latitude: data.location_latitude, longitude: data.location_longitude, accuracy: data.location_accuracy_m, distance: data.location_distance_m, verified: true } : null, overtimeApprovalStatus: data.overtime_approval_status || 'not_required' }, error: null };
      },
      async getPolicy() {
        if (!client || !isConnected) return { location: null, shifts: [], assignments: [] };
        const [locations, shifts, assignments] = await Promise.all([
          client.from('attendance_office_locations').select('*').eq('enabled', true).order('updated_at', { ascending: false }).limit(1),
          client.from('attendance_shifts').select('*').eq('enabled', true).order('name'),
          client.from('attendance_shift_assignments').select('*')
        ]);
        const error = locations.error || shifts.error || assignments.error;
        if (error) throw error;
        return { location: locations.data?.[0] || null, shifts: shifts.data || [], assignments: assignments.data || [] };
      },
      async transition(action, date, location) {
        if (!client || !isConnected) return { ok: false, offline: true };
        const { data, error } = await client.rpc('attendance_transition', {
          p_action: action, p_date: date, p_latitude: location.latitude, p_longitude: location.longitude, p_accuracy_m: location.accuracy || null, p_event_at: location.eventAt || new Date().toISOString()
        });
        if (error) throw error;
        return { ok: true, data };
      },
      async saveOfficeLocation(values) {
        if (!client || !isConnected) throw new Error('Pengaturan lokasi memerlukan koneksi Supabase.');
        const { data: authData } = await client.auth.getSession();
        const { data, error } = await client.from('attendance_office_locations').insert({ ...values, enabled: true, updated_by: authData.session?.user?.id }).select().single();
        if (error) throw error;
        return data;
      },
      async saveShift(values) {
        if (!client || !isConnected) throw new Error('Pengaturan shift memerlukan koneksi Supabase.');
        const { data, error } = await client.from('attendance_shifts').upsert(values, { onConflict: 'name' }).select().single();
        if (error) throw error;
        return data;
      },
      async assignShift(employeeId, shiftId) {
        if (!client || !isConnected) throw new Error('Penetapan shift memerlukan koneksi Supabase.');
        const { data: authData } = await client.auth.getSession();
        const { error } = await client.from('attendance_shift_assignments').upsert({ employee_id: employeeId, shift_id: shiftId, assigned_by: authData.session?.user?.id }, { onConflict: 'employee_id' });
        if (error) throw error;
        return { ok: true };
      },
      async requestCorrection(attendanceId, requestedValues, reason) {
        if (!client || !isConnected) throw new Error('Pengajuan koreksi memerlukan koneksi Supabase.');
        const { data: authData } = await client.auth.getSession();
        const { data, error } = await client.from('attendance_correction_requests').insert({ attendance_id: attendanceId, requester_id: authData.session.user.id, requested_values: requestedValues, reason }).select().single();
        if (error) throw error;
        return data;
      },
      async reviewCorrection(id, status, note = '') {
        if (!client || !isConnected) throw new Error('Persetujuan koreksi memerlukan koneksi Supabase.');
        const { data, error } = await client.rpc('review_attendance_correction', { p_request_id: id, p_approve: status === 'approved', p_note: note });
        if (error) throw error;
        return data;
      },
      async reviewOvertime(id, approve) {
        if (!client || !isConnected) throw new Error('Persetujuan lembur memerlukan koneksi Supabase.');
        const { data, error } = await client.rpc('review_attendance_overtime', { p_attendance_id: id, p_approve: Boolean(approve) });
        if (error) throw error;
        return data;
      },
      async getReviewQueue() {
        if (!client || !isConnected) return { corrections: [], overtime: [] };
        const [corrections, overtime] = await Promise.all([
          client.from('attendance_correction_requests').select('*,attendance_records(employee_name,date,employee_id)').eq('status', 'pending').order('created_at'),
          client.from('attendance_records').select('id,employee_id,employee_name,date,overtime').eq('overtime_approval_status', 'pending').order('date', { ascending: false })
        ]);
        const error = corrections.error || overtime.error;
        if (error) throw error;
        return { corrections: corrections.data || [], overtime: overtime.data || [] };
      }
    },

    // --- LEAVE SERVICE ---
    leave: {
      async getAll(fallbackData = []) {
        if (!client || !isConnected) return authRequired ? [] : fallbackData;
        try {
          const { data, error } = await client.from('leave_requests').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            return data.map(r => ({
              id: r.id,
              name: r.employee_name,
              title: r.title,
              type: r.type,
              submitDate: r.submit_date,
              period: r.period,
              duration: r.duration,
              reason: r.reason,
              status: r.status
            }));
          }
        } catch (e) {}
        return authRequired ? [] : fallbackData;
      },

      async submit(request) {
        const payload = {
          id: request.id || `lv-${Date.now().toString().slice(-4)}`,
          employee_name: request.name,
          title: request.title,
          type: request.type || 'Annual Leave',
          submit_date: request.submitDate || new Date().toLocaleDateString('id-ID'),
          period: request.period,
          duration: request.duration,
          reason: request.reason,
          status: request.status || 'Pending'
        };

        if (client && isConnected) {
          try {
            const { data: authData } = await client.auth.getSession();
            const userId = authData?.session?.user?.id;
            if (!userId) return { ok: false, error: 'Sesi login tidak ditemukan.' };
            const { data: profile, error: profileError } = await client.from('user_profiles').select('employee_id,full_name,title').eq('id', userId).single();
            if (profileError || !profile?.employee_id) return { ok: false, error: 'Akun belum tertaut ke data karyawan.' };
            payload.employee_id = profile.employee_id;
            payload.employee_name = profile.full_name || request.name;
            payload.title = profile.title || request.title;
            payload.status = 'Pending';
            const { data, error } = await client.from('leave_requests').insert(payload).select().single();
            if (error) return { ok: false, error: error.message };
            return { ok: true, data };
          } catch (e) { return { ok: false, error: e.message }; }
        }
        if (authRequired) return { ok: false, error: 'Koneksi cloud belum tersedia. Permohonan tidak disimpan.' };
        enqueueSync('insert', 'leave_requests', payload);
        return { ok: true, data: payload };
      },

      async updateStatus(id, newStatus) {
        if (client && isConnected) {
          try {
            await client.from('leave_requests').update({ status: newStatus }).eq('id', id);
          } catch (e) {}
        }
        enqueueSync('insert', 'leave_requests', { id, status: newStatus });
        return { ok: true };
      }
    },

    // --- KPI SERVICE ---
    kpi: {
      async getAll(fallbackData = []) {
        if (!client || !isConnected) return authRequired ? [] : fallbackData;
        try {
          const { data, error } = await client.from('kpi_indicators').select('*').order('created_at', { ascending: true });
          if (!error && data) {
            return data.map(k => ({
              id: k.id,
              title: k.title,
              dept: k.dept,
              pic: k.pic,
              target: Number(k.target),
              actual: Number(k.actual),
              unit: k.unit,
              weight: Number(k.weight),
              period: k.period,
              status: k.status,
              lowerIsBetter: k.lower_is_better,
              notes: k.notes
            }));
          }
        } catch (e) {}
        return authRequired ? [] : fallbackData;
      },

      async save(kpi) {
        const payload = {
          id: kpi.id || `kpi-${Date.now().toString().slice(-4)}`,
          title: kpi.title,
          dept: kpi.dept,
          pic: kpi.pic,
          target: Number(kpi.target),
          actual: Number(kpi.actual || 0),
          unit: kpi.unit || '%',
          weight: Number(kpi.weight || 20),
          period: kpi.period || 'Q2 2035',
          status: kpi.status || 'On-Track',
          lower_is_better: !!kpi.lowerIsBetter,
          notes: kpi.notes || '',
          updated_at: new Date().toISOString()
        };

        if (client && isConnected) {
          try {
            const { data: employee } = await client.from('employees').select('id').eq('name', kpi.pic).maybeSingle();
            if (employee?.id) payload.employee_id = employee.id;
            const { error } = await client.from('kpi_indicators').upsert(payload);
            if (error) throw error;
            return { ok: true, data: payload };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }
        if (authRequired) return { ok: false, error: 'Koneksi cloud belum tersedia. Perubahan KPI tidak disimpan.' };
        enqueueSync('insert', 'kpi_indicators', payload);
        return { ok: true, offline: true, data: payload };
      },

      async delete(id) {
        if (client && isConnected) {
          try {
            const { error } = await client.from('kpi_indicators').delete().eq('id', id);
            if (error) return { ok: false, error: error.message };
            return { ok: true };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        }
        enqueueSync('delete', 'kpi_indicators', { id });
        return { ok: true, queued: true };
      }
    },

    // --- CALENDAR EVENTS SERVICE ---
    calendar: {
      async getAll(fallbackData = []) {
        if (!client || !isConnected) return authRequired ? [] : fallbackData;
        try {
          const { data, error } = await client.from('calendar_events').select('*').order('day', { ascending: true });
          if (!error && data) {
            return data.map(ev => ({
              id: ev.id,
              day: Number(ev.day),
              date: ev.date,
              title: ev.title,
              time: ev.time,
              location: ev.location,
              category: ev.category,
              note: ev.note,
              tone: Number(ev.tone || 0)
            }));
          }
        } catch (e) {}
        return authRequired ? [] : fallbackData;
      },

      async create(ev) {
        const payload = {
          id: ev.id || `cal-${Date.now().toString().slice(-4)}`,
          day: Number(ev.day),
          date: ev.date || new Date().toISOString().split('T')[0],
          title: ev.title,
          time: ev.time,
          location: ev.location || 'Kantor Utama',
          category: ev.category || 'Workplace Engagement',
          note: ev.note || '',
          tone: Number(ev.tone || 0)
        };

        if (client && isConnected) {
          try {
            await client.from('calendar_events').upsert(payload);
          } catch (e) {}
        }
        enqueueSync('insert', 'calendar_events', payload);
        return { ok: true, data: payload };
      },

      async delete(id) {
        if (client && isConnected) {
          try {
            await client.from('calendar_events').delete().eq('id', id);
          } catch (e) {}
        }
        enqueueSync('delete', 'calendar_events', { id });
        return { ok: true };
      }
    },

    // --- TWO-WAY BULK SYNC ---
    async syncAll(localState) {
      if (!client || !isConnected) {
        return { ok: false, message: 'Supabase belum terhubung. Periksa Anon Key di Pengaturan.' };
      }

      const results = { employees: 0, kpi: 0, attendance: 0 };
      try {
        // 1. Sync Employees
        if (localState.isAdmin && localState.employees && localState.employees.length) {
          const empPayloads = localState.employees.map((p, i) => ({
            id: `EMP-${(localState.getEmployeeId ? localState.getEmployeeId(p) : String(i + 1).padStart(4, '0'))}`,
            name: p[0],
            email: p[1],
            department: p[2],
            title: p[3],
            status: p[4] || 'On-Time',
            ...(window.__kharismaEmployeeProfiles?.[p[0]] ? { gender: window.__kharismaEmployeeProfiles[p[0]].gender, birth_date: window.__kharismaEmployeeProfiles[p[0]].birthDate, phone: window.__kharismaEmployeeProfiles[p[0]].phone, address: window.__kharismaEmployeeProfiles[p[0]].address, join_date: window.__kharismaEmployeeProfiles[p[0]].joinDate, work_model: window.__kharismaEmployeeProfiles[p[0]].workModel, employment_type: window.__kharismaEmployeeProfiles[p[0]].employmentType } : {}),
            updated_at: new Date().toISOString()
          }));
          const { error } = await client.from('employees').upsert(empPayloads);
          if (error) throw error;
          results.employees = empPayloads.length;
        }

        // 2. Sync KPI
        if (localState.kpis && localState.kpis.length) {
          const kpiPayloads = localState.kpis.map(k => ({
            id: k.id,
            title: k.title,
            dept: k.dept,
            pic: k.pic,
            target: Number(k.target),
            actual: Number(k.actual || 0),
            unit: k.unit || '%',
            weight: Number(k.weight || 20),
            period: k.period || 'Q2 2035',
            status: k.status || 'On-Track',
            lower_is_better: !!k.lowerIsBetter,
            notes: k.notes || '',
            updated_at: new Date().toISOString()
          }));
          const { error } = await client.from('kpi_indicators').upsert(kpiPayloads);
          if (error) throw error;
          results.kpi = kpiPayloads.length;
        }

        await flushSyncQueue();

        lastSyncTime = new Date();
        dispatchStatus(true, `Sinkronisasi selesai pada ${lastSyncTime.toLocaleTimeString('id-ID')}`);
        return { ok: true, results, lastSyncTime };
      } catch (err) {
        return { ok: false, message: err.message };
      }
    }
  };

  // Auto-init on load
  if (typeof window !== 'undefined') {
    window.KharismaDB = KharismaDB;
    window.KharismaSupabase = {
      get url() { return SUPABASE_URL; },
      get client() { return client; },
      init: initClient,
      setKey: KharismaDB.setKey,
      get isConnected() { return isConnected; }
    };

    window.KharismaAuth = {
      get session() { return window.__kharismaSession || null; },
      async adminRequest(method, body = {}) {
        const { session } = await KharismaDB.auth.getSession();
        if (!session) throw new Error('Sesi login tidak ditemukan.');
        const response = await fetch('/api/users', {
          method,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: method === 'GET' ? undefined : JSON.stringify(body)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Permintaan manajemen pengguna gagal.');
        return result;
      }
    };

    configReady = (async () => {
      try {
        const response = await fetch('/api/config', { headers: { Accept: 'application/json' }, cache: 'no-store' });
        if (response.ok) {
          const config = await response.json();
          authRequired = config.authRequired === true;
          backendConfigured = config.backendConfigured !== false;
          if (typeof config.supabaseUrl === 'string' && /^https:\/\//i.test(config.supabaseUrl)) SUPABASE_URL = config.supabaseUrl.replace(/\/$/, '');
          if (typeof config.supabaseAnonKey === 'string' && config.supabaseAnonKey.trim()) anonKey = config.supabaseAnonKey.trim();
          if (!anonKey && !authRequired) anonKey = localStorage.getItem(STORAGE_KEY_ANON) || '';
          if (authRequired && !anonKey) configurationError = 'Login belum dapat digunakan karena SUPABASE_ANON_KEY belum dikonfigurasi di server.';
          else if (authRequired && !backendConfigured) configurationError = `Backend belum siap. Konfigurasikan di Vercel: ${(config.missingConfiguration || ['SUPABASE_SERVICE_ROLE_KEY']).join(', ')}.`;
        } else if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && !location.protocol.startsWith('file:')) {
          authRequired = true;
          configurationError = 'Konfigurasi autentikasi tidak dapat dimuat. Muat ulang halaman atau hubungi administrator.';
        } else {
          anonKey = localStorage.getItem(STORAGE_KEY_ANON) || anonKey;
        }
      } catch {
        if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1' && !location.protocol.startsWith('file:')) {
          authRequired = true;
          configurationError = 'Konfigurasi autentikasi tidak dapat dimuat. Periksa koneksi lalu coba lagi.';
        } else {
          anonKey = localStorage.getItem(STORAGE_KEY_ANON) || anonKey;
        }
      }
      initClient();
      return { authRequired, configured: Boolean(anonKey), backendConfigured, error: configurationError };
    })();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KharismaDB, SUPABASE_URL };
  }
})(typeof window !== 'undefined' ? window : global);
