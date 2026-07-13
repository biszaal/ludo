-- Consecutive full turns a player idled through (bot-played by opTimeout).
-- Reset whenever the player acts or their device reconnects. At
-- MISSED_TURNS_TO_LEAVE the server removes them from the game for good —
-- this is how a closed app is told apart from a briefly-minimized one.
alter table public.players
  add column if not exists missed_turns integer not null default 0;
