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
 * How far AHEAD of the visible landing a sound must be asked for to be heard ON
 * it. The one dial for audio sync — raise it if sounds still lag the picture,
 * lower it if they now anticipate it.
 *
 * There is no API that plays a sound now. `playSound` returns once expo-audio's
 * `play()` has crossed to the Android main thread (it is `runBlocking` on that
 * queue, see lib/soundPool), and the clip is audible some way after that again,
 * once ExoPlayer has re-primed its audio track. Both parts are real and neither
 * is observable from JS, so the pipeline is treated as what it is — a fixed
 * delay — and everything that must land on a visual beat is issued that much
 * early.
 *
 * This only works because the delay is CONSTANT. It is the reason lib/sound
 * seeks before every play instead of keeping some players pre-rewound: a fast
 * path and a slow path would make the offset vary by play, and a varying offset
 * cannot be compensated by any single number. Uniformly slow beats sometimes
 * fast.
 *
 * 90ms is the starting estimate for a mid-range Android — roughly a frame for
 * the UI→JS hop, the rest audio-track startup. iOS is quicker, but 90ms of lead
 * against a ~40ms pipeline reads as "tight" rather than "early": an impact sound
 * a little ahead of the picture is the convention in games, an impact sound
 * behind it is the thing being fixed.
 */
export const SFX_LEAD_MS = 90;

/**
 * Segment durations for a move's sound clock — the run of timings whose
 * completion callbacks ask for the thocks.
 *
 * `cells` is how many landings sound: every cell of a forward hop, and exactly
 * one (the arrival) for a fly or a captured pawn's retrace. `firstLandingMs` is
 * when the first of them touches down, `everyMs` the cadence after that.
 *
 * Only the FIRST segment is shortened. That is the whole trick: it shifts the
 * entire train of callbacks SFX_LEAD_MS earlier while leaving the spacing
 * identical to the pawn's, so the sounds keep the rhythm of the hops instead of
 * drifting against them. Clamped at 0 for the case where the lead is longer than
 * the run-up — the sound is then as early as it can be, which is at once.
 */
export function cueDurations(cells: number, firstLandingMs: number, everyMs: number): number[] {
  return Array.from({ length: Math.max(cells, 0) }, (_, i) =>
    i === 0 ? Math.max(firstLandingMs - SFX_LEAD_MS, 0) : everyMs,
  );
}

/**
 * THE ROLL, AS ONE CONTINUOUS PHASE.
 *
 * The die's rotation is driven by a single scalar `phi`, counted in
 * REVOLUTIONS, and every axis is an integer multiple of it (X turns twice per
 * revolution, Y once). That one decision is what makes the whole thing work:
 * because the multipliers are integers, EVERY whole value of phi is the identity
 * rotation — the rolled face square to the camera. So the roll can stop at any
 * integer and be legible, and it never has to stop anywhere else.
 *
 * WHY IT REPLACED THE LAPS. The previous design ran fixed 700ms laps and simply
 * went round again when the answer had not arrived. It never stopped on a
 * placeholder, but each lap still eased out to a near-halt before speeding up,
 * so a slow connection visibly rolled the die twice — reported exactly that way,
 * and reliably on the first roll of a game, where the prefetch has not landed
 * yet and the slow path is guaranteed.
 *
 * WHY IT IS NOT THE DESIGN THAT WAS REVERTED. 09b0606 tore out an earlier
 * attempt at a long wait because it PARKED the tumble arc and carried the wait
 * on a second rotation: two sources feeding one die, and the speed jumped
 * wherever they met. Here there is one source. The wait and the landing are the
 * same phi, moving at the same speed across the join — see diceLandingMs, which
 * exists precisely to make that speed continuous.
 */

/** Whole turns each axis makes per revolution of `phi`. Integers, so that every
 *  whole phi is the identity rotation — see above. */
export const DICE_TURNS_X = 2;
export const DICE_TURNS_Y = 1;

/** Revolutions the landing arc covers at its shortest, and how long that takes.
 *  One revolution in 560ms is exactly the tumble the die has always played, so
 *  an answer already in hand — every offline roll — animates unchanged. */
export const DICE_LANDING_REVS = 1;
export const DICE_LANDING_MS = 560;

/**
 * How fast the die spins while it is waiting, in revolutions per millisecond.
 *
 * Not a free choice. A cubic ease-out leaves its start three times faster than
 * its average, so this is the speed the landing arc BEGINS at — which is what
 * lets the wait hand over to the landing with no step in speed at all. Change
 * the landing curve and this has to change with it.
 */
export const DICE_SPIN_REV_PER_MS = (3 * DICE_LANDING_REVS) / DICE_LANDING_MS;

/**
 * Where a roll should come to rest, given the phase it had reached when the
 * answer arrived.
 *
 * The next whole revolution, plus one more. Whole because only whole phi is the
 * identity rotation; plus one so there is always a full revolution of visible
 * deceleration rather than a snap, however unlucky the timing.
 */
