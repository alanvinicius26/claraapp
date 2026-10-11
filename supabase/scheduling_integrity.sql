-- Apply ONCE after billing.sql. All changes are transactional; no historical
-- appointment is moved or assigned an invented room. See AUDITORIA_AGENDAMENTOS.md.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.resources (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id) on delete cascade,
 name text not null check(length(trim(name)) between 2 and 100),
 active boolean not null default true, created_at timestamptz not null default now(),
 unique(id,studio_id), unique(studio_id,name)
);
alter table public.resources enable row level security;
create policy resource_owner on public.resources for all to authenticated
 using(studio_id in(select id from public.studios where owner_id=(select auth.uid())))
 with check(studio_id in(select id from public.studios where owner_id=(select auth.uid())));
revoke all on public.resources from public,anon,authenticated;
grant select,insert,update on public.resources to authenticated;
alter table public.services add column resource_id uuid;
alter table public.services add constraint services_resource_studio
 foreign key(resource_id,studio_id) references public.resources(id,studio_id);
create index services_resource_idx on public.services(resource_id,studio_id);
alter table public.appointments add column resource_ids uuid[] not null default '{}';

-- One row per required physical resource. Only the appointment trigger can write.
-- The entire continuous visit + cleanup is reserved, even for multiple services.
create table public.appointment_resources (
 appointment_id uuid not null, studio_id uuid not null, resource_id uuid not null,
 occupied tstzrange not null,
 primary key(appointment_id,resource_id),
 foreign key(appointment_id,studio_id) references public.appointments(id,studio_id) on delete cascade,
 foreign key(resource_id,studio_id) references public.resources(id,studio_id),
 check(not isempty(occupied) and not lower_inf(occupied) and not upper_inf(occupied)
   and isfinite(lower(occupied)) and isfinite(upper(occupied)) and lower_inc(occupied) and not upper_inc(occupied)),
 constraint appointment_resources_no_overlap exclude using gist
 (studio_id with =,resource_id with =,occupied with &&)
);
alter table public.appointment_resources enable row level security;
create policy allocation_owner on public.appointment_resources for select to authenticated
 using(studio_id in(select id from public.studios where owner_id=(select auth.uid())));
revoke all on public.appointment_resources from public,anon,authenticated;
grant select on public.appointment_resources to authenticated;
create index appointment_resources_parent_idx on public.appointment_resources(appointment_id,studio_id);

-- A transaction mutex shared by reservations AND configuration changes.
-- Updating a row (rather than only taking an advisory lock) also makes stale
-- REPEATABLE READ transactions fail with 40001, instead of accepting stale rules.
create table encaixa_private.schedule_locks (
 studio_id uuid primary key references public.studios(id) on delete cascade,
 revision bigint not null default 0
);
revoke all on encaixa_private.schedule_locks from public,anon,authenticated;
alter table encaixa_private.schedule_locks enable row level security;
create function encaixa_private.lock_schedule() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 if tg_table_name='studios' then sid:=new.id;
 elsif tg_op='DELETE' then sid:=old.studio_id;
 else sid:=new.studio_id; end if;
 if tg_op='UPDATE' and tg_table_name<>'studios' then
  if new.studio_id is distinct from old.studio_id then raise exception 'O estúdio do registro não pode mudar.'; end if;
 end if;
 if exists(select 1 from public.studios where id=sid) then
  if auth.uid() is not null and not exists(select 1 from public.studios where id=sid and owner_id=auth.uid()) then
   raise exception 'Acesso negado.' using errcode='42501';
  end if;
  insert into encaixa_private.schedule_locks as l(studio_id) values(sid)
  on conflict(studio_id) do update set revision=l.revision+1;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function encaixa_private.lock_schedule() from public,anon,authenticated;
do $$ declare tbl text; begin
 foreach tbl in array array['appointments','services','resources','professionals','working_hours','professional_hours','payments'] loop
  execute format('create trigger a0_lock_schedule before insert or update or delete on public.%I for each row execute function encaixa_private.lock_schedule()',tbl);
 end loop;
end $$;
create trigger a0_lock_schedule before update on public.studios for each row execute function encaixa_private.lock_schedule();
create trigger billing_access_guard before insert or update or delete on public.resources
 for each row execute function encaixa_private.require_studio_subscription();
