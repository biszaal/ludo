-- A counter for turns spent stuck in the yard with nothing to show for them.
--
-- With `leaveYardOnSix`, a player whose pawns are all in the yard can do
-- nothing at all without a six, and P(no six in n rolls) is (5/6)^n: 58% still
-- stuck after three turns, 33% after six. Against a turn clock and three
-- opponents that is minutes of watching other people play, and it is the most
-- common complaint the game gets.
--
-- The previous answer was a RULE (three rolls from a full yard). It was correct
-- and symmetric but read as the game cheating, because the screen announced
-- "No moves — passing…" and then did not pass. Reverted in favour of what is
-- being counted here: after enough dry turns, the die itself becomes more
-- likely to come up six.
--
-- BE HONEST ABOUT WHAT THIS IS. It is a thumb on the scale. The dice are
-- otherwise a deterministic HMAC over (game, version, seat) precisely so that
-- nobody — including the server — can shop for a better number, and this bends
-- that. Three things keep it defensible:
--
--   * it is SYMMETRIC. Every seat is counted the same way, bots included. A bot
--     stuck in its yard gets exactly the help a human does.
--   * it is STILL DETERMINISTIC. The bias is derived from the same HMAC key and
--     the same (game, version, seat), plus this counter, which does not move
--     between a prepareRoll and the roll it belongs to. So the anti-stalling
--     property in turn.ts's rollRng comment survives: the die you walk away
--     from is still the die the bot rolls for you.
--   * it CANNOT BE FARMED. It only advances on a turn where the player had no
--     legal move whatsoever, which is a turn they would rather not have had.
--
-- It is reset by any roll that achieves anything: a six, or a turn with a legal
-- move in it. So it only ever climbs during the exact run of dead turns it
-- exists to end.
--
-- WHERE THE CURVE ENDS: nothing happens for the first six dead turns; the
-- seventh roll is 44% to be a six, the eighth 72%, and the ninth and everything
-- after it is certain. A guarantee is only something a player can plan around if
-- knowing it is coming lets them play differently, and by construction it cannot
-- here: the counter only moves on a turn with no legal move at all, so at the
-- moment the guarantee fires there is no choice to make and no move to hold
-- back. Capping below certainty instead left a tail of players still rolling at
-- 58% a turn, which is the complaint this column exists to answer.
--
-- ROLLBACK: drop the column; the edge function treats a missing value as 0 and
-- simply stops biasing.

-- ON `games`, NOT `players`, and that is a performance decision an existing
-- test made for us. away.test.ts pins "keeping the turn costs no lookup at
-- all": when a turn stays with the player who just acted, opTurn does not touch
-- the players table, and a per-roll SELECT there would have broken it. The
-- games row is ALREADY read and written by every turn, so carried here the
-- counter costs no extra query in either direction — and the update rides
-- inside the same version-guarded write as the state, so a roll that loses the
-- version race cannot move it either.
alter table public.games
  add column if not exists dry_turns jsonb not null default '{}'::jsonb;

comment on column public.games.dry_turns is
  'Per-seat count of consecutive turns rolled with no legal move and no six, as '
  '{"<player_id>": n}. Raises the chance of a six once a seat passes the edge '
  'function''s threshold; reset to 0 by any roll that produced a move or a six. '
  'Server-written only, inside the same write as the state it belongs to.';

-- No grant or policy changes: `games` already has its policies, and this column
-- is not secret — knowing your own dry streak tells you nothing you could not
-- count yourself by watching the board.
