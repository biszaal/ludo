-- Friend presence: is this person around to play right now?
--
-- Chosen over a Supabase realtime presence channel deliberately. Presence
-- state is per-channel, which leaves two bad options: one global channel
-- (every join/leave fans out to every connected client — O(users^2) messages,
-- billed per message) or one channel per user, which means N subscriptions to
-- render N dots. A heartbeat column reads all N in ONE query with zero new
-- subscriptions, and handles backgrounding better: iOS suspends the socket, so
-- channel presence gives a stale-then-flapping dot, whereas an explicit
-- offline write on AppState change is instant and the TTL is just the
-- crash/airplane-mode fallback.
--
-- Client-owned (RLS). Orthogonal to players.is_connected, which is per-game
-- seat connectivity — do not conflate the two.
--
-- A user can lie about being online: the row is self-written. Harmless — the
-- worst outcome is an invite nobody answers, which room_invites already
-- tolerates.

create table if not exists public.user_presence (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  status       text not null default 'online' check (status in ('online', 'offline'))
);

create index if not exists user_presence_last_seen_idx on public.user_presence (last_seen_at desc);

alter table public.user_presence enable row level security;

-- Readable by accepted friends only (and yourself). No definer needed: the
-- caller is a party to the friendships row, so "friendships: read own" already
-- permits this subquery.
drop policy if exists "user_presence: friends read" on public.user_presence;
create policy "user_presence: friends read"
  on public.user_presence for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friendships f
       where f.status = 'accepted'
         and ((f.requester_user_id = auth.uid() and f.addressee_user_id = user_presence.user_id)
           or (f.addressee_user_id = auth.uid() and f.requester_user_id = user_presence.user_id))
    )
  );

drop policy if exists "user_presence: self write" on public.user_presence;
create policy "user_presence: self write"
  on public.user_presence for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "user_presence: self update" on public.user_presence;
create policy "user_presence: self update"
  on public.user_presence for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
