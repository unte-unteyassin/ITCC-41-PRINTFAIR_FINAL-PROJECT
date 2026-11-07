-- PrintFair shared backend schema for Supabase (Postgres + Auth + private Storage).
-- Run this in the Supabase SQL Editor. Never expose a service_role key to the app.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  display_name text not null default '',
  email text not null,
  year_level text,
  program text,
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.stations (
  id text primary key,
  name text not null,
  floor text not null,
  status text not null default 'Operational' check (status in ('Operational','Unavailable','Under Maintenance')),
  status_reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.print_requests (
  id text primary key,
  student_id uuid not null references auth.users(id) on delete cascade,
  student_name text not null,
  student_email text not null,
  student_year text,
  student_program text,
  file_name text not null,
  storage_path text not null unique,
  total_pages integer not null check (total_pages > 0 and total_pages <= 5000),
  page_range text not null,
  requested_pages integer not null check (requested_pages > 0),
  counted_pages integer not null default 0 check (counted_pages >= 0),
  status text not null default 'Reserved' check (status in ('Reserved','Retrieved','Cancelled','Failed','Expired')),
  retrieval_code text not null unique,
  created_at timestamptz not null default now(),
  retrieved_at timestamptz,
  expires_at timestamptz not null,
  station_id text references public.stations(id),
  reason text,
  history jsonb not null default '[]'::jsonb
);

create index if not exists print_requests_student_created_idx
  on public.print_requests(student_id, created_at desc);
create index if not exists print_requests_status_idx on public.print_requests(status);
create unique index if not exists print_requests_one_active_per_student
  on public.print_requests(student_id) where status = 'Reserved';

insert into public.stations(id,name,floor,status) values
 ('old2','Old Library','2nd floor','Operational'),
 ('new2','New Library','2nd floor','Operational'),
 ('new5','New Library','5th floor','Operational'),
 ('med5','School of Medicine','5th floor','Operational')
on conflict (id) do nothing;

-- New authenticated users get a student profile. A staff role must be assigned manually by an authorized project owner.
create or replace function public.handle_new_printfair_user()
returns trigger language plpgsql security definer set search_path = public, auth
as $$
begin
  insert into public.profiles(id, full_name, display_name, email, year_level, program, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name',''),
    coalesce(new.email,''),
    nullif(new.raw_user_meta_data->>'year_level',''),
    nullif(new.raw_user_meta_data->>'program',''),
    'student'
  ) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_printfair on auth.users;
create trigger on_auth_user_created_printfair after insert on auth.users
for each row execute procedure public.handle_new_printfair_user();

create or replace function public.printfair_is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;

alter table public.profiles enable row level security;
alter table public.stations enable row level security;
alter table public.print_requests enable row level security;

drop policy if exists "profile read self or staff" on public.profiles;
create policy "profile read self or staff" on public.profiles for select to authenticated
using (id = auth.uid() or public.printfair_is_admin());

drop policy if exists "authenticated read stations" on public.stations;
create policy "authenticated read stations" on public.stations for select to authenticated using (true);
drop policy if exists "staff update stations" on public.stations;
create policy "staff update stations" on public.stations for all to authenticated
using (public.printfair_is_admin()) with check (public.printfair_is_admin());

drop policy if exists "student or staff read requests" on public.print_requests;
create policy "student or staff read requests" on public.print_requests for select to authenticated
using (student_id = auth.uid() or public.printfair_is_admin());

grant select on public.profiles, public.stations, public.print_requests to authenticated;
grant insert, update, delete on public.stations to authenticated;

-- Private bucket: no public document URLs. Max file size is 20 MiB.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('print-documents','print-documents',false,20971520,array['application/pdf'])
on conflict (id) do update set public=false, file_size_limit=20971520, allowed_mime_types=array['application/pdf'];

drop policy if exists "student upload own pdf" on storage.objects;
create policy "student upload own pdf" on storage.objects for insert to authenticated
with check (bucket_id='print-documents' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "student or staff read pdf" on storage.objects;
create policy "student or staff read pdf" on storage.objects for select to authenticated
using (bucket_id='print-documents' and ((storage.foldername(name))[1]=auth.uid()::text or public.printfair_is_admin()));
drop policy if exists "student delete own pdf" on storage.objects;
create policy "student delete own pdf" on storage.objects for delete to authenticated
using (bucket_id='print-documents' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.expire_own_print_requests()
returns integer language plpgsql security definer set search_path = public, auth
as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in is required.'; end if;
  if public.printfair_is_admin() then
    update public.print_requests set status='Expired',counted_pages=0,reason='Unused retrieval code expired',
      history=history || jsonb_build_array(jsonb_build_object('status','Expired','at',now(),'reason','Unused retrieval code expired'))
      where status='Reserved' and expires_at <= now();
  else
    update public.print_requests set status='Expired',counted_pages=0,reason='Unused retrieval code expired',
      history=history || jsonb_build_array(jsonb_build_object('status','Expired','at',now(),'reason','Unused retrieval code expired'))
      where student_id=auth.uid() and status='Reserved' and expires_at <= now();
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.create_print_request(
  p_file_name text, p_storage_path text, p_total_pages integer,
  p_page_range text, p_requested_pages integer
) returns jsonb language plpgsql security definer set search_path = public, auth, extensions
as $$
declare
  v_user uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_token text;
  v_first integer;
  v_last integer;
  v_page integer;
  v_pages integer[] := '{}';
  v_tokens text[];
  v_reserved integer;
  v_id text;
  v_code text;
  v_expiry timestamptz;
  v_row public.print_requests%rowtype;
begin
  if v_user is null then raise exception 'Sign in is required.'; end if;
  select * into v_profile from public.profiles where id=v_user;
  if not found or v_profile.role <> 'student' then raise exception 'Only student accounts can submit requests.'; end if;
  if p_file_name is null or p_file_name !~* '\.pdf$' then raise exception 'Only PDF documents are accepted.'; end if;
  if p_storage_path is null or split_part(p_storage_path,'/',1) <> v_user::text then raise exception 'Invalid document storage path.'; end if;
  if p_total_pages is null or p_total_pages < 1 or p_total_pages > 5000 then raise exception 'Invalid PDF page count.'; end if;
  if p_requested_pages is null or p_requested_pages < 1 then raise exception 'Select at least one page.'; end if;
  if p_page_range is null or length(trim(p_page_range))=0 then raise exception 'Enter a page range.'; end if;

  v_tokens := string_to_array(regexp_replace(p_page_range, '\s', '', 'g'), ',');
  foreach v_token in array v_tokens loop
    if v_token !~ '^[0-9]+(-[0-9]+)?$' then raise exception 'Invalid page range.'; end if;
    v_first := split_part(v_token,'-',1)::integer;
    v_last := case when position('-' in v_token)>0 then split_part(v_token,'-',2)::integer else v_first end;
    if v_first < 1 or v_last < v_first or v_last > p_total_pages then raise exception 'Page range exceeds the PDF page count.'; end if;
    for v_page in v_first..v_last loop
      if not (v_page = any(v_pages)) then v_pages := array_append(v_pages,v_page); end if;
    end loop;
  end loop;
  if cardinality(v_pages) <> p_requested_pages then raise exception 'Page range count does not match the selected pages.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_user::text));
  update public.print_requests set status='Expired',counted_pages=0,reason='Unused retrieval code expired',
    history=history || jsonb_build_array(jsonb_build_object('status','Expired','at',now(),'reason','Unused retrieval code expired'))
    where student_id=v_user and status='Reserved' and expires_at <= now();
  if exists(select 1 from public.print_requests where student_id=v_user and status='Reserved') then
    raise exception 'You already have an active print request.';
  end if;
  select coalesce(sum(counted_pages),0) + coalesce(sum(requested_pages) filter (where status='Reserved'),0)
    into v_reserved
    from public.print_requests
    where student_id=v_user and (created_at at time zone 'Asia/Manila')::date=(now() at time zone 'Asia/Manila')::date;
  if v_reserved + p_requested_pages > 20 then raise exception 'The request exceeds your remaining daily 20-page allowance.'; end if;

  v_expiry := now() + interval '24 hours'; v_id := 'PF-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  v_code := 'CN3-' || upper(substr(encode(gen_random_bytes(6),'hex'),1,10));
  insert into public.print_requests(
    id,student_id,student_name,student_email,student_year,student_program,
    file_name,storage_path,total_pages,page_range,requested_pages,counted_pages,
    status,retrieval_code,expires_at,history
  ) values (
    v_id,v_user,v_profile.full_name,v_profile.email,v_profile.year_level,v_profile.program,
    p_file_name,p_storage_path,p_total_pages,regexp_replace(p_page_range, '\s','','g'),p_requested_pages,0,
    'Reserved',v_code,v_expiry,
    jsonb_build_array(jsonb_build_object('status','Reserved','at',now(),'reason','Request submitted'))
  ) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.cancel_print_request(p_request_id text)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.print_requests%rowtype;
begin
  select * into v_row from public.print_requests where id=p_request_id and student_id=auth.uid() for update;
  if not found then raise exception 'Request was not found.'; end if;
  if v_row.status <> 'Reserved' then raise exception 'Only an active request can be cancelled.'; end if;
  update public.print_requests set status='Cancelled',counted_pages=0,reason='Cancelled by student before retrieval',
    history=history || jsonb_build_array(jsonb_build_object('status','Cancelled','at',now(),'reason','Cancelled by student before retrieval'))
    where id=p_request_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.claim_print_request(p_code text,p_station_id text)
returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.print_requests%rowtype; v_station public.stations%rowtype;
begin
  if not public.printfair_is_admin() then raise exception 'Authorized library staff sign-in is required.'; end if;
  select * into v_station from public.stations where id=p_station_id;
  if not found or v_station.status <> 'Operational' then raise exception 'Select an operational printing station.'; end if;
  select * into v_row from public.print_requests where upper(retrieval_code)=upper(trim(p_code)) for update;
  if not found then raise exception 'Code not found. Check the code and try again.'; end if;
  if v_row.status <> 'Reserved' then raise exception 'This code has already been used or is no longer active.'; end if;
  if v_row.expires_at <= now() then
    update public.print_requests set status='Expired',reason='Unused retrieval code expired',counted_pages=0,
      history=history || jsonb_build_array(jsonb_build_object('status','Expired','at',now(),'reason','Unused retrieval code expired'))
      where id=v_row.id returning * into v_row;
    return to_jsonb(v_row); -- Do not raise here: raising would roll back the Expired status update.
  end if;
  update public.print_requests set status='Retrieved',retrieved_at=now(),counted_pages=requested_pages,
    station_id=p_station_id,reason='Document retrieved by library staff; physical printing is not verified',
    history=history || jsonb_build_array(jsonb_build_object('status','Retrieved','at',now(),'reason','Document retrieved at '||v_station.name||' · '||v_station.floor))
    where id=v_row.id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.correct_print_request(
  p_request_id text,p_status text,p_counted_pages integer,p_reason text
) returns jsonb language plpgsql security definer set search_path = public, auth
as $$
declare v_row public.print_requests%rowtype; v_total integer;
begin
  if not public.printfair_is_admin() then raise exception 'Authorized staff sign-in is required.'; end if;
  if p_status not in ('Reserved','Retrieved','Cancelled','Failed','Expired') then raise exception 'Invalid status.'; end if;
  if p_reason is null or length(trim(p_reason))=0 then raise exception 'A correction reason is required.'; end if;
  select * into v_row from public.print_requests where id=p_request_id for update;
  if not found then raise exception 'Request was not found.'; end if;
  if p_status='Reserved' then raise exception 'Staff cannot reactivate an old request.'; end if;
  if p_status='Retrieved' and v_row.retrieved_at is null then raise exception 'A request must be retrieved before pages can be counted.'; end if;
  if p_counted_pages is null or p_counted_pages<0 or p_counted_pages>v_row.requested_pages then raise exception 'Invalid counted page total.'; end if;
  if p_counted_pages>0 and v_row.retrieved_at is null then raise exception 'Pages cannot be counted before document retrieval.'; end if;
  select coalesce(sum(counted_pages),0) + coalesce(sum(requested_pages) filter(where status='Reserved'),0)
    into v_total from public.print_requests
    where student_id=v_row.student_id and id<>v_row.id
      and (created_at at time zone 'Asia/Manila')::date=(v_row.created_at at time zone 'Asia/Manila')::date;
  if p_counted_pages>0 and v_total+p_counted_pages>20 then raise exception 'This correction would exceed the daily 20-page allowance.'; end if;
  update public.print_requests set status=p_status,counted_pages=p_counted_pages,reason=trim(p_reason),
    history=history || jsonb_build_array(jsonb_build_object('status',p_status,'at',now(),'reason',trim(p_reason),'counted_pages',p_counted_pages))
    where id=p_request_id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

grant execute on function public.printfair_is_admin() to authenticated;
grant execute on function public.expire_own_print_requests() to authenticated;
grant execute on function public.create_print_request(text,text,integer,text,integer) to authenticated;
grant execute on function public.cancel_print_request(text) to authenticated;
grant execute on function public.claim_print_request(text,text) to authenticated;
grant execute on function public.correct_print_request(text,text,integer,text) to authenticated;

-- Optional realtime: enable print_requests and stations in Database > Publications > supabase_realtime.
-- Only add these tables once, from the Supabase dashboard, to avoid duplicate-publication errors.
