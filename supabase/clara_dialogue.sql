-- One authoritative pending conversation per owner; no model can execute a write.
create table encaixa_private.clara_dialogues (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 revision integer not null default 0,
 state jsonb not null default '{"stage":"idle"}',
 updated_at timestamptz not null default now(),
 last_ticket uuid, last_start timestamptz, last_result jsonb
);
revoke all on encaixa_private.clara_dialogues from public,anon,authenticated;

create function public.clara_dialogue_get() returns jsonb
language plpgsql security definer set search_path='' as $$
declare d encaixa_private.clara_dialogues;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
 insert into encaixa_private.clara_dialogues(owner_id) values(auth.uid()) on conflict do nothing;
 select * into d from encaixa_private.clara_dialogues where owner_id=auth.uid();
 return jsonb_build_object('revision',d.revision,'state',d.state);
end $$;

create function public.clara_dialogue_save(p_revision integer,p_state jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d encaixa_private.clara_dialogues; q encaixa_private.clara_reschedules;
begin
 select * into d from encaixa_private.clara_dialogues where owner_id=auth.uid() for update;
 if not found or d.revision is distinct from p_revision then raise exception 'A conversa mudou em outra janela. Atualize o chat antes de continuar.'; end if;
 if p_state is null or jsonb_typeof(p_state)<>'object' or length(p_state::text)>30000
 or coalesce(p_state->>'stage','') not in ('idle','identified','date','offer','confirm','cancel_question') then raise exception 'Estado de conversa inválido.'; end if;
 if p_state->>'appointmentId' is not null and not exists(select 1 from public.appointments a join public.studios s on s.id=a.studio_id where a.id=(p_state->>'appointmentId')::uuid and s.owner_id=auth.uid()) then raise exception 'Atendimento não encontrado no seu espaço.'; end if;
 if p_state->>'ticket' is not null then
  select * into q from encaixa_private.clara_reschedules where id=(p_state->>'ticket')::uuid and owner_id=auth.uid() and appointment_id=(p_state->>'appointmentId')::uuid;
  if not found or q.completed_at is not null then raise exception 'Consulte os horários novamente.'; end if;
  if p_state->>'pendingStart' is not null and not((p_state->>'pendingStart')::timestamptz=any(q.slots)) then raise exception 'Escolha um horário disponível.'; end if;
 end if;
 -- Superseded suggestions cannot be reused, including from another browser tab.
 if d.state->>'ticket' is not null and (d.state->>'ticket') is distinct from (p_state->>'ticket') then
  update encaixa_private.clara_reschedules set expires_at=least(expires_at,now()) where id=(d.state->>'ticket')::uuid and owner_id=auth.uid() and completed_at is null;
 end if;
 update encaixa_private.clara_dialogues set state=p_state,revision=revision+1,updated_at=now() where owner_id=auth.uid() returning * into d;
 return jsonb_build_object('revision',d.revision,'state',d.state);
end $$;

create function public.clara_dialogue_commit(p_revision integer,p_ticket uuid,p_start timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d encaixa_private.clara_dialogues; result jsonb;
begin
 select * into d from encaixa_private.clara_dialogues where owner_id=auth.uid() for update;
 if not found then raise exception 'Abra a conversa novamente.'; end if;
 -- A lost response can be retried, but never replays after a subsequent conversation turn.
 if d.revision=p_revision+1 and d.last_ticket=p_ticket and d.last_start=p_start and d.state->>'stage'='identified' then
  result:=public.clara_reschedule_confirm(p_ticket,p_start);
  return jsonb_build_object('revision',d.revision,'state',d.state,'result',result);
 end if;
 if d.revision is distinct from p_revision or d.state->>'stage'<>'confirm'
 or (d.state->>'ticket')::uuid is distinct from p_ticket or (d.state->>'pendingStart')::timestamptz is distinct from p_start then
  raise exception 'Essa confirmação não está mais ativa. Confira a proposta atual no chat.';
 end if;
 result:=public.clara_reschedule_confirm(p_ticket,p_start);
 update encaixa_private.clara_dialogues set revision=revision+1,
 state=jsonb_build_object('stage','identified','appointmentId',result->>'appointmentId','receipt',result),
 last_ticket=p_ticket,last_start=p_start,last_result=null,updated_at=now() where owner_id=auth.uid() returning * into d;
 return jsonb_build_object('revision',d.revision,'state',d.state,'result',result);
end $$;
revoke all on function public.clara_dialogue_get(),public.clara_dialogue_save(integer,jsonb),public.clara_dialogue_commit(integer,uuid,timestamptz) from public,anon;
grant execute on function public.clara_dialogue_get(),public.clara_dialogue_save(integer,jsonb),public.clara_dialogue_commit(integer,uuid,timestamptz) to authenticated;
-- Saving now requires the active, versioned confirmation above.
revoke execute on function public.clara_reschedule_confirm(uuid,timestamptz) from authenticated;
