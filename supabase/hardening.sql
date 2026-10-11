-- Public reservations pass through the Edge Function, not privileged public RPCs.
revoke execute on function public.booking_page(text),public.available_slots(text,uuid,date),public.book_appointment(text,uuid,timestamptz,text,text,text,text),public.manage_booking(uuid,text,timestamptz) from anon,authenticated;
grant execute on function public.booking_page(text),public.available_slots(text,uuid,date),public.book_appointment(text,uuid,timestamptz,text,text,text,text),public.manage_booking(uuid,text,timestamptz) to service_role;
create table encaixa_private.request_limits(bucket text primary key, hits integer not null default 1, expires_at timestamptz not null);
alter table encaixa_private.request_limits enable row level security;
create function public.booking_rate_limit(p_bucket text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare hits integer;
begin
 if length(p_bucket)>200 or p_limit not between 1 and 300 or p_seconds not between 1 and 3600 then return false; end if;
 delete from encaixa_private.request_limits where expires_at<now()-interval '1 day';
 insert into encaixa_private.request_limits as r(bucket,hits,expires_at) values(p_bucket,1,now()+make_interval(secs=>p_seconds))
 on conflict(bucket) do update set hits=case when r.expires_at<now() then 1 else r.hits+1 end,expires_at=case when r.expires_at<now() then now()+make_interval(secs=>p_seconds) else r.expires_at end returning r.hits into hits;
 return hits<=p_limit;
end $$;
revoke all on function public.booking_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.booking_rate_limit(text,integer,integer) to service_role;
