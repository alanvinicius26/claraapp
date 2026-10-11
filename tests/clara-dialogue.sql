-- Runs against synthetic records only; the entire transaction is rolled back.
begin;
do $$
declare u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); sid uuid; pid uuid; svc uuid; cid uuid;
 aid uuid; d date:=(now() at time zone 'America/Sao_Paulo')::date+3;
 old_start timestamptz; choice timestamptz; r jsonb; q jsonb; q2 jsonb; rejected boolean; before_price numeric;
begin
 insert into auth.users(id,email) values(u,u::text||'@example.invalid'),(other_u,other_u::text||'@example.invalid');
 insert into public.studios(owner_id,name,professional,slug,min_notice,buffer,horizon)
 values(u,'Clara QA','Profissional QA','clara-qa-'||u::text,0,15,30) returning id into sid;
 select id into pid from public.professionals where studio_id=sid and is_default;
 insert into public.working_hours(studio_id,weekday,opens,closes) select sid,w,'08:00','18:00' from generate_series(0,6) w;
 insert into public.services(studio_id,name,price,duration) values(sid,'Serviço QA',75,60) returning id into svc;
 insert into public.clients(studio_id,name,phone) values(sid,'Cliente QA','11999998888') returning id into cid;
 old_start:=(d+time '09:00') at time zone 'America/Sao_Paulo';
 insert into public.appointments(studio_id,professional_id,service_id,client_id,starts_at,ends_at)
 values(sid,pid,svc,cid,old_start,old_start+interval '1 hour') returning id,price into aid,before_price;
 perform set_config('request.jwt.claim.sub',other_u::text,true);
 rejected:=false; begin perform public.clara_reschedule_options(aid,d+1); exception when raise_exception then rejected:=true; end;
 if not rejected then raise exception 'Cross-tenant options allowed'; end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 q:=public.clara_reschedule_options(aid,d+1);
 if jsonb_array_length(q->'slots')=0 then raise exception 'Missing slots'; end if;
 choice:=(q->'slots'->>0)::timestamptz;
 rejected:=false; begin perform public.clara_reschedule_confirm((q->>'ticket')::uuid,choice+interval '1 minute'); exception when raise_exception then rejected:=true; end;
 if not rejected then raise exception 'Forged slot accepted'; end if;
 perform set_config('request.jwt.claim.sub',other_u::text,true);
 rejected:=false; begin perform public.clara_reschedule_confirm((q->>'ticket')::uuid,choice); exception when raise_exception then rejected:=true; end;
 if not rejected then raise exception 'Cross-tenant confirmation allowed'; end if;
 perform set_config('request.jwt.claim.sub',u::text,true);
 update public.services set price=90,duration=90 where id=svc;
 r:=public.clara_reschedule_confirm((q->>'ticket')::uuid,choice);
 if (r->>'startsAt')::timestamptz<>choice or r->>'client'<>'Cliente QA' then raise exception 'Wrong result'; end if;
 if (select price from public.appointments where id=aid)<>before_price or (select ends_at-starts_at from public.appointments where id=aid)<>interval '1 hour' then raise exception 'Snapshot changed'; end if;
 if public.clara_reschedule_confirm((q->>'ticket')::uuid,choice)<>r then raise exception 'Retry not idempotent'; end if;

 -- Versioned conversation: a time query/offer cannot be committed.
 perform public.clara_dialogue_get();
 q:=public.clara_reschedule_options(aid,d+1);
 declare
  chat jsonb; prior integer; chosen timestamptz;
 begin
  chosen:=(q->'slots'->>0)::timestamptz;
  chat:=public.clara_dialogue_save(0,jsonb_build_object('stage','offer','appointmentId',aid,'ticket',q->>'ticket'));
  rejected:=false;begin perform public.clara_dialogue_commit((chat->>'revision')::int,(q->>'ticket')::uuid,chosen);exception when raise_exception then rejected:=true;end;
  if not rejected then raise exception 'Offer committed without active confirmation';end if;
  chat:=public.clara_dialogue_save((chat->>'revision')::int,jsonb_build_object('stage','confirm','appointmentId',aid,'ticket',q->>'ticket','pendingStart',chosen));
  prior:=(chat->>'revision')::int;
  -- Another tab correcting the conversation invalidates the old confirmation.
  chat:=public.clara_dialogue_save(prior,jsonb_build_object('stage','date','appointmentId',aid));
  rejected:=false;begin perform public.clara_dialogue_commit(prior,(q->>'ticket')::uuid,chosen);exception when raise_exception then rejected:=true;end;
  if not rejected then raise exception 'Old tab confirmation accepted';end if;
  q:=public.clara_reschedule_options(aid,d+1);
  chosen:=(q->'slots'->>0)::timestamptz;
  chat:=public.clara_dialogue_save((chat->>'revision')::int,jsonb_build_object('stage','confirm','appointmentId',aid,'ticket',q->>'ticket','pendingStart',chosen));
  prior:=(chat->>'revision')::int;
  r:=public.clara_dialogue_commit(prior,(q->>'ticket')::uuid,chosen);
  if public.clara_dialogue_commit(prior,(q->>'ticket')::uuid,chosen)<>r then raise exception 'Conversation retry not idempotent';end if;
  if (public.clara_dialogue_get()->'state'->>'stage')<>'identified' then raise exception 'Conversation not retained';end if;
  chat:=public.clara_dialogue_save((r->>'revision')::int,'{"stage":"idle"}'::jsonb);
  if public.clara_dialogue_get()->'state'<>'{"stage":"idle"}'::jsonb then raise exception 'Closed conversation retained a receipt or proposal';end if;
  if (select starts_at from public.appointments where id=aid)<>chosen then raise exception 'Reset changed a saved appointment';end if;
  rejected:=false;begin perform public.clara_dialogue_commit(prior,(q->>'ticket')::uuid,chosen);exception when raise_exception then rejected:=true;end;
  if not rejected then raise exception 'Closed conversation accepted an old confirmation';end if;
  if has_function_privilege('authenticated','public.clara_reschedule_confirm(uuid,timestamptz)','EXECUTE') then raise exception 'Legacy write bypass enabled';end if;
 end;
 q:=public.clara_reschedule_options(aid,d+2);
 choice:=(q->'slots'->>0)::timestamptz;
 insert into public.appointments(studio_id,professional_id,starts_at,ends_at,status) values(sid,pid,choice,choice+interval '1 hour','blocked');
 rejected:=false; begin perform public.clara_reschedule_confirm((q->>'ticket')::uuid,choice); exception when raise_exception then rejected:=true; end;
 if not rejected then raise exception 'Newly occupied slot accepted'; end if;
 q:=public.clara_reschedule_options(aid,d+3);
 update public.appointments set starts_at=starts_at+interval '15 minutes' where id=aid;
 rejected:=false; begin perform public.clara_reschedule_confirm((q->>'ticket')::uuid,(q->'slots'->>0)::timestamptz); exception when raise_exception then rejected:=true; end;
 if not rejected then raise exception 'Stale appointment accepted'; end if;
 q:=public.clara_reschedule_options(aid,d+3);
 update encaixa_private.clara_reschedules set expires_at=now()-interval '1 second' where id=(q->>'ticket')::uuid;
 rejected:=false; begin perform public.clara_reschedule_confirm((q->>'ticket')::uuid,(q->'slots'->>0)::timestamptz); exception when raise_exception then rejected:=true; end;
 if not rejected then raise exception 'Expired offer accepted'; end if;
 q:=public.clara_reschedule_options(aid,d+3);
 insert into public.payments(studio_id,appointment_id,amount,method) values(sid,aid,before_price,'Pix');
 rejected:=false; begin perform public.clara_reschedule_confirm((q->>'ticket')::uuid,(q->'slots'->>0)::timestamptz); exception when raise_exception then rejected:=true; end;
 if not rejected then raise exception 'Paid appointment accepted'; end if;
 if has_function_privilege('anon','public.clara_reschedule_options(uuid,date)','EXECUTE') or has_function_privilege('anon','public.clara_reschedule_confirm(uuid,timestamptz)','EXECUTE') then raise exception 'Anonymous execution allowed'; end if;
end $$;
rollback;
