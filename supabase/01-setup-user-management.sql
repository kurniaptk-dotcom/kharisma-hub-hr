-- ============================================================================
-- Kharisma Hub: User Profiles & Authentication Setup
-- Jalankan skrip ini langsung di Supabase Dashboard > SQL Editor
-- ============================================================================

-- 1. Buat tabel user_profiles jika belum ada
create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'Employee',
  department text not null default '',
  title text not null default 'Karyawan',
  status text not null default 'Pending',
  employee_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Pasang constraint role dan status
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check check (role in ('Admin', 'Supervisor', 'Employee'));

alter table public.user_profiles drop constraint if exists user_profiles_status_check;
alter table public.user_profiles add constraint user_profiles_status_check check (status in ('Pending', 'Active', 'Inactive'));

create unique index if not exists user_profiles_email_lower_unique on public.user_profiles (lower(email));
create index if not exists user_profiles_department_role_idx on public.user_profiles (department, role);

-- 3. Fungsi helper role untuk RLS
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.user_profiles where id = auth.uid() and status = 'Active'; $$;

create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_user_role() = 'Admin', false); $$;

create or replace function public.current_user_is_active()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.user_profiles where id = auth.uid() and status = 'Active'); $$;

-- 4. Trigger otomatis: saat user mendaftar/diundang di Auth, profil otomatis dibuat
create or replace function public.create_user_profile()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, full_name, role, department, title, status)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'Employee',
    '',
    'Karyawan',
    'Pending'
  )
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.create_user_profile();

-- 5. Masukkan & Promosikan kurniaptk@gmail.com dari data auth.users ke user_profiles sebagai Admin Aktif
insert into public.user_profiles (id, email, full_name, role, department, title, status)
select
  u.id,
  lower(u.email),
  coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  'Admin',
  'Human Resources',
  'Administrator SDM',
  'Active'
from auth.users u
where lower(u.email) = lower('kurniaptk@gmail.com')
on conflict (id) do update
set role = 'Admin',
    status = 'Active',
    department = 'Human Resources',
    title = 'Administrator SDM',
    updated_at = now();

-- Update langsung jika profil sudah ada
update public.user_profiles
set role = 'Admin',
    status = 'Active',
    department = 'Human Resources',
    title = 'Administrator SDM',
    updated_at = now()
where lower(email) = lower('kurniaptk@gmail.com');

-- 6. Pasang Row Level Security (RLS)
alter table public.user_profiles enable row level security;

drop policy if exists profiles_read_scope on public.user_profiles;
create policy profiles_read_scope on public.user_profiles for select to authenticated using (
  public.current_user_is_admin() or id = auth.uid() or
  (public.current_user_role() = 'Supervisor' and department = (select department from public.user_profiles where id = auth.uid()))
);

drop policy if exists profiles_update_self on public.user_profiles;
create policy profiles_update_self on public.user_profiles for update to authenticated using (id = auth.uid() and status = 'Active')
  with check (id = auth.uid() and status = 'Active');

grant select on public.user_profiles to authenticated;
grant update(full_name, updated_at) on public.user_profiles to authenticated;
grant execute on function public.current_user_role(), public.current_user_is_admin(), public.current_user_is_active() to authenticated;

-- 7. Tampilkan hasil verifikasi
select id, email, full_name, role, department, title, status, created_at from public.user_profiles;
