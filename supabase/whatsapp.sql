-- Additive, LOCAL migration. Apply after the existing production migrations.
-- No historical bookings are opted in. No network calls are made by PostgreSQL.
begin;

create table public.whatsapp_settings (
 studio_id uuid primary key references public.studios(id),
 enabled boolean not null default false,
 mode text not null default 'simulation' check(mode in ('simulation','live')),
 phone_number_id text unique,
 reminder_minutes integer not null default 1440 check(reminder_minutes between 5 and 10080),
 timezone text not null default 'America/Sao_Paulo' check(timezone='America/Sao_Paulo'),
 templates jsonb not null default '{}'::jsonb
);
create table public.whatsapp_conversations (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null references public.studios(id),
 phone text not null check(phone ~ '^[1-9][0-9]{7,14}$'),
 mode text not null default 'bot' check(mode in ('bot','human')),
 requested_at timestamptz, closed_at timestamptz, last_inbound_at timestamptz,
 greeted_at timestamptz, opted_out boolean not null default false,
 created_at timestamptz not null default now(), unique(studio_id,phone), unique(id,studio_id)
);
create table public.whatsapp_consents (
 appointment_id uuid primary key, studio_id uuid not null, client_id uuid not null,
 phone text not null, granted_at timestamptz not null default now(), revoked_at timestamptz,
 source text not null default 'booking_checkbox', version text not null default 'booking-whatsapp-v1',
 disclosure text not null default 'Autorizo este estabelecimento a enviar confirmação, alterações e lembrete deste agendamento pelo WhatsApp. Posso cancelar enviando SAIR.',
 foreign key(appointment_id,studio_id) references public.appointments(id,studio_id),
 foreign key(client_id,studio_id) references public.clients(id,studio_id)
);
create table public.whatsapp_messages (
 id uuid primary key default gen_random_uuid(), studio_id uuid not null,
 conversation_id uuid not null, appointment_id uuid, revision bigint,
 direction text not null check(direction in ('in','out')),
 kind text not null check(kind in ('inbound','greeting','booking_link','confirmation','reschedule','cancellation','reminder','manual','handoff')),
 mode text not null check(mode in ('simulation','live')),
 status text not null default 'pending' check(status in ('received','pending','sending','accepted','sent','delivered','read','simulated','failed','cancelled','uncertain')),
 body text not null default '' check(length(body)<=4096),
 template_key text, dedupe_key text not null,
 provider_id text, attempts integer not null default 0,
 available_at timestamptz not null default now(), expires_at timestamptz,
 lease_id uuid, lease_until timestamptz, error_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(studio_id,dedupe_key), unique(studio_id,provider_id), unique(id,studio_id),
 foreign key(conversation_id,studio_id) references public.whatsapp_conversations(id,studio_id),
 foreign key(appointment_id,studio_id) references public.appointments(id,studio_id)
);
create index whatsapp_queue on public.whatsapp_messages(available_at) where status='pending';
create index whatsapp_history on public.whatsapp_messages(conversation_id,created_at desc);
create table encaixa_private.whatsapp_revisions (
 appointment_id uuid primary key references public.appointments(id), revision bigint not null default 1
);
create table encaixa_private.whatsapp_requests (
 studio_id uuid not null, request_id uuid not null, fingerprint text not null, appointment_id uuid not null,
 primary key(studio_id,request_id), foreign key(appointment_id,studio_id) references public.appointments(id,studio_id)
);
create table encaixa_private.whatsapp_receipts (
 studio_id uuid not null, provider_id text not null, status text not null, event_at timestamptz not null,
 primary key(studio_id,provider_id,status)
);

