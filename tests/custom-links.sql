begin;
do $$
declare
  uid uuid := gen_random_uuid(); other_uid uuid := gen_random_uuid(); sid uuid; other_sid uuid;
  original text := 'qa-link-' || gen_random_uuid()::text;
  renamed text := 'qa-link-' || gen_random_uuid()::text;
  rejected boolean := false;
begin
  insert into auth.users(id,email) values(uid,uid::text || '@example.invalid'),(other_uid,other_uid::text || '@example.invalid');
  insert into public.studios(owner_id,name,professional,slug) values(uid,'QA Link','QA',original) returning id into sid;
  insert into public.studios(owner_id,name,professional,slug) values(other_uid,'QA Other','QA','qa-' || other_uid::text) returning id into other_sid;
  perform set_config('request.jwt.claim.sub',uid::text,true);
  if not public.studio_link_available(original) or not public.studio_link_available(renamed) then raise exception 'Own or free link rejected'; end if;
  if public.studio_link_available('UPPERCASE') or public.studio_link_available('ab') or public.studio_link_available(null) then raise exception 'Invalid link accepted'; end if;
  update public.studios set slug=renamed where id=sid;
  if not public.studio_link_available(original) then raise exception 'Own alias rejected'; end if;
  if (public.booking_page(original)->'studio'->>'id')::uuid is distinct from sid then raise exception 'Old link broken'; end if;
  perform set_config('request.jwt.claim.sub',other_uid::text,true);
  if public.studio_link_available(original) or public.studio_link_available(renamed) then raise exception 'Foreign link available'; end if;
  begin update public.studios set slug=original where id=other_sid;
  exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Alias takeover allowed'; end if;
  rejected:=false;
  begin update public.studios set slug=renamed where id=other_sid;
  exception when unique_violation or raise_exception then rejected:=true; end;
  if not rejected then raise exception 'Duplicate link allowed'; end if;
  if has_function_privilege('anon','public.studio_link_available(text)','EXECUTE') then raise exception 'Anonymous availability access'; end if;
  if not has_function_privilege('authenticated','public.studio_link_available(text)','EXECUTE') then raise exception 'Missing authenticated access'; end if;
end $$;
rollback;
