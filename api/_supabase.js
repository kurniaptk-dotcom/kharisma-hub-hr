// Kharisma Hub HR Management — Serverless Supabase & Fallback Data Helper
export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wirgqezinegebauddmgy.supabase.co';
export const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const defaultData = {
  employees: [
    { id: 'EMP-0234', name: 'Olivia Mason', email: 'olivia.mason@kharismahub.com', department: 'Marketing', title: 'Executive Marketing', status: 'On-Time', work_model: 'Hybrid' },
    { id: 'EMP-0178', name: 'Ethan Ray', email: 'ethan.ray@kharismahub.com', department: 'Product Design', title: 'UI Designer', status: 'Late', work_model: 'Remote' },
    { id: 'EMP-0312', name: 'Lina Armand', email: 'lina.armand@kharismahub.com', department: 'R&D', title: 'Lab Analyst', status: 'On Leave', work_model: 'On-Site' },
    { id: 'EMP-0115', name: 'Jacob Yuen', email: 'jacob.yuen@kharismahub.com', department: 'Operations', title: 'Site Supervisor', status: 'Absent', work_model: 'On-Site' },
    { id: 'EMP-0289', name: 'Mia Torres', email: 'mia.torres@kharismahub.com', department: 'Human Resources', title: 'HR Officer', status: 'On-Time', work_model: 'Hybrid' },
    { id: 'EMP-0356', name: 'Sara Kim', email: 'sara.kim@kharismahub.com', department: 'Customer Service', title: 'Customer Support Intern', status: 'Late', work_model: 'On-Site' },
    { id: 'EMP-0291', name: 'Daniel Cheung', email: 'daniel.cheung@kharismahub.com', department: 'Operations', title: 'Compliance Specialist', status: 'On-Time', work_model: 'Remote' },
    { id: 'EMP-0275', name: 'Anya Rodriguez', email: 'anya.rodriguez@kharismahub.com', department: 'Marketing', title: 'Graphic Designer', status: 'Late', work_model: 'Remote' },
    { id: 'EMP-0159', name: 'Kelvin Yu', email: 'kelvin.yu@kharismahub.com', department: 'Human Resources', title: 'Training Coordinator', status: 'On-Time', work_model: 'On-Site' },
    { id: 'EMP-0320', name: 'Farah Nabila', email: 'farah.nabila@kharismahub.com', department: 'Customer Service', title: 'Customer Experience Lead', status: 'On-Time', work_model: 'Hybrid' },
    { id: 'EMP-0362', name: 'Juno Park', email: 'juno.park@kharismahub.com', department: 'Product Design', title: 'UX Researcher', status: 'On-Time', work_model: 'Hybrid' },
    { id: 'EMP-0265', name: 'Hana Putri', email: 'hana.putri@kharismahub.com', department: 'Human Resources', title: 'Recruitment Assistant', status: 'On-Time', work_model: 'On-Site' }
  ],
  leave: [
    { id: 'lv-1', employee_name: 'Lina Armand', title: 'Lab Analyst', type: 'Sick Leave', submit_date: '18 Jun 2035', period: '20–22 Jun 2035', duration: '3 Days', reason: 'Doctor’s note attached', status: 'Approved' },
    { id: 'lv-2', employee_name: 'Jacob Yuen', title: 'Site Supervisor', type: 'Annual Leave', submit_date: '10 Jun 2035', period: '17–21 Jun 2035', duration: '5 Days', reason: 'Family trip', status: 'Approved' },
    { id: 'lv-3', employee_name: 'Anya Rodriguez', title: 'Graphic Designer', type: 'Other Leave', submit_date: '17 Jun 2035', period: '19 Jun 2035', duration: '1 Day', reason: 'Personal matter', status: 'Pending' }
  ],
  kpi: [
    { id: 'kpi-1', title: 'Customer Satisfaction Score (CSAT)', dept: 'Customer Service', pic: 'Olivia Mason', target: 90, actual: 95.2, unit: '%', weight: 25, status: 'Exceeded' },
    { id: 'kpi-2', title: 'Design System Component Coverage', dept: 'Product Design', pic: 'Ethan Ray', target: 85, actual: 92.4, unit: '%', weight: 30, status: 'Exceeded' },
    { id: 'kpi-3', title: 'Employee Retention Rate', dept: 'Human Resources', pic: 'Mia Torres', target: 95, actual: 96.8, unit: '%', weight: 35, status: 'Exceeded' }
  ],
  calendar: [
    { id: 'cal-1', day: 4, date: '2035-06-04', title: 'Company Town Hall & Q2 Review', time: '09:00 - 10:30 WIB', location: 'Auditorium Utama & Zoom', category: 'General', tone: 0 },
    { id: 'cal-2', day: 11, date: '2035-06-11', title: 'HR Alignment & Sprint Retro', time: '14:00 - 15:30 WIB', location: 'Meeting Room A', category: 'Human Resources', tone: 1 },
    { id: 'cal-3', day: 19, date: '2035-06-19', title: 'Design Review & KPI Review', time: '10:00 - 12:00 WIB', location: 'Design Studio Lab', category: 'Product Design', tone: 2 }
  ]
};

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

export async function querySupabase(endpoint, options = {}) {
  if (!SUPABASE_KEY) {
    return { ok: false, error: 'NO_KEY' };
  }
  try {
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers
    };
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      const errText = await response.text();
      return { ok: false, error: errText, status: response.status };
    }
    const data = await response.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
