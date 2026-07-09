/**
 * Final (or current) standings — a pure projection of GameState shared by the
 * Results overlay and stats recording. Players in `finishedOrder` rank by that
 * order (the game plays to completion, so finishing earlier IS the placement);
 * everyone still racing ranks below them by tokens finished, then total track
 * progress; ties share the earlier rank (1224 style).
 */

import { toRelativeIndex, type Color, type GameState } from "@ludo/engine";

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th". */
export function ordinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

export interface Standing {
  playerId: string;
  color: Color;
  /** Tokens that reached the center (0–4). */
  finished: number;
  /** Sum of every token's relative path progress (yard = 0). */
  progress: number;
  /** 1-based rank; ties share a rank. */
  rank: number;
}

export function computeStandings(state: GameState): Standing[] {
  const order = state.finishedOrder ?? [];
  const placeOf = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i; // placed players first, in order
  };

  const rows = state.players.map((p) => {
    let finished = 0;
    let progress = 0;
    for (const t of state.tokens) {
      if (t.playerId !== p.id) continue;
      if (t.position === "finished") finished += 1;
      progress += toRelativeIndex(t.color, t.position) ?? 0;
    }
    return { playerId: p.id, color: p.color, finished, progress, rank: 0 };
  });

  rows.sort(
    (a, b) =>
      placeOf(a.playerId) - placeOf(b.playerId) || b.finished - a.finished || b.progress - a.progress,
  );
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const tied =
      prev &&
      placeOf(prev.playerId) === placeOf(row.playerId) &&
      prev.finished === row.finished &&
      prev.progress === row.progress;
    row.rank = tied ? prev.rank : i + 1;
  });
  return rows;
}
