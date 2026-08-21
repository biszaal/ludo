-- Rematch by consent: every remaining seat gets a say, instead of the host
-- restarting the table under everyone.
--
-- The old flow (room.ts opRematch) reset the finished game the instant the host
-- tapped Rematch. Guests had no button and no answer — they were shown
-- "Waiting for the host to start a rematch…" and then simply found themselves
-- back on a fresh board. That is fine when the room is three friends on a sofa
-- and wrong everywhere else: a quick-match opponent who was done playing had no
-- way to say so except to walk out of a game that had already started.
--
-- So a rematch is now a proposal anyone still seated can open, and everyone
-- else answers yes or no. Whoever accepts plays (two or more, or the proposal
-- lapses); whoever doesn't is left out of the new deal.
--
-- Why the votes live on `players` and not on `games`:
--
--   * clients already re-read the players table on every realtime event for
--     that game (api.subscribeGame -> onLobby -> getLobby), so a vote reaches
--     every device over plumbing that exists, with no new channel and no
--     new subscription;
--   * the games row is the state-sync path, and every row that travels it is
--     matched against state_version. A vote does not change the game state, so
--     a games-row write carrying one would either be discarded as a stale echo
--     or force a fake version bump through the client's prediction machinery.
--     Neither is worth it for a boolean;
--   * a vote is per-seat by nature, and `players` is the per-seat table. The
--     UI wants exactly this shape: a tick against each chair.
--
-- `rematch_voted_at` is not bookkeeping — the earliest one is the proposal's
-- timestamp, and therefore the deadline every client counts down to. Keeping
-- it here means the window survives a reconnect (it is a row, not a timer) and
-- that no separate "a vote is open" flag can drift out of step with the votes
-- themselves.
--
-- Both columns are cleared whenever a proposal resolves — accepted, declined
-- or lapsed — so a null vote always means "has not answered this proposal",
-- never "answered a previous one".

alter table public.players
  add column if not exists rematch_vote text
    check (rematch_vote is null or rematch_vote in ('yes', 'no')),
  add column if not exists rematch_voted_at timestamptz;

-- No index: every read of these is already filtered to one game_id, which
-- players_game_id_idx (0001) covers, and a room is at most four rows.