create trigger studio_revision_changed after insert or update or delete on public.resources
 for each row execute function encaixa_private.bump_studio_revision();

-- All wall-clock rules use the same IANA zone. Intervals are UTC instants [start,end).
create function encaixa_private.schedule_fits(p_studio uuid,p_professional uuid,p_occupied tstzrange)
returns boolean language sql stable set search_path='' as $$
 with day as (select (lower(p_occupied) at time zone 'America/Sao_Paulo')::date d),
 hours as (
  select weekday,enabled,opens,closes,break_start,break_end from public.professional_hours
   where studio_id=p_studio and professional_id=p_professional
  union all
  select h.weekday,h.enabled,h.opens,h.closes,h.break_start,h.break_end from public.working_hours h
   where h.studio_id=p_studio and not exists(select 1 from public.professional_hours ph
    where ph.studio_id=p_studio and ph.professional_id=p_professional and ph.weekday=h.weekday)
 )
 select exists(select 1 from hours h cross join day where h.weekday=extract(dow from d)::int and h.enabled
  and p_occupied <@ tstzrange((d+h.opens) at time zone 'America/Sao_Paulo',(d+h.closes) at time zone 'America/Sao_Paulo','[)')
  and (h.break_start is null or not(p_occupied && tstzrange((d+h.break_start) at time zone 'America/Sao_Paulo',(d+h.break_end) at time zone 'America/Sao_Paulo','[)'))));
$$;
create function encaixa_private.resources_free(p_studio uuid,p_resources uuid[],p_occupied tstzrange,p_exclude uuid default null)
returns boolean language sql stable set search_path='' as $$
 select not exists(select 1 from unnest(p_resources) rid where not exists(
   select 1 from public.resources r where r.id=rid and r.studio_id=p_studio and r.active))
 and not exists(select 1 from public.appointment_resources r where r.studio_id=p_studio
   and r.resource_id=any(p_resources) and (p_exclude is null or r.appointment_id<>p_exclude) and r.occupied && p_occupied);
$$;

-- Executed AFTER normalization: no caller can forge end, cleanup or resources.
create function encaixa_private.validate_schedule() returns trigger
language plpgsql security definer set search_path='' as $$
declare changed boolean; s public.studios; rid uuid;
begin
 if not isfinite(new.starts_at) or not isfinite(new.ends_at) or new.ends_at<=new.starts_at then
  raise exception 'Informe um intervalo de horário válido.';
 end if;
 if tg_op='UPDATE' and new.id is distinct from old.id then raise exception 'A identificação da reserva não pode mudar.'; end if;
 changed:=tg_op='INSERT' or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at
   or new.professional_id is distinct from old.professional_id or new.service_ids is distinct from old.service_ids;
 if new.status='blocked' then new.resource_ids:='{}';
 elsif tg_op='INSERT' or new.service_ids is distinct from old.service_ids
   or (new.status='confirmed' and new.ends_at>statement_timestamp()) then
  select coalesce(array_agg(distinct resource_id order by resource_id) filter(where resource_id is not null),'{}'::uuid[])
   into new.resource_ids from public.services where studio_id=new.studio_id and id=any(new.service_ids);
 else new.resource_ids:=old.resource_ids; end if;
 if tg_op='UPDATE' then changed:=changed or new.resource_ids is distinct from old.resource_ids; end if;
 if changed and new.status not in('blocked','cancelled') then
  select * into s from public.studios where id=new.studio_id;
  if not exists(select 1 from public.professionals where id=new.professional_id and studio_id=new.studio_id and active) then
   raise exception 'Escolha uma profissional ativa deste salão.';
  end if;
  if tg_op='INSERT' or new.starts_at is distinct from old.starts_at then
   if new.starts_at<statement_timestamp()+make_interval(mins=>s.min_notice)
    or (new.starts_at at time zone 'America/Sao_Paulo')::date>(statement_timestamp() at time zone 'America/Sao_Paulo')::date+s.horizon then
    raise exception 'Escolha um horário dentro da antecedência e do período de reservas do estúdio.';
   end if;
  end if;
  if not encaixa_private.schedule_fits(new.studio_id,new.professional_id,new.occupied) then
   raise exception 'O atendimento e a limpeza precisam caber no expediente da profissional, sem invadir almoço ou folga.';
  end if;
  foreach rid in array new.resource_ids loop
   if not exists(select 1 from public.resources where id=rid and studio_id=new.studio_id and active) then
    raise exception 'Uma sala ou maca necessária está indisponível. Fale com o estúdio.';
   end if;
  end loop;
 end if;
 return new;
