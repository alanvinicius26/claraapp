-- Isolated synthetic records; every change is rolled back, even on assertion failure.
begin;
do $$
declare uid uuid:=gen_random_uuid(); sid uuid; svc uuid; cid uuid; aid uuid;
 token uuid; result jsonb; old_slug text:='qa-readiness-'||gen_random_uuid()::text;
 rejected boolean:=false;
begin
 insert into auth.users(id,email) values(uid,uid::text||'@example.invalid');
 insert into public.studios(owner_id,name,professional,slug,horizon)
 values(uid,'QA Readiness','QA',old_slug,7) returning id into sid;
 update public.studios set name='QA Renamed',slug=old_slug where id=sid;
 update public.studios set slug='changed-'||uid::text where id=sid;
 if (select name from public.studios where id=sid)<>'QA Renamed' then raise exception 'Display name must remain editable'; end if;
 if public.booking_page(old_slug)->'studio'->>'name'<>'QA Renamed' then raise exception 'Shared link must still resolve'; end if;
 insert into public.services(studio_id,name,price,duration) values(sid,'QA Service',10,30) returning id into svc;
 insert into public.working_hours(studio_id,weekday) select sid,generate_series(0,6);
 insert into public.clients(studio_id,name) values(sid,'QA Client') returning id into cid;
 insert into public.appointments(studio_id,service_id,client_id,starts_at,ends_at)
 values(sid,svc,cid,(((now() at time zone 'America/Sao_Paulo')::date+2)+time '09:00') at time zone 'America/Sao_Paulo',
 (((now() at time zone 'America/Sao_Paulo')::date+2)+time '09:30') at time zone 'America/Sao_Paulo') returning id,manage_token into aid,token;
 result:=public.manage_booking(token);
 if (result->>'paid')::boolean is distinct from false or (result->>'horizon')::int is distinct from 7 then
  raise exception 'Missing unpaid state or studio horizon';
 end if;
 insert into public.payments(studio_id,appointment_id,amount,method) values(sid,aid,10,'Pix');
 result:=public.manage_booking(token);
 if (result->>'paid')::boolean is distinct from true then raise exception 'Missing paid state'; end if;
 rejected:=false;
 begin
  perform public.manage_booking(token,'cancel');
 exception when raise_exception then
  if sqlerrm not like 'Esta reserva tem pagamento registrado.%' then raise; end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'Paid cancellation must be rejected'; end if;
 if (select status from public.appointments where id=aid)<>'confirmed' then raise exception 'Reservation was modified'; end if;
 if has_function_privilege('anon','public.manage_booking(uuid,text,timestamptz)','EXECUTE')
 or has_function_privilege('authenticated','public.manage_booking(uuid,text,timestamptz)','EXECUTE') then
  raise exception 'Management must remain gateway-only';
 end if;
end $$;
rollback;
