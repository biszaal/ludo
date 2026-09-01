/**
 * How long a state transition takes to play out on the Board.
 *
 * feedback.ts uses this so landing sounds (capture, safe chime, finish) fire
 * when the pawn visibly arrives, and onlineStore uses it to pace bunched
 * realtime updates — a laggy connection that delivers several writes at once
 * must still show each move rather than collapsing them into one jump.
 *
 * The durations are derived from render/waypoints.ts — the same function the
 * Board actually animates — rather than re-deriving them here. This used to be
 * a hand-kept mirror, and a mirror that drifts under-reports the animation,
 * which lets the next queued state land mid-hop and cut the move short.
 */

import type { Color, GameState, TokenPosition } from "@ludo/engine";
import { positionKey, walkDurationMs } from "../render/waypoints";
import { BUST_HOLD_MS, isBustHandoff } from "./projection";

export { FLY_MS, HOP_STEP_MS } from "../render/waypoints";

/**
 * How long the die tumble owns the screen: the animation itself plus a beat to
 * read the face it lands on.
 *
 * Defined here rather than in Dice.tsx because this module is the timing
 * authority the sync path consults, and it has to stay importable from Node
 * (see __tests__/moveTiming.test.ts) — Dice.tsx pulls in Skia. Dice.tsx imports
 * this constant so the animation and the hold can never drift apart.
 */
export const DICE_ROLL_MS = 700;
/** Beat after the die lands before the pawn is allowed to move. */
const DICE_READ_MS = 200;

/**
 * The whole screen budget one roll owns: the tumble plus the beat to read it.
 *
 * `stateAnimationMs` charges this for a transition that carries a die, which is
 * how a WRITTEN roll gets paced. A folding table writes no roll at all — the die
 * arrives as a broadcast and the state behind it carries the roll and the move
 * together — so `rolled()` is false there and the folded state used to be
 * applied ROW_HOLD_PAD_MS (80ms) after the tumble started, cutting a 700ms
 * animation to nothing and starting the pawn's hop over the top of it. The
 * online store arms the same hold on a broadcast so both protocols pace a roll
 * identically.
 */
export const ROLL_PACING_MS = DICE_ROLL_MS + DICE_READ_MS;

/** Fraction of a roll spent tumbling; the rest is the landing squash. */
export const DICE_CUBE_END = 0.8;
/** One lap of the cube: the tumble alone, without the squash that ends a roll. */
export const DICE_TUMBLE_MS = Math.round(DICE_ROLL_MS * DICE_CUBE_END);

/**
 * The tail of a lap in which the camera face is readable.
 *
 * The tumble eases out, so it has spent ~95% of its rotation by this point and
 * whatever is on the front face is what the player takes the roll to be.
 */
export const DICE_FACE_LOCK_MS = 200;

/**
 * How long a roll may keep looping before it stops and admits it has nothing.
 *
 * Past the first turn-op attempt's budget (api.TURN_TIMEOUT_MS, 6s) so an
 * ordinary slow answer still lands on a lap rather than on this, and well short
 * of the turn clock so a die whose roll is never coming back stops instead of
 * spinning at the player indefinitely. A die that spins forever reads as a
 * frozen app; one that stops with no number reads as what it is, and the store
 * surfaces the connection error alongside it.
 *
 * Landing here is not the end of it: if the number turns up afterwards the die
 * rolls again to receive it, so it is never painted onto a resting face.
 */
export const DICE_MAX_ROLL_MS = 9_000;

/**
 * At the end of a lap: does the die stop here, or go round again?
 *
 * The die tumbles in fixed laps and finishes on one of them, so this is the
 * only decision the roll animation actually makes — and getting it wrong is
 * visible either way. Land too eagerly and the number appears on a face the
 * player has already read, which is the die changing its mind. Never land and
 * it spins forever over a roll that was answered long ago.
 *
 * Landing requires the value to have been known for the whole readable part of
 * this lap, which is why `seenAt` is a timestamp rather than a boolean: a value
 * that arrived two frames ago has not been on the face long enough to be the
 * one the player watched the die settle onto.
 *
 * Pure and clock-injected; Dice.tsx supplies the times. Kept here rather than
 * in the component because this module is the timing authority for the die and
 * has to stay importable from Node — Dice.tsx pulls in Skia.
 */
