-- "Your friend is online" notifications, and the ledger that stops them
-- becoming spam.
--
-- Presence already exists (0017) but is a pull: you see a green dot only if you
-- are looking at the Friends screen, which means the one moment the dot is
-- worth anything — a friend who is free to play RIGHT NOW — is the moment
-- nobody is watching for it. Push closes that, and it is the same argument
-- 0029 made for invites.
--
-- The whole design problem here is volume, not delivery. A player with thirty
-- friends who each open the app twice a day is sixty notifications, and the
-- second day of that they turn notifications off for good — taking the invite
-- pushes, which they actually wanted, with them. So this table exists purely to
-- be able to say no:
--
--   * one row per (from, to) pair, holding the last time we told `to` that
--     `from` was around. A pair cooldown makes a friend who reopens the app all
--     evening worth exactly one notification;
--   * scanned by recipient over the last day, so a recipient's TOTAL for the
--     day can be capped no matter how many friends log on.
--
-- The caps live in the edge function (social.ts) rather than here: they are
-- product judgement, not a data constraint, and they will be tuned.
--
-- Service-role only, like game_bots — RLS on with no policies. Nothing about
-- who was told what, when, is any client's business, and the table would
-- otherwise leak one friend's app-open times to another.

create table if not exists public.friend_online_pings (
  -- Who came online (the subject of the notification).
  from_user_id uuid not null references auth.users (id) on delete cascade,
  -- Who was told about it.
  to_user_id   uuid not null references auth.users (id) on delete cascade,
  sent_at      timestamptz not null default now(),
  primary key (from_user_id, to_user_id)
);

-- The daily per-recipient cap reads (to_user_id, sent_at) and nothing else.
create index if not exists friend_online_pings_to_idx
  on public.friend_online_pings (to_user_id, sent_at desc);

alter table public.friend_online_pings enable row level security;
revoke all on public.friend_online_pings from anon, authenticated;

-- Old rows carry no meaning: every rule that reads this table has a horizon of
-- a day or less, so anything older is pure growth. pg_cron sweeps it if the
-- extension is present; the table is small enough that missing the sweep costs
-- nothing but disk.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'reap-friend-online-pings',
      '17 4 * * *',
      $cron$delete from public.friend_online_pings where sent_at < now() - interval '2 days'$cron$
    );
  end if;
exception
  when others then
    -- Scheduling is a nicety; never fail the migration over it.
    null;
end;
$$;
