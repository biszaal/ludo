/**
 * Capture-risk helpers for the smart policy. Pure functions over the engine's
 * board model, all in ABSOLUTE track space (captures only happen there — yard,
 * home columns and the finish are uncapturable by construction).
 *
 * The dice model is the standard single-die approximation: an opponent token
 * 1–6 cells behind a square hits it with probability 1/6 per roll, so the
 * chance at least one of several stalkers connects is 1 − (5/6)^n. Home-column
 * diverts en route are ignored — close enough for move ranking.
 *
 * Two shapes for every question. The plain functions (threatProb, captureProb)
 * take a state and answer about one square; the `*From` variants take a
 * {@link TrackIndex} built once for the whole position. They are the same
 * arithmetic — the difference is where the scan over tokens happens.
 *
 * That matters because evaluate.ts asks these questions at every leaf of the
 * search, once per token per player. Re-deriving "who is standing where" inside
 * each of those calls turned the contact math into the most expensive thing in
 * the search; building it once per position and reading it O(1) is what keeps
 * both the risk term and the hunt term affordable.
 */

import {
  absoluteTrackIndex,
  isSafeSquare,
  MAIN_TRACK_SIZE,
  type GameState,
  type TokenPosition,
} from "@ludo/engine";

/** Is `abs` a cell where the rules forbid capture? */
function safeCell(state: GameState, abs: number): boolean {
  return state.rules.safeSquares && isSafeSquare(abs);
}

/**
 * Where everybody is standing, in absolute track space.
 *
 * Parallel arrays rather than a Map: there are at most four players, so a
 * linear scan beats hashing, and this is allocated once per evaluated position
 * in the hot path. Duplicates are kept — a cell appearing twice in a player's
 * list IS a protected stack, which is how {@link stackedIn} reads them without
 * touching the token list again.
 */
export interface TrackIndex {
  ids: readonly string[];
  cells: readonly (readonly number[])[];
}

const NO_CELLS: readonly number[] = [];

/** Index every token that is actually on the shared track. */
export function buildTrackIndex(state: GameState): TrackIndex {
  const ids: string[] = [];
  const cells: number[][] = [];
  for (const t of state.tokens) {
    const abs = absoluteTrackIndex(t.position);
    if (abs === null) continue;
    let i = ids.indexOf(t.playerId);
    if (i < 0) {
      i = ids.length;
      ids.push(t.playerId);
      cells.push([]);
    }
    cells[i]!.push(abs);
  }
  return { ids, cells };
}

/**
 * This player's position in the index, or -1 if they have nothing on the track.
 *
 * Callers in the hot path resolve their slot ONCE and pass the number around,
 * which is the difference between one string lookup per evaluated position and
 * one per token per player per leaf.
 */
export function slotOf(index: TrackIndex, playerId: string): number {
  return index.ids.indexOf(playerId);
}

/** The cells at `slot`; empty for -1. */
export function cellsAt(index: TrackIndex, slot: number): readonly number[] {
  return slot < 0 ? NO_CELLS : index.cells[slot]!;
}

/**
 * Is `abs` immune? Two or more tokens sharing a cell guard each other, so the
 * square is as good as a star — neither a threat to model nor prey worth
 * chasing.
 *
 * Occupancy is counted across ALL players, matching the engine: the pile may
 * be one player's pair, that pair with an opponent stacked on top, or what is
 * left after such a pile decays to one token each from two players. Every one
 * of those is two deep, and none of them can be captured.
 */
function crowded(state: GameState, index: TrackIndex, abs: number): boolean {
  if (!state.rules.protectStacks) return false;
  let n = 0;
  for (const cells of index.cells) {
    for (const c of cells) {
      if (c === abs && ++n >= 2) return true;
    }
  }
  return false;
}

