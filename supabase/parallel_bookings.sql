-- Apply ONCE after scheduling_integrity.sql (it depends on the studio schedule
-- mutex). Encaixes: one professional may serve more than one client at the same
-- time when every overlapping service allows it. Existing reservations keep the
-- current behaviour: all of them become exclusive (parallel_limit=1).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Service: "Posso atender outra pessoa junto" + "Até quantas pessoas ao mesmo tempo".
alter table public.services
 add column allows_parallel boolean not null default false,
 add column parallel_limit smallint not null default 2 check(parallel_limit between 2 and 10);
-- Team: "Faz encaixes" and, separately, whether clients may book them online.
alter table public.professionals
 add column accepts_parallel boolean not null default false,
 add column parallel_online boolean not null default false,
 add constraint professionals_parallel_online check(accepts_parallel or not parallel_online);
-- Snapshot, like price and duration: catalog edits never invalidate booked encaixes.
-- 1 = exclusive. Time off (blocked) is always exclusive.
alter table public.appointments
 add column parallel_limit smallint not null default 1 check(parallel_limit between 1 and 10);

-- Exclusive reservations and time off still never overlap each other at the
-- constraint level. Any overlap involving an encaixe is checked by
-- zz_parallel_capacity, serialized per studio by a0_lock_schedule.
alter table public.appointments drop constraint appointments_professional_overlap;
alter table public.appointments add constraint appointments_professional_overlap
 exclude using gist(studio_id with =,professional_id with =,occupied with &&) where(status<>'cancelled' and parallel_limit=1);
create index appointments_professional_occupied_idx on public.appointments
 using gist(studio_id,professional_id,occupied) where(status<>'cancelled');

-- Smallest limit among the chosen services; 1 if any of them is exclusive.
create function encaixa_private.services_parallel_limit(p_studio uuid,p_services uuid[])
returns smallint language sql stable set search_path='' as $$
 select coalesce(case when bool_and(allows_parallel) then min(parallel_limit) end,1)::smallint
 from public.services where studio_id=p_studio and id=any(p_services);
$$;

-- Without overlap there is nothing to check here. With overlap, the professional
-- must do encaixes (and allow them online for public callers) and, at every
-- instant, the people served together cannot exceed the smallest limit among
-- their reservations. Intervals are [start,end): the peak is at some start point.
create function encaixa_private.parallel_fits(p_studio uuid,p_professional uuid,p_occupied tstzrange,p_limit integer,p_exclude uuid,p_public boolean)
returns boolean language sql stable set search_path='' as $$
 with other as (
  select a.occupied,a.parallel_limit from public.appointments a
   where a.studio_id=p_studio and a.professional_id=p_professional and a.status<>'cancelled'
    and (p_exclude is null or a.id<>p_exclude) and a.occupied && p_occupied)
 select not exists(select 1 from other) or (
  p_limit>=2
  and exists(select 1 from public.professionals p where p.id=p_professional and p.studio_id=p_studio
   and p.accepts_parallel and (p.parallel_online or not p_public))
  and not exists(
   select 1 from (select lower(p_occupied) t union select lower(o.occupied) from other o where lower(o.occupied)>lower(p_occupied)) pt
   cross join lateral (select count(*)+1 n,least(p_limit,min(o.parallel_limit)) cap from other o where o.occupied @> pt.t) x
   where x.n>x.cap));
$$;

-- Callers without a user (the public gateway) follow the online rule; the owner
-- (panel and Clara) follows "Faz encaixes". Conflicts keep SQLSTATE 23P01, the
-- same contract as the exclusion constraint (HTTP 409 in the gateway).
create function encaixa_private.check_parallel_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
declare public_call boolean:=auth.uid() is null; accepts boolean;
begin
 if new.status='blocked' then new.parallel_limit:=1;
 elsif tg_op='INSERT' or new.service_ids is distinct from old.service_ids then
  new.parallel_limit:=encaixa_private.services_parallel_limit(new.studio_id,new.service_ids);
 else new.parallel_limit:=old.parallel_limit; end if;
 if new.status='cancelled' then return new; end if;
 if tg_op='UPDATE' and new.occupied=old.occupied and new.professional_id=old.professional_id
  and new.parallel_limit=old.parallel_limit then return new; end if;
 if encaixa_private.parallel_fits(new.studio_id,new.professional_id,new.occupied,new.parallel_limit,new.id,public_call) then
  return new;
 end if;
 select accepts_parallel into accepts from public.professionals where id=new.professional_id and studio_id=new.studio_id;
 if public_call or new.parallel_limit<2 or exists(select 1 from public.appointments a where a.studio_id=new.studio_id
   and a.professional_id=new.professional_id and a.status<>'cancelled' and a.id<>new.id
   and a.occupied && new.occupied and a.parallel_limit<2) then
  raise exception 'Este horário já está ocupado para esta profissional. Escolha outro horário.' using errcode='23P01';
 elsif not accepts then
  raise exception 'Este horário já está ocupado e esta profissional não faz encaixes. Ative em Equipe ou escolha outro horário.' using errcode='23P01';
 end if;
 raise exception 'Este encaixe passaria do limite de pessoas atendidas ao mesmo tempo. Escolha outro horário.' using errcode='23P01';