do $$ declare t text; begin
 foreach t in array array['whatsapp_settings','whatsapp_conversations','whatsapp_consents','whatsapp_messages'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy whatsapp_owner on public.%I for select to authenticated using(studio_id in(select id from public.studios where owner_id=(select auth.uid())))',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;

-- One key per Brazilian mobile. WhatsApp may report older mobiles without the ninth digit
-- (55+DDD+8 digits starting 6–9); landlines start 2–5 and are kept as they are.
create function encaixa_private.whatsapp_canonical(p text) returns text language sql immutable set search_path='' as $$
 select case when n ~ '^55[1-9][1-9][6-9][0-9]{7}$' then left(n,4)||'9'||substr(n,5) else n end
 from (select regexp_replace(coalesce(p,''),'[^0-9]','','g') n) x;
$$;
-- Local Brazilian input (DDD + number) gains the country code; full numbers are kept.
create function encaixa_private.whatsapp_phone(p text) returns text language sql immutable set search_path='' as $$
 select encaixa_private.whatsapp_canonical(case when length(n) in(10,11) then '55'||n else n end) from (select regexp_replace(coalesce(p,''),'[^0-9]','','g') n) x;
$$;

create function encaixa_private.whatsapp_queue(p_studio uuid,p_conversation uuid,p_kind text,p_key text,
 p_body text default '',p_appointment uuid default null,p_revision bigint default null,
 p_at timestamptz default now(),p_expires timestamptz default null,p_template text default null)
returns uuid language plpgsql set search_path='' as $$
declare mid uuid; m text;
begin
 select mode into m from public.whatsapp_settings where studio_id=p_studio and enabled;
 if m is null then return null; end if;
 insert into public.whatsapp_messages(studio_id,conversation_id,kind,dedupe_key,direction,mode,body,appointment_id,revision,available_at,expires_at,template_key)
 values(p_studio,p_conversation,p_kind,p_key,'out',m,p_body,p_appointment,p_revision,p_at,p_expires,p_template)
 on conflict(studio_id,dedupe_key) do nothing returning id into mid;
 return mid;
end $$;

create function encaixa_private.whatsapp_schedule(p_id uuid,p_kind text default 'confirmation') returns void
language plpgsql security definer set search_path='' as $$
declare a public.appointments; c public.whatsapp_consents; cfg public.whatsapp_settings; cid uuid; rev bigint; due timestamptz; mid uuid;
begin
 select * into a from public.appointments where id=p_id;
 select * into c from public.whatsapp_consents where appointment_id=a.id and revoked_at is null;
 select * into cfg from public.whatsapp_settings where studio_id=a.studio_id and enabled;
 if c.appointment_id is null or cfg.studio_id is null or a.status='blocked' then return; end if;
 if c.client_id<>a.client_id or c.phone is distinct from (select encaixa_private.whatsapp_phone(phone) from public.clients where id=a.client_id) then return; end if;
 insert into public.whatsapp_conversations(studio_id,phone) values(a.studio_id,c.phone) on conflict(studio_id,phone) do nothing;
 select id into cid from public.whatsapp_conversations where studio_id=a.studio_id and phone=c.phone;
 insert into encaixa_private.whatsapp_revisions(appointment_id) values(a.id) on conflict do nothing;
 select revision into rev from encaixa_private.whatsapp_revisions where appointment_id=a.id;
 perform encaixa_private.whatsapp_queue(a.studio_id,cid,p_kind,a.id||':'||rev||':'||p_kind,'',a.id,rev,now(),
   case when p_kind='cancellation' then now()+interval '24 hours' else a.starts_at end,p_kind);
 if a.status<>'confirmed' then return; end if;
 due:=a.starts_at-make_interval(mins=>cfg.reminder_minutes);
 mid:=encaixa_private.whatsapp_queue(a.studio_id,cid,'reminder',a.id||':'||rev||':reminder','',a.id,rev,greatest(now(),due),a.starts_at,'reminder');
 -- Short-notice bookings get confirmation only, never an immediate duplicate reminder.
 if due<=now() then update public.whatsapp_messages set status='cancelled',error_code='short_notice' where id=mid; end if;
end $$;

create function encaixa_private.whatsapp_appointment_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.starts_at,new.professional_id,new.service_items,new.status,new.client_id) is not distinct from
    row(old.starts_at,old.professional_id,old.service_items,old.status,old.client_id) then return new; end if;
 -- Only the client record changed (e.g. merge_clients): the consent follows when the
 -- kept record has the same consented number. A different or missing number still invalidates it.
 if row(new.starts_at,new.professional_id,new.service_items,new.status) is not distinct from
    row(old.starts_at,old.professional_id,old.service_items,old.status) then
  update public.whatsapp_consents k set client_id=new.client_id
  where k.appointment_id=new.id and k.revoked_at is null and k.client_id=old.client_id
   and k.phone=(select encaixa_private.whatsapp_phone(phone) from public.clients where id=new.client_id);
  if found then return new; end if;
 end if;
 insert into encaixa_private.whatsapp_revisions(appointment_id,revision) values(new.id,2)
 on conflict(appointment_id) do update set revision=encaixa_private.whatsapp_revisions.revision+1;
 update public.whatsapp_messages set status='cancelled',error_code='appointment_changed',updated_at=now()
 where appointment_id=new.id and status='pending';
 if new.status in('confirmed','cancelled') then
  perform encaixa_private.whatsapp_schedule(new.id,case when new.status='cancelled' then 'cancellation' else 'reschedule' end);
 end if;
 return new;
