/**
 * Seat → color assignment by player count, shared by local and online play.
 * Two players sit DIAGONALLY (red ↔ yellow) so they face each other across the
 * board; otherwise seats fill clockwise.
 */

import type { Color as PlayerColor } from "@ludo/engine";

export function seatColors(count: number): PlayerColor[] {
  if (count === 2) return ["red", "yellow"];
  return (["red", "green", "yellow", "blue"] as PlayerColor[]).slice(0, count);
}
