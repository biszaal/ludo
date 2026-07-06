-- Friends + room invites. Like profiles (0003), these are client-owned tables
-- gated by RLS — the edge function never touches them. Anonymous auth users are
-- identified by their auth uid; you befriend people you've played with (their
-- uid is visible in the shared game state), so no directory/search is needed.

-- ---------------------------------------------------------------------------
-- friendships: one row per directed request; accepting flips status.
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  id                 uuid primary key default gen_random_uuid(),
  requester_user_id  uuid not null references auth.users (id) on delete cascade,
  addressee_user_id  uuid not null references auth.users (id) on delete cascade,
  status             text not null default 'pending'
                       check (status in ('pending', 'accepted')),
  created_at         timestamptz not null default now(),
  check (requester_user_id <> addressee_user_id),
  unique (requester_user_id, addressee_user_id)
);

create index if not exists friendships_addressee_idx on public.friendships (addressee_user_id);
create index if not exists friendships_requester_idx on public.friendships (requester_user_id);

alter table public.friendships enable row level security;

-- Either party can read the row.
drop policy if exists "friendships: read own" on public.friendships;
create policy "friendships: read own" on public.friendships
  for select to authenticated
  using (requester_user_id = auth.uid() or addressee_user_id = auth.uid());

-- You can only create requests you send.
drop policy if exists "friendships: send" on public.friendships;
create policy "friendships: send" on public.friendships
  for insert to authenticated
  with check (requester_user_id = auth.uid());

-- Only the addressee can accept (update). Can't re-target either party.
drop policy if exists "friendships: accept" on public.friendships;
create policy "friendships: accept" on public.friendships
  for update to authenticated
  using (addressee_user_id = auth.uid())
  with check (addressee_user_id = auth.uid());

-- Either party can remove (decline / cancel / unfriend).
drop policy if exists "friendships: remove" on public.friendships;
create policy "friendships: remove" on public.friendships
  for delete to authenticated
  using (requester_user_id = auth.uid() or addressee_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- room_invites: "come play" pings. Consumed (deleted) once acted on.
-- ---------------------------------------------------------------------------
create table if not exists public.room_invites (
  id           uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users (id) on delete cascade,
  to_user_id   uuid not null references auth.users (id) on delete cascade,
  room_code    text not null,
  created_at   timestamptz not null default now()
);

create index if not exists room_invites_to_idx on public.room_invites (to_user_id);

alter table public.room_invites enable row level security;

drop policy if exists "room_invites: read own" on public.room_invites;
create policy "room_invites: read own" on public.room_invites
  for select to authenticated
  using (to_user_id = auth.uid() or from_user_id = auth.uid());

drop policy if exists "room_invites: send" on public.room_invites;
create policy "room_invites: send" on public.room_invites
  for insert to authenticated
  with check (from_user_id = auth.uid());

drop policy if exists "room_invites: clear" on public.room_invites;
create policy "room_invites: clear" on public.room_invites
  for delete to authenticated
  using (to_user_id = auth.uid() or from_user_id = auth.uid());

-- Realtime: friends see requests/acceptances and invites arrive live.
alter table public.friendships  replica identity full;
alter table public.room_invites replica identity full;
alter publication supabase_realtime add table public.friendships;
alter publication supabase_realtime add table public.room_invites;
