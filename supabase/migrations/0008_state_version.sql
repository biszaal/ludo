-- Monotonic per-game write counter. Every authoritative write to games.state
-- increments it (guarded with .eq(state_version, v) — optimistic concurrency),
-- and it rides along on realtime rows so clients get a cheap dedup/ordering
-- key instead of deep-comparing full states. Also the reconciliation anchor
-- for optimistic client-side moves.
alter table public.games
  add column if not exists state_version integer not null default 0;
