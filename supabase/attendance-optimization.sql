-- Apply after schema.sql and auth-hardening.sql.
-- Attendance policy, shifts, GPS geofencing, break sessions, and correction review.

alter table public.attendance_records
  add column if not exists state text not null default 'completed',
  add column if not exists break_sessions jsonb not null default '[]'::jsonb,
  add column if not exists shift_id uuid,
  add column if not exists location_latitude double precision,
  add column if not exists location_longitude double precision,
  add column if not exists location_accuracy_m double precision,
  add column if not exists location_distance_m double precision,
  add column if not exists location_verified boolean not null default false,
  add column if not exists overtime_approval_status text not null default 'not_required'
    check (overtime_approval_status in ('not_required','pending','approved','rejected'));

update public.attendance_records a set date=to_char(to_date(a.date,'DD Mon YYYY'),'YYYY-MM-DD')
  where a.date ~ '^[0-9]{1,2} [[:alpha:]]{3} [0-9]{4}$'
    and not exists (select 1 from public.attendance_records other where other.auth_user_id=a.auth_user_id and other.id<>a.id
      and other.date=to_char(to_date(a.date,'DD Mon YYYY'),'YYYY-MM-DD'));

update public.attendance_records set state=case when clock_out_at is not null or nullif(clock_out,'') is not null then 'completed'
  when clock_in_at is not null or nullif(clock_in,'') is not null then 'working' else 'incomplete' end
  where state='completed' and clock_out_at is null and nullif(clock_out,'') is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='attendance_records_state_check') then
    alter table public.attendance_records add constraint attendance_records_state_check check (state in ('working','on_break','completed','incomplete'));
  end if;
end $$;

create table if not exists public.attendance_office_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Kantor Utama',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null default 150 check (radius_m between 20 and 5000),
  enabled boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_time time not null,
  end_time time not null,
  tolerance_minutes integer not null default 0 check (tolerance_minutes between 0 and 240),
  weekdays integer[] not null default array[1,2,3,4,5],
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='attendance_records_shift_id_fkey') then
    alter table public.attendance_records add constraint attendance_records_shift_id_fkey foreign key (shift_id) references public.attendance_shifts(id) on delete set null;
  end if;
end $$;

