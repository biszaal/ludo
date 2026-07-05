/**
 * Final (or current) standings — a pure projection of GameState shared by the
 * Results overlay and stats recording. Ranked by tokens finished, then total
 * track progress; ties share the earlier rank (1224 style).
 */

import { toRelativeIndex, type Color, type GameState } from "@ludo/engine";

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

  rows.sort((a, b) => b.finished - a.finished || b.progress - a.progress);
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.rank = prev && prev.finished === row.finished && prev.progress === row.progress ? prev.rank : i + 1;
  });
  return rows;
}