end $$;
create trigger whatsapp_appointment_changed after update on public.appointments for each row execute function encaixa_private.whatsapp_appointment_changed();

-- Atomic booking + per-booking consent + outbox, with replay-safe booking requests.
create function public.book_appointment_whatsapp(p_slug text,p_services uuid[],p_start timestamptz,p_name text,p_email text,p_phone text,
 p_notes text default '',p_professional uuid default null,p_whatsapp_opt_in boolean default false,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; result jsonb; saved encaixa_private.whatsapp_requests; fp text; aid uuid; phone text;
begin
 sid:=encaixa_private.resolve_studio(p_slug);
 if sid is null or p_request_id is null then raise exception 'Solicitação de reserva inválida.'; end if;
 fp:=md5(jsonb_build_array(p_slug,p_services,p_start,p_name,p_email,p_phone,p_notes,p_professional,p_whatsapp_opt_in)::text);
 perform pg_advisory_xact_lock(hashtextextended(sid||':'||p_request_id,0));
 select * into saved from encaixa_private.whatsapp_requests where studio_id=sid and request_id=p_request_id;
 if found then
  if saved.fingerprint<>fp then raise exception 'Use uma nova solicitação para dados diferentes.'; end if;
  return (select jsonb_build_object('id',id,'token',manage_token) from public.appointments where id=saved.appointment_id);
 end if;
 result:=public.book_appointment_team(p_slug,p_services,p_start,p_name,p_email,p_phone,p_notes,p_professional);
 aid:=(result->>'id')::uuid;
 insert into encaixa_private.whatsapp_requests values(sid,p_request_id,fp,aid);
 if p_whatsapp_opt_in then
  phone:=encaixa_private.whatsapp_phone(p_phone);
  if phone !~ '^[1-9][0-9]{7,14}$' then raise exception 'WhatsApp inválido.'; end if;
  insert into public.whatsapp_consents(appointment_id,studio_id,client_id,phone)
  select id,studio_id,client_id,phone from public.appointments where id=aid;
  perform encaixa_private.whatsapp_schedule(aid);
 end if;
 return result;
end $$;

-- Verified provider channel resolves the tenant; callers never choose a studio id.
create function public.whatsapp_inbound(p_channel text,p_id text,p_phone text,p_body text,p_at timestamptz,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.whatsapp_settings; c public.whatsapp_conversations; mid uuid; text_key text; was_new boolean; event_at timestamptz;
begin
 select * into cfg from public.whatsapp_settings where phone_number_id=p_channel and enabled and mode=p_mode;
 if cfg.studio_id is null then raise exception 'Canal indisponível.'; end if;
 -- Provider ids include the country code; only the Brazilian ninth digit is restored.
 p_phone:=encaixa_private.whatsapp_canonical(p_phone);
 if p_phone !~ '^[1-9][0-9]{7,14}$' or length(p_id) not between 1 and 200 or length(p_body)>4096 or p_at is null or p_at>now()+interval '5 minutes' then raise exception 'Evento inválido.'; end if;
 event_at:=least(p_at,now());
 insert into public.whatsapp_conversations(studio_id,phone) values(cfg.studio_id,p_phone) on conflict(studio_id,phone) do nothing;
 select * into c from public.whatsapp_conversations where studio_id=cfg.studio_id and phone=p_phone for update;
 insert into public.whatsapp_messages(studio_id,conversation_id,direction,kind,mode,status,body,dedupe_key,provider_id,created_at)
 values(cfg.studio_id,c.id,'in','inbound',p_mode,'received',p_body,'in:'||p_id,p_id,event_at)
 on conflict(studio_id,dedupe_key) do nothing returning id into mid;
 if mid is null then return jsonb_build_object('duplicate',true); end if;
 was_new:=c.greeted_at is null or c.last_inbound_at<event_at-interval '24 hours';
 update public.whatsapp_conversations set last_inbound_at=greatest(last_inbound_at,event_at) where id=c.id;
 text_key:=lower(trim(p_body));
 if text_key in('sair','parar','stop','cancelar notificações') then
  update public.whatsapp_conversations set opted_out=true where id=c.id;
  update public.whatsapp_consents set revoked_at=now() where studio_id=cfg.studio_id and phone=p_phone and revoked_at is null;
  update public.whatsapp_messages set status='cancelled',error_code='opt_out' where conversation_id=c.id and status='pending' and kind<>'manual';
  return jsonb_build_object('opted_out',true);
 end if;
 -- Delayed/replayed old messages must not reopen a window or resume a bot.
 if event_at<now()-interval '24 hours' or event_at<coalesce(c.last_inbound_at,event_at) then return jsonb_build_object('recorded',true); end if;
 if text_key in('2','atendente','falar com atendente','humano') then
  if c.mode<>'human' then
   perform encaixa_private.whatsapp_queue(cfg.studio_id,c.id,'handoff','handoff:'||p_id,
    'Certo! Solicitei atendimento à equipe. As respostas automáticas estão pausadas enquanto você aguarda.',null,null,now(),event_at+interval '24 hours');
  end if;
  update public.whatsapp_conversations set mode='human',requested_at=coalesce(requested_at,now()),closed_at=null where id=c.id;
  return jsonb_build_object('human',true);
 end if;
 if c.mode='human' or c.opted_out then return jsonb_build_object('paused',true); end if;
 if text_key in('1','agendar') then
  perform encaixa_private.whatsapp_queue(cfg.studio_id,c.id,'booking_link','reply:'||p_id,'',null,null,now(),event_at+interval '24 hours');
  update public.whatsapp_conversations set greeted_at=now() where id=c.id;
 elsif was_new or text_key='menu' then
  perform encaixa_private.whatsapp_queue(cfg.studio_id,c.id,'greeting','reply:'||p_id,'',null,null,now(),event_at+interval '24 hours');
  update public.whatsapp_conversations set greeted_at=now() where id=c.id;
 end if;
 return jsonb_build_object('recorded',true);
end $$;

create function public.whatsapp_owner(p_action text,p_studio uuid,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.whatsapp_conversations; cfg public.whatsapp_settings; mid uuid; txt text; tk text;
begin
 if not exists(select 1 from public.studios where id=p_studio and owner_id=auth.uid()) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_action='list' then
  return jsonb_build_object('settings',(select to_jsonb(x) from public.whatsapp_settings x where studio_id=p_studio),
   'conversations',coalesce((select jsonb_agg(x order by x.last_inbound_at desc nulls last) from
    (select * from public.whatsapp_conversations where studio_id=p_studio order by last_inbound_at desc nulls last limit 200) x),'[]'::jsonb));
 elsif p_action='settings' then
  insert into public.whatsapp_settings(studio_id,enabled,reminder_minutes) values(p_studio,coalesce((p_data->>'enabled')::boolean,false),(p_data->>'reminder_minutes')::int)
  on conflict(studio_id) do update set enabled=excluded.enabled,reminder_minutes=excluded.reminder_minutes;
  -- Re-time existing unsent reminders, but never create a second one.
  update public.whatsapp_messages m set available_at=a.starts_at-make_interval(mins=>(p_data->>'reminder_minutes')::int),
    status=case when a.starts_at-make_interval(mins=>(p_data->>'reminder_minutes')::int)<=now() then 'cancelled' else 'pending' end,
    error_code=case when a.starts_at-make_interval(mins=>(p_data->>'reminder_minutes')::int)<=now() then 'short_notice' else null end
  from public.appointments a where m.appointment_id=a.id and m.studio_id=p_studio and m.kind='reminder' and m.status='pending';
  return jsonb_build_object('saved',true);
 end if;
 select * into c from public.whatsapp_conversations where id=(p_data->>'conversation_id')::uuid and studio_id=p_studio for update;
 if c.id is null then raise exception 'Conversa não encontrada.'; end if;
 if p_action='history' then
  return coalesce((select jsonb_agg(x order by x.created_at) from(select * from public.whatsapp_messages where conversation_id=c.id and studio_id=p_studio order by created_at desc limit 200) x),'[]'::jsonb);
 elsif p_action='close' then
  update public.whatsapp_conversations set mode='bot',closed_at=now(),requested_at=null,greeted_at=now() where id=c.id;
  -- Do not release stale chatbot responses after the human conversation.
  update public.whatsapp_messages set status='cancelled',error_code='human_closed' where conversation_id=c.id and status='pending' and kind in('greeting','booking_link','handoff');
  return jsonb_build_object('closed',true);
 elsif p_action='take' then
  update public.whatsapp_conversations set mode='human',requested_at=coalesce(requested_at,now()),closed_at=null where id=c.id;
  return jsonb_build_object('human',true);
 elsif p_action='send' then
  select * into cfg from public.whatsapp_settings where studio_id=p_studio and enabled;
  if cfg.studio_id is null then raise exception 'Integração pausada.'; end if;
  txt:=trim(coalesce(p_data->>'body','')); tk:=nullif(p_data->>'template_key','');
  if length(txt) not between 1 and 4000 or (p_data->>'request_id') is null then raise exception 'Mensagem inválida.'; end if;
  if tk is not null and tk<>'human_followup' then raise exception 'Modelo inválido.'; end if;
  if tk is not null then
   if coalesce(cfg.templates->tk->>'approved','false')<>'true' or cfg.templates->tk->>'name' is null then raise exception 'Modelo ainda não aprovado.'; end if;
   if c.opted_out or not exists(select 1 from public.whatsapp_consents where studio_id=p_studio and phone=c.phone and revoked_at is null) then raise exception 'Sem autorização para contato proativo.'; end if;
   txt:='Podemos continuar seu atendimento? Responda a esta mensagem para falar com nossa equipe.';
  elsif c.last_inbound_at is null or c.last_inbound_at<=now()-interval '24 hours' then raise exception 'Janela encerrada. Aguarde a cliente ou use um modelo aprovado.'; end if;
  update public.whatsapp_conversations set mode='human',requested_at=coalesce(requested_at,now()),closed_at=null where id=c.id;
  mid:=encaixa_private.whatsapp_queue(p_studio,c.id,'manual','manual:'||(p_data->>'request_id')::uuid,txt,null,null,now(),
    case when tk is null then c.last_inbound_at+interval '24 hours' else now()+interval '24 hours' end,tk);
  return jsonb_build_object('queued',true,'id',mid);
 end if;
 raise exception 'Ação inválida.';
end $$;

-- One atomic claim per message; network uncertainty NEVER permits automatic re-send.
create function public.whatsapp_claim(p_mode text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.whatsapp_messages; c public.whatsapp_conversations; cfg public.whatsapp_settings;
 a public.appointments; s public.studios; consent public.whatsapp_consents; rev bigint; use_template boolean; params jsonb; txt text; lease uuid; reason text; candidate record;
begin
 update public.whatsapp_messages set status='uncertain',error_code='lease_expired',updated_at=now()
 where status='sending' and lease_until<now();
 for candidate in select q.id from public.whatsapp_messages q
   join public.whatsapp_settings sc on sc.studio_id=q.studio_id and sc.enabled and sc.mode=p_mode and sc.phone_number_id is not null
   join public.whatsapp_conversations cv on cv.id=q.conversation_id and (cv.mode='bot' or q.kind in('manual','handoff'))
   where q.status='pending' and q.available_at<=now() and q.mode=p_mode
   order by q.available_at,q.id limit 100 loop
  -- Lock only the candidate, not a prefetched cursor page, so workers share the queue.
  select * into m from public.whatsapp_messages where id=candidate.id and status='pending' for update skip locked;
  if not found then continue; end if;
  select * into cfg from public.whatsapp_settings where studio_id=m.studio_id;
  if not cfg.enabled or cfg.mode<>p_mode or cfg.phone_number_id is null then continue; end if;
  select * into c from public.whatsapp_conversations where id=m.conversation_id;
  if m.expires_at<=now() then
   update public.whatsapp_messages set status='cancelled',error_code='expired',updated_at=now() where id=m.id; continue;
  end if;
  if c.mode='human' and m.kind not in('manual','handoff') then continue; end if;
  if c.opted_out and m.kind<>'manual' then
   update public.whatsapp_messages set status='cancelled',error_code='opt_out' where id=m.id; continue;
  end if;
  select * into s from public.studios where id=m.studio_id;
  txt:=m.body; params:='[]'; reason:=null;
  if m.appointment_id is not null then
   select * into a from public.appointments where id=m.appointment_id;
   select revision into rev from encaixa_private.whatsapp_revisions where appointment_id=a.id;
   select * into consent from public.whatsapp_consents where appointment_id=a.id and revoked_at is null;
   if rev<>m.revision or (m.kind<>'cancellation' and a.status<>'confirmed') or (m.kind='cancellation' and a.status<>'cancelled') then reason:='appointment_changed';
   elsif consent.appointment_id is null or consent.phone<>c.phone or consent.client_id<>a.client_id or consent.phone is distinct from
    (select encaixa_private.whatsapp_phone(phone) from public.clients where id=a.client_id) then reason:='consent_missing'; end if;
   params:=jsonb_build_array(s.name,to_char(a.starts_at at time zone cfg.timezone,'DD/MM/YYYY'),to_char(a.starts_at at time zone cfg.timezone,'HH24:MI'),
     a.service_name,(select name from public.professionals where id=a.professional_id),'/#/manage/'||a.manage_token);
   txt:=case m.kind when 'reminder' then 'Lembrete' when 'reschedule' then 'Agendamento atualizado' when 'cancellation' then 'Agendamento cancelado' else 'Agendamento confirmado' end
    ||' em '||s.name||': '||(params->>1)||' às '||(params->>2)||' ('||cfg.timezone||'). Serviço: '||a.service_name||'. Profissional: '||(params->>4)||'. Consultar ou gerenciar: '||(params->>5)||'. Para parar notificações, envie SAIR.';
  elsif m.kind='greeting' then txt:='Olá! Você está falando com '||s.name||'. Como podemos ajudar?'||chr(10)||'1 — Agendar'||chr(10)||'2 — Falar com atendente';
  elsif m.kind='booking_link' then txt:='Agende em '||s.name||': /#/booking/'||s.slug; end if;
  if reason is not null then update public.whatsapp_messages set status='cancelled',error_code=reason where id=m.id; continue; end if;
  use_template:=c.last_inbound_at is null or c.last_inbound_at<=now()-interval '24 hours' or (m.kind='manual' and m.template_key is not null);
  if m.kind='manual' and use_template and (c.opted_out or not exists(
    select 1 from public.whatsapp_consents where studio_id=m.studio_id and phone=c.phone and revoked_at is null)) then
   update public.whatsapp_messages set status='cancelled',error_code='consent_missing' where id=m.id; continue;
  end if;
  if use_template and (m.template_key is null or coalesce(cfg.templates->m.template_key->>'approved','false')<>'true') then
   -- Simulation exercises template selection, but remains explicitly simulated.
   if p_mode='live' or m.template_key is null then
    update public.whatsapp_messages set status='failed',error_code='template_required',updated_at=now() where id=m.id; continue;
   end if;
  end if;
  if m.attempts>=4 then update public.whatsapp_messages set status='failed',error_code='attempts_exhausted',updated_at=now() where id=m.id; continue; end if;
  lease:=gen_random_uuid();
  update public.whatsapp_messages set status='sending',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '2 minutes',body=txt,updated_at=now() where id=m.id;
  return jsonb_build_object('id',m.id,'studio_id',m.studio_id,'lease_id',lease,'mode',p_mode,'phone',c.phone,'channel',cfg.phone_number_id,
    'body',txt,'kind',m.kind,'use_template',use_template,'template_key',m.template_key,'template',cfg.templates->m.template_key,'parameters',params);
 end loop;
 return null;
end $$;

create function public.whatsapp_finish(p_id uuid,p_lease uuid,p_result text,p_provider text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.whatsapp_messages;
begin
 select * into m from public.whatsapp_messages where id=p_id for update;
 if m.lease_id is distinct from p_lease or m.status not in('sending','uncertain') then return false; end if;
 if p_result not in('simulated','accepted','retry','failed','uncertain') or (p_result='simulated' and m.mode<>'simulation') then raise exception 'Resultado inválido.'; end if;
 update public.whatsapp_messages set status=case when p_result='retry' then case when attempts<4 then 'pending' else 'failed' end else p_result end,
  available_at=case when p_result='retry' then now()+make_interval(secs=>30*power(2,attempts-1)::int) else available_at end,
  provider_id=p_provider,error_code=p_error,lease_until=null,updated_at=now() where id=p_id;
 -- Receipts can arrive before the HTTP response; reconcile from the persistent inbox.
 if p_result='accepted' then
  update public.whatsapp_messages set status=coalesce((select r.status from encaixa_private.whatsapp_receipts r where r.studio_id=m.studio_id and r.provider_id=p_provider
   order by case r.status when 'read' then 4 when 'delivered' then 3 when 'failed' then 2 when 'sent' then 1 else 0 end desc limit 1),'accepted') where id=p_id;
 end if;
 return true;
end $$;

create function public.whatsapp_receipt(p_channel text,p_provider text,p_status text,p_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare sid uuid; m public.whatsapp_messages;
begin
 select studio_id into sid from public.whatsapp_settings where phone_number_id=p_channel and mode='live';
 if sid is null or p_status not in('sent','delivered','read','failed') or p_at is null then return false; end if;
 insert into encaixa_private.whatsapp_receipts values(sid,p_provider,p_status,p_at) on conflict do nothing;
 select * into m from public.whatsapp_messages where studio_id=sid and provider_id=p_provider and direction='out' and mode='live' for update;
 if m.id is not null then
  update public.whatsapp_messages set status=(select r.status from encaixa_private.whatsapp_receipts r where r.studio_id=sid and r.provider_id=p_provider
   order by case r.status when 'read' then 4 when 'delivered' then 3 when 'failed' then 2 when 'sent' then 1 else 0 end desc limit 1),updated_at=now() where id=m.id;
 end if;
 return true;
end $$;

revoke all on function public.book_appointment_whatsapp(text,uuid[],timestamptz,text,text,text,text,uuid,boolean,uuid),
 public.whatsapp_inbound(text,text,text,text,timestamptz,text),public.whatsapp_claim(text),public.whatsapp_finish(uuid,uuid,text,text,text),public.whatsapp_receipt(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.book_appointment_whatsapp(text,uuid[],timestamptz,text,text,text,text,uuid,boolean,uuid),
 public.whatsapp_inbound(text,text,text,text,timestamptz,text),public.whatsapp_claim(text),public.whatsapp_finish(uuid,uuid,text,text,text),public.whatsapp_receipt(text,text,text,timestamptz) to service_role;
revoke all on function public.whatsapp_owner(text,uuid,jsonb) from public,anon;
grant execute on function public.whatsapp_owner(text,uuid,jsonb) to authenticated;
revoke all on function encaixa_private.whatsapp_canonical(text),encaixa_private.whatsapp_phone(text),encaixa_private.whatsapp_queue(uuid,uuid,text,text,text,uuid,bigint,timestamptz,timestamptz,text),
 encaixa_private.whatsapp_schedule(uuid,text),encaixa_private.whatsapp_appointment_changed() from public,anon,authenticated;
revoke all on encaixa_private.whatsapp_requests,encaixa_private.whatsapp_revisions,encaixa_private.whatsapp_receipts from public,anon,authenticated;
commit;
