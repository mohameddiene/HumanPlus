-- HUMAN+ / Supabase setup
-- Run this file in Supabase SQL Editor after creating a project.
-- Owner email: lebusinessman008@gmail.com
-- IMPORTANT: this uses auth.users + server-side triggers + RLS. Never expose service_role.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','moderator')),
  created_at timestamptz not null default now()
);

create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('signup','login','session_start','app_open','pwa_install','workout_saved','habit_updated')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null,
  status text not null check (status in ('active','trialing','past_due','cancelled','expired')),
  currency text not null default 'XOF',
  started_at timestamptz not null default now(),
  current_period_end timestamptz
);

create table if not exists public.revenue_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null default 'XOF',
  status text not null check (status in ('pending','confirmed','refunded','failed')),
  provider text,
  provider_reference text unique,
  created_at timestamptz not null default now()
);

-- Automatically create a profile and assign the owner role only to the exact owner email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name',''), lower(new.email))
  on conflict (id) do update set email=excluded.email;

  if lower(coalesce(new.email,'')) = 'lebusinessman008@gmail.com' then
    insert into public.admin_roles(user_id, role) values (new.id, 'owner')
    on conflict (user_id) do update set role='owner';
  end if;

  insert into public.user_events(user_id,event_type)
  values (new.id,'signup');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_humanplus on auth.users;
create trigger on_auth_user_created_humanplus
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Existing account, if already registered when this SQL is run:
insert into public.admin_roles(user_id, role)
select id, 'owner' from auth.users
where lower(email)='lebusinessman008@gmail.com'
on conflict (user_id) do update set role='owner';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_roles
    where user_id = (select auth.uid())
      and role in ('owner','moderator')
  );
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_roles
    where user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

-- Owner-only moderator grant by email. The client cannot choose a role or promote an owner.
create or replace function public.grant_moderator_by_email(target_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare target_id uuid;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can authorize moderators';
  end if;
  select id into target_id from auth.users where lower(email)=lower(trim(target_email)) limit 1;
  if target_id is null then
    raise exception 'No account found for this email. Ask the person to create an account first.';
  end if;
  if exists(select 1 from public.admin_roles where user_id=target_id and role='owner') then
    raise exception 'The owner role cannot be changed here';
  end if;
  insert into public.admin_roles(user_id,role) values(target_id,'moderator')
  on conflict(user_id) do update set role='moderator';
  return 'Moderator authorized';
end;
$$;

alter table public.profiles enable row level security;
alter table public.admin_roles enable row level security;
alter table public.user_data enable row level security;
alter table public.user_events enable row level security;
alter table public.subscriptions enable row level security;
alter table public.revenue_events enable row level security;

drop policy if exists "profile read own or admin" on public.profiles;
create policy "profile read own or admin" on public.profiles for select to authenticated
using (id=(select auth.uid()) or public.is_admin());
drop policy if exists "profile update own" on public.profiles;
create policy "profile update own" on public.profiles for update to authenticated
using (id=(select auth.uid())) with check (id=(select auth.uid()));

drop policy if exists "roles visible to self or admins" on public.admin_roles;
create policy "roles visible to self or admins" on public.admin_roles for select to authenticated
using (user_id=(select auth.uid()) or public.is_admin());

drop policy if exists "user data own read" on public.user_data;
create policy "user data own read" on public.user_data for select to authenticated
using (user_id=(select auth.uid()));
drop policy if exists "user data own insert" on public.user_data;
create policy "user data own insert" on public.user_data for insert to authenticated
with check (user_id=(select auth.uid()));
drop policy if exists "user data own update" on public.user_data;
create policy "user data own update" on public.user_data for update to authenticated
using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

drop policy if exists "events insert own" on public.user_events;
create policy "events insert own" on public.user_events for insert to authenticated
with check (user_id=(select auth.uid()));
drop policy if exists "events read admin" on public.user_events;
create policy "events read admin" on public.user_events for select to authenticated
using (public.is_admin());

drop policy if exists "subscriptions read own or admin" on public.subscriptions;
create policy "subscriptions read own or admin" on public.subscriptions for select to authenticated
using (user_id=(select auth.uid()) or public.is_admin());
drop policy if exists "revenue read admin" on public.revenue_events;
create policy "revenue read admin" on public.revenue_events for select to authenticated
using (public.is_admin());

revoke all on public.admin_roles from anon, authenticated;
grant select on public.admin_roles to authenticated;
revoke insert, update, delete on public.admin_roles from anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.grant_moderator_by_email(text) to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.user_data to authenticated;
grant select, insert on public.user_events to authenticated;
grant select on public.subscriptions to authenticated;
grant select on public.revenue_events to authenticated;

-- Restrict event names accepted from browser clients; financial records and subscriptions
-- must be written by a trusted payment webhook / Edge Function, never by browser code.
