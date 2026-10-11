-- Reserve every shared address for its original studio.
create table encaixa_private.studio_addresses (
 slug text primary key, studio_id uuid not null references public.studios(id) on delete cascade
);
alter table encaixa_private.studio_addresses enable row level security;
insert into encaixa_private.studio_addresses select slug,id from public.studios;
create function encaixa_private.resolve_studio(p_slug text) returns uuid
language sql stable set search_path='' as $$
 select studio_id from encaixa_private.studio_addresses where slug=p_slug;
$$;
revoke all on function encaixa_private.resolve_studio(text) from public,anon,authenticated;
drop trigger preserve_studio_slug on public.studios;
create function encaixa_private.reserve_studio_address() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into encaixa_private.studio_addresses(slug,studio_id) values(new.slug,new.id) on conflict do nothing;
 if not exists(select 1 from encaixa_private.studio_addresses where slug=new.slug and studio_id=new.id) then
  raise exception 'Este link já pertence a outro estúdio. Escolha outro endereço.';
 end if;
 return new;
end $$;
revoke all on function encaixa_private.reserve_studio_address() from public,anon,authenticated;
create trigger reserve_studio_address after insert or update of slug on public.studios
for each row execute function encaixa_private.reserve_studio_address();

-- Keep originals, but hide merged cards from ordinary selection. No public matching.
alter table public.clients add column merged_into uuid;
alter table public.clients add constraint clients_merge_same_studio
 foreign key(merged_into,studio_id) references public.clients(id,studio_id);
alter table public.clients add constraint clients_merge_not_self check(merged_into is distinct from id);
create function public.merge_clients(p_source uuid,p_target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare s public.clients; t public.clients; sid uuid; combined text;
begin
 select id into sid from public.studios where owner_id=auth.uid() for update;
 if sid is null or p_source=p_target then raise exception 'Selecione dois cadastros diferentes do seu estúdio.'; end if;
 perform 1 from public.clients where id in(p_source,p_target) and studio_id=sid order by id for update;
 select * into s from public.clients where id=p_source and studio_id=sid and merged_into is null;
 select * into t from public.clients where id=p_target and studio_id=sid and merged_into is null;
 if s.id is null or t.id is null then raise exception 'Cadastro indisponível. Atualize a lista.'; end if;
 combined:=concat_ws(E'\n\n',nullif(t.notes,''),case when s.notes<>'' then 'Cadastro anterior ('||s.name||'): '||s.notes end);
 if length(combined)>5000 then raise exception 'As observações somadas excedem 5000 caracteres. Revise antes de unificar.'; end if;
 update public.appointments set client_id=t.id where client_id=s.id and studio_id=sid;
 update public.clients set notes=combined where id=t.id;
 update public.clients set merged_into=t.id where id=s.id or (studio_id=sid and merged_into=s.id);
end $$;
revoke all on function public.merge_clients(uuid,uuid) from public,anon;
grant execute on function public.merge_clients(uuid,uuid) to authenticated;
create function encaixa_private.check_active_client() returns trigger
language plpgsql set search_path='' as $$
declare merged uuid;
begin
 select merged_into into merged from public.clients where id=new.client_id and studio_id=new.studio_id for share;
 if merged is not null then
  raise exception 'Este cadastro foi unificado. Atualize a lista e escolha o cadastro principal.';
 end if;
 return new;
end $$;
revoke all on function encaixa_private.check_active_client() from public,anon,authenticated;
create trigger check_active_client before insert or update of client_id on public.appointments
for each row execute function encaixa_private.check_active_client();

create function public.available_dates_multi(p_slug text,p_services uuid[],p_after date,p_until date,p_token uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d date; last_day date; cursor_day date:=p_after; first_slot timestamptz; dates jsonb:='[]'; h integer;
begin
 select horizon into h from public.studios where id=encaixa_private.resolve_studio(p_slug) and active;
 if p_after is null or p_until is null or h is null then raise exception 'Agenda indisponível.'; end if;
 last_day:=least(p_until,(now() at time zone 'America/Sao_Paulo')::date+h);
 d:=greatest(p_after+1,(now() at time zone 'America/Sao_Paulo')::date);
 while d<=least(last_day,p_after+14) and jsonb_array_length(dates)<3 loop
  select min(x.starts_at) into first_slot from public.available_slots_multi(p_slug,p_services,d,p_token) x;
  cursor_day:=d;
  if first_slot is not null then dates:=dates||jsonb_build_array(jsonb_build_object('date',d,'first',first_slot)); end if;
  d:=d+1;
 end loop;
 return jsonb_build_object('dates',dates,'through',cursor_day,'hasMore',cursor_day<last_day);
end $$;
revoke all on function public.available_dates_multi(text,uuid[],date,date,uuid) from public,anon,authenticated;
grant execute on function public.available_dates_multi(text,uuid[],date,date,uuid) to service_role;
create or replace function public.available_slots_multi(p_slug text,p_services uuid[],p_date date,p_token uuid default null)
returns table(starts_at timestamptz) language plpgsql stable security definer set search_path='' as $$
declare s public.studios; a public.appointments; mins integer; n integer; b integer; excluded uuid;
begin
 select * into s from public.studios where id=encaixa_private.resolve_studio(p_slug) and active;
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
create or replace function public.book_appointment_multi(p_slug text,p_services uuid[],p_start timestamptz,p_name text,p_email text,p_phone text,p_notes text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; cid uuid; a public.appointments;
begin
 select id into sid from public.studios where id=encaixa_private.resolve_studio(p_slug) and active for update;
 if sid is null then raise exception 'Esta agenda não está disponível.'; end if;
 if p_name is null or p_email is null or p_phone is null or p_notes is null or length(trim(p_name)) not between 2 and 120 or length(p_email)>254 or (trim(p_email)<>'' and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or length(p_phone)>30 or length(p_notes)>2000 then raise exception 'Confira seu nome, e-mail e telefone.'; end if;
 p_phone:=regexp_replace(p_phone,'[^0-9]','','g');
 if length(p_phone) in (12,13) and left(p_phone,2)='55' then p_phone:=substr(p_phone,3); end if;
 if p_phone !~ '^[1-9][0-9][2-9][0-9]{7,8}$' then raise exception 'Informe um WhatsApp válido com DDD.'; end if;
 perform 1 from public.services where id=any(p_services) and studio_id=sid order by id for share;
 if not exists(select 1 from public.available_slots_multi(p_slug,p_services,(p_start at time zone 'America/Sao_Paulo')::date) x where x.starts_at=p_start) then raise exception 'O conjunto de serviços não cabe neste horário. Escolha outro horário.'; end if;
 insert into public.clients(studio_id,name,email,phone) values(sid,trim(p_name),lower(trim(p_email)),trim(p_phone)) returning id into cid;
 insert into public.appointments(studio_id,service_ids,client_id,starts_at,ends_at,notes,source) values(sid,p_services,cid,p_start,p_start+interval '1 minute',p_notes,'online') returning * into a;
 return jsonb_build_object('id',a.id,'token',a.manage_token);
end $$;
create or replace function public.booking_page(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('studio',jsonb_build_object('id',s.id,'name',s.name,'professional',s.professional,'bio',s.bio,'phone',s.phone,'address',s.address,'active',s.active,'horizon',s.horizon,'image_url',s.image_url),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'description',v.description,'category',v.category,'price',v.price,'duration',v.duration,'image_url',v.image_url) order by v.name) from public.services v where v.studio_id=s.id and v.active),'[]'::jsonb))
 from public.studios s where s.id=encaixa_private.resolve_studio(p_slug);
$$;


