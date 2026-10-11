-- Temporary test accounts, never emails or touches a real user.
do $$ declare uid uuid; addr text; begin
 foreach addr in array array['encaixa-test-a@example.invalid','encaixa-test-b@example.invalid'] loop
  if exists(select 1 from auth.users where email=addr) then raise exception 'Test fixture already exists; clean it first.'; end if;
  uid:=gen_random_uuid();
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,confirmation_token,recovery_token,email_change_token_new,email_change,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('00000000-0000-0000-0000-000000000000',uid,'authenticated','authenticated',addr,extensions.crypt('Encaixa-QA-9c187db1-f2c8!',extensions.gen_salt('bf')),now(),'','','','','{"provider":"email","providers":["email"]}','{}',now(),now());
  insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at)
  values(gen_random_uuid(),uid,uid::text,jsonb_build_object('sub',uid::text,'email',addr,'email_verified',true),'email',now(),now());
 end loop;
end $$;