create table if not exists public.attendance_shift_assignments (
  employee_id text primary key references public.employees(id) on delete cascade,
  shift_id uuid not null references public.attendance_shifts(id),
  assigned_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.attendance_records(id) on delete cascade,
  requester_id uuid not null references auth.users(id),
  requested_values jsonb not null,
  reason text not null check (length(trim(reason)) between 5 and 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewer_id uuid references auth.users(id),
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  check (jsonb_typeof(requested_values)='object' and requested_values <> '{}'::jsonb
    and requested_values - array['clock_in','clock_out'] = '{}'::jsonb
    and (not (requested_values ? 'clock_in') or requested_values->>'clock_in' is null or requested_values->>'clock_in' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
    and (not (requested_values ? 'clock_out') or requested_values->>'clock_out' is null or requested_values->>'clock_out' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'))
);

alter table public.attendance_office_locations enable row level security;
alter table public.attendance_shifts enable row level security;
alter table public.attendance_shift_assignments enable row level security;
alter table public.attendance_correction_requests enable row level security;

drop policy if exists attendance_read_authenticated on public.attendance_records;
create policy attendance_read_authenticated on public.attendance_records for select to authenticated using (
  public.current_user_is_admin() or auth_user_id = auth.uid() or employee_id = public.current_user_employee_id()
  or employee_id in (select e.id from public.employees e where e.department = public.current_user_department())
);
drop policy if exists attendance_self_insert on public.attendance_records;
drop policy if exists attendance_self_update on public.attendance_records;
create policy attendance_self_insert on public.attendance_records for insert to authenticated with check (
  auth_user_id = auth.uid() and employee_id = public.current_user_employee_id()
);
create policy attendance_self_update on public.attendance_records for update to authenticated
  using (public.current_user_is_admin() or auth_user_id = auth.uid())
  with check (public.current_user_is_admin() or (auth_user_id = auth.uid() and employee_id = public.current_user_employee_id()));

drop policy if exists attendance_locations_read on public.attendance_office_locations;
drop policy if exists attendance_locations_admin on public.attendance_office_locations;
drop policy if exists attendance_shifts_read on public.attendance_shifts;
drop policy if exists attendance_shifts_admin on public.attendance_shifts;
drop policy if exists attendance_assignments_read on public.attendance_shift_assignments;
drop policy if exists attendance_assignments_admin on public.attendance_shift_assignments;
drop policy if exists attendance_correction_read on public.attendance_correction_requests;
drop policy if exists attendance_correction_submit on public.attendance_correction_requests;
drop policy if exists attendance_correction_review on public.attendance_correction_requests;
create policy attendance_locations_read on public.attendance_office_locations for select to authenticated using (true);
create policy attendance_locations_admin on public.attendance_office_locations for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy attendance_shifts_read on public.attendance_shifts for select to authenticated using (true);
create policy attendance_shifts_admin on public.attendance_shifts for all to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());
create policy attendance_assignments_read on public.attendance_shift_assignments for select to authenticated using (
  public.current_user_is_admin() or employee_id = public.current_user_employee_id()
  or exists (select 1 from public.employees e where e.id = employee_id and e.department = public.current_user_department())
);
create policy attendance_assignments_admin on public.attendance_shift_assignments for all to authenticated
  using (public.current_user_is_admin() or exists (select 1 from public.user_profiles p join public.employees e on e.id=employee_id where p.id=auth.uid() and p.role='Supervisor' and p.status='Active' and p.department=e.department))
  with check (public.current_user_is_admin() or exists (select 1 from public.user_profiles p join public.employees e on e.id=employee_id where p.id=auth.uid() and p.role='Supervisor' and p.status='Active' and p.department=e.department));
create policy attendance_correction_read on public.attendance_correction_requests for select to authenticated using (
  public.current_user_is_admin() or requester_id = auth.uid()
  or exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.role = 'Supervisor' and p.status='Active'
    and p.department = (select e.department from public.employees e join public.attendance_records a on a.employee_id=e.id where a.id=attendance_id))
);
create policy attendance_correction_submit on public.attendance_correction_requests for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending' and exists (
    select 1 from public.attendance_records a where a.id = attendance_id and a.auth_user_id = auth.uid()
  ));
create policy attendance_correction_review on public.attendance_correction_requests for update to authenticated
  using (public.current_user_is_admin() or exists (
    select 1 from public.user_profiles p join public.attendance_records a on a.id=attendance_id
    join public.employees e on e.id=a.employee_id where p.id=auth.uid() and p.role='Supervisor'
      and p.status='Active' and p.department=e.department
  )) with check (public.current_user_is_admin() or reviewer_id=auth.uid());

drop function if exists public.attendance_transition(text,date,double precision,double precision,double precision);
create or replace function public.attendance_transition(
  p_action text, p_date date, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision default null,
  p_event_at timestamptz default now()
) returns public.attendance_records
language plpgsql security definer set search_path = public
as $$
declare
  v_employee_id text; v_name text; v_work_model text; v_record public.attendance_records;
  v_location public.attendance_office_locations; v_shift public.attendance_shifts; v_distance double precision;
  v_now timestamptz; v_state text; v_sessions jsonb;
  v_start timestamptz; v_end timestamptz; v_planned_end timestamptz; v_work_minutes integer; v_overtime integer;
