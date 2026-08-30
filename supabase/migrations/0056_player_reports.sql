-- Reporting a player, so the block has somewhere to be reviewed from.
--
-- In-game chat shipped with none of the three things a user-generated-content
-- surface is expected to carry: no filter on what arrives, no way to report it,
-- and no way to stop hearing from the person who sent it. `blocks` (0015) has
-- existed since friend discovery, but nothing on the chat path ever consulted
-- it, so blocking someone still left them talking in your game.
--
-- The filter is in functions/game/moderation.ts and the mute is client-side and
-- immediate. This is the third: a durable record a human can read. Without it
-- "Report" is a button that only pretends, which is worse than not offering one.
--
-- Apple guideline 1.2 and Play's UGC policy both ask for the set. So does
-- anyone matched with a stranger.

create table if not exists public.player_reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_user_id  uuid not null references auth.users (id) on delete cascade,
  reported_user_id  uuid not null references auth.users (id) on delete cascade,
  game_id           uuid references public.games (id) on delete set null,
  -- The message that prompted the report, already sanitized and masked by the
  -- time it reached the reporter's screen. Nullable: a report can be about
  -- conduct with no single line attached to it.
  message           text,
  reason            text not null default 'chat',
  created_at        timestamptz not null default now(),
  -- Set by whoever works the queue. Null means nobody has looked yet.
  reviewed_at       timestamptz,
  check (reporter_user_id <> reported_user_id),
  check (message is null or length(message) <= 200),
  check (reason in ('chat', 'conduct', 'name'))
);

-- The two queries this table exists to answer: "what is unreviewed, oldest
-- first" and "how many reports name this player".
create index if not exists player_reports_open_idx
  on public.player_reports (created_at) where reviewed_at is null;
create index if not exists player_reports_reported_idx
  on public.player_reports (reported_user_id);

-- One open report per reporter per target per game. A player hitting Report
-- three times on the same person is one complaint, not three, and the queue
-- should not have to dedupe by eye. A fresh game is a fresh incident.
create unique index if not exists player_reports_once_idx
  on public.player_reports (reporter_user_id, reported_user_id, coalesce(game_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Service-role only: RLS on, no policies, no grants. The reporter must not be
-- able to read the queue back (it would confirm whether a target has been
-- reported by others), and the reported player must never see it at all.
-- Same shape as bot_identities / internal_config / user_activity.
alter table public.player_reports enable row level security;
revoke all on table public.player_reports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Working the queue
-- ---------------------------------------------------------------------------
-- No admin UI ships with this. Until there is one, the queue is read directly:
--
--   select r.created_at, r.message, r.reason,
--          rp.display_name as reporter, tp.display_name as reported,
--          (select count(*) from player_reports x
--            where x.reported_user_id = r.reported_user_id) as total_against
--     from player_reports r
--     left join profiles rp on rp.user_id = r.reporter_user_id
--     left join profiles tp on tp.user_id = r.reported_user_id
--    where r.reviewed_at is null
--    order by r.created_at;
--
-- Closing one:  update player_reports set reviewed_at = now() where id = '…';
