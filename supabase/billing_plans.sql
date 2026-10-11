-- Apply once AFTER billing.sql. Independent of scheduling_integrity.sql.
-- Does not enable billing, start trials, charge cards or delete professionals.
begin;
set local lock_timeout='3s';

create function encaixa_private.plan_limit(p_plan text) returns integer
language sql immutable set search_path='' as $$
 select case p_plan when 'solo' then 1 when 'team3' then 3 when 'team4' then 4 when 'team5' then 5 end
$$;
create function encaixa_private.plan_amount(p_plan text) returns integer
language sql immutable set search_path='' as $$
 select case p_plan when 'solo' then 2990 when 'team3' then 5990 when 'team4' then 7990 when 'team5' then 9990 end
$$;
create function encaixa_private.team_size(p_owner uuid) returns integer
language sql stable security definer set search_path='' as $$
 select 1+count(*)::integer from public.professionals p join public.studios s on s.id=p.studio_id
 where s.owner_id=p_owner and p.active and not p.is_default
$$;

-- Fail visibly for an existing oversized team; never deactivate people silently.
do $$ begin
 if exists(select 1 from public.studios s where encaixa_private.team_size(s.owner_id)>5) then
  raise exception 'Há equipes com mais de cinco atendentes. Revise-as antes de aplicar os planos.';
 end if;
end $$;

alter table encaixa_private.billing_accounts
 add column plan_id text not null default 'solo' check(plan_id in('solo','team3','team4','team5')),
 add column team_revision bigint not null default 0,
 add column operation jsonb,
 add column operation_ticket uuid,
 add column operation_lease_until timestamptz;

create function encaixa_private.team_limit(p_owner uuid) returns integer
language sql stable security definer set search_path='' as $$
 select least(
   case when not coalesce((select enabled from encaixa_private.billing_settings where singleton),true)
     or b.trial_ends_at>now() then 5 else encaixa_private.plan_limit(b.plan_id) end,
   coalesce(encaixa_private.plan_limit(b.operation->>'plan'),5))
 from encaixa_private.billing_accounts b where owner_id=p_owner
$$;

create function encaixa_private.enforce_team_limit() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner uuid; current_size integer; allowed integer; delta integer;
begin
 if tg_op='UPDATE' and (new.id is distinct from old.id or new.studio_id is distinct from old.studio_id or new.is_default is distinct from old.is_default) then
  raise exception 'A identificação da profissional não pode mudar.';
 end if;
 select owner_id into owner from public.studios where id=coalesce(new.studio_id,old.studio_id);
 if owner is null then if tg_op='DELETE' then return old; end if; return new; end if;
 -- An UPDATE is intentional: stale REPEATABLE READ snapshots abort instead of
 -- passing a count check after another concurrent transaction took the last place.
 update encaixa_private.billing_accounts set team_revision=team_revision+1 where owner_id=owner;
 if not found then raise exception 'Configure seu espaço antes de alterar a equipe.'; end if;
 if tg_op='DELETE' then
  if old.is_default then raise exception 'O proprietário faz parte da equipe. Desative a agenda para pausar atendimentos.'; end if;
  return old;
 end if;
 delta:=case when new.active and not new.is_default then 1 else 0 end;
 if tg_op='UPDATE' then delta:=delta-case when old.active and not old.is_default then 1 else 0 end; end if;
 if delta>0 then
  current_size:=encaixa_private.team_size(owner);
  allowed:=coalesce(encaixa_private.team_limit(owner),1);
  if current_size+delta>5 then raise exception 'O limite é de cinco atendentes, incluindo o proprietário.'; end if;
  if current_size+delta>allowed then raise exception 'Seu plano não inclui esta vaga. Abra Minha assinatura para alterar o plano.'; end if;
 end if;
 return new;
end $$;
-- Runs after the optional scheduling mutex, but before the existing access guard.
create trigger a1_billing_team_limit before insert or update or delete on public.professionals
 for each row execute function encaixa_private.enforce_team_limit();

