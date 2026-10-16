-- Apply after parallel_bookings.sql (independent of client_duplicates.sql).
-- The deadline for the client to cancel or reschedule through her link becomes
-- a studio setting. Default 2 hours keeps every existing studio unchanged. The
-- rule is evaluated with the studio's current value at the moment of the action,
-- so it also applies to bookings made before a change. Confirmed status and the
-- registered payment checks stay exactly as they were.
begin;
set local lock_timeout = '5s';

alter table public.studios add column change_notice_hours integer not null default 2
 check(change_notice_hours in (2,4,6,12,24,48));

-- Same body as team.sql, with the fixed 2 hours replaced by the studio setting.
create or replace function public.manage_booking(p_token uuid,p_action text default 'get',p_start timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.appointments; s public.studios;
begin
 select * into s from public.studios where id=(select studio_id from public.appointments where manage_token=p_token) for update;
 select * into a from public.appointments where manage_token=p_token for update;
 if a.id is null then raise exception 'Reserva não encontrada. Confira seu link.'; end if;
 if p_action is null or p_action not in ('get','cancel','reschedule') then raise exception 'Ação inválida.'; end if;
 if p_action<>'get' then
  if a.status<>'confirmed' or a.starts_at<now()+make_interval(hours=>s.change_notice_hours) then
   raise exception 'Alterações online são permitidas até % horas antes. Entre em contato com o estúdio.',s.change_notice_hours;
  end if;
  if exists(select 1 from public.payments where appointment_id=a.id) then raise exception 'Esta reserva tem pagamento registrado. Fale com o estúdio para alterar.'; end if;
  if p_action='cancel' then update public.appointments set status='cancelled' where id=a.id returning * into a;
  else
   if p_start is null or not exists(select 1 from public.available_slots_multi(s.slug,a.service_ids,(p_start at time zone 'America/Sao_Paulo')::date,p_token) x where x.starts_at=p_start) then raise exception 'O conjunto de serviços não cabe neste horário. Escolha outro horário.'; end if;
   update public.appointments set starts_at=p_start where id=a.id returning * into a;
  end if;
 end if;
 return jsonb_build_object('id',a.id,'service_id',a.service_id,'service_ids',a.service_ids,'service_items',a.service_items,'service',a.service_name,'starts_at',a.starts_at,'ends_at',a.ends_at,'price',a.price,'status',a.status,'professional_id',a.professional_id,'professional_name',(select name from public.professionals where id=a.professional_id),'paid',exists(select 1 from public.payments where appointment_id=a.id),'horizon',s.horizon,'change_notice_hours',s.change_notice_hours,'studio',s.name,'slug',s.slug,'phone',s.phone,'address',s.address,'name',(select name from public.clients where id=a.client_id));
end $$;

-- Same body as parallel_bookings.sql; the reschedule branch (token) uses the
-- studio deadline so the slot list and manage_booking always agree.
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
  select ap.* into a from public.appointments ap where ap.manage_token=p_token and ap.studio_id=s.id and ap.status='confirmed' and ap.starts_at>=now()+make_interval(hours=>s.change_notice_hours);
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

-- Public page (wrapped by booking_page in billing.sql): shows the deadline before
-- the client confirms. Same body as team.sql plus change_notice_hours.
create or replace function public.booking_page_before_billing(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('studio',jsonb_build_object('id',s.id,'name',s.name,'professional',s.professional,'bio',s.bio,'phone',s.phone,'address',s.address,'active',s.active,'horizon',s.horizon,'change_notice_hours',s.change_notice_hours,'image_url',s.image_url),
 'professionals',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'is_default',p.is_default) order by p.is_default desc,p.name) from public.professionals p where p.studio_id=s.id and p.active),'[]'::jsonb),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'description',v.description,'category',v.category,'price',v.price,'duration',v.duration,'image_url',v.image_url) order by v.name) from public.services v where v.studio_id=s.id and v.active),'[]'::jsonb))
 from public.studios s where s.id=encaixa_private.resolve_studio(p_slug);
$$;
commit;
