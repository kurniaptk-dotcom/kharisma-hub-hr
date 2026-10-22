-- Login and role hardening. Apply after schema.sql, auth-hardening.sql,
-- and attendance-optimization.sql. Safe to rerun on the existing project.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'Employee',
  department text not null default '',
  title text not null default 'Karyawan',
  status text not null default 'Pending',
  employee_id text references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles add column if not exists employee_id text references public.employees(id) on delete set null;
alter table public.user_profiles add column if not exists status text not null default 'Pending';
alter table public.user_profiles add column if not exists department text not null default '';
alter table public.user_profiles add column if not exists title text not null default 'Karyawan';
alter table public.user_profiles add column if not exists updated_at timestamptz not null default now();
alter table public.user_profiles alter column role set default 'Employee';

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid='public.user_profiles'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table public.user_profiles drop constraint %I', c.conname);
  end loop;
  for c in select conname from pg_constraint where conrelid='public.user_profiles'::regclass and contype='c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.user_profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.user_profiles add constraint user_profiles_role_check check (role in ('Admin','Supervisor','Employee'));
alter table public.user_profiles add constraint user_profiles_status_check check (status in ('Pending','Active','Inactive'));
create unique index if not exists user_profiles_email_lower_unique on public.user_profiles (lower(email));
create index if not exists user_profiles_department_role_idx on public.user_profiles (department, role);
create index if not exists user_profiles_employee_id_idx on public.user_profiles (employee_id);

-- Backfill legacy profiles to a matching employee using their email.
update public.user_profiles p set
  employee_id = coalesce(p.employee_id, e.id),
  department = case when coalesce(p.department,'')='' then coalesce(e.department,'') else p.department end,
  title = case when coalesce(p.title,'')='' then coalesce(e.title,'Karyawan') else p.title end,
  updated_at = now()
from public.employees e where lower(e.email)=lower(p.email);

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.user_profiles where id=auth.uid() and status='Active'; $$;

create or replace function public.current_user_is_active()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.user_profiles where id=auth.uid() and status='Active'); $$;

create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_user_role()='Admin',false); $$;

create or replace function public.current_user_is_supervisor()
returns boolean language sql stable security definer set search_path=public
as $$ select coalesce(public.current_user_role()='Supervisor',false); $$;

create or replace function public.current_user_department()
returns text language sql stable security definer set search_path=public
as $$ select department from public.user_profiles where id=auth.uid() and status='Active'; $$;

create or replace function public.current_user_employee_id()
returns text language sql stable security definer set search_path=public
as $$ select employee_id from public.user_profiles where id=auth.uid() and status='Active'; $$;

create or replace function public.create_user_profile()
returns trigger language plpgsql security definer set search_path=public
as $$
declare v_employee public.employees;
begin
  select * into v_employee from public.employees where lower(email)=lower(new.email) limit 1;
  insert into public.user_profiles(id,email,full_name,role,department,title,status,employee_id)
  values(new.id,lower(new.email),coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1)),
    'Employee',coalesce(v_employee.department,''),coalesce(v_employee.title,'Karyawan'),'Pending',v_employee.id)
  on conflict(id) do update set email=excluded.email,updated_at=now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.create_user_profile();

-- An employee account must have an employee record. Existing admin/supervisor
-- accounts may remain unlinked; link them when a corresponding employee exists.
alter table public.leave_requests add column if not exists employee_id text references public.employees(id) on delete set null;
update public.leave_requests l set employee_id=e.id
from public.employees e where l.employee_id is null and lower(l.employee_name)=lower(e.name);

alter table public.kpi_indicators add column if not exists employee_id text references public.employees(id) on delete set null;
update public.kpi_indicators k set employee_id=e.id
from public.employees e where k.employee_id is null and lower(k.pic)=lower(e.name);

