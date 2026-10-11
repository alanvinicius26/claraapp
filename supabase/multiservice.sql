-- Additive migration: existing reservations keep their original prices and times.
alter table public.appointments add column service_ids uuid[] not null default '{}';
alter table public.appointments add column service_items jsonb not null default '[]';

-- The previous trigger preserves the existing financial/time fields on this update.
update public.appointments set service_ids=array[service_id],
 service_items=jsonb_build_array(jsonb_build_object('id',service_id,'name',service_name,'price',price,'duration',extract(epoch from (ends_at-starts_at))/60))
 where status<>'blocked';

create or replace function encaixa_private.normalize_appointment() returns trigger
language plpgsql set search_path='' as $$
declare v public.services; sid uuid; items jsonb:='[]'; mins integer:=0; b integer; changed boolean;
begin
 if TG_OP='UPDATE' then
  if new.studio_id is distinct from old.studio_id or new.manage_token is distinct from old.manage_token then raise exception 'Identificação da reserva não pode mudar.'; end if;
  if old.status='cancelled' and new.status<>'cancelled' then raise exception 'Crie um novo agendamento para este atendimento.'; end if;
  if (new.status='blocked') is distinct from (old.status='blocked') then raise exception 'Crie uma nova reserva para mudar o tipo de atendimento.'; end if;
  -- Compatibility with older clients that still send a single service_id.
  if new.service_id is distinct from old.service_id and new.service_ids is not distinct from old.service_ids then new.service_ids:=array[new.service_id]; end if;
 end if;
 if new.status='blocked' then
  new.service_id:=null; new.service_ids:='{}'; new.service_items:='[]'; new.price:=0; new.service_name:='Horário bloqueado';
  new.occupied:=tstzrange(new.starts_at,new.ends_at,'[)'); return new;
 end if;
 if TG_OP='INSERT' and cardinality(new.service_ids)=0 and new.service_id is not null then new.service_ids:=array[new.service_id]; end if;
 changed:=TG_OP='INSERT' or new.service_ids is distinct from old.service_ids;
 if TG_OP='UPDATE' and (changed or new.starts_at is distinct from old.starts_at) then
  if old.status in ('completed','cancelled') then raise exception 'Só atendimentos confirmados podem ser alterados.'; end if;
  if exists(select 1 from public.payments where appointment_id=old.id) then raise exception 'Esta reserva tem pagamento registrado. Não é possível alterar serviços ou horário.'; end if;
 end if;
 if changed then
  if new.service_ids is null or cardinality(new.service_ids) not between 1 and 20 or array_ndims(new.service_ids)<>1
     or (select count(distinct x) from unnest(new.service_ids) x)<>cardinality(new.service_ids) then raise exception 'Selecione de 1 a 20 serviços diferentes.'; end if;
  new.price:=0; new.service_name:='';
  foreach sid in array new.service_ids loop
   select * into v from public.services where id=sid and studio_id=new.studio_id and active for share;
   if not found then raise exception 'Um dos serviços está indisponível ou não pertence ao estúdio.'; end if;
   mins:=mins+v.duration; new.price:=new.price+v.price;
   new.service_name:=concat_ws(' + ',nullif(new.service_name,''),v.name);
   items:=items||jsonb_build_array(jsonb_build_object('id',v.id,'name',v.name,'price',v.price,'duration',v.duration));
  end loop;
  new.service_items:=items; new.service_id:=new.service_ids[1];
  select buffer into b from public.studios where id=new.studio_id;
 else
  -- Catalog edits never silently change an already booked price or duration.
  new.service_ids:=old.service_ids; new.service_id:=old.service_id; new.service_items:=old.service_items;
  new.price:=old.price; new.service_name:=old.service_name;
  mins:=extract(epoch from (old.ends_at-old.starts_at))/60;
  b:=extract(epoch from (upper(old.occupied)-old.ends_at))/60;
 end if;
 new.ends_at:=new.starts_at+make_interval(mins=>mins);
 new.occupied:=tstzrange(new.starts_at,new.ends_at+make_interval(mins=>b),'[)');
 return new;
end $$;

create function encaixa_private.slots_for_duration(p_studio uuid,p_duration integer,p_buffer integer,p_date date,p_exclude uuid default null)
returns table(starts_at timestamptz) language sql stable set search_path='' as $$
 select slot from public.studios s
 join public.working_hours h on h.studio_id=s.id and h.weekday=extract(dow from p_date)::int and h.enabled
 cross join lateral generate_series((p_date+h.opens) at time zone 'America/Sao_Paulo',(p_date+h.closes) at time zone 'America/Sao_Paulo',interval '15 minutes') slot
 where s.id=p_studio and s.active and p_duration>0
 and p_date between (now() at time zone 'America/Sao_Paulo')::date and (now() at time zone 'America/Sao_Paulo')::date+s.horizon
 and slot>=now()+make_interval(mins=>s.min_notice)
 and slot+make_interval(mins=>p_duration+p_buffer)<=(p_date+h.closes) at time zone 'America/Sao_Paulo'
 and (h.break_start is null or not(tstzrange(slot,slot+make_interval(mins=>p_duration+p_buffer),'[)') && tstzrange((p_date+h.break_start) at time zone 'America/Sao_Paulo',(p_date+h.break_end) at time zone 'America/Sao_Paulo','[)')))
 and not exists(select 1 from public.appointments a where a.studio_id=s.id and a.status<>'cancelled' and (p_exclude is null or a.id<>p_exclude) and a.occupied && tstzrange(slot,slot+make_interval(mins=>p_duration+p_buffer),'[)'))
 order by slot;
