-- Idempotent turn actions.
--
-- Roll/move/pass were the only calls the client never retried: replaying a lost
-- roll could double-act a turn, so a request the network dropped was simply
-- lost, and the resync snapped the board back to before it. On a congested
-- connection that reads as the game cancelling your roll or walking your pawn
-- back — you act, nothing happens, you act again.
--
-- A client-minted action id makes the replay detectable, which makes the retry
-- safe. The id is recorded ONLY when the games write actually landed (opTurn
-- releases the claim on a failed or raced write), so the invariant the retry
-- leans on is exact:
--
--     a row with this client_action_id exists  <=>  the action was applied
--
-- Nullable, and the index is partial, so rows written by older clients (and
-- every bot/stall-bot row, which has no client behind it to retry) are
-- unaffected.

alter table public.moves
  add column if not exists client_action_id text;

create unique index if not exists moves_client_action_idx
  on public.moves (game_id, client_action_id)
  where client_action_id is not null;
