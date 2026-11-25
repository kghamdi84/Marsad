-- Weekly exports (Phase 8, ADR 0026). A private bucket the export job writes with the secret key; the owner may
-- only read their own folder, with MFA. Nobody signed in can write or delete exports.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exports', 'exports', false, 52428800, array['application/json'])
on conflict (id) do nothing;

create policy exports_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exports'
    and private.is_mfa()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
