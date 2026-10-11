-- Encaixa v1. Remote migration source. All times use America/Sao_Paulo.
create extension if not exists btree_gist with schema extensions;
create schema if not exists encaixa_private;
revoke all on schema encaixa_private from public, anon, authenticated;

create table public.studios (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null unique references auth.users(id) on delete cascade,
 name text not null check(length(name) between 2 and 100), slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
 professional text not null, bio text not null default '', phone text not null default '', address text not null default '',
 active boolean not null default true, min_notice integer not null default 120 check(min_notice between 0 and 10080),
 horizon integer not null default 30 check(horizon between 1 and 90), buffer integer not null default 15 check(buffer between 0 and 120),
 created_at timestamptz not null default now()
);
create table public.working_hours (
 studio_id uuid not null references public.studios(id) on delete cascade, weekday integer not null check(weekday between 0 and 6),
 enabled boolean not null default true, opens time not null default '09:00', closes time not null default '18:00',
 break_start time default '12:00', break_end time default '13:00', primary key(studio_id,weekday),
 check(opens < closes), check((break_start is null and break_end is null) or (break_start is not null and break_end is not null and break_start < break_end and break_start >= opens and break_end <= closes))
);
create table public.services (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
 name text not null check(length(name) between 2 and 120), category text not null default 'Unhas & cuidados', description text not null default '',
 price numeric(10,2) not null check(price >= 0), duration integer not null check(duration between 5 and 480),
 active boolean not null default true, color text not null default '#6e1936', created_at timestamptz not null default now(), unique(id,studio_id)
);
create table public.clients (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
 name text not null check(length(name) between 2 and 120), email text not null default '' check(length(email)<=254),
 phone text not null default '' check(length(phone)<=30), notes text not null default '' check(length(notes)<=5000),
 created_at timestamptz not null default now(), unique(id,studio_id)
);
create table public.appointments (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
 service_id uuid, client_id uuid, starts_at timestamptz not null, ends_at timestamptz not null,
 occupied tstzrange not null, service_name text not null default '', price numeric(10,2) not null default 0 check(price>=0),
 status text not null default 'confirmed' check(status in ('confirmed','completed','cancelled','blocked')),
 notes text not null default '' check(length(notes)<=2000), source text not null default 'manual' check(source in ('manual','online')),
 manage_token uuid not null unique default gen_random_uuid(), created_at timestamptz not null default now(),
 foreign key(service_id,studio_id) references public.services(id,studio_id), foreign key(client_id,studio_id) references public.clients(id,studio_id),
 check(ends_at > starts_at), check(status='blocked' or (service_id is not null and client_id is not null)), unique(id,studio_id),
 exclude using gist (studio_id with =, occupied with &&) where (status <> 'cancelled')
);
create table public.payments (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id) on delete cascade,
 appointment_id uuid not null unique, amount numeric(10,2) not null check(amount>=0),
 method text not null check(method in ('Pix','Cartão','Dinheiro')), paid_at timestamptz not null default now(),
 foreign key(appointment_id,studio_id) references public.appointments(id,studio_id)
);
create index services_studio_idx on public.services(studio_id);
create index clients_studio_idx on public.clients(studio_id);
create index appointments_client_idx on public.appointments(client_id,studio_id);
create index appointments_service_idx on public.appointments(service_id,studio_id);
create index appointments_date_idx on public.appointments(studio_id,starts_at);
create index payments_studio_idx on public.payments(studio_id);

alter table public.studios enable row level security;
alter table public.working_hours enable row level security;
alter table public.services enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.payments enable row level security;
create policy studio_owner on public.studios for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
do $$ declare t text; begin
 foreach t in array array['working_hours','services','clients','appointments','payments'] loop
 execute format('create policy tenant_owner on public.%I for all to authenticated using (studio_id in (select id from public.studios where owner_id=(select auth.uid()))) with check (studio_id in (select id from public.studios where owner_id=(select auth.uid())))',t);
 end loop;
end $$;
revoke all on public.studios,public.working_hours,public.services,public.clients,public.appointments,public.payments from anon;
grant select,insert,update,delete on public.studios,public.working_hours,public.services,public.clients,public.appointments,public.payments to authenticated;

