/**
 * Seat → color assignment by player count.
 *
 * Two rules, and the game id decides between the rotations:
 *
 *   - Seats are consecutive on the board's clockwise cycle, so seat i and seat
 *     i+2 always face each other across the diagonal and turn order runs the
 *     way the board is drawn. A 2-player table takes the diagonal directly
 *     (red ↔ yellow at offset 0) so the two face each other across the board.
 *   - Which color a seat draws is rotated by the game id rather than fixed, so
 *     the host is not red in every game they ever open. Deriving the offset
 *     from the id (a v4 uuid — its last hex digit is uniform) rather than
 *     storing one is what lets the lobby preview the colors the server will
 *     actually deal, with no extra column and no round trip.
 *
 * This lives in the engine because the client and the server must agree to the
 * letter: the lobby previews these colors and the deal hands them out, so two
 * copies that drift promise a seat the deal doesn't give. It was two copies —
 * one here, one in supabase/functions/game/lib.ts — each carrying a comment
 * telling the next reader to keep them in step by hand.
 */

import { COLOR_ORDER, type Color } from "./types.js";

/** How far the color wheel is turned for this game. 0 when there is no id. */
export function colorOffset(gameId?: string | null): number {
  if (!gameId) return 0;
  const last = parseInt(gameId.replace(/[^0-9a-f]/gi, "").slice(-1), 16);
  return Number.isFinite(last) ? last % COLOR_ORDER.length : 0;
}

/**
 * The color for one seat, independent of how many end up seated. Used while a
 * room is still filling; the deal re-reads all of them through seatColors.
 */
export function seatColor(seat: number, gameId?: string | null): Color {
  return COLOR_ORDER[(colorOffset(gameId) + seat) % COLOR_ORDER.length]!;
}

/** The colors for a full table of `count`, in seat order. */
export function seatColors(count: number, gameId?: string | null): Color[] {
  const from = colorOffset(gameId);
  const rotated = COLOR_ORDER.map((_, i) => COLOR_ORDER[(from + i) % COLOR_ORDER.length]!);
  return count === 2 ? [rotated[0]!, rotated[2]!] : rotated.slice(0, count);
}
