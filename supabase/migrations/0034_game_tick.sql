-- Heartbeat for games nobody is watching.
--
-- Every mutation in this app is driven by a connected client. The moment the
-- last device closes the app, an active game freezes: the server-side bot
-- driver stands down when the turn belongs to a human (bots.ts), opTimeout
-- needs someone to call it, and 0021's reaper only ever looked at 'waiting' and
-- 'finished' rows. The observable symptoms were "I came back an hour later and
-- the bots were still waiting for me" and — worse — "I won and never got the
-- coins", because a game that never reaches 'finished' never reaches
-- settleIfFinished either, leaving the pot debited from every player and paid
-- to none.
--
-- pg_cron + pg_net call the game function once a minute; it advances any turn
-- whose clock ran out and settles any finished-but-unpaid pot.
--
-- SETUP (once per environment, not in this migration — secrets never belong in
-- version control):
--
--   1. supabase secrets set TICK_SECRET=<random>
--   2. insert into internal_config (key, value) values
--        ('tick_url',    'https://<project-ref>.supabase.co/functions/v1/game'),
--        ('tick_secret', '<the same random value>');
--
-- Until step 2 runs, tick_games() no-ops. The edge side fails closed too, so a
-- missing secret means "no tick", never "an open endpoint".

-- ---------------------------------------------------------------------------
-- The tick's own scan. Partial index: the planner needs "active games past
-- their deadline", never an ordering of the whole table.
-- ---------------------------------------------------------------------------
create index if not exists games_active_deadline_idx
  on public.games (turn_deadline) where status = 'active';

-- Settlement recovery scan — normally matches nothing, so keep it cheap.
create index if not exists games_unpaid_idx
  on public.games (updated_at) where status = 'finished' and payout_done = false;

-- ---------------------------------------------------------------------------
-- Private config. RLS on with no policies, same shape as bot_identities (0009):
-- the service role and SECURITY DEFINER functions can read it, no client can.
-- ---------------------------------------------------------------------------
create table if not exists public.internal_config (
  key   text primary key,
  value text not null
);
alter table public.internal_config enable row level security;
revoke all on table public.internal_config from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The cron entry point.
-- ---------------------------------------------------------------------------
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

revoke all on function public.tick_games() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedule. Same guarded pattern as 0021: an environment without pg_cron or
-- pg_net (a local stack) just doesn't tick, which degrades to today's
-- behaviour rather than failing the migration.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'tick-games',
      '* * * * *',
      $cron$select public.tick_games()$cron$
    );
  end if;
exception when others then
  null;
end $$;
