-- Clara: authenticated, read-only business queries and persistent daily quota.
create table encaixa_private.clara_usage (
 user_id uuid primary key references auth.users(id) on delete cascade,
 day date not null, requests integer not null
);
create or replace function public.clara_take_quota() returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer; u uuid := auth.uid(); d date := (now() at time zone 'America/Sao_Paulo')::date;
begin
 if u is null then return false; end if;
 insert into encaixa_private.clara_usage as q values(u,d,1)
 on conflict(user_id) do update set day=d, requests=case when q.day=d then q.requests+1 else 1 end
 returning requests into n;
 return n <= 30;
end $$;
revoke all on function public.clara_take_quota() from public,anon;
grant execute on function public.clara_take_quota() to authenticated;

create or replace function public.clara_read(p_kind text,p_from date,p_to date) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare s uuid; result jsonb; a timestamptz; b timestamptz;
begin
 select id into s from public.studios where owner_id=auth.uid();
 if s is null then raise exception 'Acesso negado'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'Período inválido'; end if;
 a := p_from::timestamp at time zone 'America/Sao_Paulo';
 b := (p_to+1)::timestamp at time zone 'America/Sao_Paulo';
 if p_kind in ('next','agenda') then
   select coalesce(jsonb_agg(t),'[]'::jsonb) into result from (
    select ap.starts_at,ap.service_name,ap.status,c.name as client,pr.name as professional
    from public.appointments ap left join public.clients c on c.id=ap.client_id
    left join public.professionals pr on pr.id=ap.professional_id
    where ap.studio_id=s and ap.status in ('confirmed','completed')
      and ((p_kind='next' and ap.starts_at>=now() and ap.status='confirmed')
        or (p_kind='agenda' and ap.starts_at>=a and ap.starts_at<b))
    order by ap.starts_at limit case when p_kind='next' then 1 else 31 end
   ) t;
 elsif p_kind='revenue' then
   select jsonb_build_object('received',coalesce(sum(amount),0),'payments',count(*)) into result
   from public.payments where studio_id=s and paid_at>=a and paid_at<b;
 elsif p_kind='summary' then
   select jsonb_build_object('appointments',count(*),'completed',count(*) filter(where status='completed'),
    'scheduled_value',coalesce(sum(price),0)) into result
   from public.appointments where studio_id=s and starts_at>=a and starts_at<b and status in ('confirmed','completed');
 else raise exception 'Consulta não permitida';
 end if;
 return result;
end $$;
revoke all on function public.clara_read(text,date,date) from public,anon;
grant execute on function public.clara_read(text,date,date) to authenticated;

