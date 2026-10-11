-- New migration. Apply once, before the new frontend. No existing data is deleted.
-- Small current database: transactional indexes. For a large database, build the
-- same indexes CONCURRENTLY outside a transaction during the release procedure.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '60s';
create index if not exists clara_reschedules_appointment_idx on encaixa_private.clara_reschedules(appointment_id);
create index if not exists studio_addresses_studio_idx on encaixa_private.studio_addresses(studio_id);
create index if not exists appointments_professional_studio_idx on public.appointments(professional_id,studio_id);
create index if not exists clients_merge_studio_idx on public.clients(merged_into,studio_id);
create index if not exists professional_hours_studio_idx on public.professional_hours(professional_id,studio_id);
create index if not exists clients_studio_cursor_idx on public.clients(studio_id,id) where merged_into is null;
create index if not exists appointments_studio_cursor_idx on public.appointments(studio_id,id);
create index if not exists payments_studio_cursor_idx on public.payments(studio_id,id);
create index if not exists appointments_client_date_idx on public.appointments(studio_id,client_id,starts_at desc);

create table if not exists encaixa_private.studio_revisions (
  studio_id uuid primary key references public.studios(id) on delete cascade,
  revision bigint not null default 1
);
alter table encaixa_private.studio_revisions enable row level security;
revoke all on encaixa_private.studio_revisions from public,anon,authenticated;
insert into encaixa_private.studio_revisions(studio_id) select id from public.studios on conflict do nothing;
create or replace function encaixa_private.bump_studio_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
  if tg_table_name='studios' then
    if tg_op='DELETE' then return old; end if;
    sid:=new.id;
  elsif tg_op='DELETE' then sid:=old.studio_id;
  else sid:=new.studio_id; end if;
  if exists(select 1 from public.studios where id=sid) then
    insert into encaixa_private.studio_revisions as r(studio_id) values(sid)
    on conflict(studio_id) do update set revision=r.revision+1;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
do $$ declare tbl text; begin
  foreach tbl in array array['studios','clients','services','appointments','payments','professionals','working_hours','professional_hours'] loop
    execute format('drop trigger if exists studio_revision_changed on public.%I',tbl);
    execute format('create trigger studio_revision_changed after insert or update or delete on public.%I for each row execute function encaixa_private.bump_studio_revision()',tbl);
  end loop;
end $$;
create or replace function public.dashboard_revision(p_studio uuid) returns bigint
language plpgsql stable security definer set search_path='' set statement_timeout='3s' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.studios where id=p_studio and owner_id=auth.uid()) then
    raise exception 'Acesso negado.' using errcode='42501';
  end if;
  return coalesce((select revision from encaixa_private.studio_revisions where studio_id=p_studio),0);
end $$;
revoke all on function encaixa_private.bump_studio_revision() from public,anon,authenticated;
revoke all on function public.dashboard_revision(uuid) from public,anon;
grant execute on function public.dashboard_revision(uuid) to authenticated;

-- Avoid a full expiry cleanup on every request. Bounded cleanup, one worker only.
create or replace function public.booking_rate_limit(p_bucket text,p_limit integer,p_seconds integer) returns boolean
language plpgsql security definer set search_path='' set statement_timeout='3s' as $$
declare hits integer;
begin
 if p_bucket is null or length(p_bucket)>200 or p_limit not between 1 and 300 or p_seconds not between 1 and 3600 then return false; end if;
 if random()<0.01 and pg_try_advisory_xact_lock(78143321) then
   delete from encaixa_private.request_limits where bucket in (
     select bucket from encaixa_private.request_limits where expires_at<now()-interval '1 day'
     order by expires_at limit 1000 for update skip locked
   );
 end if;
 insert into encaixa_private.request_limits as r(bucket,hits,expires_at) values(p_bucket,1,now()+make_interval(secs=>p_seconds))
 on conflict(bucket) do update set hits=case when r.expires_at<now() then 1 else least(r.hits+1,p_limit+1) end,
 expires_at=case when r.expires_at<now() then now()+make_interval(secs=>p_seconds) else r.expires_at end returning r.hits into hits;
 return hits<=p_limit;
end $$;
revoke all on function public.booking_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.booking_rate_limit(text,integer,integer) to service_role;
-- Authenticate the bucket inside PostgreSQL; callers cannot spend another owner's quota.
create or replace function public.clara_request_allowed() returns boolean
language plpgsql security definer set search_path='' set statement_timeout='3s' as $$
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
 return public.booking_rate_limit('clara:'||auth.uid()::text,20,60);
end $$;
revoke all on function public.clara_request_allowed() from public,anon;
grant execute on function public.clara_request_allowed() to authenticated;
commit;