/** How many of `cells` are 1–6 behind `abs` — i.e. could land on it next roll. */
function stalkersIn(cells: readonly number[], abs: number): number {
  let n = 0;
  for (const c of cells) {
    const dist = (abs - c + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
    if (dist >= 1 && dist <= 6) n++;
  }
  return n;
}

/** 1 − (5/6)^n: the chance at least one of `n` stalkers connects. */
function hitChance(n: number): number {
  let missAll = 1;
  for (let i = 0; i < n; i++) missAll *= 5 / 6;
  return 1 - missAll;
}

/** Opponent track tokens of `playerId` (the only pieces that threaten or flee). */
function opponentTrackTokens(state: GameState, playerId: string): { abs: number; owner: string }[] {
  const out: { abs: number; owner: string }[] = [];
  for (const t of state.tokens) {
    if (t.playerId === playerId) continue;
    const abs = absoluteTrackIndex(t.position);
    if (abs !== null) out.push({ abs, owner: t.playerId });
  }
  return out;
}

/**
 * Probability that an opponent's next roll captures a token of `playerId`
 * sitting at `pos`. 0 off the shared track and on safe squares.
 */
export function threatProb(state: GameState, playerId: string, pos: TokenPosition): number {
  const index = buildTrackIndex(state);
  return threatProbFrom(state, index, slotOf(index, playerId), pos);
}

/** {@link threatProb} against a prebuilt index, for the owner at `ownerSlot`. */
export function threatProbFrom(
  state: GameState,
  index: TrackIndex,
  ownerSlot: number,
  pos: TokenPosition,
): number {
  const abs = absoluteTrackIndex(pos);
  if (abs === null) return 0;
  return threatProbAt(state, index, ownerSlot, abs);
}

/** {@link threatProb} with the owner's slot and absolute cell already known. */
export function threatProbAt(
  state: GameState,
  index: TrackIndex,
  ownerSlot: number,
  abs: number,
): number {
  if (safeCell(state, abs)) return 0;
  // Standing on a pile is as good as a star — nothing here can be captured.
  if (crowded(state, index, abs)) return 0;

  let stalkers = 0;
  for (let i = 0; i < index.cells.length; i++) {
    if (i === ownerSlot) continue;
    stalkers += stalkersIn(index.cells[i]!, abs);
  }
  return hitChance(stalkers);
}

/**
 * Capturable opponent tokens within one roll AHEAD of `pos` — prey a token
 * standing there could hunt next turn. Tokens parked on safe squares don't
 * count, and neither do stacked ones; both are untakeable.
 */
export function chaseCount(state: GameState, playerId: string, pos: TokenPosition): number {
  const abs = absoluteTrackIndex(pos);
  if (abs === null) return 0;
  let n = 0;
  const index = buildTrackIndex(state);
  for (const opp of opponentTrackTokens(state, playerId)) {
    const dist = (opp.abs - abs + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
    if (dist < 1 || dist > 6) continue;
    if (safeCell(state, opp.abs) || crowded(state, index, opp.abs)) continue;
    n++;
  }
  return n;
}

/**
 * Opponent track tokens within `range` cells BEHIND `pos` — traffic that must
 * file past this square soon. A token camped on a safe cell here sits in
 * ambush: the passers-by land in its capture range while it risks nothing.
 */
export function opponentsBehind(
  state: GameState,
  playerId: string,
  pos: TokenPosition,
  range: number,
): number {
  const abs = absoluteTrackIndex(pos);
  if (abs === null) return 0;
  let n = 0;
  for (const opp of opponentTrackTokens(state, playerId)) {
    const dist = (abs - opp.abs + MAIN_TRACK_SIZE) % MAIN_TRACK_SIZE;
    if (dist >= 1 && dist <= range) n++;
  }
  return n;
}

/**
 * Probability that `hunter`'s next roll captures whatever is standing at `pos`.
 * The exact mirror of {@link threatProb} — same single-die model, same
 * exemptions for safe cells and immune piles — read from the other side of the
 * board. Whose token it is does not enter into it: immunity is a property of
 * the cell, so only the hunter's shooters and the cell itself matter.
 *
 * threatProb answers "what am I about to lose"; this answers "what can I take".
 * A position evaluator needs both, and having only the first is what makes a
 * bot play like it is running a race with the other seats as scenery: it will
 * happily take a capture that falls into its lap, and will never once line one
 * up.
 */
export function captureProb(
  state: GameState,
  hunter: string,
  pos: TokenPosition,
): number {
  const index = buildTrackIndex(state);
  return captureProbFrom(state, index, slotOf(index, hunter), pos);
}

/**
 * {@link captureProb} against a prebuilt index.
 *
 * Checks run cheapest-first, and the range test comes before the exemptions on
 * purpose: most opponent tokens are nowhere near a shooter, so the common path
 * is a handful of subtractions and an early return. Only a token actually under
 * the gun pays for the safe-square and immunity lookups.
 */
export function captureProbFrom(
  state: GameState,
  index: TrackIndex,
  hunterSlot: number,
  pos: TokenPosition,
): number {
  const abs = absoluteTrackIndex(pos);
  if (abs === null) return 0;
  return captureProbAt(state, index, hunterSlot, abs);
}

/**
 * {@link captureProb} with everything already resolved: the hunter's slot and
 * the target cell.
 *
 * This is the innermost form, and the evaluator calls it once per token per
 * rival at every leaf — so it deliberately takes what the caller already has
 * rather than re-deriving it. The range test comes first for the same reason:
 * most tokens are nowhere near a shooter, so the common path is a handful of
 * subtractions and an early return, and only a token actually under the gun
 * pays for the safe-square and immunity checks.
 */
export function captureProbAt(
  state: GameState,
  index: TrackIndex,
  hunterSlot: number,
  abs: number,
): number {
  const stalkers = stalkersIn(cellsAt(index, hunterSlot), abs);
  if (stalkers === 0) return 0; // nothing in range — no need to ask why not
  if (safeCell(state, abs) || crowded(state, index, abs)) return 0;
  return hitChance(stalkers);
}