create function encaixa_private.normalize_appointment() returns trigger language plpgsql set search_path='' as $$
declare s public.services; b integer;
begin
 if TG_OP='UPDATE' then
  if new.studio_id <> old.studio_id or new.manage_token <> old.manage_token then raise exception 'Identificação da reserva não pode mudar.'; end if;
  if old.status='cancelled' and new.status <> 'cancelled' then raise exception 'Crie um novo agendamento para este atendimento.'; end if;
 end if;
 if TG_OP='INSERT' or new.starts_at is distinct from old.starts_at or new.service_id is distinct from old.service_id then
  if new.status='blocked' then new.price:=0; new.service_name:='Horário bloqueado'; new.occupied:=tstzrange(new.starts_at,new.ends_at,'[)');
  else
   select * into s from public.services where id=new.service_id and studio_id=new.studio_id;
   if s.id is null or not s.active then raise exception 'Serviço indisponível.'; end if;
   select buffer into b from public.studios where id=new.studio_id;
   new.ends_at:=new.starts_at + make_interval(mins=>s.duration);
   new.occupied:=tstzrange(new.starts_at,new.ends_at+make_interval(mins=>b),'[)');
   if TG_OP='INSERT' or new.service_id is distinct from old.service_id then new.price:=s.price; new.service_name:=s.name; end if;
  end if;
 elsif TG_OP='UPDATE' then
  new.ends_at:=old.ends_at; new.occupied:=old.occupied; new.price:=old.price; new.service_name:=old.service_name;
 end if;
 return new;
end $$;
create trigger normalize_appointment before insert or update on public.appointments for each row execute function encaixa_private.normalize_appointment();

create function encaixa_private.normalize_payment() returns trigger language plpgsql set search_path='' as $$
declare a public.appointments;
begin
 select * into a from public.appointments where id=new.appointment_id and studio_id=new.studio_id for update;
 if a.id is null or a.status in ('cancelled','blocked') then raise exception 'Atendimento indisponível para pagamento.'; end if;
 new.amount:=a.price; return new;
end $$;
create trigger normalize_payment before insert or update on public.payments for each row execute function encaixa_private.normalize_payment();

create function public.setup_studio(p_name text,p_professional text,p_slug text) returns uuid language plpgsql security invoker set search_path='' as $$
declare sid uuid;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 insert into public.studios(owner_id,name,professional,slug) values(auth.uid(),trim(p_name),trim(p_professional),lower(trim(p_slug))) returning id into sid;
 insert into public.working_hours(studio_id,weekday,enabled) select sid,d,d between 1 and 6 from generate_series(0,6) d;
 return sid;
end $$;

-- Public RPCs deliberately expose only public projections and token-scoped reservations.
-- Anonymous visitors cannot access any base table, client lists, or internal notes.
create function public.booking_page(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('studio',jsonb_build_object('id',s.id,'name',s.name,'professional',s.professional,'bio',s.bio,'phone',s.phone,'address',s.address,'active',s.active,'horizon',s.horizon),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'description',v.description,'category',v.category,'price',v.price,'duration',v.duration) order by v.name) from public.services v where v.studio_id=s.id and v.active),'[]'::jsonb))
 from public.studios s where s.slug=p_slug;
$$;

