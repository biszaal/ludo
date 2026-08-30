-- Delete guest accounts nobody has used in 90 days.
--
-- 0053 explains why the pile exists and records the signal. This is the reaper
-- that acts on it, and it is shipped DARK: the cron jobs below are scheduled but
-- deletion cannot fire until an operator inserts sweep_url and sweep_secret into
-- internal_config. Read the RUNBOOK at the bottom before arming it.
--
-- SCOPE. Guests only -- auth.users.is_anonymous. A registered account is a
-- deliberate act: the player asked to be remembered, and Settings already offers
-- them a self-delete (opDeleteAccount). We do not decide on their behalf.
--
-- THE TRAP THIS FILE IS MOSTLY ABOUT. is_anonymous = true is NOT the same as
-- "disposable guest". saveAccount (auth.ts) upgrades a guest in place with
-- updateUser({email, password}), and with email confirmations on the address
-- sits in email_change while is_anonymous stays TRUE until the link is clicked.
-- A player who typed their email, never confirmed, and drifted away is
-- indistinguishable from a throwaway under a naive is_anonymous filter -- and
-- deleting the account they believe they saved is the worst outcome this feature
-- can produce. encrypted_password catches it: updateUser sets the password
-- immediately, confirmed or not. That predicate is not optional.
--
-- It must be spelled `coalesce(encrypted_password,'') <> ''`, NOT
-- `encrypted_password is not null`. GoTrue writes an EMPTY STRING there for
-- anonymous sign-ins, not a null -- verified against this database, where all
-- 211 guests carried a zero-length password and every real account carried a
-- 60-char bcrypt hash. The `is not null` spelling matches every guest alive,
-- exempts the entire population, and leaves a sweep that deletes nothing while
-- looking exactly like a sweep that found nothing to delete. The same care
-- applies to email_change, which is '' rather than null; email and phone ARE
-- null, and are tested accordingly.
--
-- BOTS. Not a risk, contrary to the obvious worry: claimOrCreateBotIdentity
-- (bots.ts) mints them with createUser({ email: 'bot-...@bots.ludo.internal' }),
-- so every bot is an EMAIL user and is_anonymous is false. The explicit
-- bot_identities guard below is defence in depth and costs one index probe.
--
-- PAID PLAYERS ARE EXEMPT FOREVER, and "paid" is deliberately wider than
-- iap_purchases. rc-webhook inserts that row best-effort (`.then(undefined,
-- () => {})`); the authoritative credit is gem_apply keyed on 'rc:<txn>'. So a
-- real paying customer can exist with no iap_purchases row at all, and the
-- predicate has to read the ledgers too.
--
-- entitlements is scoped to source = 'iap' rather than any row on purpose:
-- theme.classic is priced at 0 (0013), so exempting every entitlement would
-- exempt everyone who ever tapped equip on a free theme -- probably most of the
-- dormant population, quietly turning the whole feature into a no-op.

-- ---------------------------------------------------------------------------
-- 1. The scan
-- ---------------------------------------------------------------------------
-- One definition of "who is a candidate", with three consumers: the preview, the
-- marker, and the confirm at delete time. They MUST NOT drift, which is why this
-- is one function and not three queries.
--
-- A function rather than a view because it reads auth.users: a view would need
-- security_invoker off and would trip Supabase's "security definer view" advisor,
-- and revoking a view cleanly is fussier than revoking a function.
--
-- last_active_at recomputes the greatest() from 0053 rather than trusting
-- user_activity alone. The stored column is the cheap indexed signal going
-- forward; the recomputation is the belt, and it rescues anyone whose only
-- activity arrived on a path that never reaches the edge function (a game
-- finishing writes player_stats; a coin movement writes wallets).
create or replace function public.guest_activity_scan()
returns table (user_id uuid, last_active_at timestamptz, exempt_reason text)
language sql
security definer
set search_path = public
as $$
  select
    u.id,
    greatest(
      coalesce(a.last_active_at,  '-infinity'::timestamptz),
      coalesce(pr.last_seen_at,   '-infinity'::timestamptz),
      coalesce(ps.last_played_at, '-infinity'::timestamptz),
      coalesce(w.updated_at,      '-infinity'::timestamptz),
      coalesce(p.updated_at,      '-infinity'::timestamptz),
      coalesce(s.last_session_at, '-infinity'::timestamptz),
      coalesce(u.last_sign_in_at, '-infinity'::timestamptz),
      u.created_at
    ),
    case
      -- Never the bot pool. Unreachable given the is_anonymous scope; kept so
      -- that a future change to how bots are minted fails safe.
      when exists (select 1 from bot_identities b where b.user_id = u.id)
        then 'bot'

      -- A guest who reached for an account. See the header: encrypted_password
      -- is the load-bearing half, because it is set the moment saveAccount runs
      -- whether or not the email is ever confirmed. provider <> 'anonymous'
      -- matters too -- see the WARNING in the runbook.
      when u.email is not null
        or u.phone is not null
        or coalesce(u.email_change, '') <> ''
        or coalesce(u.encrypted_password, '') <> ''
        or exists (
             select 1 from auth.identities i
              where i.user_id = u.id and i.provider <> 'anonymous'
           )
        then 'registering'

      -- Anyone who ever gave us money, by any of the four traces a purchase
      -- leaves. Any ONE of them is enough; they disagree in practice.
      when exists (select 1 from iap_purchases ip where ip.user_id = u.id)
        or exists (
             select 1 from gem_txns g
              where g.user_id = u.id and g.ext_id like 'rc:%'
           )
        or coalesce(w.purchased_balance, 0) > 0
        or exists (
             select 1 from wallet_txns t
              where t.user_id = u.id and t.bucket = 'purchased'
           )
        or exists (
             select 1 from entitlements e
              where e.user_id = u.id and e.source = 'iap'
           )
        then 'paid'

      else null
    end
  from auth.users u
  left join public.user_activity a  on  a.user_id = u.id
  left join public.user_presence pr on pr.user_id = u.id
  left join public.player_stats  ps on ps.user_id = u.id
  left join public.wallets        w on  w.user_id = u.id
  left join public.profiles       p on  p.user_id = u.id
  left join lateral (
    select max(greatest(se.updated_at, se.refreshed_at)) as last_session_at
      from auth.sessions se
     where se.user_id = u.id
  ) s on true
  where u.is_anonymous;
