-- Run after schema.sql in the Supabase SQL editor.
-- Removes the old anonymous allow-all policies and installs role-aware access.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role text not null default 'Supervisor' check (role in ('Admin', 'Supervisor')),
  department text not null default '',
  title text not null default 'Supervisor',
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  employee_id text references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;
alter table public.attendance_records drop constraint if exists attendance_employee_date_unique;
alter table public.attendance_records add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
alter table public.attendance_records add column if not exists clock_in_at timestamptz;
alter table public.attendance_records add column if not exists clock_out_at timestamptz;
alter table public.attendance_records add column if not exists late_minutes integer not null default 0;
alter table public.attendance_records drop constraint if exists attendance_auth_user_date_unique;
alter table public.attendance_records add constraint attendance_auth_user_date_unique unique (auth_user_id, date);

create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'Admin' and p.status = 'Active'); $$;

create or replace function public.current_user_department()
returns text language sql stable security definer set search_path = public
as $$ select department from public.user_profiles where id = auth.uid() and status = 'Active'; $$;

create or replace function public.current_user_employee_id()
returns text language sql stable security definer set search_path = public
as $$ select employee_id from public.user_profiles where id = auth.uid() and status = 'Active'; $$;

create or replace function public.create_user_profile()
returns trigger language plpgsql security definer set search_path = public
as $$
declare matched_employee_id text;
begin
  select id into matched_employee_id from public.employees where lower(email) = lower(new.email) limit 1;
  insert into public.user_profiles (id, email, full_name, role, department, title, employee_id)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), 'Supervisor', '', 'Supervisor', matched_employee_id)
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile after insert on auth.users
for each row execute function public.create_user_profile();

-- Promote the first administrator manually after creating that Auth account:
-- update public.user_profiles set role = 'Admin', department = 'Human Resources', title = 'Administrator SDM' where email = 'your-admin@example.com';

do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('employees','attendance_records','leave_requests','kpi_indicators','calendar_events','departments','applicants','system_settings','user_profiles') loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create policy profiles_read_self_or_admin on public.user_profiles for select to authenticated using (id = auth.uid() or public.current_user_is_admin());
create policy profiles_update_self_or_admin on public.user_profiles for update to authenticated using (id = auth.uid() or public.current_user_is_admin()) with check (id = auth.uid() or public.current_user_is_admin());
revoke update on public.user_profiles from authenticated;
grant update (full_name, title, updated_at) on public.user_profiles to authenticated;
grant select on public.user_profiles to authenticated;

create policy employees_read_authenticated on public.employees for select to authenticated using (
  public.current_user_is_admin() or department = public.current_user_department() or lower(email) = lower(coalesce(auth.jwt()->>'email', ''))
);
create policy employees_admin_write on public.employees for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy attendance_read_authenticated on public.attendance_records for select to authenticated using (
  public.current_user_is_admin() or auth_user_id = auth.uid() or employee_id = public.current_user_employee_id() or employee_id in (
    select e.id from public.employees e where e.department = public.current_user_department()
  )
);
create policy attendance_self_insert on public.attendance_records for insert to authenticated with check (
  public.current_user_is_admin() or auth_user_id = auth.uid() or employee_id in (select employee_id from public.user_profiles where id = auth.uid() and status = 'Active')
);
create policy attendance_self_update on public.attendance_records for update to authenticated using (public.current_user_is_admin() or auth_user_id = auth.uid()) with check (public.current_user_is_admin() or auth_user_id = auth.uid());
create policy attendance_admin_delete on public.attendance_records for delete to authenticated using (public.current_user_is_admin());

create policy kpi_read_authenticated on public.kpi_indicators for select to authenticated using (
  public.current_user_is_admin() or dept = public.current_user_department()
);
create policy kpi_manage_admin_or_department on public.kpi_indicators for all to authenticated
  using (public.current_user_is_admin() or dept = public.current_user_department())
  with check (public.current_user_is_admin() or dept = public.current_user_department());

create policy leave_read_authenticated on public.leave_requests for select to authenticated using (
  public.current_user_is_admin() or employee_name in (
    select e.name from public.employees e where e.department = public.current_user_department() or e.id = public.current_user_employee_id()
  )
);
create policy leave_self_submit on public.leave_requests for insert to authenticated with check (
  status = 'Pending' and employee_name in (select e.name from public.employees e where e.id = public.current_user_employee_id())
);
create policy leave_self_update_pending on public.leave_requests for update to authenticated
  using (employee_name in (select e.name from public.employees e where e.id = public.current_user_employee_id()) and status = 'Pending')
  with check (employee_name in (select e.name from public.employees e where e.id = public.current_user_employee_id()) and status = 'Pending');
create policy leave_admin_write on public.leave_requests for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy calendar_read_authenticated on public.calendar_events for select to authenticated using (true);
create policy calendar_admin_write on public.calendar_events for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy departments_read_authenticated on public.departments for select to authenticated using (true);
create policy departments_admin_write on public.departments for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy applicants_read_authenticated on public.applicants for select to authenticated using (
  public.current_user_is_admin() or public.current_user_department() in ('Human Resources', 'Recruitment')
);
create policy applicants_admin_write on public.applicants for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy settings_read_authenticated on public.system_settings for select to authenticated using (true);
create policy settings_admin_write on public.system_settings for all to authenticated using (public.current_user_is_admin()) with check (public.current_user_is_admin());

grant select, insert, update, delete on public.employees, public.attendance_records, public.leave_requests, public.kpi_indicators, public.calendar_events, public.departments, public.applicants, public.system_settings to authenticated;