-- Remove all previous public/overlapping policies before installing scoped rules.
do $$
declare p record;
begin
  for p in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in (
    'user_profiles','employees','attendance_records','leave_requests','kpi_indicators','calendar_events',
    'departments','applicants','system_settings','attendance_office_locations','attendance_shifts',
    'attendance_shift_assignments','attendance_correction_requests'
  ) loop
    execute format('drop policy if exists %I on %I.%I',p.policyname,p.schemaname,p.tablename);
  end loop;
end $$;

alter table public.user_profiles enable row level security;
create policy profiles_read_scope on public.user_profiles for select to authenticated using (
  public.current_user_is_admin() or id=auth.uid() or
  (public.current_user_is_supervisor() and department=public.current_user_department())
);
create policy profiles_update_self on public.user_profiles for update to authenticated using (id=auth.uid() and status='Active')
  with check (id=auth.uid() and status='Active');
revoke update on public.user_profiles from authenticated;
grant select on public.user_profiles to authenticated;
grant update(full_name,updated_at) on public.user_profiles to authenticated;

create policy employees_read_scope on public.employees for select to authenticated using (
  public.current_user_is_admin() or id=public.current_user_employee_id() or
  (public.current_user_is_supervisor() and department=public.current_user_department())
);
create policy employees_admin_write on public.employees for all to authenticated
  using(public.current_user_is_admin()) with check(public.current_user_is_admin());
revoke insert,update,delete on public.employees from authenticated;
grant select,insert,update,delete on public.employees to authenticated;

create policy attendance_read_scope on public.attendance_records for select to authenticated using (
  public.current_user_is_admin() or auth_user_id=auth.uid() or employee_id=public.current_user_employee_id() or
  (public.current_user_is_supervisor() and exists(select 1 from public.employees e where e.id=employee_id and e.department=public.current_user_department()))
);
create policy attendance_self_insert on public.attendance_records for insert to authenticated with check (
  auth_user_id=auth.uid() and employee_id=public.current_user_employee_id()
);
-- Attendance writes must go through transition/review RPCs so users cannot
-- forge timestamps, GPS results, approvals, or completion state via REST.
drop policy if exists attendance_self_insert on public.attendance_records;
drop policy if exists attendance_admin_delete on public.attendance_records;
revoke insert,update,delete on public.attendance_records from authenticated;

create policy leave_read_scope on public.leave_requests for select to authenticated using (
  public.current_user_is_admin() or employee_id=public.current_user_employee_id() or
  (public.current_user_is_supervisor() and exists(select 1 from public.employees e where e.id=employee_id and e.department=public.current_user_department()))
);
create policy leave_self_submit on public.leave_requests for insert to authenticated with check (
  employee_id=public.current_user_employee_id() and status='Pending'
);
create policy leave_supervisor_review on public.leave_requests for update to authenticated
  using(public.current_user_is_admin() or (public.current_user_is_supervisor() and status='Pending' and exists(select 1 from public.employees e where e.id=employee_id and e.department=public.current_user_department())))
  with check(public.current_user_is_admin() or (public.current_user_is_supervisor() and status in ('Approved','Rejected') and exists(select 1 from public.employees e where e.id=employee_id and e.department=public.current_user_department())));

create policy kpi_read_scope on public.kpi_indicators for select to authenticated using (
  public.current_user_is_admin() or (public.current_user_is_supervisor() and dept=public.current_user_department()) or employee_id=public.current_user_employee_id()
);
create policy kpi_admin_write on public.kpi_indicators for all to authenticated using(public.current_user_is_admin()) with check(public.current_user_is_admin());
create policy kpi_supervisor_write on public.kpi_indicators for all to authenticated
  using(public.current_user_is_supervisor() and dept=public.current_user_department())
  with check(public.current_user_is_supervisor() and dept=public.current_user_department() and
    (employee_id is null or exists(select 1 from public.employees e where e.id=employee_id and e.department=public.current_user_department())));

