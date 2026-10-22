-- Additive, LOCAL migration. Apply after whatsapp.sql and whatsapp_operations.sql.
-- WAHA as a second live provider, attendance status on the existing conversation and the
-- 08:00–20:00 (São Paulo) window for active messages. No network calls, no historical opt-in.
begin;

-- WAHA channels are 'waha:<session>', so they never collide with a Meta phone_number_id.
-- The provider follows the channel: one source of truth, also after a Meta connection is saved.
alter table public.whatsapp_settings
 add column provider text generated always as (case when phone_number_id like 'waha:%' then 'waha' else 'meta' end) stored,
 add constraint whatsapp_settings_waha_session check(phone_number_id not like 'waha:%' or phone_number_id ~ '^waha:[A-Za-z0-9_-]{1,64}$');

-- wa_lid: the client's hidden WhatsApp id, learned from her own messages, so a reply typed on the
-- studio's phone to a @lid chat finds her conversation. human_until: end of a takeover from that phone.
alter table public.whatsapp_conversations
 add column status text not null default 'TRIAGEM' check(status in('TRIAGEM','AGUARDANDO_ASSUNTO','FILA_HUMANO','FINALIZADO')),
 add column resumo_duvida text check(length(resumo_duvida)<=500),
 add column wa_lid text check(wa_lid ~ '^[0-9]{6,20}$'),
 add column human_until timestamptz;
create unique index whatsapp_conversations_lid on public.whatsapp_conversations(studio_id,wa_lid) where wa_lid is not null;
-- Expand a validation constraint only: the SAIR acknowledgement and replies typed on the studio's phone.
alter table public.whatsapp_messages drop constraint whatsapp_messages_kind_check;
alter table public.whatsapp_messages add constraint whatsapp_messages_kind_check check(kind in('inbound','greeting','booking_link','confirmation','reschedule','cancellation','reminder','manual','handoff','opt_out_ack','team_phone'));
update public.whatsapp_conversations set status=case when mode='human' then 'FILA_HUMANO' when closed_at is not null then 'FINALIZADO' else 'TRIAGEM' end;
-- The bot is paused exactly while the client waits for, or talks to, a person.
alter table public.whatsapp_conversations add constraint whatsapp_conversations_status_mode
 check((mode='human')=(status in('AGUARDANDO_ASSUNTO','FILA_HUMANO')));

-- Older functions write only mode; newer ones write only status. Keep both in step.
create function encaixa_private.whatsapp_conversation_status() returns trigger language plpgsql set search_path='' as $$
begin
 if (tg_op='INSERT' and new.status<>'TRIAGEM') or (tg_op='UPDATE' and new.status is distinct from old.status) then
  new.mode:=case when new.status in('AGUARDANDO_ASSUNTO','FILA_HUMANO') then 'human' else 'bot' end;
 elsif new.mode='human' and new.status not in('AGUARDANDO_ASSUNTO','FILA_HUMANO') then new.status:='FILA_HUMANO';
 elsif new.mode='bot' and new.status in('AGUARDANDO_ASSUNTO','FILA_HUMANO') then
  new.status:=case when new.closed_at is not null then 'FINALIZADO' else 'TRIAGEM' end;
 end if;
 if new.status not in('AGUARDANDO_ASSUNTO','FILA_HUMANO') then new.human_until:=null; end if;
 return new;
end $$;
create trigger whatsapp_conversation_status before insert or update on public.whatsapp_conversations
 for each row execute function encaixa_private.whatsapp_conversation_status();

-- Active messages leave only from 08:00 to 19:59 in São Paulo. Mirrors functions/whatsapp/hours.js.
create function encaixa_private.whatsapp_in_hours(p_at timestamptz) returns boolean language sql stable set search_path='' as $$
 select (p_at at time zone 'America/Sao_Paulo')::time>=time '08:00' and (p_at at time zone 'America/Sao_Paulo')::time<time '20:00';
$$;
-- First allowed moment at or after p_at.
create function encaixa_private.whatsapp_next_open(p_at timestamptz) returns timestamptz language sql stable set search_path='' as $$
 select case when encaixa_private.whatsapp_in_hours(p_at) then p_at
  else ((l::date+case when l::time>=time '20:00' then 1 else 0 end)+time '08:00') at time zone 'America/Sao_Paulo' end
 from (select p_at at time zone 'America/Sao_Paulo' l) x;
