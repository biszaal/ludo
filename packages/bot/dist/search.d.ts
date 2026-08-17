/**
 * Expectimax over the dice.
 *
 * The old policy answered "which move looks best right now". This answers the
 * question a competitive player actually asks: "which move leaves me best off
 * AFTER the other seats have rolled and replied as well as they can".
 *
 * Shape of one candidate:
 *
 *     my move ──▶ resulting state
 *                   ├─ game over                  → terminal value
 *                   ├─ I earned a bonus turn      → average over MY next 6 rolls
 *                   └─ someone else to act        → average over THEIR next 6
 *                                                    rolls, each answered with
 *                                                    their own best reply
 *                                                        └─ recurse to `depth`
 *
 * Chance nodes fan out by six (the die); decision nodes do NOT fan out. At each
 * one the actor's single best reply is picked by static evaluation and only
 * that line is followed. Branching therefore stays 6^depth instead of 18^depth,
 * which is what makes depth 2 affordable at all. It is the usual
 * principal-variation approximation: wrong when the best-looking reply is not
 * the best reply, cheap enough to buy two extra plies with the savings.
 *
 * Bonus turns are followed rather than flattened into a constant, so chaining a
 * six or a capture into another roll is valued by what the extra roll can
 * actually reach.
 *
 * Cost at a 4-player midgame on V8 is ~162µs per decision at depth 1 and ~948µs
 * at depth 2 — see __tests__/searchBudget.test.ts, which fails if that
 * regresses far enough to matter against the edge runtime's 200ms soft CPU
 * limit.
 */
import { type GameState, type Move } from "@ludo/engine";
export interface ScoredMove {
    move: Move;
    score: number;
    /** State the move produces, kept so a caller can extend the search further. */
    after: GameState;
}
/**
 * Score every candidate move by searching `depth` plies past it. Returns them
 * in the order given, each with the state it produced.
 */
export declare function scoreMoves(state: GameState, playerId: string, moves: Move[], risk: number, depth: number): ScoredMove[];
//# sourceMappingURL=search.d.ts.map