end $$;
create trigger z_validate_schedule before insert or update on public.appointments
 for each row execute function encaixa_private.validate_schedule();

create function encaixa_private.sync_appointment_resources() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.occupied=old.occupied and new.resource_ids=old.resource_ids and new.status=old.status then return new; end if;
 delete from public.appointment_resources where appointment_id=new.id;
 if new.status not in('cancelled','blocked') then
  insert into public.appointment_resources(appointment_id,studio_id,resource_id,occupied)
   select new.id,new.studio_id,rid,new.occupied from unnest(new.resource_ids) rid order by rid;
 end if;
 return new;
end $$;
create trigger sync_appointment_resources after insert or update on public.appointments
 for each row execute function encaixa_private.sync_appointment_resources();

-- Reject changes which would make a future reservation invalid. A leave can be
-- entered as a blocked appointment; its professional exclusion is authoritative.
create function encaixa_private.guard_schedule_configuration() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 if tg_op='DELETE' then sid:=old.studio_id; else sid:=new.studio_id; end if;
 if tg_table_name in('working_hours','professional_hours') then
  if exists(select 1 from public.appointments a where a.studio_id=sid and a.status='confirmed' and a.ends_at>statement_timestamp()
    and not encaixa_private.schedule_fits(a.studio_id,a.professional_id,a.occupied)) then
   raise exception 'Este expediente deixaria um atendimento sem cobertura. Remarque ou cancele os horários afetados primeiro.';
  end if;
 elsif tg_table_name='services' and tg_op='UPDATE' then
  if new.resource_id is distinct from old.resource_id then
   -- Reconcile future reservations atomically when the owner maps a physical
   -- resource. Existing time/price snapshots stay untouched. Any exclusion
   -- failure rolls back BOTH the service setting and ALL updated allocations.
   perform 1 from public.appointments where studio_id=sid and status='confirmed'
    and ends_at>statement_timestamp() and old.id=any(service_ids) order by id for update;
   update public.appointments set notes=notes where studio_id=sid and status='confirmed'
    and ends_at>statement_timestamp() and old.id=any(service_ids);
  end if;
 elsif tg_table_name='resources' and tg_op='UPDATE' then
  if new.id is distinct from old.id then raise exception 'A identificação da sala ou maca não pode mudar.'; end if;
  if not new.active and exists(select 1 from public.appointment_resources r where r.resource_id=new.id and upper(r.occupied)>statement_timestamp()) then
   raise exception 'Esta sala ou maca tem reservas futuras. Remarque ou cancele antes de desativar.';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
do $$ declare tbl text; begin
 foreach tbl in array array['working_hours','professional_hours','services','resources'] loop
  execute format('create trigger z_guard_schedule_configuration after insert or update or delete on public.%I for each row execute function encaixa_private.guard_schedule_configuration()',tbl);
 end loop;
end $$;

create function encaixa_private.scheduling_slots(p_studio uuid,p_professional uuid,p_duration integer,p_buffer integer,p_date date,p_exclude uuid,p_resources uuid[],p_require_online boolean default true)
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
 and not exists(select 1 from public.appointments a where a.studio_id=s.id and a.professional_id=p.id
  and a.status<>'cancelled' and (p_exclude is null or a.id<>p_exclude) and a.occupied && span.occupied)
 and encaixa_private.resources_free(s.id,p_resources,span.occupied,p_exclude)
 order by slot;
$$;

-- Existing Clara callers automatically use the reservation's resource snapshot.
create or replace function encaixa_private.team_slots(p_studio uuid,p_professional uuid,p_duration integer,p_buffer integer,p_date date,p_exclude uuid default null)
returns table(starts_at timestamptz) language sql stable set search_path='' as $$
 select * from encaixa_private.scheduling_slots(p_studio,p_professional,p_duration,p_buffer,p_date,p_exclude,
  coalesce((select resource_ids from public.appointments where id=p_exclude and studio_id=p_studio),'{}'::uuid[]));
