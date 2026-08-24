-- Whether this table can be spoken to in the folded write protocol.
--
-- 0049 recorded, per seat, which client build sat in it. This is the decision
-- that column exists to support: when every human seat is on a build that
-- understands a die delivered over broadcast, a turn can cost one write
-- instead of two.
--
-- Decided ONCE, at deal time, and never revisited. A player who updates
-- mid-match, or a seat that changes hands, must not flip the broadcast shape
-- out from under a table that is already being rendered.
--
-- Defaults false, which is what every existing row gets: unknown means the
-- protocol that works everywhere.
alter table public.games add column if not exists fold_writes boolean not null default false;

comment on column public.games.fold_writes is
  'Set at deal time when every human seat is >= FOLD_MIN_VERSION. Never re-evaluated mid-match.';
