create or replace function public.manage_booking(p_token uuid,p_action text default 'get',p_start timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.appointments; s public.studios;
begin
 select * into s from public.studios where id=(select studio_id from public.appointments where manage_token=p_token) for update;
 select * into a from public.appointments where manage_token=p_token for update;
 if a.id is null then raise exception 'Reserva não encontrada. Confira seu link.'; end if;
 if p_action is null or p_action not in ('get','cancel','reschedule') then raise exception 'Ação inválida.'; end if;
 if p_action<>'get' then
  if a.status<>'confirmed' or a.starts_at<now()+interval '2 hours' then raise exception 'Alterações online são permitidas até 2 horas antes. Entre em contato com o estúdio.'; end if;
  if exists(select 1 from public.payments where appointment_id=a.id) then raise exception 'Esta reserva tem pagamento registrado. Fale com o estúdio para alterar.'; end if;
  if p_action='cancel' then update public.appointments set status='cancelled' where id=a.id returning * into a;
  else
   if p_start is null or not exists(select 1 from public.available_slots_multi(s.slug,a.service_ids,(p_start at time zone 'America/Sao_Paulo')::date,p_token) x where x.starts_at=p_start) then raise exception 'O conjunto de serviços não cabe neste horário. Escolha outro horário.'; end if;
   update public.appointments set starts_at=p_start where id=a.id returning * into a;
  end if;
 end if;
 return jsonb_build_object('id',a.id,'service_id',a.service_id,'service_ids',a.service_ids,'service_items',a.service_items,'service',a.service_name,'starts_at',a.starts_at,'ends_at',a.ends_at,'price',a.price,'status',a.status,'paid',exists(select 1 from public.payments where appointment_id=a.id),'horizon',s.horizon,'studio',s.name,'slug',s.slug,'phone',s.phone,'address',s.address,'name',(select name from public.clients where id=a.client_id));
end $$;
-- Keep shared URLs stable, including writes outside the panel.
create function encaixa_private.preserve_studio_slug() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.slug is distinct from old.slug then
  raise exception 'O link do estúdio é permanente. Altere apenas o nome de exibição.';
 end if;
 return new;
end $$;
revoke all on function encaixa_private.preserve_studio_slug() from public,anon,authenticated;
create trigger preserve_studio_slug before update of slug on public.studios
 for each row execute function encaixa_private.preserve_studio_slug();
