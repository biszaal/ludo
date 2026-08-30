/**
 * Where the local seat stands in a match — the projection every end-of-race
 * screen gates on, kept pure so the rules can be tested without a renderer.
 *
 * One rule underneath all of them: a full-screen sheet belongs to a player
 * whose own race is over. Someone else bringing their last token home must not
 * yank a player out of their turn to ask whether they want to keep playing;
 * and a player who IS home must not be made to sit through the minor places to
 * find out where they came.
 *
 * The game plays to completion, so "still racing" is not the same as "hasn't
 * won": a seat that finished 2nd is done, and a seat that walked out is done.
 * With two players the winning move ends the match and the engine places the
 * loser in the same update, so neither of them is still racing either.
 */

import type { Color, GameState, PlayerState } from "@ludo/engine";

export interface SeatFinish {
  /** The local seat, or null when the device isn't one player — pass & play
   *  shares a screen, and a spectator has no seat at all. */
  seat: PlayerState | null;
  /** 0-based place in `finishedOrder`; -1 while this seat is still racing, and
   *  -1 with no local seat. */
  place: number;
  /** This seat still has tokens to bring home. False with no local seat: there
   *  is no single "you" to interrupt, so the device sees the match's moments. */
  stillPlaying: boolean;
  /** This seat has banked a placement — it can read the standings now, and
   *  keeps that place whether it stays to watch or leaves. */
  placed: boolean;
}

export function seatFinish(state: GameState, viewColor?: Color): SeatFinish {
  const seat = (viewColor ? state.players.find((p) => p.color === viewColor) : undefined) ?? null;
  const place = seat ? (state.finishedOrder ?? []).indexOf(seat.id) : -1;
  return {
    seat,
    place,
    stillPlaying: !!seat && place === -1 && !seat.hasLeft,
    placed: place >= 0,
  };
}

/**
 * Is the match over for THIS seat — the only moment an interstitial may run?
 *
 * Two ways a game ends for somebody, and the difference is the whole bug this
 * exists to prevent:
 *
 *   finished          the last token is home for everybody. The match is over
 *                     for the table, so it is over for this seat too.
 *   placed + leaving   this seat banked a place and is walking away. Their race
 *                     is done and the next screen is home either way.
 *
 * Everything else is the MIDDLE of a game. The case that shipped broken: in a
 * 3- or 4-handed match the champion stops racing the instant they come home,
 * while everyone else is still walking tokens around the board. The winner
 * sheet opens for them with a "Watch the rest" button — and that button ran the
 * end-of-match ad, dropping a full-screen takeover over a live match and then
 * returning the player to it.
 *
 * A seat still racing gets nothing on either intent. Quitting mid-race is a
 * forfeit, often of a stake, and is the last moment to monetise.
 */
export function matchOverForSeat(
  seat: Pick<SeatFinish, "placed">,
  opts: { finished: boolean; intent: "stay" | "leave" },
): boolean {
  if (opts.finished) return true;
  return opts.intent === "leave" && seat.placed;
}
