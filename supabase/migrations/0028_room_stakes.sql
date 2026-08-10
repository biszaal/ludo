-- Friend rooms can play for a pot.
--
-- games.stake already existed (0010) but opCreate never set it, so every
-- private room was hardcoded to 0 and friends could only ever play for fun.
-- The stake is now the host's choice, validated server-side against the same
-- economy.stakeTiers list quick match uses.
--
-- WHEN THE MONEY MOVES is the design decision worth recording. Quick match
-- debits on seat, because there the seat IS the matchmaking queue and holding
-- one without paying would let a client squat every pool. A room is different:
-- it can sit unstarted indefinitely while the host waits for friends. Charging
-- at join would strand real coins in lobbies nobody ever begins, with no
-- refund path a player could reason about. So rooms collect from every seat at
-- START (deal.ts collectStakes), all-or-nothing, unwinding by hand if anyone
-- comes up short. Nothing to refund when a room is simply abandoned, because
-- nothing was ever taken.
--
-- FAIRNESS INVARIANT (0013, 0018) is untouched: a stake buys ACCESS to a match,
-- exactly as quick match already does. It cannot change who wins.

-- room_invites carries the pot so an invitee sees what they're joining before
-- they tap. Without it the banner can only say "Room ABCD", and a friend can
-- be walked into a 10,000-coin table by a one-word message.
alter table public.room_invites
  add column if not exists stake int not null default 0 check (stake >= 0);

comment on column public.room_invites.stake is
  'Per-seat pot of the room at invite time, for display only. The authoritative '
  'stake is games.stake, read again at start.';
