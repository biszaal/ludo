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
import { type GameState } from "@ludo/engine";
/**
 * Static worth of a token at relative index `rel` (null = still in the yard).
 * Monotonic in `rel` by construction, with deliberate jumps where the token's
 * legal status changes rather than merely its distance.
 */
export declare function tokenProgressValue(rel: number | null): number;
/**
 * Risk appetite for `playerId` in this position, on the BASE_RISK scale.
 *
 * Behind → smaller weight → the bot accepts exposure it would otherwise avoid,
 * because a safe loss is still a loss (spec §8). Ahead → larger weight → it
 * protects the lead instead of pressing it. The input is the progress gap to
 * the best opponent, normalised by roughly one token's worth of travel.
 */
export declare function riskAppetite(state: GameState, playerId: string): number;
/**
 * Value of `state` from `playerId`'s point of view: own strength measured
 * against the opposition, so the score answers "am I winning" rather than "how
 * far have I walked".
 *
 * Terminal states short-circuit to a value far outside the live range, so a
 * search never trades a win away for positional crumbs.
 */
export declare function evaluateFor(state: GameState, playerId: string, risk: number): number;
//# sourceMappingURL=evaluate.d.ts.map