end $$;
create trigger zz_parallel_capacity before insert or update on public.appointments
 for each row execute function encaixa_private.check_parallel_capacity();

-- Availability: same rules as before, replacing "no overlap" by parallel_fits.
drop function encaixa_private.scheduling_slots(uuid,uuid,integer,integer,date,uuid,uuid[],boolean);
create function encaixa_private.scheduling_slots(p_studio uuid,p_professional uuid,p_duration integer,p_buffer integer,p_date date,p_exclude uuid,p_resources uuid[],
 p_require_online boolean default true,p_limit integer default 1,p_public boolean default true)
returns table(starts_at timestamptz) language sql stable set search_path='' as $$
 with hours as (
  select weekday,enabled,opens,closes from public.professional_hours where studio_id=p_studio and professional_id=p_professional
  union all select h.weekday,h.enabled,h.opens,h.closes from public.working_hours h where h.studio_id=p_studio
   and not exists(select 1 from public.professional_hours ph where ph.studio_id=p_studio and ph.professional_id=p_professional and ph.weekday=h.weekday)
 )
 select slot from public.studios s
 join public.professionals p on p.studio_id=s.id and p.id=p_professional and p.active
 join hours h on h.weekday=extract(dow from p_date)::int and h.enabled
 cross join lateral generate_series((p_date+h.opens) at time zone 'America/Sao_Paulo',(p_date+h.closes) at time zone 'America/Sao_Paulo',interval '15 minutes') slot
 cross join lateral (select tstzrange(slot,slot+make_interval(mins=>p_duration+p_buffer),'[)') occupied) span
 where s.id=p_studio and (s.active or not p_require_online) and p_duration>0 and p_buffer>=0
 and p_date between (statement_timestamp() at time zone 'America/Sao_Paulo')::date and (statement_timestamp() at time zone 'America/Sao_Paulo')::date+s.horizon
 and slot>=statement_timestamp()+make_interval(mins=>s.min_notice)
 and encaixa_private.schedule_fits(s.id,p.id,span.occupied)
 and encaixa_private.parallel_fits(s.id,p.id,span.occupied,p_limit,p_exclude,p_public)
 and encaixa_private.resources_free(s.id,p_resources,span.occupied,p_exclude)
 order by slot;
$$;

-- Clara reschedules as the owner; the reservation keeps its own limit snapshot.
create or replace function encaixa_private.team_slots(p_studio uuid,p_professional uuid,p_duration integer,p_buffer integer,p_date date,p_exclude uuid default null)
returns table(starts_at timestamptz) language sql stable set search_path='' as $$
 select x.starts_at from (select coalesce((select a.resource_ids from public.appointments a where a.id=p_exclude and a.studio_id=p_studio),'{}'::uuid[]) rids,
  coalesce((select a.parallel_limit from public.appointments a where a.id=p_exclude and a.studio_id=p_studio),1) lim) r
 cross join lateral encaixa_private.scheduling_slots(p_studio,p_professional,p_duration,p_buffer,p_date,p_exclude,r.rids,true,r.lim,auth.uid() is null) x;
$$;

