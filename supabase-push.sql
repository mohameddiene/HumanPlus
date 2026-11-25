-- HUMAN+ : notifications push en arrière-plan (à exécuter UNE fois : Supabase > Éditeur SQL > Run)

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  tz text not null default 'UTC',
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists "push read own" on public.push_subscriptions;
create policy "push read own" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "push insert own" on public.push_subscriptions;
create policy "push insert own" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "push update own" on public.push_subscriptions;
create policy "push update own" on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "push delete own" on public.push_subscriptions;
create policy "push delete own" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Journal anti-doublon : lu et écrit uniquement par la fonction serveur (aucune policy = inaccessible depuis l'appli)
create table if not exists public.push_sent (
  sub_id uuid not null references public.push_subscriptions(id) on delete cascade,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (sub_id, key)
);
alter table public.push_sent enable row level security;