export function diceLandsThisLap(input: {
  /** When a value first arrived for this roll, or null while still unknown. */
  seenAt: number | null;
  /** Is a value on screen RIGHT NOW? Belt to seenAt's braces: seenAt is a ref
   *  the component latches, and a die must never keep spinning over a number it
   *  is already holding just because the latch missed it. */
  haveValue: boolean;
  /** When the lap now ending began. */
  lapStartedAt: number;
  /** When the whole roll began, for the giving-up cap. */
  rollStartedAt: number;
  now: number;
}): boolean {
  const { seenAt, haveValue, lapStartedAt, rollStartedAt, now } = input;
  // Out of patience: stop, whether or not there is a number to stop on.
  if (now - rollStartedAt >= DICE_MAX_ROLL_MS) return true;
  if (!haveValue) return false;
  // Known, but not known WHEN — treat it as having just landed and give it a
  // lap to sit on the face before the die is allowed to stop on it.
  if (seenAt === null) return false;
  return seenAt <= lapStartedAt + DICE_TUMBLE_MS - DICE_FACE_LOCK_MS;
}

/**
 * The number of the roll that is on screen but not yet explained by a state.
 *
 * `useDieHandover` keeps one of these so the die hand-off can still read an
 * opponent's number, and the rule lives here — pure and Node-testable — because
 * getting it wrong is invisible until someone watches a real game.
 *
 * WHAT GOES WRONG WITHOUT IT. On a folding table the store publishes an
 * opponent's die from a broadcast and then, when the state carrying the roll AND
 * the move arrives, sets `lastRoll` back to null in the SAME setState — because
 * applyMove has already cleared `diceValue`, and null is what the projection
 * honestly says. Both halves land in one render, so anything that merely
 * MIRRORED `lastRoll` was null by the time the hand-off asked for it: the hold
 * never fired for an opponent, which is the one case it exists for. The die
 * jumped to the next seat mid-hop and painted the awaiting-roll swirl, so an
 * opponent's roll was never readable at all.
 *
 * So this latches instead of mirroring. `seq` is the store's `rollSeq` — its own
 * "a roll began" signal — and a number is adopted for as long as that seq holds.
 * A null is the store forgetting, not the roll being cancelled, and is ignored.
 *
 * SPENDING is the caller's job and is not optional: the latch must be cleared by
 * the first state transition after the roll, or a number outlives its own roll
 * and turns up beside a seat that never rolled it (a player who leaves without
 * rolling would inherit the previous roller's die).
 */
export interface RollLatch {
  /** The `rollSeq` this number belongs to. */
  seq: number;
  /** The number, or null while the roll has none yet — or once it is spent. */
  value: number | null;
}

/** Fold a render's `(rollSeq, lastRoll)` into the latch. Returns the SAME object
 *  when nothing changed, so the caller can hold it in a ref without churn. */
export function latchRoll(latch: RollLatch, rollSeq: number, lastRoll: number | null): RollLatch {
  // A new roll: whatever was latched belonged to the last one. Seeded from
  // lastRoll because our own prepared roll publishes both in one go.
  if (latch.seq !== rollSeq) return { seq: rollSeq, value: lastRoll };
  if (lastRoll === null) return latch;
  return latch.value === lastRoll ? latch : { seq: rollSeq, value: lastRoll };
}

/** A die to keep at its roller's corner: whose it is, what it reads, how long. */
export interface DieHold {
  playerId: string;
  value: number;
  ms: number;
}

/**
 * The whole hand-off decision for one state transition, in one place.
 *
 * `useDieHandover` is then only refs and a timer, and everything that decides
 * what the player actually sees is testable in Node — which matters because
 * every bug this has had was a case nobody could see from the component: a
 * number that was null at the one moment it was read, or one that outlived its
 * own roll.
 *
 * `rolled` is the caller's latched number (see `latchRoll`), and it is SPENT by
 * this call whether or not a hold comes of it. That is the caller's contract and
 * it is not optional: a transition that is not held is still the transition that
 * resolved the roll, and a number carried past it turns up beside a seat that
 * never rolled it — a player who leaves without rolling would inherit the
 * previous roller's die.
 */
export function dieHoldFor(prev: GameState, next: GameState, rolled: number | null): DieHold | null {
  const ms = dieHandoverMs(prev, next, rolled);
  if (ms <= 0) return null;
  // On a folding table the number is only ever in the latch — `prev.diceValue`
  // is null there — so the fallback is the NORMAL path for an opponent's roll,
  // not a safety net. (Unreachable when ms > 0, since dieHandoverMs needs one of
  // the two to be set, but a total function is worth more than the saved line.)
  const value = prev.diceValue ?? rolled;
  if (value == null) return null;
  return { playerId: prev.currentTurnPlayerId, value, ms };
}

/** Did `prev -> next` include a new roll landing on the board? */
function rolled(prev: GameState, next: GameState): boolean {
  return next.diceValue != null && prev.diceValue !== next.diceValue;
}

