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
