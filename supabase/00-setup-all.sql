-- ============================================================================
-- KharismaHub: Skrip Migrasi Lengkap & Bersih (Jalankan Sekali di Supabase SQL Editor)
-- Proyek: https://wirgqezinegebauddmgy.supabase.co
-- ============================================================================

-- 1. EXTENSIONS
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 2. TABEL PROFIL PENGGUNA (user_profiles)
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'Employee' check (role in ('Admin', 'Supervisor', 'Employee')),
  department text not null default '',
  title text not null default 'Karyawan',
  status text not null default 'Pending' check (status in ('Pending', 'Active', 'Inactive')),
  employee_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_profiles_email_lower_unique on public.user_profiles (lower(email));
create index if not exists user_profiles_dept_role_idx on public.user_profiles (department, role);

-- 3. PERBAIKAN ROW LEVEL SECURITY (RLS) AGAR TIDAK TERJADI REKURSI
alter table public.user_profiles enable row level security;

drop policy if exists profiles_read_scope on public.user_profiles;
drop policy if exists profiles_read_self on public.user_profiles;
drop policy if exists profiles_update_self on public.user_profiles;

-- Pengguna dapat membaca profilnya sendiri
create policy profiles_read_self on public.user_profiles
  for select to authenticated
  using (id = auth.uid());

-- Pengguna dapat memperbarui namanya sendiri
create policy profiles_update_self on public.user_profiles
  for update to authenticated
  using (id = auth.uid() and status = 'Active')
  with check (id = auth.uid() and status = 'Active');

grant select on public.user_profiles to authenticated;
grant update (full_name, updated_at) on public.user_profiles to authenticated;

