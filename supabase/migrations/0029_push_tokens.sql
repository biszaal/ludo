-- Push notifications for room invites and friend requests.
--
-- Until now an invite only reached you through the realtime channel in
-- net/friends.ts, which means only while the app was open — the Friends screen
-- says so in its own footer. That is fine for a friend request, which can wait,
-- and useless for a room invite, where someone is sitting in a lobby waiting
-- for you right now. This is the missing half.
--
-- Tokens are Expo push tokens (ExponentPushToken[...]), minted per install by
-- expo-notifications. The actual APNs/FCM credentials live in EAS, so nothing
-- secret is stored here and the send is one HTTPS call to Expo's service.

create table if not exists public.push_tokens (
  -- The token is the identity: one row per install, and reinstalling mints a
  -- new one. A composite (user_id, token) key would let a stale row for a
  -- previous account keep receiving another player's invites on the same
  -- device, so the token owns itself and re-registration moves it.
  token      text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- Self-write only, and deliberately NO select policy: the edge function (service
-- role) is the only reader. A readable token table would let any signed-in
-- client enumerate device tokens and push to strangers through Expo's service,
-- which needs nothing but the token itself. Same posture as friend_codes (0015).
drop policy if exists "push_tokens: self upsert" on public.push_tokens;
create policy "push_tokens: self upsert" on public.push_tokens
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "push_tokens: self update" on public.push_tokens;
create policy "push_tokens: self update" on public.push_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Deleting by token, not by user: this is how a device drops its registration
-- when the player turns notifications off, and it must work even if the row
-- currently belongs to a previous account on the same install.
drop policy if exists "push_tokens: self delete" on public.push_tokens;
create policy "push_tokens: self delete" on public.push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

revoke select on public.push_tokens from anon, authenticated;
