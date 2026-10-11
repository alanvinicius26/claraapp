-- Apply once after billing_plans.sql. Does not grant any administrator automatically.
begin;
set local lock_timeout='3s';

create table encaixa_private.platform_admins (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table encaixa_private.admin_access_locks (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 ticket uuid not null,
 expires_at timestamptz not null
);
alter table encaixa_private.admin_access_locks enable row level security;
revoke all on encaixa_private.admin_access_locks from public,anon,authenticated,service_role;
create table encaixa_private.access_grants (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 id uuid not null unique default gen_random_uuid(),
 kind text not null check(kind in ('courtesy','free_period')),
 plan_id text not null check(plan_id in ('solo','team3','team4','team5')),
 expires_at timestamptz,
 reason text not null check(length(reason) between 3 and 500),
 created_by uuid references auth.users(id) on delete set null,
 updated_at timestamptz not null default now(),
 check(kind <> 'free_period' or expires_at is not null)
);
create table encaixa_private.admin_audit (
 id bigint generated always as identity primary key,
 actor_id uuid references auth.users(id) on delete set null,
 owner_id uuid references auth.users(id) on delete set null,
 action text not null,
 details jsonb not null,
 created_at timestamptz not null default now()
);
create index admin_audit_owner on encaixa_private.admin_audit(owner_id,id desc);
create table encaixa_private.admin_coupons (
 id uuid primary key default gen_random_uuid(),
 code text not null check(code ~ '^[A-Z0-9]{3,32}$'),
 mode text not null check(mode in ('test','live')),
 definition jsonb not null,
 stripe_coupon_id text,
 promotion_id text,
 state text not null default 'pending' check(state in ('pending','active','inactive')),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(mode,code)
);
alter table encaixa_private.platform_admins enable row level security;
alter table encaixa_private.access_grants enable row level security;
alter table encaixa_private.admin_audit enable row level security;
alter table encaixa_private.admin_coupons enable row level security;
revoke all on encaixa_private.platform_admins,encaixa_private.access_grants,
 encaixa_private.admin_audit,encaixa_private.admin_coupons from public,anon,authenticated,service_role;

create function public.platform_admin_status() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from encaixa_private.platform_admins where user_id=auth.uid())
$$;
create function encaixa_private.require_platform_admin(p_actor uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if p_actor is null or not exists(select 1 from encaixa_private.platform_admins where user_id=p_actor) then
  raise exception 'Acesso restrito à administração.' using errcode='42501';
 end if;
end $$;
create function encaixa_private.active_access_grant(p_owner uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',id,'kind',kind,'plan_id',plan_id,'expires_at',expires_at)
 from encaixa_private.access_grants where owner_id=p_owner and (expires_at is null or expires_at>now())
$$;

create function public.admin_accounts(p_search text default '',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform encaixa_private.require_platform_admin(auth.uid());
 if p_search is null or length(p_search)>254 or p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Busca inválida.'; end if;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into result from (
  select b.owner_id,u.email,s.name as studio_name,b.status,b.plan_id,b.trial_ends_at,b.paid_until,
   (b.subscription_id is not null and b.status not in ('canceled','incomplete_expired')) as has_open_subscription,
   b.operation is not null as has_pending_operation,
   encaixa_private.team_size(b.owner_id) as team_size,
   encaixa_private.billing_access(b.owner_id) as can_use,
   encaixa_private.team_limit(b.owner_id) as effective_limit,
   (select to_jsonb(g) from encaixa_private.access_grants g where g.owner_id=b.owner_id) as benefit
  from encaixa_private.billing_accounts b join auth.users u on u.id=b.owner_id
  join public.studios s on s.owner_id=b.owner_id
  where p_search='' or strpos(lower(coalesce(u.email,'')),lower(p_search))>0 or strpos(lower(s.name),lower(p_search))>0
  order by b.created_at desc,b.owner_id limit 26 offset p_offset
 ) a;
 return result;
end $$;

create function encaixa_private.set_admin_access(p_actor uuid,p_ticket uuid,p_owner uuid,p_kind text,p_plan text,p_expires timestamptz,p_reason text,p_expected uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b encaixa_private.billing_accounts; previous encaixa_private.access_grants; next_grant encaixa_private.access_grants;
begin
 perform encaixa_private.require_platform_admin(p_actor);
 if p_kind is null or p_kind not in ('courtesy','free_period') or encaixa_private.plan_limit(p_plan) is null
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500
  or (p_kind='free_period' and p_expires is null) or (p_expires is not null and (not isfinite(p_expires) or p_expires<=now())) then
  raise exception 'Informe plano, motivo e uma validade futura (obrigatória para período gratuito).';
 end if;
 -- Same row lock as checkout and team edits: a benefit cannot race a new charge.
 update encaixa_private.billing_accounts set team_revision=team_revision+1 where owner_id=p_owner returning * into b;
 if not found then raise exception 'Conta não encontrada.'; end if;
 select * into previous from encaixa_private.access_grants where owner_id=p_owner;
 if previous.id is distinct from p_expected then raise exception 'O benefício mudou. Atualize a conta antes de continuar.'; end if;
 if b.operation is not null or b.operation_lease_until>now() then raise exception 'Conclua ou cancele a contratação pendente antes de conceder acesso gratuito.'; end if;
 if b.subscription_id is not null and b.status not in ('canceled','incomplete_expired') then
  raise exception 'Esta conta possui assinatura em andamento. A gratuidade não cancela cobranças. Aguarde o encerramento da assinatura.';
 end if;
 if b.customer_id is not null and (p_ticket is null or not exists(select 1 from encaixa_private.admin_access_locks where owner_id=p_owner and ticket=p_ticket and expires_at>now())) then
  raise exception 'Confirme o encerramento das cobranças pelo painel administrativo.';
 end if;
 if encaixa_private.team_size(p_owner)>encaixa_private.plan_limit(p_plan) then raise exception 'Escolha um plano que comporte os atendentes ativos.'; end if;
 insert into encaixa_private.access_grants(owner_id,kind,plan_id,expires_at,reason,created_by)
 values(p_owner,p_kind,p_plan,p_expires,btrim(p_reason),p_actor)
 on conflict(owner_id) do update set id=gen_random_uuid(),kind=excluded.kind,plan_id=excluded.plan_id,
  expires_at=excluded.expires_at,reason=excluded.reason,created_by=excluded.created_by,updated_at=now()
 returning * into next_grant;
 insert into encaixa_private.admin_audit(actor_id,owner_id,action,details)
 values(p_actor,p_owner,'access_granted',jsonb_build_object('before',to_jsonb(previous),'after',to_jsonb(next_grant)));
 return to_jsonb(next_grant);
end $$;


create function public.admin_set_access(p_owner uuid,p_kind text,p_plan text,p_expires timestamptz,p_reason text,p_expected uuid default null) returns jsonb
language sql security definer set search_path='' as $$
 select encaixa_private.set_admin_access(auth.uid(),null,p_owner,p_kind,p_plan,p_expires,p_reason,p_expected)
$$;
revoke all on function encaixa_private.set_admin_access(uuid,uuid,uuid,text,text,timestamptz,text,uuid) from public,anon,authenticated,service_role;

create function public.admin_access_claim(p_actor uuid,p_owner uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b encaixa_private.billing_accounts; t uuid:=gen_random_uuid();
begin
 perform encaixa_private.require_platform_admin(p_actor);
 update encaixa_private.billing_accounts set team_revision=team_revision+1 where owner_id=p_owner returning * into b;
 if not found then raise exception 'Conta não encontrada.'; end if;
 if b.operation is not null or b.operation_lease_until>now() then raise exception 'Conclua ou cancele a contratação pendente.'; end if;
 if exists(select 1 from encaixa_private.admin_access_locks where owner_id=p_owner and expires_at>now()) then raise exception 'Aguarde a concessão em andamento.'; end if;
 insert into encaixa_private.admin_access_locks(owner_id,ticket,expires_at) values(p_owner,t,now()+interval '60 seconds')
 on conflict(owner_id) do update set ticket=excluded.ticket,expires_at=excluded.expires_at;
 return to_jsonb(b)||jsonb_build_object('admin_ticket',t);
end $$;
create function public.admin_access_apply(p_actor uuid,p_ticket uuid,p_owner uuid,p_kind text,p_plan text,p_expires timestamptz,p_reason text,p_expected uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform encaixa_private.require_platform_admin(p_actor);
 perform 1 from encaixa_private.billing_accounts where owner_id=p_owner for update;
 if p_ticket is null or not exists(select 1 from encaixa_private.admin_access_locks where owner_id=p_owner and ticket=p_ticket and expires_at>now()) then raise exception 'A conferência expirou. Tente novamente.'; end if;
 return encaixa_private.set_admin_access(p_actor,p_ticket,p_owner,p_kind,p_plan,p_expires,p_reason,p_expected);
end $$;
create function public.admin_access_release(p_actor uuid,p_owner uuid,p_ticket uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform encaixa_private.require_platform_admin(p_actor);
 delete from encaixa_private.admin_access_locks where owner_id=p_owner and ticket=p_ticket;
 return found;
end $$;
revoke all on function public.admin_access_claim(uuid,uuid),public.admin_access_apply(uuid,uuid,uuid,text,text,timestamptz,text,uuid),public.admin_access_release(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_access_claim(uuid,uuid),public.admin_access_apply(uuid,uuid,uuid,text,text,timestamptz,text,uuid),public.admin_access_release(uuid,uuid,uuid) to service_role;

create function public.admin_revoke_access(p_owner uuid,p_expected uuid,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
declare previous encaixa_private.access_grants;
begin
 perform encaixa_private.require_platform_admin(auth.uid());
 if p_expected is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then raise exception 'Informe o motivo do encerramento.'; end if;
 update encaixa_private.billing_accounts set team_revision=team_revision+1 where owner_id=p_owner;
 select * into previous from encaixa_private.access_grants where owner_id=p_owner;
 if previous.id is distinct from p_expected then raise exception 'O benefício mudou. Atualize a conta antes de continuar.'; end if;
 delete from encaixa_private.access_grants where owner_id=p_owner;
 insert into encaixa_private.admin_audit(actor_id,owner_id,action,details)
 values(auth.uid(),p_owner,'access_revoked',jsonb_build_object('before',to_jsonb(previous),'reason',btrim(p_reason)));
 return true;
end $$;

create function public.admin_history(p_owner uuid default null,p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform encaixa_private.require_platform_admin(auth.uid());
 select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into result from (
  select id,actor_id,owner_id,action,details,created_at from encaixa_private.admin_audit
  where (p_owner is null or owner_id=p_owner) and (p_before is null or id<p_before)
  order by id desc limit 25
 ) a;
 return result;
end $$;

create function public.admin_coupons_list(p_mode text,p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform encaixa_private.require_platform_admin(auth.uid());
 select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from (
  select * from encaixa_private.admin_coupons where mode=p_mode and (p_before is null or created_at<p_before)
  order by created_at desc,id limit 50
 ) c;
 return result;
end $$;

create function public.admin_coupon_authorize(p_actor uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 perform encaixa_private.require_platform_admin(p_actor);
 return true;
end $$;
revoke all on function public.admin_coupon_authorize(uuid) from public,anon,authenticated;
grant execute on function public.admin_coupon_authorize(uuid) to service_role;

-- These RPCs are exclusive to the authenticated Edge Function's service client.
create function public.admin_coupon_prepare(p_actor uuid,p_mode text,p_code text,p_definition jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c encaixa_private.admin_coupons;
begin
 perform encaixa_private.require_platform_admin(p_actor);
 if p_mode is null or p_mode not in ('test','live') or p_code is null or p_code !~ '^[A-Z0-9]{3,32}$' or p_definition is null then raise exception 'Cupom inválido.'; end if;
 insert into encaixa_private.admin_coupons(mode,code,definition,created_by) values(p_mode,p_code,p_definition,p_actor)
 on conflict(mode,code) do nothing returning * into c;
 if found then
  insert into encaixa_private.admin_audit(actor_id,action,details) values(p_actor,'coupon_requested',to_jsonb(c));
 else
  select * into c from encaixa_private.admin_coupons where mode=p_mode and code=p_code;
  if c.definition<>p_definition then raise exception 'Este código já existe com outras condições. Escolha outro código.'; end if;
 end if;
 return to_jsonb(c);
end $$;
create function public.admin_coupon_get(p_actor uuid,p_id uuid,p_mode text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare c encaixa_private.admin_coupons;
begin
 perform encaixa_private.require_platform_admin(p_actor);
 select * into c from encaixa_private.admin_coupons where id=p_id and mode=p_mode;
 if not found then raise exception 'Cupom não encontrado neste ambiente.'; end if;
 return to_jsonb(c);
end $$;
create function public.admin_coupon_finish(p_actor uuid,p_id uuid,p_mode text,p_coupon text,p_promotion text,p_state text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c encaixa_private.admin_coupons; old_state text;
begin
 perform encaixa_private.require_platform_admin(p_actor);
 select * into c from encaixa_private.admin_coupons where id=p_id and mode=p_mode for update;
 if not found then raise exception 'Cupom não encontrado.'; end if;
 if p_coupon is null or p_promotion is null or p_state is null or p_state not in ('active','inactive')
  or (c.promotion_id is not null and c.promotion_id<>p_promotion) or (c.stripe_coupon_id is not null and c.stripe_coupon_id<>p_coupon)
  then raise exception 'Resposta de cupom inválida.'; end if;
 old_state:=c.state;
 update encaixa_private.admin_coupons set stripe_coupon_id=p_coupon,promotion_id=p_promotion,
  state=case when state='inactive' then 'inactive' else p_state end where id=p_id returning * into c;
 if old_state<>c.state then
  insert into encaixa_private.admin_audit(actor_id,action,details) values(p_actor,'coupon_'||c.state,to_jsonb(c));
 end if;
 return to_jsonb(c);
end $$;

revoke all on function encaixa_private.require_platform_admin(uuid),encaixa_private.active_access_grant(uuid) from public,anon,authenticated,service_role;
revoke all on function public.platform_admin_status(),public.admin_accounts(text,integer),
 public.admin_set_access(uuid,text,text,timestamptz,text,uuid),public.admin_revoke_access(uuid,uuid,text),
 public.admin_history(uuid,bigint),public.admin_coupons_list(text,timestamptz) from public,anon,service_role;
grant execute on function public.platform_admin_status(),public.admin_accounts(text,integer),
 public.admin_set_access(uuid,text,text,timestamptz,text,uuid),public.admin_revoke_access(uuid,uuid,text),
 public.admin_history(uuid,bigint),public.admin_coupons_list(text,timestamptz) to authenticated;
revoke all on function public.admin_coupon_prepare(uuid,text,text,jsonb),public.admin_coupon_get(uuid,uuid,text),
 public.admin_coupon_finish(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_coupon_prepare(uuid,text,text,jsonb),public.admin_coupon_get(uuid,uuid,text),
 public.admin_coupon_finish(uuid,uuid,text,text,text,text) to service_role;

-- Billing overrides appended below; no changes to Stripe-owned payment fields.

create or replace function encaixa_private.team_limit(p_owner uuid) returns integer
language sql stable security definer set search_path='' as $$
 select least(
  case when g.v is not null then encaixa_private.plan_limit(g.v->>'plan_id')
   when not coalesce((select enabled from encaixa_private.billing_settings where singleton),true) or b.trial_ends_at>now() then 5
   else encaixa_private.plan_limit(b.plan_id) end,
  coalesce(encaixa_private.plan_limit(b.operation->>'plan'),5))
 from encaixa_private.billing_accounts b
 cross join lateral (select encaixa_private.active_access_grant(p_owner) as v) g where b.owner_id=p_owner
$$;
create or replace function encaixa_private.billing_access(p_owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case when encaixa_private.active_access_grant(p_owner) is not null
  then encaixa_private.team_size(p_owner)<=encaixa_private.team_limit(p_owner)
  else not coalesce((select enabled from encaixa_private.billing_settings where singleton),true) or coalesce((
   select trial_ends_at>now() or (status='active' and paid_until>now()
    and encaixa_private.team_size(p_owner)<=encaixa_private.plan_limit(plan_id))
   from encaixa_private.billing_accounts where owner_id=p_owner),false) end
$$;

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
  'benefit',encaixa_private.active_access_grant(auth.uid()),'benefits_version',1,'pending_plan',b.operation->>'plan','pending_action',b.operation->>'action');
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
 'benefit',encaixa_private.active_access_grant(p_owner),'active_professionals',encaixa_private.team_size(p_owner),'plans_version',2);
end $$;
create or replace function public.billing_begin_operation(p_owner uuid,p_action text,p_plan text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b encaixa_private.billing_accounts; op jsonb; ticket uuid; stamp bigint;
begin
 update encaixa_private.billing_accounts set team_revision=team_revision+1 where owner_id=p_owner returning * into b;
 if b.owner_id is null then raise exception 'Configure seu espaço antes de assinar.'; end if;
 if not (select enabled from encaixa_private.billing_settings where singleton) then raise exception 'A cobrança ainda não foi ativada.'; end if;
 if encaixa_private.plan_limit(p_plan) is null or p_action not in('checkout','change') then raise exception 'Plano inválido.'; end if;
 if b.operation_lease_until>now() then raise exception 'Aguarde a solicitação em andamento e tente novamente.'; end if;
 if exists(select 1 from encaixa_private.admin_access_locks where owner_id=p_owner and expires_at>now()) then raise exception 'Aguarde a atualização administrativa do acesso.'; end if;
 if encaixa_private.active_access_grant(p_owner) is not null then raise exception 'Seu acesso gratuito está ativo. Nenhuma assinatura é necessária durante este período.'; end if;
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
commit;
