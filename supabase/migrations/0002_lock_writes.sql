-- M4 hardening: all state writes now go through the server-authoritative `game`
-- Edge Function (service role, bypasses RLS). Clients keep SELECT (for reads and
-- realtime) but lose direct INSERT/UPDATE — except a player may update their own
-- row for presence (is_connected).

drop policy if exists "games: authenticated insert" on public.games;
drop policy if exists "games: authenticated update" on public.games;
drop policy if exists "players: authenticated insert" on public.players;
drop policy if exists "moves: authenticated insert" on public.moves;

drop policy if exists "players: authenticated update" on public.players;
create policy "players: self presence" on public.players
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
