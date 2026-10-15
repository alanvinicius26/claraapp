-- Apply after booking_notifications.sql. Alerts carry client names, so they are
-- kept only 90 days. Cleanup is per studio, piggybacked on a new alert and on the
-- owner opening the bell (indexed by studio_id, created_at); no scheduler needed.
begin;
set local lock_timeout = '5s';

create or replace function encaixa_private.notify_owner() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; detail jsonb;
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
 insert into public.studio_notifications(studio_id,appointment_id,kind,payload) values(new.studio_id,new.id,k,detail);
 delete from public.studio_notifications where studio_id=new.studio_id and created_at<now()-interval '90 days';
 return new;
end $$;

create or replace function public.mark_notifications_seen(p_studio uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not exists(select 1 from public.studios where id=p_studio and owner_id=auth.uid()) then
  raise exception 'Acesso negado.' using errcode='42501';
 end if;
 update public.studio_notifications set seen_at=now() where studio_id=p_studio and seen_at is null;
 get diagnostics n=row_count;
 delete from public.studio_notifications where studio_id=p_studio and created_at<now()-interval '90 days';
 return n;
end $$;

revoke all on function encaixa_private.notify_owner() from public,anon,authenticated;
revoke all on function public.mark_notifications_seen(uuid) from public,anon;
grant execute on function public.mark_notifications_seen(uuid) to authenticated;

-- Existing rows older than the window (none at the time of writing).
delete from public.studio_notifications where created_at<now()-interval '90 days';
commit;
