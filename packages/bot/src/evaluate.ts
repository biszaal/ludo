/**
 * Position evaluation: how good is a whole board for one player?
 *
 * The original policy scored MOVES directly — a bag of bonuses attached to a
 * single step. That cannot express "this position is better", which is what a
 * search needs to compare leaves. So the value lives here instead, as a
 * function of state, and search.ts drives it.
 *
 * Everything is expressed in PROGRESS POINTS: one point is roughly one cell of
 * forward travel, so a 100-point token is one that has gone all the way home.
 * Keeping every term on that scale is what makes the weights arguable rather
 * than magic — a risk of 0.6 on a 55-point runner costs ~33 points, and you can
 * check that against the ~15 points it would gain by diving for the home column.
 */

import {
  FINISH_REL_INDEX,
  TRACK_PATH_LENGTH,
  absoluteTrackIndex,
  toRelativeIndex,
  type GameState,
  type PlayerState,
} from "@ludo/engine";
import { buildTrackIndex, captureProbAt, cellsAt, slotOf, threatProbAt, type TrackIndex } from "./threat.js";

/**
 * Anchors of the progress curve. The SHAPE is the load-bearing part, not the
 * numbers: a linear curve makes every token equally worth advancing, which
 * collapses two things a competitive player does instinctively.
 *
 *   yard  0 ─────────────────────────────────────────────── the token is dead
 *   rel 0 10  ← stepping onto the board is worth about a six
 *         │   convex: the last cells of the lap are worth ~2.6x the first,
 *         │   so progress concentrates on the token nearest home instead of
 *         ▼   being smeared evenly across four exposed runners
 *  rel 51 70
 *   home  80 ← a jump, not a step: the column cannot be captured, so turning
 *    col  92   in converts a risky asset into a banked one
 *   done 105 ← another jump: permanent, and it pays a bonus roll
 */
const YARD_VALUE = 0;
const ENTRY_VALUE = 10;
const TRACK_TOP_VALUE = 70;
/** Split of the track's span between the linear and the squared term. */
const TRACK_LINEAR_SHARE = 0.55;
const HOME_PATH_BASE = 80;
const HOME_PATH_STEP = 3;
const FINISHED_VALUE = 105;

/**
 * Static worth of a token at relative index `rel` (null = still in the yard).
 * Monotonic in `rel` by construction, with deliberate jumps where the token's
 * legal status changes rather than merely its distance.
 */
export function tokenProgressValue(rel: number | null): number {
  if (rel === null) return YARD_VALUE;
  if (rel >= FINISH_REL_INDEX) return FINISHED_VALUE;
  if (rel >= TRACK_PATH_LENGTH) return HOME_PATH_BASE + (rel - TRACK_PATH_LENGTH) * HOME_PATH_STEP;
  const f = rel / TRACK_PATH_LENGTH;
  const span = TRACK_TOP_VALUE - ENTRY_VALUE;
  return ENTRY_VALUE + span * (TRACK_LINEAR_SHARE * f + (1 - TRACK_LINEAR_SHARE) * f * f);
}

/**
 * How heavily to price capture risk, as a multiple of the threatened token's
 * value. Below 1 because a captured token is not lost forever — it walks back
 * out of the yard — but high enough that a likely capture outweighs the
 * progress of the move that walked into it.
 */
const BASE_RISK = 0.55;
/** Risk weight floor/ceiling as the standing pushes the bot to gamble or protect. */
const RISK_MIN = 0.3;
const RISK_MAX = 0.85;

/** Each active token on the track is a live option; the first few matter most. */
const MOBILITY_PER_TOKEN = 3;
const MOBILITY_CAP = 3;

/**
 * How much a shot at an opponent's token is worth, as a multiple of the
 * expected damage (their token's value × the chance of connecting next roll).
 *
 * Without this term the evaluator is purely defensive about contact: it prices
 * what can be done TO its tokens (`exposure`) and says nothing about what its
 * tokens can do to anyone. A bot built that way takes captures that happen to
 * fall on its path and never sets one up — it races, and treats the other seats
 * as scenery. Hunting is half of how the game is actually played, so standing
 * behind a loaded opponent runner has to be worth something in itself.
 *
 * Deliberately below 1: a shot is not a kill, and a bot that overpays for
 * position behind prey stops running its own race. Note that pressure is also
 * priced a second time, from the other end — the victim's own `exposure` term
 * reads the same threat and lowers their strength, which raises ours through
 * the opponent weighting. That double count is intentional, not an oversight:
 * threatening is genuinely good for us and bad for them, and being seen from
 * both sides is what makes the bot commit to a hunt rather than drift near one.
 */
const HUNT_WEIGHT = 0.5;

/**
 * Weight on the strongest opponent versus the field. The `max` term is what
 * makes the bot hunt the leader without a special rule for it: anything that
 * knocks the front-runner back raises this score more than the same damage done
 * to a straggler. The `mean` term keeps it from tunnelling on one seat in a
 * four-player game. They sum to 1 so the scale matches a single opponent.
 */
const OPP_MAX_WEIGHT = 0.65;
const OPP_MEAN_WEIGHT = 0.35;

/** Terminal scores, far outside the range any live position can reach. */
const WIN_VALUE = 100_000;
const LOSS_VALUE = -100_000;

/** Is this seat still racing? Finished and departed players are not opposition. */
function inPlay(state: GameState, p: PlayerState): boolean {
  return !p.hasLeft && !(state.finishedOrder ?? []).includes(p.id);
}

