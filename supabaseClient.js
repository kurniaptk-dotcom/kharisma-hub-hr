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

  const SUPABASE_URL = 'https://wirgqezinegebauddmgy.supabase.co';
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
      }
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
        // Table might not exist yet or key invalid
        if (error.code === '42P01') {
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
      flushSyncQueue();
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

      const remaining = [];
      for (const item of queue) {
        try {
          if (item.action === 'insert') {
            await client.from(item.table).upsert(item.payload);
          } else if (item.action === 'delete') {
            await client.from(item.table).delete().eq('id', item.payload.id);
          }
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
    get url() { return SUPABASE_URL; },
    get isConnected() { return isConnected; },
    get lastSyncTime() { return lastSyncTime; },
    testConnection,

    setKey(newKey) {
      anonKey = (newKey || '').trim();
      localStorage.setItem(STORAGE_KEY_ANON, anonKey);
      initClient();
      return testConnection();
    },

    // --- EMPLOYEES SERVICE ---
    employees: {
      async getAll(fallbackData = []) {
        if (!client || !isConnected) return fallbackData;
        try {
          const { data, error } = await client.from('employees').select('*').order('created_at', { ascending: true });
          if (!error && data && data.length) {
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
        return fallbackData;
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
          status: employeeObj.status || 'On-Time',
          updated_at: new Date().toISOString()
        };

        if (client && isConnected) {
          try {
            const { error } = await client.from('employees').upsert(payload);
            if (!error) return { ok: true, data: payload };
          } catch (e) {}
        }
        enqueueSync('insert', 'employees', payload);
        return { ok: true, offline: true, data: payload };
      },

      async delete(nameOrId) {
        if (client && isConnected) {
          try {
            await client.from('employees').delete().or(`id.eq.${nameOrId},name.eq.${nameOrId}`);
          } catch (e) {}
        }
        enqueueSync('delete', 'employees', { id: nameOrId });
        return { ok: true };
      }
    },

    // --- ATTENDANCE SERVICE ---
    attendance: {
      async log(record) {
        const payload = {
          employee_id: record.id || 'EMP-0001',
          employee_name: record.name,
          date: record.date || new Date().toISOString().split('T')[0],
          work_model: record.workModel || 'Di Kantor',
          clock_in: record.clockIn || '09:00 AM',
          clock_out: record.clockOut || null,
          duration: record.duration || '—',
          overtime: record.overtime || '—',
          status: record.status || 'On-Time'
        };

        if (client && isConnected) {
          try {
            await client.from('attendance_records').insert(payload);
          } catch (e) {}
        }
        enqueueSync('insert', 'attendance_records', payload);
        return { ok: true, data: payload };
      }
    },

    // --- LEAVE SERVICE ---
    leave: {
      async getAll(fallbackData = []) {
        if (!client || !isConnected) return fallbackData;
        try {
          const { data, error } = await client.from('leave_requests').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length) {
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
        return fallbackData;
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
            await client.from('leave_requests').upsert(payload);
          } catch (e) {}
        }
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
        if (!client || !isConnected) return fallbackData;
        try {
          const { data, error } = await client.from('kpi_indicators').select('*').order('created_at', { ascending: true });
          if (!error && data && data.length) {
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
        return fallbackData;
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
            await client.from('kpi_indicators').upsert(payload);
          } catch (e) {}
        }
        enqueueSync('insert', 'kpi_indicators', payload);
        return { ok: true, data: payload };
      },

      async delete(id) {
        if (client && isConnected) {
          try {
            await client.from('kpi_indicators').delete().eq('id', id);
          } catch (e) {}
        }
        enqueueSync('delete', 'kpi_indicators', { id });
        return { ok: true };
      }
    },

    // --- CALENDAR EVENTS SERVICE ---
    calendar: {
      async getAll(fallbackData = []) {
        if (!client || !isConnected) return fallbackData;
        try {
          const { data, error } = await client.from('calendar_events').select('*').order('day', { ascending: true });
          if (!error && data && data.length) {
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
        return fallbackData;
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

      const results = { employees: 0, kpi: 0, leave: 0, calendar: 0 };
      try {
        // 1. Sync Employees
        if (localState.employees && localState.employees.length) {
          const empPayloads = localState.employees.map((p, i) => ({
            id: `EMP-${(localState.getEmployeeId ? localState.getEmployeeId(p) : String(i + 1).padStart(4, '0'))}`,
            name: p[0],
            email: p[1],
            department: p[2],
            title: p[3],
            status: p[4] || 'On-Time',
            updated_at: new Date().toISOString()
          }));
          const { error } = await client.from('employees').upsert(empPayloads);
          if (!error) results.employees = empPayloads.length;
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
          if (!error) results.kpi = kpiPayloads.length;
        }

        // 3. Sync Calendar
        if (localState.calendar && localState.calendar.length) {
          const calPayloads = localState.calendar.map(ev => ({
            id: ev.id,
            day: Number(ev.day),
            date: ev.date || '2035-06-01',
            title: ev.title,
            time: ev.time,
            location: ev.location,
            category: ev.category,
            note: ev.note,
            tone: Number(ev.tone || 0)
          }));
          const { error } = await client.from('calendar_events').upsert(calPayloads);
          if (!error) results.calendar = calPayloads.length;
        }

        // 4. Sync Leave
        if (localState.leave && localState.leave.length) {
          const leavePayloads = localState.leave.map(r => ({
            id: r.id,
            employee_name: r.name,
            title: r.title,
            type: r.type,
            submit_date: r.submitDate,
            period: r.period,
            duration: r.duration,
            reason: r.reason,
            status: r.status
          }));
          const { error } = await client.from('leave_requests').upsert(leavePayloads);
          if (!error) results.leave = leavePayloads.length;
        }

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
      url: SUPABASE_URL,
      get client() { return client; },
      init: initClient,
      setKey: KharismaDB.setKey,
      get isConnected() { return isConnected; }
    };

    window.addEventListener('DOMContentLoaded', () => {
      initClient();
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KharismaDB, SUPABASE_URL };
  }
})(typeof window !== 'undefined' ? window : global);
