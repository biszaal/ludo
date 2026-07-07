/**
 * Randomness is injected into the engine as an {@link Rng} so dice rolls stay a
 * pure function of their inputs: deterministic (seeded) in tests, `crypto`-backed
 * on the server, `Math.random` on the client.
 */
/**
 * mulberry32 — a tiny, fast, deterministic PRNG. Same seed ⇒ same sequence,
 * which makes full-game simulations reproducible in tests.
 */
export function createSeededRng(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Roll a single fair six-sided die (1..6) from an {@link Rng}. */
export function rollDie(rng) {
    return Math.floor(rng() * 6) + 1;
}
/** Default client-side randomness source. Late-binds `Math.random` so it can be
 *  seeded/stubbed in tests. */
export const mathRandomRng = () => Math.random();
//# sourceMappingURL=rng.js.map