/**
 * Raw strength of EVERY player's position, in seat order, before any
 * comparison: banked progress, minus what is hanging over it, plus what it is
 * hanging over other people, plus a little for having options.
 *
 * All seats in one pass over the tokens, rather than a per-player function
 * called four times. That is not tidiness — it is the only reason the hunt term
 * is affordable. Every token's progress value is the same number no matter who
 * is asking, and it costs a relative-index conversion to work out; computing it
 * once per token instead of once per token per player pays for the extra
 * contact question the hunt term asks. Threat and pressure are also the same
 * relationship read from opposite ends, so they belong in the same pass.
 */
function allStrengths(state: GameState, risk: number, index: TrackIndex): number[] {
  const n = state.players.length;
  const progress = new Array<number>(n).fill(0);
  const exposure = new Array<number>(n).fill(0);
  const pressure = new Array<number>(n).fill(0);
  const active = new Array<number>(n).fill(0);
  // Each seat's position in the track index, resolved once for the whole pass.
  const slots = new Array<number>(n);
  for (let i = 0; i < n; i++) slots[i] = slotOf(index, state.players[i]!.id);

  for (const t of state.tokens) {
    let owner = -1;
    for (let i = 0; i < n; i++) {
      if (state.players[i]!.id === t.playerId) {
        owner = i;
        break;
      }
    }
    if (owner < 0) continue; // a token with no seat — nothing to attribute it to

    const value = tokenProgressValue(toRelativeIndex(t.color, t.position));
    progress[owner]! += value;

    // Only tokens on the shared track can be taken, so everything below is
    // skipped for the yard, the home column and the finish. `abs` is carried
    // into the contact terms rather than re-derived by each of them.
    const abs = absoluteTrackIndex(t.position);
    if (abs === null) continue;
    active[owner]! += 1;

    // Defense: what the owner stands to lose here. threatProbFrom already
    // returns 0 on safe squares and protected stacks, so cover costs nothing to
    // model — it simply zeroes the term.
    exposure[owner]! += threatProbAt(state, index, slots[owner]!, abs) * value;

    // Offense, the same fact from the other side: for everyone else, this token
    // is prey, priced at what taking it would cost its owner. Without this the
    // evaluator only ever prices what can be done TO a player's tokens and
    // never what they can do to anyone — which is a bot that races and treats
    // the other seats as scenery.
    for (let h = 0; h < n; h++) {
      if (h === owner) continue;
      // A seat with nothing on the track cannot threaten anything, which in the
      // opening is most of them.
      if (cellsAt(index, slots[h]!).length === 0) continue;
      pressure[h]! += captureProbAt(state, index, slots[h]!, abs) * value;
    }
  }

  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] =
      progress[i]! -
      risk * exposure[i]! +
      HUNT_WEIGHT * pressure[i]! +
      Math.min(active[i]!, MOBILITY_CAP) * MOBILITY_PER_TOKEN;
  }
  return out;
}

/**
 * Risk appetite for `playerId` in this position, on the BASE_RISK scale.
 *
 * Behind → smaller weight → the bot accepts exposure it would otherwise avoid,
 * because a safe loss is still a loss (spec §8). Ahead → larger weight → it
 * protects the lead instead of pressing it. The input is the progress gap to
 * the best opponent, normalised by roughly one token's worth of travel.
 */
export function riskAppetite(state: GameState, playerId: string): number {
  let mine = 0;
  let best = 0;
  for (const p of state.players) {
    if (!inPlay(state, p) && p.id !== playerId) continue;
    let sum = 0;
    for (const t of state.tokens) {
      if (t.playerId !== p.id) continue;
      sum += tokenProgressValue(toRelativeIndex(t.color, t.position));
    }
    if (p.id === playerId) mine = sum;
    else if (sum > best) best = sum;
  }
  const lead = (mine - best) / 100; // one finished token's worth of gap
  return Math.max(RISK_MIN, Math.min(RISK_MAX, BASE_RISK * (1 + 0.5 * lead)));
}

/**
 * Value of `state` from `playerId`'s point of view: own strength measured
 * against the opposition, so the score answers "am I winning" rather than "how
 * far have I walked".
 *
 * Terminal states short-circuit to a value far outside the live range, so a
 * search never trades a win away for positional crumbs.
 */
export function evaluateFor(state: GameState, playerId: string, risk: number): number {
  if (state.status === "finished") {
    const order = state.finishedOrder ?? [];
    const place = order.indexOf(playerId);
    if (place === 0) return WIN_VALUE;
    // Placement still counts once the win is gone — 2nd beats last.
    return LOSS_VALUE + (place < 0 ? 0 : (order.length - place) * 1000);
  }

  // One index for the whole position: every strength term is a question about
  // who stands where, and this is the only place that has to work it out.
  const strengths = allStrengths(state, risk, buildTrackIndex(state));

  let mine = 0;
  let max = 0;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i]!;
    if (p.id === playerId) {
      mine = strengths[i]!;
      continue;
    }
    if (!inPlay(state, p)) continue;
    const s = strengths[i]!;
    if (s > max) max = s;
    sum += s;
    n++;
  }
  if (n === 0) return mine;

  return mine - (OPP_MAX_WEIGHT * max + OPP_MEAN_WEIGHT * (sum / n));
}