-- Owner availability now also tells which free times are encaixes (shared).
drop function public.owner_available_slots(uuid,uuid,uuid[],date,uuid);
create function public.owner_available_slots(p_studio uuid,p_professional uuid,p_services uuid[],p_date date,p_appointment uuid default null)
returns table(starts_at timestamptz,shared boolean) language plpgsql stable security definer set search_path='' as $$
declare s public.studios; a public.appointments; mins integer; b integer; n integer; rids uuid[]; lim integer;
begin
 select * into s from public.studios where id=p_studio and owner_id=auth.uid();
 if s.id is null then raise exception 'Acesso negado.' using errcode='42501'; end if;
 b:=s.buffer;
 if p_appointment is not null then
  select * into a from public.appointments where id=p_appointment and studio_id=s.id and status='confirmed';
  if a.id is null or exists(select 1 from public.payments where appointment_id=a.id) then return; end if;
 end if;
 if a.id is not null and (p_services is null or p_services=a.service_ids) then
  mins:=extract(epoch from (a.ends_at-a.starts_at))/60;
  b:=extract(epoch from (upper(a.occupied)-a.ends_at))/60; rids:=a.resource_ids; lim:=a.parallel_limit;
 else
  if p_services is null or cardinality(p_services) not between 1 and 20 or array_ndims(p_services)<>1 then return; end if;
  select sum(duration),count(*),coalesce(array_agg(distinct resource_id) filter(where resource_id is not null),'{}'::uuid[])
   into mins,n,rids from public.services where studio_id=s.id and id=any(p_services) and active;
  if n<>cardinality(p_services) then return; end if;
  lim:=encaixa_private.services_parallel_limit(s.id,p_services);
 end if;
 return query select x.slot,exists(select 1 from public.appointments o where o.studio_id=s.id and o.professional_id=p_professional
   and o.status<>'cancelled' and (a.id is null or o.id<>a.id) and o.occupied && tstzrange(x.slot,x.slot+make_interval(mins=>mins+b),'[)'))
 from (select y.starts_at slot from encaixa_private.scheduling_slots(s.id,p_professional,mins,b,p_date,a.id,rids,false,lim,false) y
  union
  -- Older manual reservations may start off the 15-minute grid. Editing their
  -- services must check their exact existing start, without a new notice period.
  select a.starts_at where a.id is not null and a.starts_at>=statement_timestamp()
   and (a.starts_at at time zone 'America/Sao_Paulo')::date=p_date
   and exists(select 1 from public.professionals where id=p_professional and studio_id=s.id and active)
   and encaixa_private.schedule_fits(s.id,p_professional,tstzrange(a.starts_at,a.starts_at+make_interval(mins=>mins+b),'[)'))
   and encaixa_private.resources_free(s.id,rids,tstzrange(a.starts_at,a.starts_at+make_interval(mins=>mins+b),'[)'),a.id)
   and encaixa_private.parallel_fits(s.id,p_professional,tstzrange(a.starts_at,a.starts_at+make_interval(mins=>mins+b),'[)'),lim,a.id,false)) x
 order by x.slot;
end $$;
revoke all on function public.owner_available_slots(uuid,uuid,uuid[],date,uuid) from public,anon;
grant execute on function public.owner_available_slots(uuid,uuid,uuid[],date,uuid) to authenticated;

-- Public availability: encaixes only where the professional released them online.
create or replace function public.available_slots_team(p_slug text,p_services uuid[],p_date date,p_token uuid default null,p_professional uuid default null)
returns table(starts_at timestamptz) language plpgsql stable security definer set search_path='' as $$
declare s public.studios; a public.appointments; mins integer; n integer; b integer; excluded uuid; pid uuid; rids uuid[]; lim integer;
begin
 select * into s from public.studios where id=encaixa_private.resolve_studio(p_slug) and active;
 if not found then return; end if;
 pid:=p_professional;
 if pid is null then select id into pid from public.professionals where studio_id=s.id and is_default; end if;
 b:=s.buffer;
 if p_token is not null then
  select ap.* into a from public.appointments ap where ap.manage_token=p_token and ap.studio_id=s.id and ap.status='confirmed' and ap.starts_at>=now()+interval '2 hours';
  if not found or exists(select 1 from public.payments where appointment_id=a.id) then return; end if;
  if p_professional is not null and p_professional<>a.professional_id then return; end if;
  pid:=a.professional_id;
  mins:=extract(epoch from (a.ends_at-a.starts_at))/60;
  b:=extract(epoch from (upper(a.occupied)-a.ends_at))/60; excluded:=a.id; rids:=a.resource_ids; lim:=a.parallel_limit;
 else
  if p_services is null or cardinality(p_services) not between 1 and 20 or array_ndims(p_services)<>1 then return; end if;
  select sum(v.duration),count(*),coalesce(array_agg(distinct v.resource_id) filter(where v.resource_id is not null),'{}'::uuid[]) into mins,n,rids from public.services v where v.id=any(p_services) and v.studio_id=s.id and v.active;
  if n<>cardinality(p_services) then return; end if;
  lim:=encaixa_private.services_parallel_limit(s.id,p_services);
 end if;
 return query select x.starts_at from encaixa_private.scheduling_slots(s.id,pid,mins,b,p_date,excluded,rids,true,lim,true) x;
end $$;

revoke all on function encaixa_private.services_parallel_limit(uuid,uuid[]),
 encaixa_private.parallel_fits(uuid,uuid,tstzrange,integer,uuid,boolean),
 encaixa_private.check_parallel_capacity(),
 encaixa_private.scheduling_slots(uuid,uuid,integer,integer,date,uuid,uuid[],boolean,integer,boolean) from public,anon,authenticated;

commit;