export function diceLandingTarget(phi: number): number {
  return Math.ceil(phi) + DICE_LANDING_REVS;
}

/**
 * How long that landing takes, so it opens at exactly the speed the die was
 * already spinning.
 *
 * A cubic ease-out over distance d and duration D starts at 3d/D. Setting that
 * equal to the spin rate gives D = 3d/rate, which is all this is. The die
 * therefore never changes speed when the answer lands — it simply begins to
 * slow, which is the whole difference between one roll and two.
 */
export function diceLandingMs(phi: number): number {
  return (3 * (diceLandingTarget(phi) - phi)) / DICE_SPIN_REV_PER_MS;
}

/**
 * The landing arc, and the squash that ends it.
 *
 * Defined here rather than in Dice.tsx because this module is the timing
 * authority the sync path consults, and it has to stay importable from Node
 * (see __tests__/moveTiming.test.ts) — Dice.tsx pulls in Skia. Dice.tsx imports
 * these so the animation and the hold can never drift apart.
 */
export const DICE_SETTLE_MS = 140;

/**
 * A roll whose number is already in hand, start to finish.
 *
 * Every offline roll, and every online one whose die was prefetched. It is no
 * longer the length of ALL rolls: a roll still waiting on the server spins for
 * as long as that takes and then plays this landing, which is the whole point
 * of the phase design above.
 */
export const DICE_ROLL_MS = DICE_LANDING_MS + DICE_SETTLE_MS;

/**
 * How long the landed number stays on screen before anything else may move.
 *
 * Half a second, at the user's direction: a number you cannot finish reading
 * before the board moves under it may as well not have been shown. It is the
 * floor for the roller and, through ROLL_PACING_MS, for everyone watching.
 */
const DICE_READ_MS = 500;

/**
 * The whole screen budget one roll owns: the landing plus the beat to read it.
 *
 * `stateAnimationMs` charges this for a transition that carries a die, which is
 * how a WRITTEN roll gets paced. A folding table writes no roll at all — the die
 * arrives as a broadcast and the state behind it carries the roll and the move
 * together — so `rolled()` is false there and the folded state used to be
 * applied ROW_HOLD_PAD_MS (80ms) after the tumble started, cutting the whole
 * animation to nothing and starting the pawn's hop over the top of it. The
 * online store arms the same hold on a broadcast so both protocols pace a roll
 * identically.
 */
export const ROLL_PACING_MS = DICE_ROLL_MS + DICE_READ_MS;

/**
 * How long a roll may spin before it stops and admits it has nothing.
 *
 * Past the first turn-op attempt's budget (api.TURN_TIMEOUT_MS, 6s) so an
 * ordinary slow answer still lands normally rather than on this, and well short
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
export function stateAnimationMs(
  prev: GameState,
  next: GameState,
  broadcastRoll: number | null = null,
): number {
  if (prev.gameId !== next.gameId) return 0;
  // A busted third six moves no token, but the board still holds on the
  // roller's six before handing over. Without this the queue would consider the
  // transition instant and drop the next state on top of the hold.
  if (isBustHandoff(prev, next)) return BUST_HOLD_MS;
  const rollMs = rolled(prev, next) ? ROLL_PACING_MS : 0;
  /**
   * THE DIE HAND-OFF IS PART OF WHAT THIS TRANSITION OWNS, and leaving it out
   * was a bug with three faces.
   *
   * The board's own animation can be much shorter than the hold that keeps the
   * die at the seat that rolled it: a yard exit is FLY_MS, a short hop a couple
   * of steps, while the hold has a half-second floor. So the queue would release
   * the NEXT state — and with it the next player's roll — while the previous
   * player's die was still on screen at their corner.
   *
   * What that looked like: the bump landed on the die still mounted at the old
   * seat, so THAT die re-tumbled, showing the old number again; then the hold
   * expired, the die moved corners (which remounts it), and the new roll's bump
   * was swallowed by the mount, so the incoming number simply appeared without
   * rolling at all. Reported as turns being missed, animations not appearing,
   * and the die rolling twice — one seam, all three.
   *
   * Taking the max means the queue never hands over mid-hold: the die reaches
   * the new seat first, and the roll that follows finds it there.
   */
  return Math.max(rollMs + moverLegMs(prev, next), dieHandoverMs(prev, next, broadcastRoll));
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
 * Least time the number stays beside its roller when a roll leads straight to a
 * hand-off with nothing to animate — a roll with no legal move.
 *
 * The same half second DICE_READ_MS gives every other roll, and for the same
 * reason: this is the case where the number is about to be taken away, so it is
 * the one that most needs the beat.
 */
const DIE_HANDOVER_FLOOR_MS = 500;

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
