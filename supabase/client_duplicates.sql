-- Apply after booking_notifications_retention.sql.
-- Duplicate clients by WhatsApp are detected only inside the owner's panel and
-- in owner-only alerts. The public booking route is unchanged: it never looks up,
-- links or returns existing clients (privacy decision in specs/agendamento.md).
begin;
set local lock_timeout = '5s';

-- One key per Brazilian phone: digits only, without country code 55, with the
-- ninth digit restored for old 8-digit mobiles (first digit 6-9). Landlines keep
-- 10 digits. Anything else has no key ('') and is never matched.
create function encaixa_private.phone_key(p text) returns text
language sql immutable set search_path='' as $$
 select case
  when n ~ '^[1-9][1-9][6-9][0-9]{7}$' then left(n,2)||'9'||substr(n,3)
  when n ~ '^[1-9][1-9][0-9]{8,9}$' then n
  else '' end
 from (select case when length(d) in (12,13) and left(d,2)='55' then substr(d,3) else d end n
  from (select regexp_replace(coalesce(p,''),'[^0-9]','','g') d) x) y;
$$;

-- One-click merge of a duplicate group into the chosen main record, atomically.
-- Reuses merge_clients (history, notes, merged_into) and only accepts records
-- with the same WhatsApp key. The main record keeps its data; an empty e-mail is
-- filled from the first merged record that has one.
create function public.merge_client_group(p_target uuid,p_sources uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare sid uuid; t public.clients; s public.clients; k text; src uuid; mail text:='';
begin
 select id into sid from public.studios where owner_id=auth.uid() for update;
 if sid is null then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_target is null or p_sources is null or cardinality(p_sources) not between 1 and 20 or array_ndims(p_sources)<>1
  or p_target=any(p_sources) or (select count(distinct x) from unnest(p_sources) x)<>cardinality(p_sources) then
  raise exception 'Selecione os cadastros que serão unificados.';
 end if;
 select * into t from public.clients where id=p_target and studio_id=sid and merged_into is null for update;
 if t.id is null then raise exception 'Cadastro indisponível. Atualize a lista.'; end if;
 k:=encaixa_private.phone_key(t.phone);
 if k='' then raise exception 'O cadastro principal precisa ter um WhatsApp válido.'; end if;
 foreach src in array p_sources loop
  select * into s from public.clients where id=src and studio_id=sid and merged_into is null for update;
  if s.id is null then raise exception 'Cadastro indisponível. Atualize a lista.'; end if;
  if encaixa_private.phone_key(s.phone)<>k then raise exception 'Só é possível unificar cadastros com o mesmo WhatsApp.'; end if;
  if mail='' and s.email<>'' then mail:=s.email; end if;
 end loop;
 foreach src in array p_sources loop
  perform public.merge_clients(src,p_target);
 end loop;
 if t.email='' and mail<>'' then update public.clients set email=mail where id=p_target; end if;
 return jsonb_build_object('target',p_target,'merged',cardinality(p_sources));
end $$;

-- Owner alerts: a new online booking from a WhatsApp already registered in the
-- studio is flagged "returning" with the number of completed visits. Owner-only
-- (studio_notifications RLS); nothing changes in the public response.
create or replace function encaixa_private.notify_owner() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; detail jsonb; pk text; others integer; done integer;
begin
 if auth.uid() is not null or new.status='blocked' then return new; end if;
 if tg_op='INSERT' then
  if new.source<>'online' or new.status<>'confirmed' then return new; end if;
  k:='new_booking';
 elsif new.status='cancelled' and old.status is distinct from 'cancelled' then k:='client_cancelled';
 elsif new.status='confirmed' and new.starts_at is distinct from old.starts_at then k:='client_rescheduled';
 else return new; end if;
 detail:=jsonb_build_object('client',(select name from public.clients where id=new.client_id),
  'service',new.service_name,'professional',(select name from public.professionals where id=new.professional_id),
  'starts_at',new.starts_at);
 if k='client_rescheduled' then detail:=detail||jsonb_build_object('previous_starts_at',old.starts_at); end if;
 if k='new_booking' then
  pk:=encaixa_private.phone_key((select phone from public.clients where id=new.client_id));
  if pk<>'' then
   select count(distinct c.id),count(a.id) filter(where a.status='completed') into others,done
   from public.clients c left join public.appointments a on a.client_id=c.id and a.studio_id=c.studio_id
   where c.studio_id=new.studio_id and c.id<>new.client_id and c.merged_into is null
    and encaixa_private.phone_key(c.phone)=pk;
   if others>0 then detail:=detail||jsonb_build_object('returning',true,'previous_visits',done); end if;
  end if;
 end if;
 insert into public.studio_notifications(studio_id,appointment_id,kind,payload) values(new.studio_id,new.id,k,detail);
 delete from public.studio_notifications where studio_id=new.studio_id and created_at<now()-interval '90 days';
 return new;
end $$;

revoke all on function encaixa_private.phone_key(text) from public,anon,authenticated;
revoke all on function encaixa_private.notify_owner() from public,anon,authenticated;
revoke all on function public.merge_client_group(uuid,uuid[]) from public,anon;
grant execute on function public.merge_client_group(uuid,uuid[]) to authenticated;
commit;
