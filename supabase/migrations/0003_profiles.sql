-- Player profiles: display name + avatar shown in lobbies and games.
-- Clients read all profiles (party game among friends) and write only their
-- own row; the edge function never touches this table. Additive & back-compat:
-- clients without a profile row keep their color-label fallback.

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player'
               check (char_length(display_name) between 1 and 20),
  avatar_id    text not null default 'orbit-moss'
               check (avatar_id ~ '^[a-z0-9-]{1,24}$'),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: authenticated read" on public.profiles;
create policy "profiles: authenticated read"
  on public.profiles for select to authenticated using (true);

drop policy if exists "profiles: self insert" on public.profiles;
create policy "profiles: self insert"
  on public.profiles for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "profiles: self update" on public.profiles;
create policy "profiles: self update"
  on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
