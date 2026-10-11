-- Apply after production_readiness.sql, in staging first. Stripe is NOT activated by this migration.
begin;
set local lock_timeout='3s';
create table encaixa_private.billing_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into encaixa_private.billing_settings(singleton) values(true);
alter table encaixa_private.billing_settings enable row level security;
revoke all on encaixa_private.billing_settings from public,anon,authenticated;
create table encaixa_private.billing_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  trial_ends_at timestamptz,
  customer_id text unique,
  subscription_id text unique,
  status text not null default 'trial',
  paid_until timestamptz,
  cancel_at_period_end boolean not null default false,
  last_event_at bigint not null default 0,
  checkout_key uuid,
  checkout_expires_at bigint,
  sync_token uuid,
  sync_expires_at timestamptz,
  created_at timestamptz not null default now()
);
create table encaixa_private.billing_events (
  id text primary key,
  received_at timestamptz not null default now()
);
alter table encaixa_private.billing_accounts enable row level security;
alter table encaixa_private.billing_events enable row level security;
revoke all on encaixa_private.billing_accounts,encaixa_private.billing_events from public,anon,authenticated;
-- Trials start only after payment activation, never merely from deploying code.
insert into encaixa_private.billing_accounts(owner_id) select owner_id from public.studios on conflict do nothing;
create function encaixa_private.activate_billing() returns void
language plpgsql security definer set search_path='' as $$
begin
 update encaixa_private.billing_settings set enabled=true where singleton and not enabled;
 if found then
  update encaixa_private.billing_accounts set trial_ends_at=now()+interval '7 days' where trial_ends_at is null;
 end if;
end $$;
revoke all on function encaixa_private.activate_billing() from public,anon,authenticated,service_role;
create function encaixa_private.start_studio_trial() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into encaixa_private.billing_accounts(owner_id,trial_ends_at)
 values(new.owner_id,case when (select enabled from encaixa_private.billing_settings where singleton) then now()+interval '7 days' end) on conflict do nothing;
 return new;
end $$;
create trigger billing_start_trial after insert on public.studios for each row execute function encaixa_private.start_studio_trial();

