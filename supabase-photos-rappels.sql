-- HUMAN+ : correctif photos de profil (à exécuter UNE fois dans Supabase > Éditeur SQL > Run)
-- Les rappels n'ont besoin d'aucune nouvelle table : ils se synchronisent dans user_data.

alter table public.profiles add column if not exists avatar_url text;

-- Permet à chaque utilisateur de créer / mettre à jour SA propre ligne de profil
drop policy if exists "profile insert own" on public.profiles;
create policy "profile insert own" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
drop policy if exists "profile update own" on public.profiles;
create policy "profile update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select, insert, update on public.profiles to authenticated;

-- Dossier de stockage des photos (public en lecture, écriture limitée à son propre dossier)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-photos', 'profile-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "H+ profile photos public read" on storage.objects;
create policy "H+ profile photos public read" on storage.objects for select
  using (bucket_id = 'profile-photos');
drop policy if exists "H+ profile photos own insert" on storage.objects;
create policy "H+ profile photos own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "H+ profile photos own update" on storage.objects;
create policy "H+ profile photos own update" on storage.objects for update to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "H+ profile photos own delete" on storage.objects;
create policy "H+ profile photos own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
