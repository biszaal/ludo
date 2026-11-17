/**
 * Final (or current) standings — a pure projection of GameState shared by the
 * Results overlay and stats recording. Players in `finishedOrder` rank by that
 * order (the game plays to completion, so finishing earlier IS the placement);
 * everyone still racing ranks below them by tokens finished, then track
 * progress; ties share the earlier rank (1224 style).
 */

import { TOKENS_PER_PLAYER, toRelativeIndex, type Color, type GameState } from "@ludo/engine";

export type Variant = "classic" | "blitz" | "frenzy";
/** The modes a server can run. Frenzy is vs AI only. */
export type OnlineMode = Exclude<Variant, "frenzy">;

/** What an online setup sheet may offer, given the server's `modes.blitzOnline`. */
export function onlineModes(blitzOnline: boolean): OnlineMode[] {
  return blitzOnline ? ["classic", "blitz"] : ["classic"];
}

/** Which mode a game is, read off the state itself (it carries its own rules). */
export function variantOf(state: GameState): Variant {
  if (state.frenzy) return "frenzy";
  return state.rules.tokensToWin === 1 ? "blitz" : "classic";
}

/** Tokens a seat must bring home to place: all four, or one in Blitz. */
export function tokensToWin(state: GameState): number {
  return state.rules.tokensToWin ?? TOKENS_PER_PLAYER;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th". */
export function ordinal(n: number): string {
  return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

export interface Standing {
  playerId: string;
  color: Color;
  /** Tokens that reached the center (0–4). */
  finished: number;
  /**
   * Relative path progress (yard = 0): the sum over every token, or in Blitz
   * the lead token's alone — only the first one home counts there.
   */
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

  const leadOnly = tokensToWin(state) < TOKENS_PER_PLAYER;
  const rows = state.players.map((p) => {
    let finished = 0;
    let progress = 0;
    for (const t of state.tokens) {
      if (t.playerId !== p.id) continue;
      if (t.position === "finished") finished += 1;
      const rel = toRelativeIndex(t.color, t.position) ?? 0;
      progress = leadOnly ? Math.max(progress, rel) : progress + rel;
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
