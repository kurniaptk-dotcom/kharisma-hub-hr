-- ============================================================================
-- Kharisma Hub HR Management — Database Schema & Initial Migration
-- Target Project: https://wirgqezinegebauddmgy.supabase.co
-- Compatible with PostgreSQL 15+ & Supabase
-- ============================================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================================
-- 1. EMPLOYEES TABLE
-- ============================================================================
create table if not exists public.employees (
  id text primary key, -- e.g. 'EMP-0234'
  name text not null,
  email text unique not null,
  department text not null,
  title text not null,
  employment_type text default 'Full-Time', -- 'Full-Time', 'Part-Time', 'Internship', 'Freelance'
  work_model text default 'Hybrid', -- 'Hybrid', 'Remote', 'On-Site'
  join_date text default '12 Jan 2034',
  status text default 'On-Time', -- 'On-Time', 'Late', 'On Leave', 'Absent'
  gender text default 'Not provided',
  birth_date text default 'Not provided',
  phone text default '+62 812-0000-0000',
  address text default 'Indonesia',
  avatar_idx integer default 1,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 2. ATTENDANCE RECORDS TABLE
-- ============================================================================
create table if not exists public.attendance_records (
  id uuid default uuid_generate_v4() primary key,
  employee_id text not null,
  employee_name text not null,
  date text not null, -- formatted date string or ISO
  work_model text default 'Di Kantor',
  clock_in text not null,
  clock_out text,
  duration text default '—',
  overtime text default '—',
  status text default 'On-Time',
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 3. LEAVE REQUESTS TABLE
-- ============================================================================
create table if not exists public.leave_requests (
  id text primary key, -- e.g. 'lv-1'
  employee_name text not null,
  title text not null,
  type text default 'Annual Leave', -- 'Annual Leave', 'Sick Leave', 'Casual Leave', 'Other Leave'
  submit_date text not null,
  period text not null,
  duration text not null,
  reason text,
  status text default 'Pending', -- 'Approved', 'Pending', 'Rejected'
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 4. KPI INDICATORS TABLE
-- ============================================================================
create table if not exists public.kpi_indicators (
  id text primary key, -- e.g. 'kpi-1'
  title text not null,
  dept text not null,
  pic text not null,
  period text default 'Q2 2035',
  weight integer default 20,
  target numeric not null,
  actual numeric default 0,
  unit text default '%',
  lower_is_better boolean default false,
  status text default 'On-Track', -- 'Exceeded', 'On-Track', 'At Risk'
  notes text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 5. CALENDAR EVENTS TABLE
-- ============================================================================
create table if not exists public.calendar_events (
  id text primary key, -- e.g. 'cal-1'
  day integer not null,
  date text not null,
  title text not null,
  time text not null,
  location text default 'Kantor Utama',
  category text default 'Workplace Engagement', -- 'Talent Acquisition', 'Employee Development', 'Workplace Engagement'
  note text,
  tone integer default 0,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 6. DEPARTMENTS TABLE
-- ============================================================================
create table if not exists public.departments (
  id text primary key, -- e.g. 'dept-1'
  name text unique not null,
  code text not null,
  head text not null,
  budget text default 'Rp 0',
  description text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 7. APPLICANTS TABLE (RECRUITMENT)
-- ============================================================================
create table if not exists public.applicants (
  id text primary key, -- e.g. 'app-1'
  name text not null,
  email text not null,
  position text not null,
  applied_date text not null,
  type text default 'Full-Time Hybrid',
  stage text default 'Application Received', -- 'Application Received', 'Interview Scheduled', 'Test Completed', 'Final Interview'
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 8. SYSTEM SETTINGS TABLE
-- ============================================================================
create table if not exists public.system_settings (
  id text primary key default 'current_settings',
  company_name text default 'PT Kharisma Group Indonesia',
  currency text default 'IDR',
  timezone text default 'WIB',
  work_start text default '09:00',
  work_end text default '17:00',
  late_tolerance integer default 15,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
alter table public.employees enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_requests enable row level security;
alter table public.kpi_indicators enable row level security;
alter table public.calendar_events enable row level security;
alter table public.departments enable row level security;
alter table public.applicants enable row level security;
alter table public.system_settings enable row level security;

-- Allow anonymous / authenticated read and write for web app usage
create policy "Allow all read on employees" on public.employees for select using (true);
create policy "Allow all write on employees" on public.employees for all using (true) with check (true);

create policy "Allow all read on attendance" on public.attendance_records for select using (true);
create policy "Allow all write on attendance" on public.attendance_records for all using (true) with check (true);

create policy "Allow all read on leave" on public.leave_requests for select using (true);
create policy "Allow all write on leave" on public.leave_requests for all using (true) with check (true);

create policy "Allow all read on kpi" on public.kpi_indicators for select using (true);
create policy "Allow all write on kpi" on public.kpi_indicators for all using (true) with check (true);

create policy "Allow all read on calendar" on public.calendar_events for select using (true);
create policy "Allow all write on calendar" on public.calendar_events for all using (true) with check (true);

create policy "Allow all read on departments" on public.departments for select using (true);
create policy "Allow all write on departments" on public.departments for all using (true) with check (true);

create policy "Allow all read on applicants" on public.applicants for select using (true);
create policy "Allow all write on applicants" on public.applicants for all using (true) with check (true);

create policy "Allow all read on settings" on public.system_settings for select using (true);
create policy "Allow all write on settings" on public.system_settings for all using (true) with check (true);

-- ============================================================================
-- SEED INITIAL DATA
-- ============================================================================

-- Departments
insert into public.departments (id, name, code, head, budget, description) values
  ('dept-1', 'Product Design', 'PD', 'Ethan Ray', 'Rp 45.000.000', 'Perancangan desain antarmuka, UX research, dan design system produk.'),
  ('dept-2', 'Marketing', 'MKT', 'Olivia Mason', 'Rp 65.000.000', 'Akuisisi pelanggan, kampanye digital, branding, dan lead generation B2B.'),
  ('dept-3', 'Operations', 'OPS', 'Jacob Yuen', 'Rp 50.000.000', 'Manajemen operasional harian, kepatuhan prosedur, dan ketepatan delivery.'),
  ('dept-4', 'Human Resources', 'HR', 'Mia Torres', 'Rp 40.000.000', 'Manajemen talenta, rekrutmen, retensi karyawan, dan budaya kerja tim.'),
  ('dept-5', 'Customer Service', 'CS', 'Farah Nabila', 'Rp 35.000.000', 'Penanganan tiket layanan pelanggan, kepuasan konsumen, dan respons cepat.'),
  ('dept-6', 'R&D', 'RND', 'Lina Armand', 'Rp 55.000.000', 'Riset dan inovasi teknologi, uji laboratorium, dan eksperimen prototipe.')
on conflict (id) do nothing;

-- Employees
insert into public.employees (id, name, email, department, title, employment_type, work_model, join_date, status, avatar_idx) values
  ('EMP-0234', 'Olivia Mason', 'olivia.mason@kharismahub.com', 'Marketing', 'Executive Marketing', 'Full-Time', 'Hybrid', '12 Jan 2034', 'On-Time', 1),
  ('EMP-0178', 'Ethan Ray', 'ethan.ray@kharismahub.com', 'Product Design', 'UI Designer', 'Full-Time', 'Remote', '03 Mar 2033', 'Late', 2),
  ('EMP-0312', 'Lina Armand', 'lina.armand@kharismahub.com', 'R&D', 'Lab Analyst', 'Part-Time', 'On-Site', '22 Jul 2034', 'On Leave', 3),
  ('EMP-0115', 'Jacob Yuen', 'jacob.yuen@kharismahub.com', 'Operations', 'Site Supervisor', 'Full-Time', 'On-Site', '05 Sep 2032', 'Absent', 4),
  ('EMP-0289', 'Mia Torres', 'mia.torres@kharismahub.com', 'Human Resources', 'HR Officer', 'Full-Time', 'Hybrid', '14 Feb 2033', 'On-Time', 5),
  ('EMP-0356', 'Sara Kim', 'sara.kim@kharismahub.com', 'Customer Service', 'Customer Support Intern', 'Internship', 'On-Site', '10 May 2035', 'Late', 6),
  ('EMP-0291', 'Daniel Cheung', 'daniel.cheung@kharismahub.com', 'Operations', 'Compliance Specialist', 'Full-Time', 'Remote', '19 Nov 2033', 'On-Time', 7),
  ('EMP-0275', 'Anya Rodriguez', 'anya.rodriguez@kharismahub.com', 'Marketing', 'Graphic Designer', 'Part-Time', 'Remote', '06 Apr 2035', 'Late', 8),
  ('EMP-0159', 'Kelvin Yu', 'kelvin.yu@kharismahub.com', 'Human Resources', 'Training Coordinator', 'Full-Time', 'On-Site', '27 Jun 2032', 'On-Time', 9),
  ('EMP-0320', 'Farah Nabila', 'farah.nabila@kharismahub.com', 'Customer Service', 'Customer Experience Lead', 'Full-Time', 'Hybrid', '08 Aug 2034', 'On-Time', 1),
  ('EMP-0362', 'Juno Park', 'juno.park@kharismahub.com', 'Product Design', 'UX Researcher', 'Full-Time', 'Hybrid', '15 Apr 2034', 'On-Time', 2),
  ('EMP-0265', 'Hana Putri', 'hana.putri@kharismahub.com', 'Human Resources', 'Recruitment Assistant', 'Internship', 'On-Site', '20 Feb 2035', 'On-Time', 3)
on conflict (id) do nothing;

-- KPI Indicators
insert into public.kpi_indicators (id, title, dept, pic, target, actual, unit, weight, period, status, notes) values
  ('kpi-1', 'Customer Satisfaction Score (CSAT)', 'Customer Service', 'Olivia Mason', 90, 95.2, '%', 25, 'Q2 2035', 'Exceeded', 'Survei kepuasan pelanggan mencapai rekor tertinggi kuartal ini.'),
  ('kpi-2', 'Design System Component Coverage', 'Product Design', 'Ethan Ray', 85, 92.4, '%', 30, 'Q2 2035', 'Exceeded', '45 komponen baru dipublikasikan ke Figma & Storybook.'),
  ('kpi-3', 'Employee Retention Rate', 'Human Resources', 'Mia Torres', 95, 96.8, '%', 35, 'Q2 2035', 'Exceeded', 'Turnover turun 2.4% dari bulan lalu dengan program engagement baru.'),
  ('kpi-4', 'Qualified B2B Leads Generated', 'Marketing', 'Daniel Cheung', 150, 142, 'Leads', 25, 'Q2 2035', 'On-Track', 'Pipeline lead dari webinar dan LinkedIn Ads berjalan konsisten.'),
  ('kpi-5', 'On-Time Project Delivery Rate', 'Operations', 'Jacob Yuen', 90, 88.5, '%', 30, 'Q2 2035', 'On-Track', '18 dari 20 sprint rilis tepat waktu sesuai SLA.'),
  ('kpi-6', 'R&D Prototype Lab Tests Completed', 'R&D', 'Lina Armand', 20, 16, 'Tests', 20, 'Q2 2035', 'At Risk', 'Terkendala pengiriman sampel material lab minggu lalu.'),
  ('kpi-7', 'First Response Resolution Time', 'Customer Service', 'Farah Nabila', 15, 11.5, 'Menit', 20, 'Q2 2035', 'Exceeded', 'Kecepatan respons tiket bantuan rata-rata di bawah 12 menit.'),
  ('kpi-8', 'Recruitment Time-to-Hire', 'Human Resources', 'Davis Levin', 25, 21, 'Hari', 25, 'Q2 2035', 'Exceeded', 'Waktu rata-rata rekrutmen dipangkas dengan sistem pipeline baru.'),
  ('kpi-9', 'Organic Search Traffic Growth', 'Marketing', 'Daniel Cheung', 30, 22.5, '%', 20, 'Q2 2035', 'At Risk', 'Perlu optimasi SEO lanjutan pada landing page produk.'),
  ('kpi-10', 'Operational Budget Variance Efficiency', 'Operations', 'Jacob Yuen', 5, 3.2, '%', 15, 'Q2 2035', 'On-Track', 'Realisasi anggaran berada di bawah toleransi 5%.')
on conflict (id) do nothing;

-- Leave Requests
insert into public.leave_requests (id, employee_name, title, type, submit_date, period, duration, reason, status) values
  ('lv-1', 'Lina Armand', 'Lab Analyst', 'Sick Leave', '18 Jun 2035', '20–22 Jun 2035', '3 Days', 'Doctor’s note attached', 'Approved'),
  ('lv-2', 'Jacob Yuen', 'Site Supervisor', 'Annual Leave', '10 Jun 2035', '17–21 Jun 2035', '5 Days', 'Family trip', 'Approved'),
  ('lv-3', 'Anya Rodriguez', 'Graphic Designer', 'Other Leave', '17 Jun 2035', '19 Jun 2035', '1 Day', 'Personal matter', 'Pending'),
  ('lv-4', 'Olivia Mason', 'Marketing', 'Annual Leave', '02 Jun 2035', '05–07 Jun 2035', '3 Days', 'Conference attendance', 'Approved'),
  ('lv-5', 'Sara Kim', 'Customer Support', 'Sick Leave', '14 Jun 2035', '15–16 Jun 2035', '2 Days', 'Fever', 'Approved'),
  ('lv-6', 'Daniel Cheung', 'Compliance Specialist', 'Annual Leave', '01 Jun 2035', '10–12 Jun 2035', '3 Days', 'Holiday', 'Pending'),
  ('lv-7', 'Mia Torres', 'HR Officer', 'Annual Leave', '06 Jun 2035', '09–10 Jun 2035', '2 Days', 'Personal retreat', 'Approved'),
  ('lv-8', 'Ethan Ray', 'UI Designer', 'Casual Leave', '05 Jun 2035', '07 Jun 2035', '1 Day', 'Family event', 'Rejected')
on conflict (id) do nothing;

-- Calendar Events
insert into public.calendar_events (id, day, date, title, time, location, category, note, tone) values
  ('cal-1', 1, '2035-06-01', 'Onboarding Session — New Hires Batch 3', '10:00 AM', 'HR Room 2B', 'Talent Acquisition', 'Prepare welcome kits and ID cards', 0),
  ('cal-2', 4, '2035-06-04', 'Interview — Product Designer', '09:00 AM', 'Meeting Room C', 'Talent Acquisition', 'Review portfolio first', 0),
  ('cal-3', 4, '2035-06-04', 'Quarterly Policy Review', '03:00 PM', 'Conference Room 1A', 'Workplace Engagement', 'All department heads', 2),
  ('cal-4', 7, '2035-06-07', 'Team Communication Workshop', '02:00 PM', 'Main Training Hall', 'Employee Development', 'Interactive session', 1),
  ('cal-5', 13, '2035-06-13', 'Performance Review Check-in — Marketing Team', '01:00 PM', 'Notion Review Sheet', 'Employee Development', 'Q2 deliverables assessment', 1),
  ('cal-6', 15, '2035-06-15', 'Recruitment Planning — Q3 Targets', '11:00 AM', 'Meeting Room A', 'Talent Acquisition', 'Headcount forecast', 0),
  ('cal-7', 18, '2035-06-18', 'Remote Work Compliance Briefing', '09:30 AM', 'Zoom (link in calendar)', 'Workplace Engagement', 'Mandatory for hybrid & remote staff', 2),
  ('cal-8', 21, '2035-06-21', 'New Recruit Introduction', '09:00 AM', 'HR Room 2B', 'Talent Acquisition', 'Prepare welcome kits and ID cards', 0),
  ('cal-9', 21, '2035-06-21', 'Personal Growth Session — Leadership Track', '02:00 PM', 'Zoom (link shared via email)', 'Employee Development', 'Attendees must complete pre-session survey', 1),
  ('cal-10', 22, '2035-06-22', 'Upskilling Program: Advanced Excel', '03:30 PM', 'Computer Lab 1', 'Employee Development', 'Financial modeling practice', 1),
  ('cal-11', 27, '2035-06-27', 'Final Interview — Sales Manager', '10:00 AM', 'Boardroom 3', 'Talent Acquisition', 'CEO & HR Director panel', 0),
  ('cal-12', 29, '2035-06-29', 'Internal Team-Building Event', '08:00 AM', 'Kurnia Green Park', 'Workplace Engagement', 'Sportswear and casual gear', 2)
on conflict (id) do nothing;