create function encaixa_private.billing_access(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not coalesce((select enabled from encaixa_private.billing_settings where singleton),true) or coalesce((select trial_ends_at>now() or (status='active' and paid_until>now())
 from encaixa_private.billing_accounts where owner_id=p_owner),false)
$$;
create function public.billing_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b encaixa_private.billing_accounts;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 select * into b from encaixa_private.billing_accounts where owner_id=auth.uid();
 return jsonb_build_object('trial_ends_at',b.trial_ends_at,'status',coalesce(b.status,'pending'),
 'paid_until',b.paid_until,'cancel_at_period_end',b.cancel_at_period_end,
 'has_subscription',b.subscription_id is not null,'has_customer',b.customer_id is not null,'can_use',encaixa_private.billing_access(auth.uid()),
 'billing_enabled',(select enabled from encaixa_private.billing_settings where singleton),'amount',2990,'currency','brl');
end $$;

-- Database enforcement also covers direct REST calls and SECURITY DEFINER RPCs.
-- Reading/exporting existing records remains available after expiry.
create function encaixa_private.require_studio_subscription() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid; owner uuid;
begin
 if tg_table_name='studios' then
   owner:=old.owner_id;
   if tg_op='UPDATE' and new.owner_id is distinct from old.owner_id then raise exception 'O proprietário não pode ser alterado.'; end if;
 else
   if tg_op='DELETE' then sid:=old.studio_id; else sid:=new.studio_id; end if;
   select owner_id into owner from public.studios where id=sid;
   -- Allow a cascade initiated by deleting the auth account.
   if owner is null then if tg_op='DELETE' then return old; end if; return new; end if;
 end if;
 -- A client may always cancel an otherwise cancellable booking, even if the studio expired.
 if tg_table_name='appointments' and tg_op='UPDATE' then
   if new.status='cancelled' and (to_jsonb(new)-'status')=(to_jsonb(old)-'status') then return new; end if;
 end if;
 if not encaixa_private.billing_access(owner) then
   raise exception 'Seu período de acesso terminou. Abra Minha assinatura para continuar.';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
do $$ declare tbl text; begin
 foreach tbl in array array['clients','services','appointments','payments','professionals','working_hours','professional_hours'] loop
  execute format('create trigger billing_access_guard before insert or update or delete on public.%I for each row execute function encaixa_private.require_studio_subscription()',tbl);
 end loop;
end $$;
create trigger billing_access_guard before update on public.studios for each row execute function encaixa_private.require_studio_subscription();

-- Backend-only operations: authenticated users cannot forge paid status or Stripe IDs.
create function public.billing_backend_account(p_owner uuid, p_customer text default null, p_checkout boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b encaixa_private.billing_accounts;
begin
 select * into b from encaixa_private.billing_accounts where owner_id=p_owner for update;
 if b.owner_id is null then raise exception 'Configure seu espaço antes de assinar.'; end if;
 if p_customer is not null and b.customer_id is null then
   update encaixa_private.billing_accounts set customer_id=p_customer where owner_id=p_owner returning * into b;
 end if;
 if p_checkout and (b.checkout_expires_at is null or b.checkout_expires_at<=extract(epoch from now())) then
   update encaixa_private.billing_accounts set checkout_key=gen_random_uuid(), checkout_expires_at=floor(extract(epoch from now()))::bigint+82800
   where owner_id=p_owner returning * into b;
 end if;
 return to_jsonb(b)||jsonb_build_object('billing_enabled',(select enabled from encaixa_private.billing_settings where singleton));
end $$;
create function public.billing_sync_claim(p_customer text,p_event text) returns uuid
language plpgsql security definer set search_path='' as $$
declare b encaixa_private.billing_accounts; ticket uuid;
begin
 select * into b from encaixa_private.billing_accounts where customer_id=p_customer for update;
 if b.owner_id is null then raise exception 'Conta de cobrança não encontrada.'; end if;
 if exists(select 1 from encaixa_private.billing_events where id=p_event) then return null; end if;
 if b.sync_expires_at>now() then raise exception 'Sincronização em andamento.'; end if;
 ticket:=gen_random_uuid();
 update encaixa_private.billing_accounts set sync_token=ticket,sync_expires_at=now()+interval '60 seconds' where owner_id=b.owner_id;
 return ticket;
end $$;
create function public.billing_apply_event(p_event text,p_created bigint,p_customer text,p_subscription text,p_status text,p_until timestamptz,p_cancel boolean,p_ticket uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare b encaixa_private.billing_accounts;
begin
 if p_event is null or p_created is null or p_status is null or p_event !~ '^evt_' or p_status not in ('active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused','trialing') then raise exception 'Evento inválido.'; end if;
 select * into b from encaixa_private.billing_accounts where customer_id=p_customer for update;
 if b.owner_id is null then raise exception 'Conta de cobrança não encontrada.'; end if;
 if exists(select 1 from encaixa_private.billing_events where id=p_event) then return false; end if;
 if p_ticket is null or b.sync_token is distinct from p_ticket or b.sync_expires_at<=now() then raise exception 'Sincronização expirada.'; end if;
 -- The lease covers Stripe retrieval and commit. Timestamps are audit metadata,
 -- not an ordering guarantee (distinct Stripe events can share a second).
   update encaixa_private.billing_accounts set subscription_id=p_subscription,status=p_status,paid_until=p_until,
   cancel_at_period_end=p_cancel,last_event_at=greatest(p_created,last_event_at),sync_token=null,sync_expires_at=null where owner_id=b.owner_id;
 insert into encaixa_private.billing_events(id) values(p_event) on conflict do nothing;
 return true;
end $$;

alter function public.booking_page(text) rename to booking_page_before_billing;
create function public.booking_page(p_slug text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; owner uuid;
begin
 result:=public.booking_page_before_billing(p_slug);
 select owner_id into owner from public.studios where id=(result->'studio'->>'id')::uuid;
 if owner is not null and not encaixa_private.billing_access(owner) then result:=jsonb_set(result,'{studio,active}','false'); end if;
 return result;
end $$;
revoke all on function encaixa_private.start_studio_trial(),encaixa_private.billing_access(uuid),encaixa_private.require_studio_subscription() from public,anon,authenticated;
revoke all on function public.billing_status() from public,anon;
grant execute on function public.billing_status() to authenticated;
revoke all on function public.billing_backend_account(uuid,text,boolean),public.billing_sync_claim(text,text),public.billing_apply_event(text,bigint,text,text,text,timestamptz,boolean,uuid),public.booking_page(text) from public,anon,authenticated;
grant execute on function public.billing_backend_account(uuid,text,boolean),public.billing_sync_claim(text,text),public.billing_apply_event(text,bigint,text,text,text,timestamptz,boolean,uuid),public.booking_page(text) to service_role;
commit;
