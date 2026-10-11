-- Owner-only, expiring proposals. No API key or customer contact is stored here.
create table encaixa_private.clara_reschedules (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 appointment_id uuid not null references public.appointments(id) on delete cascade,
 snapshot jsonb not null, slots timestamptz[] not null,
 expires_at timestamptz not null default now()+interval '15 minutes',
 chosen_start timestamptz, completed_at timestamptz
);
revoke all on encaixa_private.clara_reschedules from public,anon,authenticated;
create index clara_reschedules_owner on encaixa_private.clara_reschedules(owner_id);

create function encaixa_private.clara_snapshot(a public.appointments) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('start',a.starts_at,'end',a.ends_at,'occupied',a.occupied::text,
 'professional',a.professional_id,'client',a.client_id,'services',a.service_items,'price',a.price,'status',a.status);
$$;
revoke all on function encaixa_private.clara_snapshot(public.appointments) from public,anon,authenticated;

create function public.clara_reschedule_options(p_appointment uuid,p_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.appointments; s public.studios; options timestamptz[]; ticket uuid; expires timestamptz;
begin
 select st.* into s from public.studios st join public.appointments ap on ap.studio_id=st.id
 where ap.id=p_appointment and st.owner_id=auth.uid() for update of st;
 if s.id is null then raise exception 'Atendimento não encontrado no seu espaço.'; end if;
 select * into a from public.appointments where id=p_appointment for update;
 if a.status<>'confirmed' or a.starts_at<=now() then raise exception 'Escolha um atendimento futuro e confirmado.'; end if;
 if exists(select 1 from public.payments where appointment_id=a.id) then raise exception 'Este atendimento já tem pagamento. Consulte os detalhes na agenda.'; end if;
 if p_date is null or p_date<(now() at time zone 'America/Sao_Paulo')::date or p_date>(now() at time zone 'America/Sao_Paulo')::date+s.horizon then
  raise exception 'Escolha uma data dentro do período de reservas do seu espaço.';
 end if;
 select coalesce(array_agg(x.starts_at order by x.starts_at),'{}'::timestamptz[]) into options
 from encaixa_private.team_slots(s.id,a.professional_id,(extract(epoch from (a.ends_at-a.starts_at))/60)::int,
 (extract(epoch from (upper(a.occupied)-a.ends_at))/60)::int,p_date,a.id) x where x.starts_at<>a.starts_at;
 delete from encaixa_private.clara_reschedules where owner_id=auth.uid() and expires_at<now()-interval '1 day';
 if cardinality(options)>0 then
  insert into encaixa_private.clara_reschedules(owner_id,appointment_id,snapshot,slots)
  values(auth.uid(),a.id,encaixa_private.clara_snapshot(a),options) returning id,expires_at into ticket,expires;
 end if;
 return jsonb_build_object('ticket',ticket,'appointmentId',a.id,'oldStart',a.starts_at,'date',p_date,'expiresAt',expires,
 'client',(select name from public.clients where id=a.client_id),'service',a.service_name,
 'professional',(select name from public.professionals where id=a.professional_id),'slots',to_jsonb(options));
end $$;
revoke all on function public.clara_reschedule_options(uuid,date) from public,anon;
grant execute on function public.clara_reschedule_options(uuid,date) to authenticated;

create function public.clara_reschedule_confirm(p_ticket uuid,p_start timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q encaixa_private.clara_reschedules; a public.appointments; s public.studios;
begin
 select st.* into s from public.studios st join public.appointments ap on ap.studio_id=st.id
 join encaixa_private.clara_reschedules r on r.appointment_id=ap.id
 where r.id=p_ticket and r.owner_id=auth.uid() and st.owner_id=auth.uid() for update of st;
 if s.id is null then raise exception 'Esta seleção não está disponível. Consulte os horários novamente.'; end if;
 select * into q from encaixa_private.clara_reschedules where id=p_ticket and owner_id=auth.uid() for update;
 select * into a from public.appointments where id=q.appointment_id for update;
 if p_start is null or not(p_start=any(q.slots)) then raise exception 'Escolha um dos horários oferecidos pela Clara.'; end if;
 if q.completed_at is not null then
  if q.chosen_start<>p_start or a.starts_at<>p_start or a.status<>'confirmed' then raise exception 'Este atendimento foi alterado. Consulte a agenda novamente.'; end if;
 else
  if q.expires_at<=now() then raise exception 'Os horários expiraram. Consulte novamente antes de remarcar.'; end if;
  if encaixa_private.clara_snapshot(a)<>q.snapshot then raise exception 'Este atendimento foi alterado. Consulte a agenda novamente.'; end if;
  if a.status<>'confirmed' or a.starts_at<=now() then raise exception 'Escolha um atendimento futuro e confirmado.'; end if;
  if exists(select 1 from public.payments where appointment_id=a.id) then raise exception 'Este atendimento já tem pagamento. Consulte os detalhes na agenda.'; end if;
  if not exists(select 1 from encaixa_private.team_slots(s.id,a.professional_id,
   (extract(epoch from (a.ends_at-a.starts_at))/60)::int,(extract(epoch from (upper(a.occupied)-a.ends_at))/60)::int,
   (p_start at time zone 'America/Sao_Paulo')::date,a.id) x where x.starts_at=p_start) then
   raise exception 'Esse horário não está mais disponível. Peça novos horários à Clara.';
  end if;
  update public.appointments set starts_at=p_start where id=a.id returning * into a;
  update encaixa_private.clara_reschedules set chosen_start=p_start,completed_at=now() where id=q.id;
 end if;
 return jsonb_build_object('appointmentId',a.id,'oldStart',q.snapshot->>'start','startsAt',a.starts_at,
 'client',(select name from public.clients where id=a.client_id),'phone',(select phone from public.clients where id=a.client_id),
 'service',a.service_name,'professional',(select name from public.professionals where id=a.professional_id),'studio',s.name);
end $$;
revoke all on function public.clara_reschedule_confirm(uuid,timestamptz) from public,anon;
grant execute on function public.clara_reschedule_confirm(uuid,timestamptz) to authenticated;
