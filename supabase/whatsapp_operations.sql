-- Additive migration, after whatsapp.sql. No network calls or historical opt-in.
begin;
-- Expand a validation constraint only; no rows/columns are removed.
alter table public.whatsapp_messages drop constraint whatsapp_messages_kind_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_kind_check check(kind in('inbound','greeting','booking_link','confirmation','reschedule','cancellation','reminder','manual','handoff'));
create table encaixa_private.whatsapp_connections (
 studio_id uuid primary key references public.studios(id), waba_id text not null,
 phone_number_id text not null unique, display_phone text not null, verified_name text not null,
 token_cipher jsonb not null, connected_at timestamptz not null default now(), generation uuid not null,
 status text not null default 'connected' check(status in('connected','disconnected'))
);
create table encaixa_private.whatsapp_signup (
 id uuid primary key, studio_id uuid not null references public.studios(id), owner_id uuid not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '10 minutes',
 consumed_at timestamptz
);
create table encaixa_private.whatsapp_inbox (
 id uuid primary key default gen_random_uuid(), event_key text not null unique, mode text not null check(mode in('simulation','live')),
 payload jsonb not null, status text not null default 'pending' check(status in('pending','done','failed')),
 attempts integer not null default 0, available_at timestamptz not null default now(), created_at timestamptz not null default now(), error_code text
);
create index whatsapp_inbox_ready on encaixa_private.whatsapp_inbox(available_at) where status='pending';
create table encaixa_private.whatsapp_incidents (
 id uuid primary key default gen_random_uuid(), code text not null, opened_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(), occurrences integer not null default 1, resolved_at timestamptz
);
create unique index whatsapp_incident_open on encaixa_private.whatsapp_incidents(code) where resolved_at is null;