-- 4. TABEL DEPARTEMEN
create table if not exists public.departments (
  id text primary key,
  name text unique not null,
  code text not null,
  head text not null,
  budget text default 'Rp 0',
  description text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 5. TABEL KARYAWAN (employees)
create table if not exists public.employees (
  id text primary key,
  name text not null,
  email text unique not null,
  department text not null,
  title text not null,
  employment_type text default 'Full-Time',
  work_model text default 'Hybrid',
  join_date text default '12 Jan 2026',
  status text default 'On-Time',
  gender text default 'Not provided',
  birth_date text default 'Not provided',
  phone text default '+62 812-0000-0000',
  address text default 'Indonesia',
  avatar_idx integer default 1,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- 6. TABEL PRESENSI (attendance_records)
create table if not exists public.attendance_records (
  id uuid default uuid_generate_v4() primary key,
  employee_id text not null,
  employee_name text not null,
  date text not null,
  work_model text default 'Di Kantor',
  clock_in text not null,
  clock_out text,
  duration text default '—',
  overtime text default '—',
  status text default 'On-Time',
  auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 7. TABEL CUTI (leave_requests)
create table if not exists public.leave_requests (
  id text primary key,
  employee_name text not null,
  title text not null,
  type text default 'Annual Leave',
  submit_date text not null,
  period text not null,
  duration text not null,
  reason text,
  status text default 'Pending',
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 8. TABEL KPI (kpi_indicators)
create table if not exists public.kpi_indicators (
  id text primary key,
  title text not null,
  dept text not null,
  pic text not null,
  period text default 'Q2 2026',
  weight integer default 20,
  target numeric not null,
  actual numeric default 0,
  unit text default '%',
  lower_is_better boolean default false,
  status text default 'On-Track',
  notes text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- 9. TABEL KALENDER (calendar_events)
create table if not exists public.calendar_events (
  id text primary key,
  day integer not null,
  date text not null,
  title text not null,
  time text not null,
  location text default 'Kantor Utama',
  category text default 'Workplace Engagement',
  note text,
  tone integer default 0,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

-- 10. TABEL PELAMAR (applicants) & PENGATURAN (system_settings)
create table if not exists public.applicants (
  id text primary key,
  name text not null,
  email text not null,
  position text not null,
  applied_date text not null,
  type text default 'Full-Time Hybrid',
  stage text default 'Application Received',
  created_at timestamptz default timezone('utc'::text, now()) not null
);

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

-- 11. POLICIES UNTUK SEMUA TABEL OPERASIONAL
alter table public.departments enable row level security;
alter table public.employees enable row level security;
alter table public.attendance_records enable row level security;
alter table public.leave_requests enable row level security;
alter table public.kpi_indicators enable row level security;
alter table public.calendar_events enable row level security;
alter table public.applicants enable row level security;
alter table public.system_settings enable row level security;

create policy departments_auth_all on public.departments for all to authenticated using (true) with check (true);
create policy employees_auth_all on public.employees for all to authenticated using (true) with check (true);
create policy attendance_auth_all on public.attendance_records for all to authenticated using (true) with check (true);
create policy leave_auth_all on public.leave_requests for all to authenticated using (true) with check (true);
create policy kpi_auth_all on public.kpi_indicators for all to authenticated using (true) with check (true);
create policy calendar_auth_all on public.calendar_events for all to authenticated using (true) with check (true);
create policy applicants_auth_all on public.applicants for all to authenticated using (true) with check (true);
create policy settings_auth_all on public.system_settings for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.departments, public.employees, public.attendance_records, public.leave_requests, public.kpi_indicators, public.calendar_events, public.applicants, public.system_settings to authenticated;

-- 12. SEED DATA DEFAULT
insert into public.departments (id, name, code, head, budget, description) values
  ('dept-1', 'Product Design', 'PD', 'Ethan Ray', 'Rp 45.000.000', 'Perancangan desain antarmuka, UX research, dan design system.'),
  ('dept-2', 'Marketing', 'MKT', 'Olivia Mason', 'Rp 65.000.000', 'Akuisisi pelanggan, kampanye digital, branding, dan lead generation.'),
  ('dept-3', 'Operations', 'OPS', 'Jacob Yuen', 'Rp 50.000.000', 'Manajemen operasional harian, kepatuhan prosedur, dan delivery.'),
  ('dept-4', 'Human Resources', 'HR', 'Mia Torres', 'Rp 40.000.000', 'Manajemen talenta, rekrutmen, retensi karyawan, dan budaya tim.'),
  ('dept-5', 'Customer Service', 'CS', 'Farah Nabila', 'Rp 35.000.000', 'Penanganan tiket layanan pelanggan dan kepuasan konsumen.'),
  ('dept-6', 'R&D', 'RND', 'Lina Armand', 'Rp 55.000.000', 'Riset dan inovasi teknologi, uji laboratorium, dan prototipe.')
on conflict (id) do nothing;

insert into public.employees (id, name, email, department, title, employment_type, work_model, join_date, status, avatar_idx) values
  ('EMP-0234', 'Olivia Mason', 'olivia.mason@kharismahub.com', 'Marketing', 'Executive Marketing', 'Full-Time', 'Hybrid', '12 Jan 2024', 'On-Time', 1),
  ('EMP-0178', 'Ethan Ray', 'ethan.ray@kharismahub.com', 'Product Design', 'UI Designer', 'Full-Time', 'Remote', '03 Mar 2024', 'Late', 2),
  ('EMP-0312', 'Lina Armand', 'lina.armand@kharismahub.com', 'R&D', 'Lab Analyst', 'Part-Time', 'On-Site', '22 Jul 2024', 'On Leave', 3),
  ('EMP-0115', 'Jacob Yuen', 'jacob.yuen@kharismahub.com', 'Operations', 'Site Supervisor', 'Full-Time', 'On-Site', '05 Sep 2023', 'Absent', 4),
  ('EMP-0289', 'Mia Torres', 'mia.torres@kharismahub.com', 'Human Resources', 'HR Officer', 'Full-Time', 'Hybrid', '14 Feb 2024', 'On-Time', 5),
  ('EMP-0356', 'Sara Kim', 'sara.kim@kharismahub.com', 'Customer Service', 'Customer Support Intern', 'Internship', 'On-Site', '10 May 2025', 'Late', 6),
  ('EMP-0291', 'Daniel Cheung', 'daniel.cheung@kharismahub.com', 'Operations', 'Compliance Specialist', 'Full-Time', 'Remote', '19 Nov 2024', 'On-Time', 7),
  ('EMP-0275', 'Anya Rodriguez', 'anya.rodriguez@kharismahub.com', 'Marketing', 'Graphic Designer', 'Part-Time', 'Remote', '06 Apr 2025', 'Late', 8),
  ('EMP-0159', 'Kelvin Yu', 'kelvin.yu@kharismahub.com', 'Human Resources', 'Training Coordinator', 'Full-Time', 'On-Site', '27 Jun 2023', 'On-Time', 9),
  ('EMP-0320', 'Farah Nabila', 'farah.nabila@kharismahub.com', 'Customer Service', 'Customer Experience Lead', 'Full-Time', 'Hybrid', '08 Aug 2024', 'On-Time', 1),
  ('EMP-0362', 'Juno Park', 'juno.park@kharismahub.com', 'Product Design', 'UX Researcher', 'Full-Time', 'Hybrid', '15 Apr 2024', 'On-Time', 2),
  ('EMP-0265', 'Hana Putri', 'hana.putri@kharismahub.com', 'Human Resources', 'Recruitment Assistant', 'Internship', 'On-Site', '20 Feb 2025', 'On-Time', 3)
on conflict (id) do nothing;

insert into public.kpi_indicators (id, title, dept, pic, target, actual, unit, weight, period, status, notes) values
  ('kpi-1', 'Customer Satisfaction Score (CSAT)', 'Customer Service', 'Olivia Mason', 90, 95.2, '%', 25, 'Q2 2026', 'Exceeded', 'Survei kepuasan pelanggan mencapai rekor tertinggi kuartal ini.'),
  ('kpi-2', 'Design System Component Coverage', 'Product Design', 'Ethan Ray', 85, 92.4, '%', 30, 'Q2 2026', 'Exceeded', '45 komponen baru dipublikasikan ke Figma & Storybook.'),
  ('kpi-3', 'Employee Retention Rate', 'Human Resources', 'Mia Torres', 95, 96.8, '%', 35, 'Q2 2026', 'Exceeded', 'Turnover turun 2.4% dari bulan lalu dengan program baru.')
on conflict (id) do nothing;

-- 13. PASTIKAN AKUN ADMIN KURNIAPTK TERVERIFIKASI
update public.user_profiles
set role = 'Admin',
    status = 'Active',
    department = 'Human Resources',
    title = 'Administrator SDM',
    updated_at = now()
where lower(email) = lower('kurniaptk@gmail.com');