/** How long the Board animates a token from `was` to `now`. */
export function moveDurationMs(color: Color, was: TokenPosition, now: TokenPosition): number {
  return walkDurationMs(color, was, now);
}

/**
 * How long the Board animates `prev -> next` overall: the die tumble if this
 * transition rolled, then the slowest mover, plus a captured token's retrace
 * home (the Board holds that back until the capturing mover lands, so the two
 * are sequential, not concurrent).
 *
 * The roll leg matters more than it looks. A roll moves no token, so this used
 * to return 0 for one and the row queue held the next state for ROW_HOLD_PAD_MS
 * alone — 80ms against a 700ms tumble. On a connection that delivered the roll
 * and the move together, an opponent's pawn started hopping before their die
 * had visibly landed, and since the die only renders beside the active seat,
 * the number was gone before anyone could read it.
 */
export function stateAnimationMs(prev: GameState, next: GameState): number {
  if (prev.gameId !== next.gameId) return 0;
  // A busted third six moves no token, but the board still holds on the
  // roller's six before handing over. Without this the queue would consider the
  // transition instant and drop the next state on top of the hold.
  if (isBustHandoff(prev, next)) return BUST_HOLD_MS;
  const rollMs = rolled(prev, next) ? ROLL_PACING_MS : 0;
  return rollMs + moverLegMs(prev, next);
}

/**
 * How long the board spends animating pawns across `prev -> next`: the slowest
 * mover, plus a captured token's retrace home (the Board holds that back until
 * the capturing mover lands, so the two are sequential, not concurrent).
 *
 * Split out of stateAnimationMs because the die hand-off needs this leg WITHOUT
 * the roll: by the time a pawn is moving, the tumble has already been watched.
 */
function moverLegMs(prev: GameState, next: GameState): number {
  const prevPos = new Map(prev.tokens.map((t) => [t.id, t.position]));
  let moverMs = 0;
  let captureMs = 0;
  for (const t of next.tokens) {
    const was = prevPos.get(t.id);
    if (was === undefined || positionKey(was) === positionKey(t.position)) continue;
    if (t.position === "home") captureMs = Math.max(captureMs, walkDurationMs(t.color, was, t.position));
    else moverMs = Math.max(moverMs, walkDurationMs(t.color, was, t.position));
  }
  return moverMs + captureMs;
}

/**
 * Least time the number stays on screen when a roll leads straight to a
 * hand-off with nothing to animate — a roll with no legal move.
 *
 * Long enough to read a single digit that is about to be taken away, and short
 * enough that a table of players who all roll badly does not crawl.
 */
const DIE_HANDOVER_FLOOR_MS = 450;

/**
 * How long the die stays beside the player who rolled it, once the turn has
 * moved on.
 *
 * A move that ends a turn arrives as one state — token moved, `diceValue`
 * cleared by applyMove, `currentTurnPlayerId` already the next player — and the
 * die renders beside whichever seat is current. So it jumped to the next player
 * on the frame that state applied, while the pawn it explained was still
 * hopping. The number itself survives in the store's `lastRoll`; what was lost
 * was WHOSE it was and the chance to read it at all.
 *
 * The hold is the mover's own animation, taken from the same waypoints the
 * Board hops to, so the die is still in place as the pawn lands and has moved
 * on before the next player is asked to roll. Zero means hand over at once:
 * nothing was rolled, the roller kept the turn (a six — the die never left), or
 * this is not the same game.
 *
 * `broadcastRoll` is the number the store is holding in `lastRoll`, and it is
 * what makes this work on a FOLDING table at all. There, a roll is broadcast
 * and never written: the state that follows carries the roll and the move
 * together, so applyMove has already cleared diceValue and `prev` is the state
 * from before the roll, with no die on it. Keying the hold on `prev.diceValue`
 * alone therefore missed every opponent hand-off — precisely the case the hold
 * exists for — and the die jumped away mid-hop with the number never shown.
 */
export function dieHandoverMs(prev: GameState, next: GameState, broadcastRoll: number | null = null): number {
  if (prev.gameId !== next.gameId) return 0;
  // The turn is still the roller's — a six, or a move that granted another
  // roll. The die is already where it belongs.
  if (prev.currentTurnPlayerId === next.currentTurnPlayerId) return 0;
  // Nothing was rolled into this hand-off (a timeout, a seat leaving), so there
  // is no number on the face worth keeping there. Either source counts.
  if (prev.diceValue == null && broadcastRoll == null) return 0;
  // A bust is already held by BUST_HOLD_MS in applyState, which keeps the whole
  // previous state — die included — on screen. Holding again would double it.
  if (isBustHandoff(prev, next)) return 0;
  return Math.max(moverLegMs(prev, next), DIE_HANDOVER_FLOOR_MS);
}
