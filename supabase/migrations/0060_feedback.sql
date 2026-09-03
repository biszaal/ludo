-- Player feedback, and somewhere for it to land.
--
-- Settings had no way to say anything back. The obvious version of this is a
-- `mailto:` row, and it is the version that quietly fails: a large share of
-- Android phones have no mail client configured at all, iOS Mail can be
-- deleted, and on both the tap opens a blank compose window that most people
-- close again. The bug report we most want — "the dice froze on turn nine" —
-- is exactly the one nobody will retype into a mail app.
--
-- So the app writes the message here, and the row is the record. Forwarding it
-- to the team's inbox (functions/game/feedback.ts) is a convenience laid on
-- top: if the mail provider is unset, rate-limited or down, the feedback is
-- still saved and `forwarded_at` stays null so it can be picked up later.
--
-- Diagnostics ride along because the sender cannot be asked follow-up
-- questions. Version and device answer half the bug reports on their own, and
-- they are the half people never think to include.

create table if not exists public.feedback (
  id             uuid primary key default gen_random_uuid(),
  -- Nulled rather than cascaded when the account goes: an account deletion (or
  -- the dormant-guest sweep, 0054) should take the PERSON out of the row, not
  -- the report out of the queue. What is left is an anonymous note about the
  -- app, which is what it always was.
  user_id        uuid references auth.users (id) on delete set null,
  message        text not null,
  -- Optional, and the only way a guest can be answered — most senders have no
  -- account, so without this a reply has nowhere to go. Typed by the player or
  -- prefilled from their account; never harvested silently.
  contact_email  text,
  -- What the sender was running. Collected by the client, clamped by the
  -- server, and never trusted for anything but reading.
  app_version    text,
  platform       text,
  device         text,
  created_at     timestamptz not null default now(),
  -- When the forward to the team inbox succeeded. Null means it is only here.
  forwarded_at   timestamptz,
  -- Set by whoever works the queue. Null means nobody has looked yet.
  reviewed_at    timestamptz,
  check (length(message) between 1 and 2000),
  check (contact_email is null or length(contact_email) <= 254),
  check (app_version is null or length(app_version) <= 32),
  check (platform is null or length(platform) <= 32),
  check (device is null or length(device) <= 120)
);

-- The two questions the queue gets asked: "what has nobody read yet" and "what
-- never made it to the inbox".
create index if not exists feedback_open_idx
  on public.feedback (created_at) where reviewed_at is null;
create index if not exists feedback_unforwarded_idx
  on public.feedback (created_at) where forwarded_at is null;

-- Service-role only: RLS on, no policies, no grants. Nothing about this table
-- is readable by a client — one player's feedback is not another player's
-- business, and a sender who could read the table could enumerate everyone
-- else's. Same shape as player_reports (0056) and user_activity (0053).
alter table public.feedback enable row level security;
revoke all on table public.feedback from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Working the queue
-- ---------------------------------------------------------------------------
-- Mail is the day-to-day path. This is the backstop, and the way to find
-- anything the forward dropped:
--
--   select f.created_at, f.message, f.contact_email,
--          f.app_version, f.platform, f.device,
--          p.display_name, f.forwarded_at
--     from feedback f
--     left join profiles p on p.user_id = f.user_id
--    where f.reviewed_at is null
--    order by f.created_at;
--
-- Closing one:  update feedback set reviewed_at = now() where id = '…';
