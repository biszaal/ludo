-- Performance only. Every policy below keeps exactly the predicate it already
-- had; the sole change is `auth.uid()` -> `(select auth.uid())`.
--
-- WHY IT MATTERS. auth.uid() reads a GUC, so the planner treats it as volatile
-- and re-evaluates it once PER ROW SCANNED. Wrapped in a scalar subquery it
-- becomes an InitPlan: evaluated once per statement, and the result is then a
-- constant the planner can push into an index condition. On the self-read
-- tables (wallets, wallet_txns, entitlements, gem_txns) this is the difference
-- between an index lookup and a sequential scan that re-reads the JWT claim for
-- every row in the table.
--
-- It is not a security change. `(select auth.uid())` returns the same value in
-- the same context; only the number of evaluations differs.
--
-- ROLLBACK: recreate each policy with the bare auth.uid() form.

-- --- ad_rewards -------------------------------------------------------------
drop policy if exists "ad_rewards: self read" on public.ad_rewards;
create policy "ad_rewards: self read" on public.ad_rewards
  for select to authenticated using (user_id = (select auth.uid()));

-- --- blocks -----------------------------------------------------------------
drop policy if exists "blocks: read own" on public.blocks;
create policy "blocks: read own" on public.blocks
  for select to authenticated using (blocker_user_id = (select auth.uid()));

drop policy if exists "blocks: add" on public.blocks;
create policy "blocks: add" on public.blocks
  for insert to authenticated with check (blocker_user_id = (select auth.uid()));

drop policy if exists "blocks: remove" on public.blocks;
create policy "blocks: remove" on public.blocks
  for delete to authenticated using (blocker_user_id = (select auth.uid()));

-- --- entitlements -----------------------------------------------------------
drop policy if exists "entitlements: self read" on public.entitlements;
create policy "entitlements: self read" on public.entitlements
  for select to authenticated using (user_id = (select auth.uid()));

-- --- friend_codes -----------------------------------------------------------
drop policy if exists "friend_codes: self read" on public.friend_codes;
create policy "friend_codes: self read" on public.friend_codes
  for select to authenticated using (user_id = (select auth.uid()));

-- --- friendships ------------------------------------------------------------
drop policy if exists "friendships: read own" on public.friendships;
create policy "friendships: read own" on public.friendships
  for select to authenticated
  using (
    requester_user_id = (select auth.uid())
    or addressee_user_id = (select auth.uid())
  );

drop policy if exists "friendships: accept" on public.friendships;
create policy "friendships: accept" on public.friendships
  for update to authenticated
  using (addressee_user_id = (select auth.uid()))
  with check (addressee_user_id = (select auth.uid()));

drop policy if exists "friendships: remove" on public.friendships;
create policy "friendships: remove" on public.friendships
  for delete to authenticated
  using (
    requester_user_id = (select auth.uid())
    or addressee_user_id = (select auth.uid())
  );

-- Anti-spam caps (20/hour, 50 pending) and the block check are preserved
-- verbatim from 0005/0015 — only the uid calls change.
drop policy if exists "friendships: send" on public.friendships;
create policy "friendships: send" on public.friendships
  for insert to authenticated
  with check (
    requester_user_id = (select auth.uid())
    and not is_blocked(requester_user_id, addressee_user_id)
    and (
      select count(*) from friendships f
       where f.requester_user_id = (select auth.uid())
         and f.created_at > now() - interval '1 hour'
    ) < 20
    and (
      select count(*) from friendships f
       where f.requester_user_id = (select auth.uid())
         and f.status = 'pending'
    ) < 50
  );

-- --- gem_txns ---------------------------------------------------------------
drop policy if exists "gem_txns: self read" on public.gem_txns;
create policy "gem_txns: self read" on public.gem_txns
  for select to authenticated using (user_id = (select auth.uid()));

-- --- iap_purchases ----------------------------------------------------------
drop policy if exists "iap_purchases: self read" on public.iap_purchases;
create policy "iap_purchases: self read" on public.iap_purchases
  for select to authenticated using (user_id = (select auth.uid()));

-- --- players ----------------------------------------------------------------
-- Still row-scoped here; the COLUMN scoping that stops a client rewriting its
-- own seat is the grant from 0019, which this does not touch.
drop policy if exists "players: self presence" on public.players;
create policy "players: self presence" on public.players
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --- profiles ---------------------------------------------------------------
drop policy if exists "profiles: self insert" on public.profiles;
create policy "profiles: self insert" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "profiles: self update" on public.profiles;
create policy "profiles: self update" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --- room_invites -----------------------------------------------------------
drop policy if exists "room_invites: read own" on public.room_invites;
create policy "room_invites: read own" on public.room_invites
  for select to authenticated
  using (
    to_user_id = (select auth.uid())
    or from_user_id = (select auth.uid())
  );

drop policy if exists "room_invites: clear" on public.room_invites;
create policy "room_invites: clear" on public.room_invites
  for delete to authenticated
  using (
    to_user_id = (select auth.uid())
    or from_user_id = (select auth.uid())
  );

-- Invites stay friends-only.
drop policy if exists "room_invites: send" on public.room_invites;
create policy "room_invites: send" on public.room_invites
  for insert to authenticated
  with check (
    from_user_id = (select auth.uid())
    and exists (
      select 1 from friendships f
       where f.status = 'accepted'
         and (
           (f.requester_user_id = (select auth.uid()) and f.addressee_user_id = room_invites.to_user_id)
           or (f.addressee_user_id = (select auth.uid()) and f.requester_user_id = room_invites.to_user_id)
         )
    )
  );

-- --- user_presence ----------------------------------------------------------
drop policy if exists "user_presence: friends read" on public.user_presence;
create policy "user_presence: friends read" on public.user_presence
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from friendships f
       where f.status = 'accepted'
         and (
           (f.requester_user_id = (select auth.uid()) and f.addressee_user_id = user_presence.user_id)
           or (f.addressee_user_id = (select auth.uid()) and f.requester_user_id = user_presence.user_id)
         )
    )
  );

drop policy if exists "user_presence: self write" on public.user_presence;
create policy "user_presence: self write" on public.user_presence
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "user_presence: self update" on public.user_presence;
create policy "user_presence: self update" on public.user_presence
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- --- wallets / wallet_txns --------------------------------------------------
drop policy if exists "wallets: self read" on public.wallets;
create policy "wallets: self read" on public.wallets
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "txns: self read" on public.wallet_txns;
create policy "txns: self read" on public.wallet_txns
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Foreign keys without a covering index
-- ---------------------------------------------------------------------------
-- Without these, the referenced side's DELETE has to sequential-scan the
-- referencing table to prove no rows point at the row being removed. That is
-- exactly what 0021's retention reapers do to `games` on a schedule.
create index if not exists bot_identities_in_use_game_idx
  on public.bot_identities (in_use_game_id);
create index if not exists iap_purchases_user_idx
  on public.iap_purchases (user_id);
create index if not exists room_invites_from_user_idx
  on public.room_invites (from_user_id);
