-- Owner alerts for changes made by clients (public booking page / management link).
-- Apply after parallel_bookings.sql. One row per event: the panel listens to it in
-- real time today; native push, e-mail or WhatsApp can consume the same rows later.
begin;
set local lock_timeout = '5s';

create table public.studio_notifications (
 id uuid primary key default gen_random_uuid(),
 studio_id uuid not null references public.studios(id) on delete cascade,
 appointment_id uuid,
 kind text not null check(kind in('new_booking','client_cancelled','client_rescheduled')),
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 seen_at timestamptz,
 foreign key(appointment_id,studio_id) references public.appointments(id,studio_id) on delete cascade
);
create index studio_notifications_recent_idx on public.studio_notifications(studio_id,created_at desc);
alter table public.studio_notifications enable row level security;
create policy notification_owner on public.studio_notifications for select to authenticated
 using(studio_id in(select id from public.studios where owner_id=(select auth.uid())));
revoke all on public.studio_notifications from public,anon,authenticated;
grant select on public.studio_notifications to authenticated;

-- Only callers without a signed-in user are clients: the public booking gateway.
-- The owner's own changes (panel, Clara) never alert the owner.
create function encaixa_private.notify_owner() returns trigger
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
 return new;
end $$;
create trigger zz_notify_owner after insert or update on public.appointments
 for each row execute function encaixa_private.notify_owner();

create function public.mark_notifications_seen(p_studio uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not exists(select 1 from public.studios where id=p_studio and owner_id=auth.uid()) then
  raise exception 'Acesso negado.' using errcode='42501';
 end if;
 update public.studio_notifications set seen_at=now() where studio_id=p_studio and seen_at is null;
 get diagnostics n=row_count;
 return n;
end $$;

revoke all on function encaixa_private.notify_owner() from public,anon,authenticated;
revoke all on function public.mark_notifications_seen(uuid) from public,anon;
grant execute on function public.mark_notifications_seen(uuid) to authenticated;

-- Supabase Realtime delivers inserts to the signed-in owner, filtered by RLS.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.studio_notifications;
 end if;
end $$;
commit;