$$;

revoke all on function public.guest_activity_scan() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The dry run
-- ---------------------------------------------------------------------------
-- Run this BEFORE arming anything, and read it carefully. A wrong predicate here
-- looks exactly like success: it reports few or no eligible users, which is
-- indistinguishable from a healthy population.
--
-- Baseline measured on production the day this was written, for comparison:
--
--   guests (total)        211
--   exempt: paid            2
--   exempt: registering     0   <- correct HERE, see below
--   eligible, idle 30d     48
--   eligible, idle 60d      2
--   eligible, idle 90d      0
--
-- The zero next to 'registering' is normally a red flag, and is not one on this
-- project yet: every non-anonymous user in this database is a bot, so no player
-- has ever completed saveAccount. The moment one does, that number must become
-- non-zero -- if players are saving accounts and this still reads 0, the
-- encrypted_password predicate has regressed to the `is not null` spelling and
-- is matching everyone. Check it against:
--
--   select coalesce(encrypted_password,'') <> '' as has_password, count(*)
--     from auth.users where is_anonymous group by 1;
--
-- Nothing was eligible at 90 days when this shipped, which is the expected shape
-- for a young app: the first real deletions are ~90 days after the earliest
-- guests went quiet, not on the day this is armed.
create or replace function public.guest_sweep_preview()
returns table (label text, users bigint)
language sql
security definer
set search_path = public
as $$
  with scan as (select * from guest_activity_scan())
  select 'guests (total)', count(*) from scan
  union all
  select 'exempt: ' || exempt_reason, count(*) from scan
   where exempt_reason is not null group by exempt_reason
  union all
  -- count(scan.user_id), not count(*): the left join keeps the day bucket even
  -- when nothing matches, and count(*) would report that empty bucket as 1.
  select 'eligible, idle ' || d.days || 'd', count(scan.user_id)
    from (values (30), (60), (90), (180), (365)) as d(days)
    left join scan on scan.exempt_reason is null
                  and scan.last_active_at < now() - make_interval(days => d.days)
   group by d.days
   order by 1;
$$;

