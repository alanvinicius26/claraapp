-- Availability is advisory; unique keys and reserve_studio_address enforce ownership atomically.
create or replace function public.studio_link_available(p_slug text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{2,59}$' then return false; end if;
  return not exists (
    select 1 from encaixa_private.studio_addresses a
    join public.studios s on s.id = a.studio_id
    where a.slug = p_slug and s.owner_id <> auth.uid()
  ) and not exists (
    select 1 from public.studios s where s.slug = p_slug and s.owner_id <> auth.uid()
  );
end;
$$;
revoke all on function public.studio_link_available(text) from public, anon;
grant execute on function public.studio_link_available(text) to authenticated;
