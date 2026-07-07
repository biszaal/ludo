/**
 * Randomness is injected into the engine as an {@link Rng} so dice rolls stay a
 * pure function of their inputs: deterministic (seeded) in tests, `crypto`-backed
 * on the server, `Math.random` on the client.
 */
/** Returns a float in [0, 1), like `Math.random`. */
export type Rng = () => number;
/**
 * mulberry32 — a tiny, fast, deterministic PRNG. Same seed ⇒ same sequence,
 * which makes full-game simulations reproducible in tests.
 */
export declare function createSeededRng(seed: number): Rng;
/** Roll a single fair six-sided die (1..6) from an {@link Rng}. */
export declare function rollDie(rng: Rng): number;
/** Default client-side randomness source. Late-binds `Math.random` so it can be
 *  seeded/stubbed in tests. */
export declare const mathRandomRng: Rng;
//# sourceMappingURL=rng.d.ts.map