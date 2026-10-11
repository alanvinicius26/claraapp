-- Independent agendas. Existing appointments retain all financial/time snapshots.
create table public.professionals (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
 name text not null check(length(trim(name)) between 2 and 100), active boolean not null default true,
 is_default boolean not null default false, created_at timestamptz not null default now(), unique(id,studio_id)
);
create unique index professionals_default on public.professionals(studio_id) where is_default;
create table public.professional_hours (
 professional_id uuid not null, studio_id uuid not null, weekday integer not null check(weekday between 0 and 6),
 enabled boolean not null default true, opens time not null, closes time not null,
 break_start time, break_end time, primary key(professional_id,weekday),
 foreign key(professional_id,studio_id) references public.professionals(id,studio_id) on delete cascade,
 check(opens<closes),
 check((break_start is null and break_end is null) or (break_start is not null and break_end is not null and break_start<break_end and break_start>=opens and break_end<=closes))
);
alter table public.professionals enable row level security;
alter table public.professional_hours enable row level security;
create policy professional_owner on public.professionals for all to authenticated
 using(studio_id in(select id from public.studios where owner_id=(select auth.uid())))
 with check(studio_id in(select id from public.studios where owner_id=(select auth.uid())));
create policy professional_hours_owner on public.professional_hours for all to authenticated
 using(studio_id in(select id from public.studios where owner_id=(select auth.uid())))
 with check(studio_id in(select id from public.studios where owner_id=(select auth.uid())));
revoke all on public.professionals,public.professional_hours from anon;
grant select,insert,update on public.professionals to authenticated;
revoke delete on public.professionals from authenticated;
grant select,insert,update,delete on public.professional_hours to authenticated;
insert into public.professionals(studio_id,name,is_default)
 select id,case when length(trim(professional))>=2 then left(trim(professional),100) else name end,true from public.studios;
create function encaixa_private.create_primary_professional() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.professionals(studio_id,name,is_default) values(new.id,case when length(trim(new.professional))>=2 then left(trim(new.professional),100) else new.name end,true);
 return new;
end $$;
revoke all on function encaixa_private.create_primary_professional() from public,anon,authenticated;
create trigger create_primary_professional after insert on public.studios for each row execute function encaixa_private.create_primary_professional();
create function encaixa_private.protect_professional_identity() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.id is distinct from old.id or new.studio_id is distinct from old.studio_id or new.is_default is distinct from old.is_default then
  raise exception 'A identificação da profissional não pode mudar.';
 end if;
 return new;
end $$;
revoke all on function encaixa_private.protect_professional_identity() from public,anon,authenticated;
create trigger protect_professional_identity before update on public.professionals for each row execute function encaixa_private.protect_professional_identity();