$$;

create function public.available_slots_multi(p_slug text,p_services uuid[],p_date date,p_token uuid default null)
returns table(starts_at timestamptz) language plpgsql stable security definer set search_path='' as $$
declare s public.studios; a public.appointments; mins integer; n integer; b integer; excluded uuid;
begin
 select * into s from public.studios where slug=p_slug and active;
 if not found then return; end if;
 b:=s.buffer;
 if p_token is not null then
  select ap.* into a from public.appointments ap where ap.manage_token=p_token and ap.studio_id=s.id and ap.status='confirmed' and ap.starts_at>=now()+interval '2 hours';
  if not found or exists(select 1 from public.payments where appointment_id=a.id) then return; end if;
  mins:=extract(epoch from (a.ends_at-a.starts_at))/60;
  b:=extract(epoch from (upper(a.occupied)-a.ends_at))/60; excluded:=a.id;
 else
  if p_services is null or cardinality(p_services) not between 1 and 20 or array_ndims(p_services)<>1 then return; end if;
  select sum(v.duration),count(*) into mins,n from public.services v where v.id=any(p_services) and v.studio_id=s.id and v.active;
  if n<>cardinality(p_services) then return; end if;
 end if;
 return query select x.starts_at from encaixa_private.slots_for_duration(s.id,mins,b,p_date,excluded) x;
end $$;

create function public.book_appointment_multi(p_slug text,p_services uuid[],p_start timestamptz,p_name text,p_email text,p_phone text,p_notes text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; cid uuid; a public.appointments;
begin
 select id into sid from public.studios where slug=p_slug and active for update;
 if sid is null then raise exception 'Esta agenda não está disponível.'; end if;
 if p_name is null or p_email is null or p_phone is null or p_notes is null or length(trim(p_name)) not between 2 and 120 or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_phone)>30 or length(p_notes)>2000 then raise exception 'Confira seu nome, e-mail e telefone.'; end if;
 perform 1 from public.services where id=any(p_services) and studio_id=sid order by id for share;
 if not exists(select 1 from public.available_slots_multi(p_slug,p_services,(p_start at time zone 'America/Sao_Paulo')::date) x where x.starts_at=p_start) then raise exception 'O conjunto de serviços não cabe neste horário. Escolha outro horário.'; end if;
 insert into public.clients(studio_id,name,email,phone) values(sid,trim(p_name),lower(trim(p_email)),trim(p_phone)) returning id into cid;
 insert into public.appointments(studio_id,service_ids,client_id,starts_at,ends_at,notes,source) values(sid,p_services,cid,p_start,p_start+interval '1 minute',p_notes,'online') returning * into a;
 return jsonb_build_object('id',a.id,'token',a.manage_token);
end $$;

-- Existing links/clients continue to work during and after rollout.
create or replace function public.available_slots(p_slug text,p_service uuid,p_date date) returns table(starts_at timestamptz)
language sql stable security definer set search_path='' as $$ select * from public.available_slots_multi(p_slug,array[p_service],p_date); $$;
create or replace function public.book_appointment(p_slug text,p_service uuid,p_start timestamptz,p_name text,p_email text,p_phone text,p_notes text default '') returns jsonb
language sql security definer set search_path='' as $$ select public.book_appointment_multi(p_slug,array[p_service],p_start,p_name,p_email,p_phone,p_notes); $$;

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
 return jsonb_build_object('id',a.id,'service_id',a.service_id,'service_ids',a.service_ids,'service_items',a.service_items,'service',a.service_name,'starts_at',a.starts_at,'ends_at',a.ends_at,'price',a.price,'status',a.status,'studio',s.name,'slug',s.slug,'phone',s.phone,'address',s.address,'name',(select name from public.clients where id=a.client_id));
end $$;

revoke all on function encaixa_private.slots_for_duration(uuid,integer,integer,date,uuid) from public,anon,authenticated;
revoke all on function public.available_slots_multi(text,uuid[],date,uuid),public.book_appointment_multi(text,uuid[],timestamptz,text,text,text,text) from public,anon,authenticated;
grant execute on function public.available_slots_multi(text,uuid[],date,uuid),public.book_appointment_multi(text,uuid[],timestamptz,text,text,text,text) to service_role;
