-- When was this player last here? Nothing in this database could answer that.
--
-- Play is guest-first: ensureSignedIn mints an anonymous auth.users row on first
-- launch and every wallet, profile, stat and cosmetic hangs off it. Nothing ever
-- removes one. Each uninstall, each device that opened the app once and never
-- came back, leaves a permanent user holding a profile, a wallet, 500 coins and
-- a reserved display name. reap_stale_games (0038) trims games, moves, rate
-- limits and ad handshakes; it has never touched a user.
--
-- Deleting dormant guests is the obvious fix and the dangerous one, because the
-- deletion is only ever as good as the signal it fires on. The signals that
-- exist today are all partial:
--
--   user_presence.last_seen_at   only once the player opens the Friends screen
--   player_stats.last_played_at  only when an ONLINE game finishes
--   profiles.updated_at          only on a name/avatar/dice edit
--   wallets.updated_at           only on a coin or gem movement
--   auth.users.last_sign_in_at   not bumped by refresh-token rotation, so it
--                                goes stale on exactly the players who never
--                                sign out -- which is all of them
--
-- So this migration records the real one. It deletes nothing and enables no
-- deletion: it is safe to apply on its own, and should sit in production for a
-- few weeks before anything is built on top of it, so that live players
-- accumulate genuine rows rather than backfilled guesses.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------
-- Service-role only, and deliberately NOT a column on profiles. profiles carries
-- a client self-update policy (0003), so a last_active_at there would be
-- client-writable -- the one column in the schema that must not be. Worse,
-- profiles is `select using (true)` for every authenticated user, so the column
-- would publish every player's app-open times to anyone who can reach PostgREST.
-- That is the precise leak 0042 went to trouble to avoid for friend_online_pings.
--
-- Not user_presence either. That table is readable by accepted friends, drives
-- the green dot and gates the friend-online push fan-out (ONLINE_AWAY_MINUTES in
-- social.ts). Writing it from every request would turn the dot green for players
-- who are not on the Friends screen -- a shipped product behaviour changed as a
-- side effect of a retention feature. Keep the two orthogonal.
create table if not exists public.user_activity (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  last_active_at timestamptz not null default now()
);

-- The only query anyone runs against this: "who was last here before <date>".
create index if not exists user_activity_last_active_idx
  on public.user_activity (last_active_at);

-- RLS on with no policies -- the bot_identities / internal_config shape. When a
-- player was last online is nobody else's business, and there is no client read
-- of this table by design.
alter table public.user_activity enable row level security;
revoke all on table public.user_activity from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The write
-- ---------------------------------------------------------------------------
-- Called from the router on every authenticated request. The 6-hour guard lives
-- in the WHERE clause rather than in the caller, so the write is bounded no
-- matter who calls it or how often: at most 4 row writes per user per day.
--
-- The edge side stacks a second throttle in front of this (touchGate in lib.ts),
-- because this clause bounds WRITES but not ROUND TRIPS -- opTurn fires several
-- times per player per minute, and a 30-minute four-player match would otherwise
-- pay for ~400 RPCs to record 4 facts.
--
-- 6 hours is absurdly precise for a horizon measured in months. Resist tightening
-- it: the granularity buys nothing and the write amplification is real.
create or replace function public.touch_activity(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into user_activity as ua (user_id, last_active_at)
  values (p_user, now())
  on conflict (user_id) do update
     set last_active_at = excluded.last_active_at
   where ua.last_active_at < now() - interval '6 hours';
$$;

revoke all on function public.touch_activity(uuid) from public, anon, authenticated;
grant execute on function public.touch_activity(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Every user who already exists has no recorded activity at all, and "unknown"
-- must never read as "inactive". So seed from the best evidence available for
-- each user, with created_at as the floor so nobody is ever null.
--
-- The safety property that makes this defensible: greatest() is monotone, so
-- every ADDITIONAL term can only make a user look MORE recently active, never
-- less. Adding a signal can only prevent a future deletion; dropping one can
-- only cause one. When in doubt, add the term.
--
-- auth.sessions is the strongest of these and the least obvious. GoTrue bumps
-- the session row on every refresh-token rotation, and the mobile client runs
-- autoRefreshToken: true, so a foregrounded app rotates continuously. That is
-- exactly what last_sign_in_at fails to be. If a future GoTrue drops those
-- columns this statement errors loudly at migrate time rather than silently
-- ageing everyone -- which is the right failure.
insert into public.user_activity (user_id, last_active_at)
select u.id,
       greatest(
         coalesce(pr.last_seen_at,   '-infinity'::timestamptz),
         coalesce(ps.last_played_at, '-infinity'::timestamptz),
         coalesce(w.updated_at,      '-infinity'::timestamptz),
         coalesce(p.updated_at,      '-infinity'::timestamptz),
         coalesce(s.last_session_at, '-infinity'::timestamptz),
         coalesce(u.last_sign_in_at, '-infinity'::timestamptz),
         u.created_at
       )
  from auth.users u
  left join public.user_presence pr on pr.user_id = u.id
  left join public.player_stats  ps on ps.user_id = u.id
  left join public.wallets        w on  w.user_id = u.id
  left join public.profiles       p on  p.user_id = u.id
  left join lateral (
    select max(greatest(se.updated_at, se.refreshed_at)) as last_session_at
      from auth.sessions se
     where se.user_id = u.id
  ) s on true
on conflict (user_id) do nothing;
