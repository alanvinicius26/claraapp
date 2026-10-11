-- Trusted database administrator only. Never expose this script as a public RPC.
-- Before executing, set clara.bootstrap_admin_email to the EXACT email provided
-- by the account owner, using a parameterized query / safely quoted SQL literal.
-- Example (same database session):
-- select set_config('clara.bootstrap_admin_email', '<confirmed email>', false);
begin;
do $$
declare chosen uuid; supplied text:=nullif(btrim(current_setting('clara.bootstrap_admin_email',true)),'');
begin
 if supplied is null then raise exception 'Informe o e-mail autorizado antes de conceder acesso administrativo.'; end if;
 if (select count(*) from auth.users where lower(email)=lower(supplied) and email_confirmed_at is not null)<>1 then
  raise exception 'É necessária exatamente uma conta com este e-mail confirmado.';
 end if;
 select id into chosen from auth.users where lower(email)=lower(supplied) and email_confirmed_at is not null;
 if exists(select 1 from encaixa_private.platform_admins where user_id<>chosen) then
  raise exception 'Já existe outro administrador. Revise a concessão explicitamente.';
 end if;
 insert into encaixa_private.platform_admins(user_id) values(chosen) on conflict do nothing;
 if found then
  insert into encaixa_private.admin_audit(actor_id,owner_id,action,details)
  values(null,chosen,'admin_bootstrapped',jsonb_build_object('reason','Acesso exclusivo autorizado pelo titular'));
 end if;
end $$;
commit;