$$;

-- Owner-only availability for create, transfer, reschedule and service changes.
create function public.owner_available_slots(p_studio uuid,p_professional uuid,p_services uuid[],p_date date,p_appointment uuid default null)
returns table(starts_at timestamptz) language plpgsql stable security definer set search_path='' as $$
declare s public.studios; a public.appointments; mins integer; b integer; n integer; rids uuid[];
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
  b:=extract(epoch from (upper(a.occupied)-a.ends_at))/60; rids:=a.resource_ids;
 else
  if p_services is null or cardinality(p_services) not between 1 and 20 or array_ndims(p_services)<>1 then return; end if;
  select sum(duration),count(*),coalesce(array_agg(distinct resource_id) filter(where resource_id is not null),'{}'::uuid[])
   into mins,n,rids from public.services where studio_id=s.id and id=any(p_services) and active;
  if n<>cardinality(p_services) then return; end if;
 end if;
 return query select x.starts_at from encaixa_private.scheduling_slots(s.id,p_professional,mins,b,p_date,a.id,rids,false) x
 union
 -- Older manual reservations may start off the 15-minute grid. Editing their
 -- services must check their exact existing start, without a new notice period.
 select a.starts_at where a.id is not null and a.starts_at>=statement_timestamp()
  and (a.starts_at at time zone 'America/Sao_Paulo')::date=p_date
  and exists(select 1 from public.professionals where id=p_professional and studio_id=s.id and active)
  and encaixa_private.schedule_fits(s.id,p_professional,tstzrange(a.starts_at,a.starts_at+make_interval(mins=>mins+b),'[)'))
  and encaixa_private.resources_free(s.id,rids,tstzrange(a.starts_at,a.starts_at+make_interval(mins=>mins+b),'[)'),a.id)
  and not exists(select 1 from public.appointments ap where ap.studio_id=s.id and ap.professional_id=p_professional
   and ap.id<>a.id and ap.status<>'cancelled' and ap.occupied && tstzrange(a.starts_at,a.starts_at+make_interval(mins=>mins+b),'[)'))
 order by starts_at;
end $$;
revoke all on function public.owner_available_slots(uuid,uuid,uuid[],date,uuid) from public,anon;
grant execute on function public.owner_available_slots(uuid,uuid,uuid[],date,uuid) to authenticated;

-- Explicit ACLs for every new private function (trigger execution needs no grant).
revoke all on function encaixa_private.schedule_fits(uuid,uuid,tstzrange),
 encaixa_private.resources_free(uuid,uuid[],tstzrange,uuid),encaixa_private.validate_schedule(),
 encaixa_private.sync_appointment_resources(),encaixa_private.guard_schedule_configuration(),
 encaixa_private.scheduling_slots(uuid,uuid,integer,integer,date,uuid,uuid[],boolean) from public,anon,authenticated;

-- Public availability replacement is appended below, before COMMIT.

create or replace function public.available_slots_team(p_slug text,p_services uuid[],p_date date,p_token uuid default null,p_professional uuid default null)
returns table(starts_at timestamptz) language plpgsql stable security definer set search_path='' as $$
declare s public.studios; a public.appointments; mins integer; n integer; b integer; excluded uuid; pid uuid; rids uuid[];
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
  b:=extract(epoch from (upper(a.occupied)-a.ends_at))/60; excluded:=a.id; rids:=a.resource_ids;
 else
  if p_services is null or cardinality(p_services) not between 1 and 20 or array_ndims(p_services)<>1 then return; end if;
  select sum(v.duration),count(*),coalesce(array_agg(distinct v.resource_id) filter(where v.resource_id is not null),'{}'::uuid[]) into mins,n,rids from public.services v where v.id=any(p_services) and v.studio_id=s.id and v.active;
  if n<>cardinality(p_services) then return; end if;
 end if;
 return query select x.starts_at from encaixa_private.scheduling_slots(s.id,pid,mins,b,p_date,excluded,rids) x;
end $$;


commit;