$$;
-- Last allowed moment at or before p_at; 19:30 leaves room for retries before the window closes.
create function encaixa_private.whatsapp_last_open(p_at timestamptz) returns timestamptz language sql stable set search_path='' as $$
 select case when encaixa_private.whatsapp_in_hours(p_at) then p_at
  else ((l::date-case when l::time<time '08:00' then 1 else 0 end)+time '19:30') at time zone 'America/Sao_Paulo' end
 from (select p_at at time zone 'America/Sao_Paulo' l) x;
$$;
-- Replies to a client who just wrote are receptive; everything else the studio starts is active.
create function encaixa_private.whatsapp_active(p_kind text,p_template text) returns boolean language sql immutable set search_path='' as $$
 select p_kind in('confirmation','reschedule','cancellation','reminder') or (p_kind='manual' and p_template is not null);
$$;

-- Reminders move earlier, never later: a later reminder could arrive after the visit.
-- When the earlier time has already passed, the reminder is not sent.
create function encaixa_private.whatsapp_reminder_hours() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind<>'reminder' or new.status<>'pending'
  or (tg_op='UPDATE' and (old.status<>'pending' or new.available_at is not distinct from old.available_at)) then return new; end if;
 new.available_at:=encaixa_private.whatsapp_last_open(new.available_at);
 if new.available_at<now() then new.status:='cancelled'; new.error_code:='outside_hours'; end if;
 return new;
end $$;
create trigger whatsapp_reminder_hours before insert or update on public.whatsapp_messages
 for each row execute function encaixa_private.whatsapp_reminder_hours();