create function public.whatsapp_connect_control(p_owner uuid,p_studio uuid,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare c encaixa_private.whatsapp_connections; sid uuid;
begin
 if not exists(select 1 from public.studios where id=p_studio and owner_id=p_owner) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 -- Serializes connect/disconnect and invalidates older onboarding attempts.
 perform pg_advisory_xact_lock(hashtextextended('wa-connect:'||p_studio,0));
 select * into c from encaixa_private.whatsapp_connections where studio_id=p_studio;
 if p_action='status' then
  return jsonb_build_object('status',coalesce(c.status,'disconnected'),'display_phone',c.display_phone,'verified_name',c.verified_name,
    'connected_at',c.connected_at,'phone_number_id',c.phone_number_id,'waba_id',c.waba_id);
 elsif p_action='begin' then
  if (select count(*) from encaixa_private.whatsapp_signup where studio_id=p_studio and created_at>now()-interval '1 hour')>=10 then raise exception 'Aguarde para tentar conectar novamente.'; end if;
  update encaixa_private.whatsapp_signup set consumed_at=now() where studio_id=p_studio and consumed_at is null;
  sid:=gen_random_uuid();insert into encaixa_private.whatsapp_signup(id,studio_id,owner_id) values(sid,p_studio,p_owner);
  return jsonb_build_object('session_id',sid);
 elsif p_action='consume' then
  update encaixa_private.whatsapp_signup set consumed_at=now() where id=(p_data->>'session_id')::uuid and studio_id=p_studio
   and owner_id=p_owner and consumed_at is null and expires_at>now() returning id into sid;
  if sid is null then raise exception 'Conexão expirada ou já utilizada. Inicie novamente.'; end if;
  return jsonb_build_object('session_id',sid);
 elsif p_action='save' then
  sid:=(p_data->>'session_id')::uuid;
  if not exists(select 1 from encaixa_private.whatsapp_signup where id=sid and studio_id=p_studio and owner_id=p_owner
   and consumed_at is not null and expires_at>now() and created_at=(select max(created_at) from encaixa_private.whatsapp_signup where studio_id=p_studio)) then raise exception 'Conexão substituída. Inicie novamente.'; end if;
  if p_data->>'phone_number_id' !~ '^[0-9]+$' or p_data->>'waba_id' !~ '^[0-9]+$' or jsonb_typeof(p_data->'token_cipher')<>'object' then raise exception 'Conexão inválida.'; end if;
  -- A different number must start with a fresh queue and independently approved templates.
  update public.whatsapp_messages set status='cancelled',error_code='channel_changed' where studio_id=p_studio and status='pending';
  insert into encaixa_private.whatsapp_connections(studio_id,waba_id,phone_number_id,display_phone,verified_name,token_cipher,generation)
   values(p_studio,p_data->>'waba_id',p_data->>'phone_number_id',p_data->>'display_phone',p_data->>'verified_name',p_data->'token_cipher',sid)
  on conflict(studio_id) do update set waba_id=excluded.waba_id,phone_number_id=excluded.phone_number_id,display_phone=excluded.display_phone,
   verified_name=excluded.verified_name,token_cipher=excluded.token_cipher,generation=sid,status='connected',connected_at=now();
  insert into public.whatsapp_settings(studio_id,phone_number_id,mode,enabled) values(p_studio,p_data->>'phone_number_id','live',false)
  on conflict(studio_id) do update set phone_number_id=excluded.phone_number_id,mode='live',enabled=false,templates='{}';
  return jsonb_build_object('connected',true,'enabled',false);
 elsif p_action='credential' then
  if c.status<>'connected' or c.phone_number_id is distinct from p_data->>'phone_number_id' then return null; end if;
  return jsonb_build_object('token_cipher',c.token_cipher,'waba_id',c.waba_id,'generation',c.generation);
 elsif p_action='templates' then
  if c.status<>'connected' or c.generation is distinct from (p_data->>'generation')::uuid then raise exception 'Conexão alterada.'; end if;
  update public.whatsapp_settings set templates=p_data->'templates' where studio_id=p_studio;
  return jsonb_build_object('updated',true);
 elsif p_action='disconnect' then
  update encaixa_private.whatsapp_connections set status='disconnected',token_cipher='{}' where studio_id=p_studio;
  update public.whatsapp_settings set enabled=false where studio_id=p_studio;
  update public.whatsapp_messages set status='cancelled',error_code='channel_disconnected' where studio_id=p_studio and status='pending';
  -- An in-flight completion can no longer save this connection.
  delete from encaixa_private.whatsapp_signup where studio_id=p_studio;
  return jsonb_build_object('disconnected',true);
 end if;
 raise exception 'Ação inválida.';
end $$;

-- Worker-only credential lookup. No credential can be read by browser roles.
create function public.whatsapp_worker_connection(p_studio uuid,p_channel text) returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('token_cipher',c.token_cipher) from encaixa_private.whatsapp_connections c
 join public.whatsapp_settings s on s.studio_id=c.studio_id and s.enabled and s.mode='live'
 where c.studio_id=p_studio and c.phone_number_id=p_channel and c.status='connected';
$$;

create function public.whatsapp_ingest(p_key text,p_payload jsonb,p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i uuid;
begin
 if p_key !~ '^[a-f0-9]{64}$' or p_payload->>'object'<>'whatsapp_business_account' or jsonb_typeof(p_payload->'entry')<>'array' then raise exception 'Evento inválido.'; end if;
 insert into encaixa_private.whatsapp_inbox(event_key,payload,mode) values(p_key,p_payload,p_mode) on conflict do nothing returning id into i;
 return jsonb_build_object('received',true,'duplicate',i is null);
end $$;

-- Each event is processed in one SQL transaction. No received event depends on n8n memory.
create function public.whatsapp_dispatch(p_mode text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; entry jsonb; change jsonb; msg jsonb; v jsonb; channel text; result jsonb;
 processed int:=0; failures int:=0; human int:=0; receipts int:=0; ignored int:=0; event_human int; event_receipts int; event_ignored int;
begin
 for item in select * from encaixa_private.whatsapp_inbox where mode=p_mode and status='pending' and available_at<=now()
  order by created_at,id limit 30 for update skip locked loop
  begin
   event_human:=0;event_receipts:=0;event_ignored:=0;
   for entry in select * from jsonb_array_elements(item.payload->'entry') loop
    for change in select * from jsonb_array_elements(coalesce(entry->'changes','[]')) loop
     if change->>'field'<>'messages' then continue; end if;
     v:=change->'value';channel:=v->'metadata'->>'phone_number_id';
     if not exists(select 1 from public.whatsapp_settings where phone_number_id=channel and mode=p_mode) then event_ignored:=event_ignored+1;continue;end if;
     for msg in select * from jsonb_array_elements(coalesce(v->'statuses','[]')) loop
      perform public.whatsapp_receipt(channel,msg->>'id',msg->>'status',to_timestamp((msg->>'timestamp')::double precision));event_receipts:=event_receipts+1;
     end loop;
     -- Disabled channels retain the event for a controlled retry instead of silently losing handoff requests.
     for msg in select * from jsonb_array_elements(coalesce(v->'messages','[]')) loop
      result:=public.whatsapp_inbound(channel,msg->>'id',msg->>'from',coalesce(msg->'text'->>'body',msg->'interactive'->'button_reply'->>'id',msg->'interactive'->'list_reply'->>'id',msg->'button'->>'payload','[Mensagem não textual]'),to_timestamp((msg->>'timestamp')::double precision),p_mode);
      if result->>'human'='true' then event_human:=event_human+1;end if;
     end loop;
    end loop;
   end loop;
   update encaixa_private.whatsapp_inbox set status='done',attempts=attempts+1,error_code=null where id=item.id;processed:=processed+1;
   human:=human+event_human;receipts:=receipts+event_receipts;ignored:=ignored+event_ignored;
  exception when others then
   update encaixa_private.whatsapp_inbox set attempts=attempts+1,status=case when attempts>=4 then 'failed' else 'pending' end,
    available_at=now()+make_interval(secs=>30*power(2,attempts)::int),error_code='event_processing_failed' where id=item.id;
   failures:=failures+1;
  end;
 end loop;
 return jsonb_build_object('processed',processed,'failures',failures,'human_requests',human,'receipts',receipts,'ignored_channels',ignored);
end $$;

create function public.whatsapp_operations(p_mode text,p_record boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pending int; bad int; incoming int; people int; attention boolean;
begin
 -- Terminal failures alert for one hour after they happen, so a single old failure cannot
 -- keep the incident open forever. They remain visible in each conversation history.
 select count(*) filter(where status='pending'),count(*) filter(where status in('failed','uncertain') and updated_at>now()-interval '1 hour') into pending,bad from public.whatsapp_messages where mode=p_mode;
 -- available_at holds the last attempt (plus backoff) for events that failed permanently.
 select count(*) into incoming from encaixa_private.whatsapp_inbox where mode=p_mode and ((status='failed' and available_at>now()-interval '1 hour') or (status='pending' and created_at<now()-interval '5 minutes'));
 select count(*) into people from public.whatsapp_conversations c join public.whatsapp_settings s on s.studio_id=c.studio_id where s.mode=p_mode and c.mode='human';
 attention:=bad+incoming>0;
 if p_record and attention then
  insert into encaixa_private.whatsapp_incidents(code) values('queue_attention_'||p_mode) on conflict(code) where resolved_at is null
   do update set last_seen_at=now(),occurrences=encaixa_private.whatsapp_incidents.occurrences+1;
 end if;
 if not attention then update encaixa_private.whatsapp_incidents set resolved_at=now() where code='queue_attention_'||p_mode and resolved_at is null;end if;
 return jsonb_build_object('pending',pending,'failed_or_uncertain',bad,'inbox_attention',incoming,'human_requests',people,'needs_attention',attention);
end $$;

revoke all on encaixa_private.whatsapp_connections,encaixa_private.whatsapp_signup,encaixa_private.whatsapp_inbox,encaixa_private.whatsapp_incidents from public,anon,authenticated;
revoke all on function public.whatsapp_connect_control(uuid,uuid,text,jsonb), public.whatsapp_worker_connection(uuid,text),
 public.whatsapp_ingest(text,jsonb,text),public.whatsapp_dispatch(text),public.whatsapp_operations(text,boolean) from public,anon,authenticated;
grant execute on function public.whatsapp_connect_control(uuid,uuid,text,jsonb), public.whatsapp_worker_connection(uuid,text),
 public.whatsapp_ingest(text,jsonb,text),public.whatsapp_dispatch(text),public.whatsapp_operations(text,boolean) to service_role;
commit;