create function public.available_slots(p_slug text,p_service uuid,p_date date) returns table(starts_at timestamptz) language sql stable security definer set search_path='' as $$
 select slot from public.studios s
 join public.services v on v.studio_id=s.id and v.id=p_service and v.active
 join public.working_hours h on h.studio_id=s.id and h.weekday=extract(dow from p_date)::int and h.enabled
 cross join lateral generate_series((p_date+h.opens) at time zone 'America/Sao_Paulo', (p_date+h.closes) at time zone 'America/Sao_Paulo',interval '15 minutes') slot
 where s.slug=p_slug and s.active
 and p_date between (now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date+s.horizon
 and slot>=now()+make_interval(mins=>s.min_notice)
 and slot+make_interval(mins=>v.duration+s.buffer)<=(p_date+h.closes) at time zone 'America/Sao_Paulo'
 and (h.break_start is null or not (tstzrange(slot,slot+make_interval(mins=>v.duration+s.buffer),'[)') && tstzrange((p_date+h.break_start) at time zone 'America/Sao_Paulo',(p_date+h.break_end) at time zone 'America/Sao_Paulo','[)')))
 and not exists(select 1 from public.appointments a where a.studio_id=s.id and a.status<>'cancelled' and a.occupied && tstzrange(slot,slot+make_interval(mins=>v.duration+s.buffer),'[)'))
 order by slot;
$$;

create function public.book_appointment(p_slug text,p_service uuid,p_start timestamptz,p_name text,p_email text,p_phone text,p_notes text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; cid uuid; a public.appointments;
begin
 select id into sid from public.studios where slug=p_slug and active for update;
 if sid is null then raise exception 'Esta agenda não está disponível.'; end if;
 if length(trim(p_name)) not between 2 and 120 or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_phone)>30 or length(p_notes)>2000 then raise exception 'Confira seu nome, e-mail e telefone.'; end if;
 if not exists(select 1 from public.available_slots(p_slug,p_service,(p_start at time zone 'America/Sao_Paulo')::date) x where x.starts_at=p_start) then raise exception 'Horário indisponível. Escolha outro horário.'; end if;
 -- Do not merge by an unverified email: callers cannot overwrite an existing client.
 insert into public.clients(studio_id,name,email,phone) values(sid,trim(p_name),lower(trim(p_email)),trim(p_phone)) returning id into cid;
 insert into public.appointments(studio_id,service_id,client_id,starts_at,ends_at,notes,source) values(sid,p_service,cid,p_start,p_start+interval '1 minute',p_notes,'online') returning * into a;
 return jsonb_build_object('id',a.id,'token',a.manage_token);
end $$;

create function public.manage_booking(p_token uuid,p_action text default 'get',p_start timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.appointments; s public.studios;
begin
 select * into a from public.appointments where manage_token=p_token for update;
 if a.id is null then raise exception 'Reserva não encontrada. Confira seu link.'; end if;
 select * into s from public.studios where id=a.studio_id for update;
 if p_action not in ('get','cancel','reschedule') then raise exception 'Ação inválida.'; end if;
 if p_action <> 'get' then
  if a.status<>'confirmed' or a.starts_at<now()+interval '2 hours' then raise exception 'Alterações online são permitidas até 2 horas antes. Entre em contato com o estúdio.'; end if;
  if exists(select 1 from public.payments where appointment_id=a.id) then raise exception 'Esta reserva tem pagamento registrado. Fale com o estúdio para alterar.'; end if;
  if p_action='cancel' then update public.appointments set status='cancelled' where id=a.id returning * into a;
  else
   if p_start is null or not exists(select 1 from public.available_slots(s.slug,a.service_id,(p_start at time zone 'America/Sao_Paulo')::date) x where x.starts_at=p_start) then raise exception 'Horário indisponível. Escolha outro horário.'; end if;
   update public.appointments set starts_at=p_start where id=a.id returning * into a;
  end if;
 end if;
 return jsonb_build_object('id',a.id,'service_id',a.service_id,'service',a.service_name,'starts_at',a.starts_at,'ends_at',a.ends_at,'price',a.price,'status',a.status,'studio',s.name,'slug',s.slug,'phone',s.phone,'address',s.address,'name',(select name from public.clients where id=a.client_id));
end $$;

create function public.save_hours(p_studio uuid,p_hours jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.studios where id=p_studio and owner_id=auth.uid()) then raise exception 'Acesso negado.'; end if;
 if jsonb_array_length(p_hours) <> 7 then raise exception 'Informe os sete dias da semana.'; end if;
 insert into public.working_hours(studio_id,weekday,enabled,opens,closes,break_start,break_end)
 select p_studio,x.weekday,x.enabled,x.opens,x.closes,x.break_start,x.break_end from jsonb_to_recordset(p_hours) as x(weekday int,enabled boolean,opens time,closes time,break_start time,break_end time)
 on conflict(studio_id,weekday) do update set enabled=excluded.enabled,opens=excluded.opens,closes=excluded.closes,break_start=excluded.break_start,break_end=excluded.break_end;
end $$;

revoke execute on all functions in schema encaixa_private from public,anon,authenticated;
revoke execute on function public.setup_studio(text,text,text), public.save_hours(uuid,jsonb) from public,anon;
grant execute on function public.setup_studio(text,text,text), public.save_hours(uuid,jsonb) to authenticated;
revoke execute on function public.booking_page(text), public.available_slots(text,uuid,date), public.book_appointment(text,uuid,timestamptz,text,text,text,text), public.manage_booking(uuid,text,timestamptz) from public;
grant execute on function public.booking_page(text), public.available_slots(text,uuid,date), public.book_appointment(text,uuid,timestamptz,text,text,text,text), public.manage_booking(uuid,text,timestamptz) to anon,authenticated;
