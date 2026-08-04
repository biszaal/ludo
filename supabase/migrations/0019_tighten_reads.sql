-- Close two holes left over from the pre-Edge-Function era (0001/0002).
--
-- 1. COLUMN-SCOPED PRESENCE WRITES.
--    "players: self presence" (0002) is row-scoped but not column-scoped, and
--    RLS cannot express columns — a policy that lets you update your row lets
--    you update EVERY column of it. So a modified client could set its own
--    `seat`, and startGameNow orders the deal by seat, which in a coin-staked
--    1v1 is "always go first". Table grants are the only tool for this.
--    Same reasoning as 0016: player_stats lives off `profiles` precisely
--    because that table has a self-update policy.
--
-- 2. PARTICIPANTS-ONLY READS.
--    0001 shipped `select using (true)` on games/players/moves with a comment
--    saying M4 would tighten it to participants-only. M4 landed (0002 moved
--    every write server-side) but the read side never followed, so any signed-in
--    user can scrape `room_code` from `games` and walk into a stranger's room
--    (opJoin only checks status + capacity), enumerate user_ids from `players`,
--    and read every game's move log.
--
--    The client only ever reads a game it is already seated in (net/api.ts:
--    fetchGame, getLobby, setConnected) and never reads `moves` at all, so
--    nothing in the app loses access. Join-by-code keeps working because
--    opJoin runs with the service role, which bypasses RLS entirely.
--
-- Rollback: drop the three policies below, recreate them as `using (true)`,
-- and `grant update on public.players to authenticated`.

-- ---------------------------------------------------------------------------
-- 1. Presence columns only
-- ---------------------------------------------------------------------------
-- The policy already limits this to the caller's own row; the grant limits it
-- to the two columns presence actually needs. is_connected: foreground/
-- background. missed_turns: cleared on return, so a minimized app is told apart
-- from a closed one (0007). Everything else — seat, color, is_host, game_id —
-- is the server's to write.
revoke update on public.players from authenticated, anon;
grant  update (is_connected, missed_turns) on public.players to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Participants-only reads
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER on purpose: a policy on `players` that reads `players`
-- would re-enter its own policy and error with infinite recursion. Running the
-- lookup as the owner sidesteps RLS for this one question. STABLE so the
-- planner can cache it within a statement — it is evaluated per row, and
-- Realtime evaluates it per message per subscriber.
--
-- The (game_id, user_id) unique constraint from 0001 already indexes this.
create or replace function public.is_game_participant(p_game uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.players
     where game_id = p_game
       and user_id = auth.uid()
  );
$$;

revoke all on function public.is_game_participant(uuid) from public, anon;
grant execute on function public.is_game_participant(uuid) to authenticated, service_role;

drop policy if exists "games: authenticated read" on public.games;
create policy "games: participants read" on public.games
  for select to authenticated
  using (public.is_game_participant(id));

drop policy if exists "players: authenticated read" on public.players;
create policy "players: participants read" on public.players
  for select to authenticated
  using (public.is_game_participant(game_id));

-- Kept readable to participants rather than dropped outright: the audit log is
-- the only record of how a finished game played out, and a replay/dispute view
-- would read exactly this. Nothing in the client reads it today.
drop policy if exists "moves: authenticated read" on public.moves;
create policy "moves: participants read" on public.moves
  for select to authenticated
  using (public.is_game_participant(game_id));