begin
  if auth.uid() is null then raise exception 'Sesi masuk diperlukan.'; end if;
  if p_action not in ('clock_in','break_start','break_end','clock_out') then raise exception 'Aksi absensi tidak dikenal.'; end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180 or (p_accuracy_m is not null and p_accuracy_m < 0) then raise exception 'Koordinat GPS tidak valid.'; end if;
  if p_event_at is null or p_event_at > now() + interval '5 minutes' or p_event_at < now() - interval '36 hours' then raise exception 'Waktu absensi tidak valid atau antrean offline sudah terlalu lama.'; end if;
  v_now := p_event_at;
  select p.employee_id, p.full_name into v_employee_id, v_name from public.user_profiles p
    where p.id=auth.uid() and p.status='Active';
  if v_employee_id is null then raise exception 'Akun belum ditautkan ke data karyawan.'; end if;
  select work_model into v_work_model from public.employees where id=v_employee_id;
  select * into v_location from public.attendance_office_locations where enabled=true order by updated_at desc limit 1;
  if not found then raise exception 'Admin harus mengatur lokasi kantor sebelum absensi.'; end if;
  if p_latitude is null or p_longitude is null then raise exception 'Lokasi GPS diperlukan untuk absensi.'; end if;
  v_distance := 6371000 * 2 * asin(least(1,sqrt(
    power(sin(radians(p_latitude-v_location.latitude)/2),2) + cos(radians(v_location.latitude))*cos(radians(p_latitude))*power(sin(radians(p_longitude-v_location.longitude)/2),2)
  )));
  if lower(coalesce(v_work_model, 'on-site')) <> 'remote' and v_distance > v_location.radius_m then
    raise exception 'Anda berada di luar radius lokasi kantor (% meter).', v_location.radius_m;
  end if;
  select s.* into v_shift from public.attendance_shift_assignments a join public.attendance_shifts s on s.id=a.shift_id
    where a.employee_id=v_employee_id and s.enabled=true;
  if not found then
    select * into v_shift from public.attendance_shifts where enabled=true order by created_at asc limit 1;
  end if;
  if v_shift.id is null then raise exception 'Atasan belum menetapkan shift kerja untuk akun Anda.'; end if;
  if not (extract(isodow from p_date)::integer = any(v_shift.weekdays)) then raise exception 'Hari ini tidak termasuk jadwal kerja shift Anda.'; end if;

  select * into v_record from public.attendance_records where auth_user_id=auth.uid() and date=p_date for update;
  if p_action='clock_in' then
    if p_date <> (p_event_at at time zone 'Asia/Jakarta')::date then raise exception 'Tanggal absensi tidak sesuai waktu lokal.'; end if;
    if found then raise exception 'Absensi masuk hari ini sudah tercatat.'; end if;
    insert into public.attendance_records(employee_id,employee_name,date,work_model,clock_in,clock_in_at,status,late_minutes,auth_user_id,state,shift_id,location_latitude,location_longitude,location_accuracy_m,location_distance_m,location_verified)
    values(v_employee_id,v_name,p_date::text,coalesce(v_work_model,'Kantor'),to_char(v_now at time zone 'Asia/Jakarta','HH24:MI'),v_now,
      case when (v_now at time zone 'Asia/Jakarta')::time > v_shift.start_time + make_interval(mins=>v_shift.tolerance_minutes) then 'Late' else 'On-Time' end,
      greatest(0, floor(extract(epoch from ((v_now at time zone 'Asia/Jakarta')::time-v_shift.start_time))/60)::int),auth.uid(),'working',v_shift.id,p_latitude,p_longitude,p_accuracy_m,v_distance,true)
    returning * into v_record;
    return v_record;
  end if;
  if not found then raise exception 'Catat presensi masuk terlebih dahulu.'; end if;
  v_state := v_record.state; v_sessions := coalesce(v_record.break_sessions,'[]'::jsonb);
  if p_action='break_start' then
    if v_state <> 'working' then raise exception 'Istirahat hanya dapat dimulai saat sedang bekerja.'; end if;
    v_sessions := v_sessions || jsonb_build_array(jsonb_build_object('start',v_now,'end',null)); v_state := 'on_break';
  elsif p_action='break_end' then
    if v_state <> 'on_break' then raise exception 'Tidak ada sesi istirahat yang sedang berlangsung.'; end if;
    v_sessions := jsonb_set(v_sessions, array[(jsonb_array_length(v_sessions)-1)::text,'end'], to_jsonb(v_now), false); v_state := 'working';
  elsif p_action='clock_out' then
    if v_state='on_break' then raise exception 'Akhiri istirahat sebelum presensi pulang.'; end if;
    if v_state <> 'working' then raise exception 'Status absensi tidak mengizinkan presensi pulang.'; end if;
    v_start := v_record.clock_in_at; v_end := v_now;
    v_work_minutes := greatest(0,floor(extract(epoch from (v_end-v_start))/60)::int);
    select v_work_minutes - coalesce(sum(greatest(0,floor(extract(epoch from ((item->>'end')::timestamptz-(item->>'start')::timestamptz))/60)::int)),0)
      into v_work_minutes from jsonb_array_elements(v_sessions) as break_item(item) where item->>'end' is not null;
    v_planned_end := (p_date + v_shift.end_time) at time zone 'Asia/Jakarta';
    if v_shift.end_time <= v_shift.start_time then v_planned_end := v_planned_end + interval '1 day'; end if;
    v_overtime := greatest(0,floor(extract(epoch from (v_now-v_planned_end))/60)::int);
    update public.attendance_records set clock_out=to_char(v_now at time zone 'Asia/Jakarta','HH24:MI'),clock_out_at=v_now,
      duration=(v_work_minutes/60)::text||'j '||(v_work_minutes%60)::text||'m', overtime=case when v_overtime>0 then (v_overtime/60)::text||'j '||(v_overtime%60)::text||'m' else '—' end,
      state='completed',break_sessions=v_sessions,overtime_approval_status=case when v_overtime>0 then 'pending' else 'not_required' end,
      location_latitude=p_latitude,location_longitude=p_longitude,location_accuracy_m=p_accuracy_m,location_distance_m=v_distance,location_verified=true
      where id=v_record.id returning * into v_record;
    return v_record;
  end if;
  update public.attendance_records set state=v_state,break_sessions=v_sessions,location_latitude=p_latitude,location_longitude=p_longitude,
    location_accuracy_m=p_accuracy_m,location_distance_m=v_distance,location_verified=true where id=v_record.id returning * into v_record;
  return v_record;
