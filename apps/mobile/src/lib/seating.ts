/**
 * Seat → color assignment by player count, shared by local and online play.
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
 * Mirrors seatColors/colorOffset in supabase/functions/game/lib.ts — the two
 * must agree or the lobby promises a seat the deal doesn't hand out.
 */

import type { Color as PlayerColor } from "@ludo/engine";

const FULL_ORDER: PlayerColor[] = ["red", "green", "yellow", "blue"];

export function colorOffset(gameId?: string | null): number {
  if (!gameId) return 0;
  const last = parseInt(gameId.replace(/[^0-9a-f]/gi, "").slice(-1), 16);
  return Number.isFinite(last) ? last % FULL_ORDER.length : 0;
}

export function seatColors(count: number, gameId?: string | null): PlayerColor[] {
  const from = colorOffset(gameId);
  const rotated = FULL_ORDER.map((_, i) => FULL_ORDER[(from + i) % FULL_ORDER.length]!);
  return count === 2 ? [rotated[0]!, rotated[2]!] : rotated.slice(0, count);
}