create or replace function encaixa_private.billing_access(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not coalesce((select enabled from encaixa_private.billing_settings where singleton),true) or coalesce((
 select trial_ends_at>now() or (status='active' and paid_until>now()
   and encaixa_private.team_size(p_owner)<=encaixa_private.plan_limit(plan_id))
 from encaixa_private.billing_accounts where owner_id=p_owner),false)
$$;

-- Preserve the existing access checks; allow reducing the team even after expiry.
create or replace function encaixa_private.require_studio_subscription() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid; owner uuid;
begin
 if tg_table_name='studios' then
  owner:=old.owner_id;
  if tg_op='UPDATE' and new.owner_id is distinct from old.owner_id then raise exception 'O proprietário não pode ser alterado.'; end if;
 else
  if tg_op='DELETE' then sid:=old.studio_id; else sid:=new.studio_id; end if;
  select owner_id into owner from public.studios where id=sid;
  if owner is null then if tg_op='DELETE' then return old; end if; return new; end if;
 end if;
 if tg_table_name='appointments' and tg_op='UPDATE' then
  if new.status='cancelled' and (to_jsonb(new)-'status')=(to_jsonb(old)-'status') then return new; end if;
 end if;
 if tg_table_name='professionals' and tg_op='UPDATE' then
  if not new.active and (to_jsonb(new)-'active')=(to_jsonb(old)-'active') then return new; end if;
 end if;
 if not encaixa_private.billing_access(owner) then raise exception 'Seu período de acesso terminou ou sua equipe excede o plano. Abra Minha assinatura para continuar.'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

create or replace function public.billing_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b encaixa_private.billing_accounts; n integer;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 select * into b from encaixa_private.billing_accounts where owner_id=auth.uid();
 n:=encaixa_private.team_size(auth.uid());
 return jsonb_build_object('trial_ends_at',b.trial_ends_at,'status',coalesce(b.status,'pending'),
  'paid_until',b.paid_until,'cancel_at_period_end',b.cancel_at_period_end,
  'has_subscription',b.subscription_id is not null,'has_customer',b.customer_id is not null,
  'can_use',encaixa_private.billing_access(auth.uid()),'billing_enabled',(select enabled from encaixa_private.billing_settings where singleton),
  'plan_id',b.plan_id,'plan_limit',encaixa_private.plan_limit(b.plan_id),'effective_limit',encaixa_private.team_limit(auth.uid()),
  'active_professionals',n,'amount',encaixa_private.plan_amount(b.plan_id),'currency','brl','plans_version',2,
  'pending_plan',b.operation->>'plan','pending_action',b.operation->>'action');
end $$;

create or replace function public.billing_backend_account(p_owner uuid,p_customer text default null,p_checkout boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b encaixa_private.billing_accounts;
begin
 if p_checkout then raise exception 'Atualize a função de cobrança para os novos planos.'; end if;
 select * into b from encaixa_private.billing_accounts where owner_id=p_owner for update;
 if b.owner_id is null then raise exception 'Configure seu espaço antes de assinar.'; end if;
 if p_customer is not null and b.customer_id is null then
  update encaixa_private.billing_accounts set customer_id=p_customer where owner_id=p_owner returning * into b;
 end if;
 return to_jsonb(b)||jsonb_build_object('billing_enabled',(select enabled from encaixa_private.billing_settings where singleton),
 'active_professionals',encaixa_private.team_size(p_owner),'plans_version',2);
end $$;

-- One durable operation and one short network lease per owner. Retries reuse the
-- same Stripe idempotency key and request parameters, even after a lost response.
create function public.billing_begin_operation(p_owner uuid,p_action text,p_plan text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b encaixa_private.billing_accounts; op jsonb; ticket uuid; stamp bigint;
begin
 update encaixa_private.billing_accounts set team_revision=team_revision+1 where owner_id=p_owner returning * into b;
 if b.owner_id is null then raise exception 'Configure seu espaço antes de assinar.'; end if;
 if not (select enabled from encaixa_private.billing_settings where singleton) then raise exception 'A cobrança ainda não foi ativada.'; end if;
 if encaixa_private.plan_limit(p_plan) is null or p_action not in('checkout','change') then raise exception 'Plano inválido.'; end if;
 if b.operation_lease_until>now() then raise exception 'Aguarde a solicitação em andamento e tente novamente.'; end if;
 op:=b.operation;
 if op is not null then
  if op->>'plan'<>p_plan or op->>'action'<>p_action then raise exception 'Conclua ou cancele a alteração em andamento antes de escolher outro plano.'; end if;
 else
  if encaixa_private.team_size(p_owner)>encaixa_private.plan_limit(p_plan) then
   raise exception 'Desative os atendentes excedentes antes de escolher este plano. O histórico será preservado.';
  end if;
  if b.trial_ends_at>now() then raise exception 'Seu teste grátis ainda está ativo.'; end if;
  if p_action='change' and (b.subscription_id is null or b.status<>'active' or b.paid_until<=now() or b.paid_until is null or b.cancel_at_period_end) then
   raise exception 'Regularize sua assinatura antes de alterar o plano.';
  end if;
  if p_action='change' and b.plan_id=p_plan then raise exception 'Este já é seu plano atual.'; end if;
  stamp:=floor(extract(epoch from now()))::bigint;
  op:=jsonb_build_object('key',gen_random_uuid(),'action',p_action,'plan',p_plan,'from_plan',b.plan_id,
    'subscription',b.subscription_id,'created',stamp,'expires',stamp+3600);
 end if;
 ticket:=gen_random_uuid();
 update encaixa_private.billing_accounts set operation=op,operation_ticket=ticket,operation_lease_until=now()+interval '60 seconds'
 where owner_id=p_owner returning * into b;
 return to_jsonb(b)||jsonb_build_object('active_professionals',encaixa_private.team_size(p_owner));
end $$;

create function public.billing_finish_operation(p_owner uuid,p_key uuid,p_ticket uuid,p_clear boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update encaixa_private.billing_accounts set operation=case when p_clear or
 (operation->>'action'='change' and operation->>'plan'=plan_id and status='active' and paid_until>now()) then null else operation end,
 operation_ticket=null,operation_lease_until=null
 where owner_id=p_owner and operation->>'key'=p_key::text and operation_ticket=p_ticket;
 return found;
end $$;

-- The old RPC cannot apply a single-plan event after this migration.
revoke all on function public.billing_apply_event(text,bigint,text,text,text,timestamptz,boolean,uuid) from service_role;
create function public.billing_apply_plan_event(p_event text,p_created bigint,p_customer text,p_subscription text,
 p_status text,p_until timestamptz,p_cancel boolean,p_ticket uuid,p_plan text,p_preserve_paid boolean,p_period_end timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
declare b encaixa_private.billing_accounts; paid timestamptz;
begin
 if p_event is null or p_created is null or p_event !~ '^evt_' or p_status is null
  or p_status not in('active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused','trialing')
  or encaixa_private.plan_limit(p_plan) is null then raise exception 'Evento inválido.'; end if;
 select * into b from encaixa_private.billing_accounts where customer_id=p_customer for update;
 if b.owner_id is null then raise exception 'Conta de cobrança não encontrada.'; end if;
 if exists(select 1 from encaixa_private.billing_events where id=p_event) then return false; end if;
 if p_ticket is null or b.sync_token is distinct from p_ticket or b.sync_expires_at<=now() then raise exception 'Sincronização expirada.'; end if;
 paid:=p_until;
 if p_preserve_paid and p_status='active' and p_until is null and p_subscription=b.subscription_id and p_plan=b.plan_id and p_period_end is not null then
  paid:=least(b.paid_until,p_period_end);
  if b.paid_until is null then paid:=null; end if;
 end if;
 update encaixa_private.billing_accounts set subscription_id=p_subscription,status=p_status,paid_until=paid,
  plan_id=p_plan,cancel_at_period_end=p_cancel,last_event_at=greatest(p_created,last_event_at),sync_token=null,sync_expires_at=null,
  operation=case when operation->>'plan'=p_plan and paid>now() and p_status='active'
    and coalesce(operation_lease_until,now())<=now() then null else operation end
 where owner_id=b.owner_id;
 insert into encaixa_private.billing_events(id) values(p_event) on conflict do nothing;
 return true;
end $$;

revoke all on function encaixa_private.plan_limit(text),encaixa_private.plan_amount(text),encaixa_private.team_size(uuid),
 encaixa_private.team_limit(uuid),encaixa_private.enforce_team_limit() from public,anon,authenticated,service_role;
revoke all on function public.billing_begin_operation(uuid,text,text),public.billing_finish_operation(uuid,uuid,uuid,boolean),
 public.billing_apply_plan_event(text,bigint,text,text,text,timestamptz,boolean,uuid,text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.billing_begin_operation(uuid,text,text),public.billing_finish_operation(uuid,uuid,uuid,boolean),
 public.billing_apply_plan_event(text,bigint,text,text,text,timestamptz,boolean,uuid,text,boolean,timestamptz) to service_role;
commit;