end;
$$;

revoke all on function public.attendance_transition(text,date,double precision,double precision,double precision,timestamptz) from public;
grant execute on function public.attendance_transition(text,date,double precision,double precision,double precision,timestamptz) to authenticated;
grant select, insert, update, delete on public.attendance_office_locations, public.attendance_shifts, public.attendance_shift_assignments to authenticated;
grant select, insert on public.attendance_correction_requests to authenticated;
revoke update, delete on public.attendance_correction_requests from authenticated;

-- All attendance state changes go through the validated function above.
revoke insert, update, delete on public.attendance_records from authenticated;
grant select on public.attendance_records to authenticated;

create or replace function public.review_attendance_correction(p_request_id uuid, p_approve boolean, p_note text default '')
returns public.attendance_correction_requests language plpgsql security definer set search_path=public
as $$
declare v_request public.attendance_correction_requests; v_record public.attendance_records; v_shift public.attendance_shifts; v_values jsonb;
  v_work_minutes integer; v_late integer; v_overtime integer; v_planned_end timestamptz;
begin
  if not public.current_user_is_admin() and not exists (
    select 1 from public.user_profiles p join public.attendance_records a on a.id=(select attendance_id from public.attendance_correction_requests where id=p_request_id)
    join public.employees e on e.id=a.employee_id where p.id=auth.uid() and p.role='Supervisor' and p.status='Active' and p.department=e.department
  ) then raise exception 'Akses persetujuan ditolak.'; end if;
  select * into v_request from public.attendance_correction_requests where id=p_request_id and status='pending' for update;
  if not found then raise exception 'Permintaan tidak ditemukan atau sudah diproses.'; end if;
  if p_approve then
    v_values := v_request.requested_values;
    update public.attendance_records a set
      clock_in=coalesce(v_values->>'clock_in',a.clock_in),
      clock_out=coalesce(v_values->>'clock_out',a.clock_out),
      clock_in_at=case when v_values->>'clock_in' is not null then (a.date::date + (v_values->>'clock_in')::time) at time zone 'Asia/Jakarta' else a.clock_in_at end,
      clock_out_at=case when v_values->>'clock_out' is not null then
        (a.date::date + (v_values->>'clock_out')::time + case when (v_values->>'clock_out')::time < coalesce((v_values->>'clock_in')::time,(a.clock_in_at at time zone 'Asia/Jakarta')::time) then interval '1 day' else interval '0' end) at time zone 'Asia/Jakarta'
        else a.clock_out_at end,
      state=case when coalesce(v_values->>'clock_out',a.clock_out) is not null then 'completed' else a.state end
    where a.id=v_request.attendance_id;
    select * into v_record from public.attendance_records where id=v_request.attendance_id;
    if v_record.shift_id is not null and v_record.clock_in_at is not null then
      select * into v_shift from public.attendance_shifts where id=v_record.shift_id;
      if found then
        v_late := greatest(0,floor(extract(epoch from ((v_record.clock_in_at at time zone 'Asia/Jakarta')::time-v_shift.start_time))/60)::integer);
        update public.attendance_records set late_minutes=v_late,
          status=case when (v_record.clock_in_at at time zone 'Asia/Jakarta')::time > v_shift.start_time + make_interval(mins=>v_shift.tolerance_minutes) then 'Late' else 'On-Time' end
          where id=v_request.attendance_id;
        if v_record.clock_out_at is not null then
          v_planned_end := (v_record.date::date + v_shift.end_time) at time zone 'Asia/Jakarta';
          if v_shift.end_time <= v_shift.start_time then v_planned_end := v_planned_end + interval '1 day'; end if;
          v_overtime := greatest(0,floor(extract(epoch from (v_record.clock_out_at-v_planned_end))/60)::integer);
          update public.attendance_records set overtime=case when v_overtime>0 then (v_overtime/60)::text||'j '||(v_overtime%60)::text||'m' else '—' end,
            overtime_approval_status=case when v_overtime>0 then 'pending' else 'not_required' end where id=v_request.attendance_id;
        end if;
      end if;
    end if;
    if v_record.clock_in_at is not null and v_record.clock_out_at is not null then
      v_work_minutes := floor(extract(epoch from (v_record.clock_out_at-v_record.clock_in_at))/60)::integer;
      select v_work_minutes-coalesce(sum(greatest(0,floor(extract(epoch from ((item->>'end')::timestamptz-(item->>'start')::timestamptz))/60)::integer)),0)
        into v_work_minutes from jsonb_array_elements(v_record.break_sessions) as break_item(item) where item->>'end' is not null;
      update public.attendance_records set duration=(greatest(0,v_work_minutes)/60)::text||'j '||(greatest(0,v_work_minutes)%60)::text||'m' where id=v_request.attendance_id;
    end if;
  end if;
  update public.attendance_correction_requests set status=case when p_approve then 'approved' else 'rejected' end,
    reviewer_id=auth.uid(),review_note=left(coalesce(p_note,''),1000),reviewed_at=now() where id=p_request_id returning * into v_request;
  return v_request;
end;
$$;

create or replace function public.review_attendance_overtime(p_attendance_id uuid, p_approve boolean)
returns public.attendance_records language plpgsql security definer set search_path=public
as $$
declare v_record public.attendance_records;
begin
  if not public.current_user_is_admin() and not exists (
    select 1 from public.user_profiles p join public.attendance_records a on a.id=p_attendance_id
    join public.employees e on e.id=a.employee_id where p.id=auth.uid() and p.role='Supervisor' and p.status='Active' and p.department=e.department
  ) then raise exception 'Akses persetujuan ditolak.'; end if;
  update public.attendance_records set overtime_approval_status=case when p_approve then 'approved' else 'rejected' end
    where id=p_attendance_id and overtime_approval_status='pending' returning * into v_record;
  if not found then raise exception 'Lembur tidak ditemukan atau sudah diproses.'; end if;
  return v_record;
end;
$$;
revoke all on function public.review_attendance_correction(uuid,boolean,text) from public;
revoke all on function public.review_attendance_overtime(uuid,boolean) from public;
grant execute on function public.review_attendance_correction(uuid,boolean,text), public.review_attendance_overtime(uuid,boolean) to authenticated;