revoke all on function public.guest_sweep_preview() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Candidates and confirmation
-- ---------------------------------------------------------------------------
create or replace function public.guest_sweep_candidates(p_days int default 90)
returns table (user_id uuid, last_active_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select s.user_id, s.last_active_at
    from guest_activity_scan() s
   where s.exempt_reason is null
     and s.last_active_at < now() - make_interval(days => greatest(p_days, 1));
$$;

revoke all on function public.guest_sweep_candidates(int) from public, anon, authenticated;

-- The last safety net, and the reason a stale mark cannot hurt anyone.
--
-- A mark is written by cron and acted on at least seven days later. In between
-- the player may have come back, bought something, or saved an account. This
-- re-runs the full scan against just the batch in hand, immediately before
-- deletion, and the edge function deletes ONLY what comes back.
create or replace function public.guest_sweep_confirm(p_users uuid[], p_days int default 90)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select c.user_id
    from guest_sweep_candidates(p_days) c
   where c.user_id = any(p_users);
$$;

revoke all on function public.guest_sweep_confirm(uuid[], int) from public, anon, authenticated;
grant execute on function public.guest_sweep_confirm(uuid[], int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The queue
-- ---------------------------------------------------------------------------
-- Marking and deleting are separated by seven days on purpose: a user must fail
-- the check TWICE, a week apart, before anything is destroyed. That week is also
-- the window in which a mistake is visible and reversible -- the marks are
-- readable, and nothing has happened yet.
--
-- The cascade makes this table self-draining: a successful deleteUser removes
-- the queue row that asked for it. No acknowledgement path to get wrong.
create table if not exists public.guest_sweep_marks (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  marked_at      timestamptz not null default now(),
  last_active_at timestamptz not null,
  -- Bounded retry. A user the Auth API refuses five times is a bug to look at,
  -- not a row to keep hammering once a day forever.
  attempts       int not null default 0,
  last_error     text
);

create index if not exists guest_sweep_marks_marked_idx on public.guest_sweep_marks (marked_at);

alter table public.guest_sweep_marks enable row level security;
revoke all on table public.guest_sweep_marks from anon, authenticated;

-- The audit trail. pg_net discards the HTTP response and cron only knows it
-- POSTed, so the edge function recording its own outcome is the ONLY way to
-- learn what a sweep did. Never trimmed: a few rows a year, and they are the
-- answer to "what happened to my account".
create table if not exists public.guest_sweep_runs (
  id         bigint generated always as identity primary key,
  ran_at     timestamptz not null default now(),
  considered int not null,
  confirmed  int not null,
  deleted    int not null,
  failed     int not null
);

alter table public.guest_sweep_runs enable row level security;
revoke all on table public.guest_sweep_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Marking
-- ---------------------------------------------------------------------------
-- Unmark FIRST, always. Someone who came back during the grace week must lose
-- their mark, and doing it in this order means a crash between the two
-- statements leaves the queue smaller rather than larger -- the safe direction.
create or replace function public.mark_guest_sweep()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days  int;
  v_limit int;
begin
  select coalesce((select value::int from internal_config where key = 'sweep_days'), 90)
    into v_days;
  select coalesce((select value::int from internal_config where key = 'sweep_mark_limit'), 5000)
    into v_limit;

  delete from guest_sweep_marks m
   where not exists (
     select 1 from guest_sweep_candidates(v_days) c where c.user_id = m.user_id
   );

  insert into guest_sweep_marks (user_id, last_active_at)
  select c.user_id, c.last_active_at
    from guest_sweep_candidates(v_days) c
   order by c.last_active_at
   limit v_limit
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.mark_guest_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The orphan purge
-- ---------------------------------------------------------------------------
-- Four tables carry a user id with no foreign key, so they do not cascade.
-- Called by the edge function AFTER deleteUser succeeds, on the deleted set only
-- -- so a partial failure never touches rows belonging to a user who still exists.
--
-- Why no FKs were added instead:
--
--   players.user_id     a cascade would vaporise a seat mid-match, breaking
--                       unique (game_id, seat) and desyncing games.state, which
--                       embeds userId in its JSON.
--   games.host_user_id  a cascade would destroy a live table and the other three
--                       seats' staked coins because ONE player self-deleted.
--   game_bots.user_id   only ever holds bot ids, and already cascades via game_id.
--                       Nothing to do.
--
-- For games/players this is belt-and-braces: a 90-day-idle candidate owns no
-- rows, since reap_stale_games clears waiting rooms at 15min/24h, active at 24h
-- and finished at 7 days -- and player_stats.last_played_at is itself an activity
-- signal, so a recent player cannot BE a candidate.
--
-- wallet_txns is the real one, and it is a deliberate reversal of 0038's "the
-- money ledgers are never trimmed". That policy is already only half-true:
-- gem_txns and iap_purchases both cascade, so opDeleteAccount destroys two of
-- the three today. wallet_txns survives by missing FK, not by design. And a
-- swept guest has PROVABLY never paid -- that is what the exemption enforces --
-- so their ledger has no chargeback value, its RLS predicate (user_id =
-- auth.uid()) can never match again, and it is the largest per-user row count in
-- the database. To keep them for aggregate economy stats instead, delete the
-- wallet_txns statement; nothing else depends on it.
create or replace function public.guest_sweep_purge(p_users uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_users is null or array_length(p_users, 1) is null then
    return;
  end if;
  delete from players     where user_id      = any(p_users);
  delete from games       where host_user_id = any(p_users);
  delete from wallet_txns where user_id      = any(p_users);
end;
$$;

revoke all on function public.guest_sweep_purge(uuid[]) from public, anon, authenticated;
grant execute on function public.guest_sweep_purge(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 7. The cron entrypoint
-- ---------------------------------------------------------------------------
-- Shaped exactly like tick_games, INCLUDING the Authorization header -- see 0052
-- for the day that header went missing and the tick 401ed in silence for a
-- release. The sweep would fail the same way and look identical to "there are no
-- dormant guests", which is why the runbook checks net._http_response.
--
-- Deletion goes through the edge function rather than `delete from auth.users`
-- here. Raw SQL does work (auth.identities/sessions/mfa_factors/one_time_tokens
-- all cascade, and refresh_tokens transitively via session_id), but: legacy
-- refresh_tokens rows with a null session_id have no cascade path; it depends on
-- the postgres role keeping DELETE on a schema Supabase owns and can change; and
-- a future GoTrue table would be silently missed. Against that, the edge path
-- gives per-user error isolation and -- decisive for a live app -- a five-second
-- disarm that needs no migration and no redeploy.
create or replace function public.sweep_guests()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  fn_url  text;
  fn_key  text;
  fn_auth text;
begin
  -- Nothing has served its grace week: do not wake the edge function at all.
  -- An idle day costs one index probe, the 0049 argument.
  if not exists (
    select 1 from guest_sweep_marks
     where marked_at < now() - interval '7 days'
       and attempts < 5
  ) then
    return;
  end if;

  select value into fn_url  from internal_config where key = 'sweep_url';
  select value into fn_key  from internal_config where key = 'sweep_secret';
  select value into fn_auth from internal_config where key = 'tick_auth_key';
  -- THE SAFETY CATCH. Until an operator inserts sweep_url and sweep_secret this
  -- returns here and no account is ever deleted. Deleting those two rows is the
  -- documented way to stop the sweep instantly.
  if fn_url is null or fn_key is null or fn_auth is null then
    return;
  end if;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'Authorization',  'Bearer ' || fn_auth,
                 'x-sweep-secret', fn_key
               ),
    body    := jsonb_build_object('op', 'sweepGuests'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.sweep_guests() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Schedule
-- ---------------------------------------------------------------------------
-- Offset from the existing jobs (reap-stale-games */5, tick-games every minute,
-- reap-friend-online-pings 04:17) and from each other: marking at 03:23, sweeping
-- at 03:41, so a mark run always settles before the sweep reads its output.
--
-- Marking is non-destructive and runs from day one; that is intentional, because
-- a populated guest_sweep_marks IS the dry run. Deletion stays impossible until
-- internal_config is configured.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('mark-guest-sweep',     '23 3 * * *', $cron$select public.mark_guest_sweep()$cron$);
    perform cron.schedule('sweep-guest-accounts', '41 3 * * *', $cron$select public.sweep_guests()$cron$);
  end if;
exception
  when others then
    -- Scheduling is a nicety; never fail the migration over it.
    null;
end;
$$;

-- ---------------------------------------------------------------------------
-- RUNBOOK
-- ---------------------------------------------------------------------------
-- WARNING, run this FIRST. If this GoTrue version gives anonymous users an
-- identity row whose provider is NOT 'anonymous', the 'registering' predicate
-- above matches every guest, the preview reads zero, and that is indistinguish-
-- able from having no dormant users:
--
--   select coalesce(i.provider,'<none>') as provider, count(*)
--     from auth.users u left join auth.identities i on i.user_id = u.id
--    where u.is_anonymous group by 1;
--
-- DRY RUN (safe, this is the state the migration leaves you in):
--   select * from public.guest_sweep_preview();
--   select * from public.guest_sweep_candidates(90) order by last_active_at limit 20;
--   select public.mark_guest_sweep();
--   select count(*) from public.guest_sweep_marks;   -- = the 90d preview count
--
-- ARM. Start at 365 days, not 90 -- walk it down over a few weeks once the runs
-- look right:
--   insert into internal_config (key, value) values ('sweep_days','365')
--     on conflict (key) do update set value = excluded.value;
--   -- supabase secrets set SWEEP_SECRET=<random>
--   insert into internal_config (key, value) values
--     ('sweep_url','https://<ref>.supabase.co/functions/v1/game'),
--     ('sweep_secret','<the same random value>');
--   -- tick_auth_key must already be present (0036).
--
-- WATCH, the morning after:
--   select * from guest_sweep_runs order by ran_at desc limit 10;
--   select status_code, count(*) from net._http_response
--    where created > now() - interval '1 day' group by 1;      -- 200s, not 401s
--   select attempts, last_error, count(*) from guest_sweep_marks
--    where attempts > 0 group by 1,2;                          -- expect empty
--
-- DISARM, instantly, no migration and no redeploy:
--   delete from internal_config where key in ('sweep_url','sweep_secret');
--   select cron.unschedule('sweep-guest-accounts');  -- and 'mark-guest-sweep'
--
-- One consequence worth knowing: friend_codes cascade, so a swept guest's
-- six-character code returns to the pool and can be re-minted to someone else.
-- A stale invite link shared months ago would resolve to a different player.