create policy calendar_read_active on public.calendar_events for select to authenticated using(public.current_user_is_active());
create policy calendar_admin_write on public.calendar_events for all to authenticated using(public.current_user_is_admin()) with check(public.current_user_is_admin());
create policy departments_read_active on public.departments for select to authenticated using(public.current_user_is_active());
create policy departments_admin_write on public.departments for all to authenticated using(public.current_user_is_admin()) with check(public.current_user_is_admin());
create policy applicants_read_scope on public.applicants for select to authenticated using(
  public.current_user_is_admin() or (public.current_user_is_supervisor() and public.current_user_department() in ('Human Resources','Recruitment'))
);
create policy applicants_admin_write on public.applicants for all to authenticated using(public.current_user_is_admin()) with check(public.current_user_is_admin());
create policy settings_read_active on public.system_settings for select to authenticated using(public.current_user_is_active());
create policy settings_admin_write on public.system_settings for all to authenticated using(public.current_user_is_admin()) with check(public.current_user_is_admin());

-- Restore scoped attendance-policy access after the previous attendance migration.
create policy attendance_locations_read on public.attendance_office_locations for select to authenticated using(public.current_user_is_active());
create policy attendance_locations_admin on public.attendance_office_locations for all to authenticated using(public.current_user_is_admin()) with check(public.current_user_is_admin());
create policy attendance_shifts_read on public.attendance_shifts for select to authenticated using(public.current_user_is_active());
create policy attendance_shifts_admin on public.attendance_shifts for all to authenticated using(public.current_user_is_admin()) with check(public.current_user_is_admin());
create policy attendance_assignments_read on public.attendance_shift_assignments for select to authenticated using(
  public.current_user_is_admin() or employee_id=public.current_user_employee_id() or
  (public.current_user_is_supervisor() and exists(select 1 from public.employees e where e.id=attendance_shift_assignments.employee_id and e.department=public.current_user_department()))
);
create policy attendance_assignments_manage on public.attendance_shift_assignments for all to authenticated
  using(public.current_user_is_admin() or (public.current_user_is_supervisor() and exists(select 1 from public.employees e where e.id=attendance_shift_assignments.employee_id and e.department=public.current_user_department())))
  with check(public.current_user_is_admin() or (public.current_user_is_supervisor() and exists(select 1 from public.employees e where e.id=attendance_shift_assignments.employee_id and e.department=public.current_user_department())));
create policy attendance_correction_read on public.attendance_correction_requests for select to authenticated using(
  public.current_user_is_admin() or requester_id=auth.uid() or
  (public.current_user_is_supervisor() and exists(select 1 from public.attendance_records a join public.employees e on e.id=a.employee_id where a.id=attendance_id and e.department=public.current_user_department()))
);
create policy attendance_correction_submit on public.attendance_correction_requests for insert to authenticated with check(
  requester_id=auth.uid() and status='pending' and exists(select 1 from public.attendance_records a where a.id=attendance_id and a.auth_user_id=auth.uid())
);
create policy attendance_correction_review on public.attendance_correction_requests for update to authenticated
  using(public.current_user_is_admin() or (public.current_user_is_supervisor() and exists(select 1 from public.attendance_records a join public.employees e on e.id=a.employee_id where a.id=attendance_id and e.department=public.current_user_department())))
  with check(public.current_user_is_admin() or reviewer_id=auth.uid());

-- Submit corrections directly, but review only through the guarded RPC.
revoke update,delete on public.attendance_correction_requests from authenticated;
grant select,insert on public.attendance_correction_requests to authenticated;

grant select on public.attendance_records to authenticated;
grant select,insert on public.leave_requests to authenticated;
revoke update on public.leave_requests from authenticated;
grant update(status) on public.leave_requests to authenticated;
grant select,insert,update,delete on public.kpi_indicators,public.calendar_events,public.departments,public.applicants,public.system_settings to authenticated;
grant select,insert,update,delete on public.attendance_office_locations,public.attendance_shifts,public.attendance_shift_assignments to authenticated;

revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_is_active() from public;
grant execute on function public.current_user_role(),public.current_user_is_active() to authenticated;
