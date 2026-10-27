insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('frequency-media','frequency-media',true,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
create policy frequency_media_admin_upload on storage.objects for insert to authenticated with check(bucket_id='frequency-media' and (select private.advice_admin()));
