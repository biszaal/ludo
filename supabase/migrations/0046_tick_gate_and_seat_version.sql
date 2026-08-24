-- Two unrelated-looking economies, both about not paying for nothing.
--
-- 1. The tick stops knocking when nobody is home.
-- 2. A seat records which build sat in it.
--
-- ---------------------------------------------------------------------------
-- 1. Tick gate
-- ---------------------------------------------------------------------------
-- 0034 wired pg_cron to POST the game function once a minute so that a table
-- everyone walked away from still finishes and still pays out. It works. What
-- it also does is fire 1,440 times a day whether or not there is anything to
-- do — 43,200 edge invocations a month, 8.6% of the free plan's entire budget,
-- to serve a handful of abandoned games.
--
-- The two things the tick looks for are both already indexed, by 0034 itself:
-- games_active_deadline_idx and games_unpaid_idx. So ask Postgres first. An
-- idle minute becomes two index probes instead of an HTTP round trip into a
-- cold isolate.
--
-- The predicates below MUST stay a superset of what tick.ts acts on:
--
--   * 15 seconds matches TICK_GRACE_MS. The edge side recomputes its cutoff
--     when the request lands, which is strictly LATER than this probe, so the
--     guard can never hide work the tick would have done.
--   * stake > 0 matches settleUnpaid's filter — a free game has no pot to pay.
--
-- Worst case a deadline passes microseconds after the probe and waits for the
-- next minute. That is what a once-a-minute backstop already promised.
create or replace function public.tick_games()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  fn_url  text;
  fn_key  text;
begin
  -- Nothing stalled and nothing unpaid: do not wake the edge function at all.
  if not exists (
        select 1 from games
         where status = 'active'
           and turn_deadline is not null
           and turn_deadline < now() - interval '15 seconds'
      )
     and not exists (
        select 1 from games
         where status = 'finished'
           and payout_done = false
           and stake > 0
      )
  then
    return;
  end if;

  select value into fn_url  from internal_config where key = 'tick_url';
  select value into fn_key  from internal_config where key = 'tick_secret';
  -- Not configured yet (or a local stack) — nothing to do, and nothing broken.
  if fn_url is null or fn_key is null then
    return;
  end if;

  -- Fire and forget. pg_net queues the request and returns immediately, so a
  -- slow or unreachable edge function can never hold the cron worker open.
  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'x-tick-secret',  fn_key
               ),
    body    := jsonb_build_object('op', 'tick'),
    timeout_milliseconds := 20000
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Seat version
-- ---------------------------------------------------------------------------
-- This app has no OTA channel — expo-updates is not a dependency — so every
-- client in the wild is a store binary that only the user can replace. That
-- makes the realtime write protocol effectively frozen: today a turn costs two
-- pushes (the roll, then the move), and an old client animates the opponent's
-- die from the FIRST of them. Folding those into one push is worth roughly
-- half of all realtime traffic, and it silently takes the die away from
-- everyone who has not updated.
--
-- So the fold has to be decided per table: only when every human seat is known
-- to understand it. This column is where that is known.
--
-- Pinned at SEAT time rather than kept per user, because the decision must be
-- stable for the length of a match — a player updating mid-game must not flip
-- the broadcast shape out from under the table they are sitting at.
--
-- NULL means "a client old enough not to say", which every currently-shipped
-- binary is, and which the gate must read as "cannot fold". Bots have no client
-- and never render, so their NULL is read separately.
alter table public.players add column if not exists app_version text;

comment on column public.players.app_version is
  'Client build that took this seat; NULL = pre-handshake binary. Read as "cannot fold" by the realtime write gate.';