-- Same contract as whatsapp.sql, plus the attendance status and the subject of the handoff.
create or replace function public.whatsapp_inbound(p_channel text,p_id text,p_phone text,p_body text,p_at timestamptz,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.whatsapp_settings; c public.whatsapp_conversations; mid uuid; text_key text; was_new boolean; event_at timestamptz; subject text;
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
  -- One acknowledgement per conversation, only when SAIR actually switched the notices off.
  if not c.opted_out then
   perform encaixa_private.whatsapp_queue(cfg.studio_id,c.id,'opt_out_ack','optout:'||c.id,'',null,null,now(),event_at+interval '24 hours');
  end if;
  return jsonb_build_object('opted_out',true);
 end if;
 -- Delayed/replayed old messages must not reopen a window or resume a bot.
 if event_at<now()-interval '24 hours' or event_at<coalesce(c.last_inbound_at,event_at) then return jsonb_build_object('recorded',true); end if;
 -- A takeover from the studio's phone ends by itself after 12 h without the team writing.
 if c.mode='human' and c.human_until<=event_at then
  update public.whatsapp_conversations set status='FINALIZADO',closed_at=now(),requested_at=null,greeted_at=now() where id=c.id;
  update public.whatsapp_messages set status='cancelled',error_code='human_closed' where conversation_id=c.id and status='pending' and kind in('greeting','booking_link','handoff');
  select * into c from public.whatsapp_conversations where id=c.id;
 end if;
 if text_key in('2','atendente','falar com atendente','humano') then
  if c.mode<>'human' then
   perform encaixa_private.whatsapp_queue(cfg.studio_id,c.id,'handoff','handoff:'||p_id,
    'Certo! Solicitei atendimento à equipe. Para agilizar, conte em uma mensagem qual é o assunto. As respostas automáticas ficam pausadas enquanto você aguarda.',
    null,null,now(),event_at+interval '24 hours');
   update public.whatsapp_conversations set status='AGUARDANDO_ASSUNTO',resumo_duvida=null,requested_at=coalesce(requested_at,now()),closed_at=null where id=c.id;
  else
   -- The client asked for a person: the attendance now lasts until the team closes it.
   update public.whatsapp_conversations set requested_at=coalesce(requested_at,now()),closed_at=null,human_until=null where id=c.id;
  end if;
  return jsonb_build_object('human',true);
 end if;
 if c.mode='human' and not c.opted_out then
  -- The first words after the handoff tell the team what the client needs. No AI involved.
  subject:=nullif(left(trim(p_body),500),'');
  if subject='[Mensagem não textual]' then subject:=null; end if;
  update public.whatsapp_conversations set resumo_duvida=coalesce(resumo_duvida,subject),
   status=case when status='AGUARDANDO_ASSUNTO' then 'FILA_HUMANO' else status end where id=c.id;
 end if;
 if c.mode='human' or c.opted_out then return jsonb_build_object('paused',true); end if;
 update public.whatsapp_conversations set status='TRIAGEM' where id=c.id and status='FINALIZADO';
 if text_key in('1','agendar') then
  perform encaixa_private.whatsapp_queue(cfg.studio_id,c.id,'booking_link','reply:'||p_id,'',null,null,now(),event_at+interval '24 hours');
  update public.whatsapp_conversations set greeted_at=now() where id=c.id;
 elsif was_new or text_key='menu' then
  perform encaixa_private.whatsapp_queue(cfg.studio_id,c.id,'greeting','reply:'||p_id,'',null,null,now(),event_at+interval '24 hours');
  update public.whatsapp_conversations set greeted_at=now() where id=c.id;
 end if;
 return jsonb_build_object('recorded',true);
end $$;

-- Claim with an explicit clock. Only public.whatsapp_claim (real time) is exposed to the worker;
-- tests call this one directly to check the window at any hour.
create function encaixa_private.whatsapp_claim_at(p_mode text,p_now timestamptz) returns jsonb language plpgsql set search_path='' as $$
declare m public.whatsapp_messages; c public.whatsapp_conversations; cfg public.whatsapp_settings;
 a public.appointments; s public.studios; consent public.whatsapp_consents; rev bigint; use_template boolean; params jsonb; txt text; lease uuid; reason text; candidate record; opens timestamptz;
begin
 update public.whatsapp_messages set status='uncertain',error_code='lease_expired',updated_at=now()
 where status='sending' and lease_until<now();
 for candidate in select q.id from public.whatsapp_messages q
   join public.whatsapp_settings sc on sc.studio_id=q.studio_id and sc.enabled and sc.mode=p_mode and sc.phone_number_id is not null
   join public.whatsapp_conversations cv on cv.id=q.conversation_id and (cv.mode='bot' or q.kind not in('greeting','booking_link'))
   where q.status='pending' and q.available_at<=p_now and q.mode=p_mode
   -- Held until 08:00 together, the confirmation still goes before its reminder.
   order by q.available_at,q.kind='reminder',q.id limit 100 loop
  -- Lock only the candidate, not a prefetched cursor page, so workers share the queue.
  select * into m from public.whatsapp_messages where id=candidate.id and status='pending' for update skip locked;
  if not found then continue; end if;
  select * into cfg from public.whatsapp_settings where studio_id=m.studio_id;
  if not cfg.enabled or cfg.mode<>p_mode or cfg.phone_number_id is null then continue; end if;
  select * into c from public.whatsapp_conversations where id=m.conversation_id;
  if m.expires_at<=p_now then
   update public.whatsapp_messages set status='cancelled',error_code='expired',updated_at=now() where id=m.id; continue;
  end if;
  -- During a human attendance only the chatbot waits; booking notices still reach the client.
  if c.mode='human' and m.kind in('greeting','booking_link') then continue; end if;
  if c.opted_out and m.kind not in('manual','opt_out_ack') then
   update public.whatsapp_messages set status='cancelled',error_code='opt_out' where id=m.id; continue;
  end if;
  -- Real channels never start a conversation outside 08:00–20:00: wait for the next opening,
  -- or drop the message when that would be too late to matter.
  if p_mode='live' and encaixa_private.whatsapp_active(m.kind,m.template_key) and not encaixa_private.whatsapp_in_hours(p_now) then
   opens:=encaixa_private.whatsapp_next_open(p_now);
   if opens>=coalesce(m.expires_at,'infinity') then
    update public.whatsapp_messages set status='cancelled',error_code='outside_hours',updated_at=now() where id=m.id;
   else
    update public.whatsapp_messages set available_at=opens,updated_at=now() where id=m.id;
   end if;
   continue;
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
    ||' em '||s.name||': '||(params->>1)||' às '||(params->>2)||' (horário de Brasília). Serviço: '||a.service_name||'. Profissional: '||(params->>4)||'. Consultar ou gerenciar: '||(params->>5)||'. Para parar notificações, envie SAIR.';
  elsif m.kind='greeting' then txt:='Olá! Você está falando com '||s.name||'. Como podemos ajudar?'||chr(10)||'1 — Agendar'||chr(10)||'2 — Falar com atendente';
  elsif m.kind='booking_link' then txt:='Agende em '||s.name||': /#/booking/'||s.slug;
  elsif m.kind='opt_out_ack' then txt:='Pronto! Você não vai mais receber avisos automáticos de '||s.name||' por aqui. Se precisar, é só escrever.'; end if;
  if reason is not null then update public.whatsapp_messages set status='cancelled',error_code=reason where id=m.id; continue; end if;
  use_template:=c.last_inbound_at is null or c.last_inbound_at<=p_now-interval '24 hours' or (m.kind='manual' and m.template_key is not null);
  if m.kind='manual' and use_template and (c.opted_out or not exists(
    select 1 from public.whatsapp_consents where studio_id=m.studio_id and phone=c.phone and revoked_at is null)) then
   update public.whatsapp_messages set status='cancelled',error_code='consent_missing' where id=m.id; continue;
  end if;
  -- WAHA has no approved templates; consent and the window above are its only proactive gates.
  if cfg.provider='waha' then use_template:=false; end if;
  if use_template and (m.template_key is null or coalesce(cfg.templates->m.template_key->>'approved','false')<>'true') then
   -- Simulation exercises template selection, but remains explicitly simulated.
   if p_mode='live' or m.template_key is null then
    update public.whatsapp_messages set status='failed',error_code='template_required',updated_at=now() where id=m.id; continue;
   end if;
  end if;
  if m.attempts>=4 then update public.whatsapp_messages set status='failed',error_code='attempts_exhausted',updated_at=now() where id=m.id; continue; end if;
  lease:=gen_random_uuid();
  update public.whatsapp_messages set status='sending',attempts=attempts+1,lease_id=lease,lease_until=now()+interval '2 minutes',body=txt,updated_at=now() where id=m.id;
  return jsonb_build_object('id',m.id,'studio_id',m.studio_id,'lease_id',lease,'mode',p_mode,'provider',cfg.provider,'phone',c.phone,'channel',cfg.phone_number_id,
    'body',txt,'kind',m.kind,'use_template',use_template,'template_key',m.template_key,'template',cfg.templates->m.template_key,'parameters',params);
 end loop;
 return null;
end $$;

-- One atomic claim per message; network uncertainty NEVER permits automatic re-send.
create or replace function public.whatsapp_claim(p_mode text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return encaixa_private.whatsapp_claim_at(p_mode,now());
end $$;

-- 'deferred': the worker's own clock found the window closed; the message goes back untouched.
create or replace function public.whatsapp_finish(p_id uuid,p_lease uuid,p_result text,p_provider text default null,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare m public.whatsapp_messages; opens timestamptz;
begin
 select * into m from public.whatsapp_messages where id=p_id for update;
 if m.lease_id is distinct from p_lease or m.status not in('sending','uncertain') then return false; end if;
 if p_result not in('simulated','accepted','retry','failed','uncertain','deferred') or (p_result='simulated' and m.mode<>'simulation') then raise exception 'Resultado inválido.'; end if;
 if p_result='deferred' then
  opens:=encaixa_private.whatsapp_next_open(now());
  update public.whatsapp_messages set status=case when opens>=coalesce(expires_at,'infinity') then 'cancelled' else 'pending' end,
   error_code=case when opens>=coalesce(expires_at,'infinity') then 'outside_hours' else null end,
   attempts=greatest(attempts-1,0),available_at=opens,lease_until=null,updated_at=now() where id=p_id;
  return true;
 end if;
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

-- The client's hidden id comes with her own messages; it is never taken from the studio's side.
create function encaixa_private.whatsapp_remember_lid(p_channel text,p_phone text,p_lid text) returns void
language plpgsql set search_path='' as $$
declare sid uuid; client text:=encaixa_private.whatsapp_canonical(p_phone);
begin
 if p_lid !~ '^[0-9]{6,20}$' then return; end if;
 select studio_id into sid from public.whatsapp_settings where phone_number_id=p_channel;
 update public.whatsapp_conversations set wa_lid=null where studio_id=sid and wa_lid=p_lid and phone<>client;
 update public.whatsapp_conversations set wa_lid=p_lid where studio_id=sid and phone=client and wa_lid is distinct from p_lid;
end $$;

-- A message sent from the studio's own number (WAHA message.any, fromMe). Clara's own sends come
-- back here too and are ignored; anything else was typed by the team on the phone.
create function public.whatsapp_echo(p_channel text,p_id text,p_phone text,p_lid text,p_body text,p_at timestamptz,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.whatsapp_settings; c public.whatsapp_conversations; mid uuid; event_at timestamptz; plain text; own uuid;
begin
 select * into cfg from public.whatsapp_settings where phone_number_id=p_channel and enabled and mode=p_mode;
 if cfg.studio_id is null then raise exception 'Canal indisponível.'; end if;
 if cfg.provider<>'waha' then return jsonb_build_object('ignored',true); end if;
 if length(p_id) not between 1 and 200 or length(p_body)>4096 or p_at is null or p_at>now()+interval '5 minutes' then raise exception 'Evento inválido.'; end if;
 event_at:=least(p_at,now());
 if exists(select 1 from public.whatsapp_messages where studio_id=cfg.studio_id and provider_id=p_id and direction='out' and kind<>'team_phone') then
  return jsonb_build_object('echo',true);
 end if;
 if p_phone ~ '^[1-9][0-9]{7,14}$' then p_phone:=encaixa_private.whatsapp_canonical(p_phone); else p_phone:=null; end if;
 -- Personal chats never enter: only a conversation the client herself opened with the studio.
 select * into c from public.whatsapp_conversations where studio_id=cfg.studio_id and (phone=p_phone or wa_lid=p_lid)
  order by (phone=p_phone) desc nulls last limit 1 for update;
 if c.id is null then return jsonb_build_object('ignored',true); end if;
 -- The echo can arrive before Clara records the provider id: then it matches one of her recent
 -- texts, compared without the site address the worker adds to links.
 plain:=regexp_replace(p_body,'https?://[^/[:space:]]+(/#/)','\1','g');
 select id into own from public.whatsapp_messages where conversation_id=c.id and direction='out' and kind<>'team_phone'
  and status not in('pending','cancelled','failed') and updated_at>now()-interval '10 minutes' and body=plain
  order by updated_at desc limit 1 for update;
 if own is not null then
  -- An unknown result that WhatsApp now shows as sent stops being uncertain.
  update public.whatsapp_messages set status='accepted',provider_id=p_id,error_code=null,updated_at=now()
  where id=own and status='uncertain' and provider_id is null
   and not exists(select 1 from public.whatsapp_messages where studio_id=cfg.studio_id and provider_id=p_id);
  return jsonb_build_object('echo',true);
 end if;
 insert into public.whatsapp_messages(studio_id,conversation_id,direction,kind,mode,status,body,dedupe_key,provider_id,created_at)
 values(cfg.studio_id,c.id,'out','team_phone',p_mode,'sent',p_body,'phone:'||p_id,p_id,event_at)
 on conflict do nothing returning id into mid;
 if mid is null then return jsonb_build_object('duplicate',true); end if;
 update public.whatsapp_messages set status=coalesce((select r.status from encaixa_private.whatsapp_receipts r where r.studio_id=cfg.studio_id and r.provider_id=p_id
  order by case r.status when 'read' then 4 when 'delivered' then 3 when 'failed' then 2 when 'sent' then 1 else 0 end desc limit 1),'sent') where id=mid;
 -- A late redelivery stays in the history but does not pause the bot again.
 if event_at<now()-interval '12 hours' then return jsonb_build_object('team',true); end if;
 -- The team took over: the bot stops at once. A takeover the client did not ask for ends 12 h after
 -- the team's last message; one she asked for ("2") lasts until it is closed.
 update public.whatsapp_conversations set status='FILA_HUMANO',closed_at=null,
  human_until=case when mode='bot' or human_until is not null then greatest(human_until,event_at+interval '12 hours') end
 where id=c.id;
 update public.whatsapp_messages set status='cancelled',error_code='human_took_over' where conversation_id=c.id and status='pending' and kind in('greeting','booking_link');
 return jsonb_build_object('team',true);
end $$;

-- Same as whatsapp_operations.sql, plus messages sent from the studio's number ('echoes') and the
-- client's hidden id carried by WAHA messages.
create or replace function public.whatsapp_dispatch(p_mode text) returns jsonb
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
      if msg->>'lid' is not null then perform encaixa_private.whatsapp_remember_lid(channel,msg->>'from',msg->>'lid'); end if;
     end loop;
     for msg in select * from jsonb_array_elements(coalesce(v->'echoes','[]')) loop
      perform public.whatsapp_echo(channel,msg->>'id',msg->>'to',msg->>'lid',coalesce(msg->'text'->>'body','[Mensagem não textual]'),to_timestamp((msg->>'timestamp')::double precision),p_mode);
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

revoke all on function encaixa_private.whatsapp_conversation_status(),encaixa_private.whatsapp_reminder_hours(),
 encaixa_private.whatsapp_in_hours(timestamptz),encaixa_private.whatsapp_next_open(timestamptz),encaixa_private.whatsapp_last_open(timestamptz),
 encaixa_private.whatsapp_active(text,text),encaixa_private.whatsapp_claim_at(text,timestamptz),
 encaixa_private.whatsapp_remember_lid(text,text,text),public.whatsapp_echo(text,text,text,text,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.whatsapp_echo(text,text,text,text,text,timestamptz,text) to service_role;
commit;