alter table public.appointments add column professional_id uuid;
update public.appointments a set professional_id=p.id from public.professionals p where p.studio_id=a.studio_id and p.is_default;
alter table public.appointments alter column professional_id set not null;
alter table public.appointments add constraint appointments_professional_studio foreign key(professional_id,studio_id) references public.professionals(id,studio_id);
-- Replace only the old studio-wide exclusion; keep the rest of the constraints.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.appointments'::regclass and contype='x' loop
  execute format('alter table public.appointments drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.appointments add constraint appointments_professional_overlap
 exclude using gist(studio_id with =,professional_id with =,occupied with &&) where(status<>'cancelled');
create function encaixa_private.assign_professional() returns trigger
language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' and new.professional_id is null then
  select id into new.professional_id from public.professionals where studio_id=new.studio_id and is_default;
 end if;
 if TG_OP='INSERT' or new.professional_id is distinct from old.professional_id then
  perform 1 from public.professionals where id=new.professional_id and studio_id=new.studio_id and active for share;
  if not found then raise exception 'Escolha uma profissional ativa deste salão.'; end if;
  if TG_OP='UPDATE' and (old.status in('completed','cancelled') or exists(select 1 from public.payments where appointment_id=old.id)) then
   raise exception 'Não é possível trocar a profissional de um atendimento finalizado, cancelado ou pago.';
  end if;
 end if;
 return new;
end $$;
revoke all on function encaixa_private.assign_professional() from public,anon,authenticated;
create trigger aa_assign_professional before insert or update on public.appointments for each row execute function encaixa_private.assign_professional();

create function public.save_professional_hours(p_professional uuid,p_hours jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare sid uuid; h jsonb;
begin
 select p.studio_id into sid from public.professionals p join public.studios s on s.id=p.studio_id where p.id=p_professional and s.owner_id=auth.uid() for update of p;
 if sid is null then raise exception 'Acesso negado.'; end if;
 if jsonb_typeof(p_hours)<>'array' or jsonb_array_length(p_hours)<>7 or (select count(distinct (x->>'weekday')::int) from jsonb_array_elements(p_hours) x)<>7 then
  raise exception 'Informe os sete dias da semana.';
 end if;
 for h in select * from jsonb_array_elements(p_hours) loop
  insert into public.professional_hours(professional_id,studio_id,weekday,enabled,opens,closes,break_start,break_end)
  values(p_professional,sid,(h->>'weekday')::int,(h->>'enabled')::boolean,(h->>'opens')::time,(h->>'closes')::time,nullif(h->>'break_start','')::time,nullif(h->>'break_end','')::time)
  on conflict(professional_id,weekday) do update set enabled=excluded.enabled,opens=excluded.opens,closes=excluded.closes,break_start=excluded.break_start,break_end=excluded.break_end;
 end loop;
end $$;
revoke all on function public.save_professional_hours(uuid,jsonb) from public,anon;
grant execute on function public.save_professional_hours(uuid,jsonb) to authenticated;

create function encaixa_private.team_slots(p_studio uuid,p_professional uuid,p_duration integer,p_buffer integer,p_date date,p_exclude uuid default null)
returns table(starts_at timestamptz) language sql stable set search_path='' as $$
 with hours as (
  select weekday,enabled,opens,closes,break_start,break_end from public.professional_hours where studio_id=p_studio and professional_id=p_professional
  union all
  select h.weekday,h.enabled,h.opens,h.closes,h.break_start,h.break_end from public.working_hours h where h.studio_id=p_studio
  and not exists(select 1 from public.professional_hours ph where ph.professional_id=p_professional and ph.weekday=h.weekday)
 )
 select slot from public.studios s
 join public.professionals p on p.studio_id=s.id and p.id=p_professional and p.active
 join hours h on h.weekday=extract(dow from p_date)::int and h.enabled
 cross join lateral generate_series((p_date+h.opens) at time zone 'America/Sao_Paulo',(p_date+h.closes) at time zone 'America/Sao_Paulo',interval '15 minutes') slot
 where s.id=p_studio and s.active and p_duration>0
 and p_date between (now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date+s.horizon
 and slot>=now()+make_interval(mins=>s.min_notice)
 and slot+make_interval(mins=>p_duration+p_buffer)<=(p_date+h.closes) at time zone 'America/Sao_Paulo'
 and (h.break_start is null or not(tstzrange(slot,slot+make_interval(mins=>p_duration+p_buffer),'[)') && tstzrange((p_date+h.break_start) at time zone 'America/Sao_Paulo',(p_date+h.break_end) at time zone 'America/Sao_Paulo','[)')))
 and not exists(select 1 from public.appointments a where a.studio_id=s.id and a.professional_id=p_professional and a.status<>'cancelled' and (p_exclude is null or a.id<>p_exclude) and a.occupied && tstzrange(slot,slot+make_interval(mins=>p_duration+p_buffer),'[)'))
 order by slot;
$$;
revoke all on function encaixa_private.team_slots(uuid,uuid,integer,integer,date,uuid) from public,anon,authenticated;

create or replace function public.available_slots_team(p_slug text,p_services uuid[],p_date date,p_token uuid default null,p_professional uuid default null)
returns table(starts_at timestamptz) language plpgsql stable security definer set search_path='' as $$
declare s public.studios; a public.appointments; mins integer; n integer; b integer; excluded uuid; pid uuid;
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
  b:=extract(epoch from (upper(a.occupied)-a.ends_at))/60; excluded:=a.id;
 else
  if p_services is null or cardinality(p_services) not between 1 and 20 or array_ndims(p_services)<>1 then return; end if;
  select sum(v.duration),count(*) into mins,n from public.services v where v.id=any(p_services) and v.studio_id=s.id and v.active;
  if n<>cardinality(p_services) then return; end if;
 end if;
 return query select x.starts_at from encaixa_private.team_slots(s.id,pid,mins,b,p_date,excluded) x;
end $$;

create or replace function public.book_appointment_team(p_slug text,p_services uuid[],p_start timestamptz,p_name text,p_email text,p_phone text,p_notes text default '',p_professional uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; cid uuid; pid uuid; a public.appointments;
begin
 select id into sid from public.studios where id=encaixa_private.resolve_studio(p_slug) and active for update;
 if sid is null then raise exception 'Esta agenda não está disponível.'; end if;
 if p_name is null or p_email is null or p_phone is null or p_notes is null or length(trim(p_name)) not between 2 and 120 or length(p_email)>254 or (trim(p_email)<>'' and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or length(p_phone)>30 or length(p_notes)>2000 then raise exception 'Confira seu nome, e-mail e telefone.'; end if;
 p_phone:=regexp_replace(p_phone,'[^0-9]','','g');
 if length(p_phone) in (12,13) and left(p_phone,2)='55' then p_phone:=substr(p_phone,3); end if;
 if p_phone !~ '^[1-9][0-9][2-9][0-9]{7,8}$' then raise exception 'Informe um WhatsApp válido com DDD.'; end if;
 pid:=p_professional;
 if pid is null then select id into pid from public.professionals where studio_id=sid and is_default; end if;
 perform 1 from public.professionals where id=pid and studio_id=sid and active for share;
 if not found then raise exception 'Escolha uma profissional ativa deste salão.'; end if;
 perform 1 from public.services where id=any(p_services) and studio_id=sid order by id for share;
 if not exists(select 1 from public.available_slots_team(p_slug,p_services,(p_start at time zone 'America/Sao_Paulo')::date,null,pid) x where x.starts_at=p_start) then raise exception 'O conjunto de serviços não cabe neste horário. Escolha outro horário.'; end if;
 insert into public.clients(studio_id,name,email,phone) values(sid,trim(p_name),lower(trim(p_email)),trim(p_phone)) returning id into cid;
 insert into public.appointments(studio_id,professional_id,service_ids,client_id,starts_at,ends_at,notes,source) values(sid,pid,p_services,cid,p_start,p_start+interval '1 minute',p_notes,'online') returning * into a;
 return jsonb_build_object('id',a.id,'token',a.manage_token);
end $$;

create function public.available_dates_team(p_slug text,p_services uuid[],p_after date,p_until date,p_token uuid default null,p_professional uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d date; last_day date; cursor_day date:=p_after; first_slot timestamptz; dates jsonb:='[]'; h integer;
begin
 select horizon into h from public.studios where id=encaixa_private.resolve_studio(p_slug) and active;
 if p_after is null or p_until is null or h is null then raise exception 'Agenda indisponível.'; end if;
 last_day:=least(p_until,(now() at time zone 'America/Sao_Paulo')::date+h);
 d:=greatest(p_after+1,(now() at time zone 'America/Sao_Paulo')::date);
 while d<=least(last_day,p_after+14) and jsonb_array_length(dates)<3 loop
  select min(x.starts_at) into first_slot from public.available_slots_team(p_slug,p_services,d,p_token,p_professional) x;
  cursor_day:=d;
  if first_slot is not null then dates:=dates||jsonb_build_array(jsonb_build_object('date',d,'first',first_slot)); end if;
  d:=d+1;
 end loop;
 return jsonb_build_object('dates',dates,'through',cursor_day,'hasMore',cursor_day<last_day);
end $$;

create or replace function public.booking_page(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('studio',jsonb_build_object('id',s.id,'name',s.name,'professional',s.professional,'bio',s.bio,'phone',s.phone,'address',s.address,'active',s.active,'horizon',s.horizon,'image_url',s.image_url),
 'professionals',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'is_default',p.is_default) order by p.is_default desc,p.name) from public.professionals p where p.studio_id=s.id and p.active),'[]'::jsonb),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'description',v.description,'category',v.category,'price',v.price,'duration',v.duration,'image_url',v.image_url) order by v.name) from public.services v where v.studio_id=s.id and v.active),'[]'::jsonb))
 from public.studios s where s.id=encaixa_private.resolve_studio(p_slug);
