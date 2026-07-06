-- Turn timer: each active turn gets a wall-clock deadline. When it passes, any
-- room member may call the `timeout` op and the server skips the stalled turn,
-- so one idle player can't freeze the room. The column is set server-side (edge
-- function, service role) on every active state write; clients only read it.

alter table public.games
  add column if not exists turn_deadline timestamptz;

-- turn_deadline rides along on the games row already in the realtime publication
-- (REPLICA IDENTITY FULL from 0001), so no publication change is needed.
