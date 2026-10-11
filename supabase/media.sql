alter table public.studios add column image_url text not null default '';
alter table public.services add column image_url text not null default '';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('studio-media','studio-media',true,5242880,array['image/jpeg','image/png','image/webp']);
create policy owner_media_insert on storage.objects for insert to authenticated with check(bucket_id='studio-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy owner_media_select on storage.objects for select to authenticated using(bucket_id='studio-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy owner_media_delete on storage.objects for delete to authenticated using(bucket_id='studio-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create or replace function public.booking_page(p_slug text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('studio',jsonb_build_object('id',s.id,'name',s.name,'professional',s.professional,'bio',s.bio,'phone',s.phone,'address',s.address,'active',s.active,'horizon',s.horizon,'image_url',s.image_url),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'description',v.description,'category',v.category,'price',v.price,'duration',v.duration,'image_url',v.image_url) order by v.name) from public.services v where v.studio_id=s.id and v.active),'[]'::jsonb))
 from public.studios s where s.slug=p_slug;
$$;