$$;

create or replace function public.manage_booking(p_token uuid,p_action text default 'get',p_start timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.appointments; s public.studios;
begin
 select * into s from public.studios where id=(select studio_id from public.appointments where manage_token=p_token) for update;
 select * into a from public.appointments where manage_token=p_token for update;
 if a.id is null then raise exception 'Reserva não encontrada. Confira seu link.'; end if;
 if p_action is null or p_action not in ('get','cancel','reschedule') then raise exception 'Ação inválida.'; end if;
 if p_action<>'get' then
  if a.status<>'confirmed' or a.starts_at<now()+interval '2 hours' then raise exception 'Alterações online são permitidas até 2 horas antes. Entre em contato com o estúdio.'; end if;
  if exists(select 1 from public.payments where appointment_id=a.id) then raise exception 'Esta reserva tem pagamento registrado. Fale com o estúdio para alterar.'; end if;
  if p_action='cancel' then update public.appointments set status='cancelled' where id=a.id returning * into a;
  else
   if p_start is null or not exists(select 1 from public.available_slots_multi(s.slug,a.service_ids,(p_start at time zone 'America/Sao_Paulo')::date,p_token) x where x.starts_at=p_start) then raise exception 'O conjunto de serviços não cabe neste horário. Escolha outro horário.'; end if;
   update public.appointments set starts_at=p_start where id=a.id returning * into a;
  end if;
 end if;
 return jsonb_build_object('id',a.id,'service_id',a.service_id,'service_ids',a.service_ids,'service_items',a.service_items,'service',a.service_name,'starts_at',a.starts_at,'ends_at',a.ends_at,'price',a.price,'status',a.status,'professional_id',a.professional_id,'professional_name',(select name from public.professionals where id=a.professional_id),'paid',exists(select 1 from public.payments where appointment_id=a.id),'horizon',s.horizon,'studio',s.name,'slug',s.slug,'phone',s.phone,'address',s.address,'name',(select name from public.clients where id=a.client_id));
end $$;

-- Legacy callers keep the main agenda; token-based rescheduling uses the booked professional.
create or replace function public.available_slots_multi(p_slug text,p_services uuid[],p_date date,p_token uuid default null)
returns table(starts_at timestamptz) language sql stable security definer set search_path='' as $$
 select * from public.available_slots_team(p_slug,p_services,p_date,p_token,null);
$$;
create or replace function public.book_appointment_multi(p_slug text,p_services uuid[],p_start timestamptz,p_name text,p_email text,p_phone text,p_notes text default '')
returns jsonb language sql security definer set search_path='' as $$
 select public.book_appointment_team(p_slug,p_services,p_start,p_name,p_email,p_phone,p_notes,null);
$$;
create or replace function public.available_dates_multi(p_slug text,p_services uuid[],p_after date,p_until date,p_token uuid default null)
returns jsonb language sql stable security definer set search_path='' as $$
 select public.available_dates_team(p_slug,p_services,p_after,p_until,p_token,null);
$$;
revoke all on function public.available_slots_team(text,uuid[],date,uuid,uuid),public.book_appointment_team(text,uuid[],timestamptz,text,text,text,text,uuid),public.available_dates_team(text,uuid[],date,date,uuid,uuid) from public,anon,authenticated;
grant execute on function public.available_slots_team(text,uuid[],date,uuid,uuid),public.book_appointment_team(text,uuid[],timestamptz,text,text,text,text,uuid),public.available_dates_team(text,uuid[],date,date,uuid,uuid) to service_role;
