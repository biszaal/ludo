/**
 * Deno tests for the derived die.
 *
 * The die stopped being a fresh crypto draw so that the server could tell a
 * player their number BEFORE they tap it, which is what removes the wait from
 * the online roll. That trade only holds if the derivation is as good as the
 * draw it replaced — these are the properties the rest of the design leans on:
 *
 *   stable    — the same roll always derives the same number, which is what
 *               makes prepareRoll's answer honest and a retry idempotent;
 *   separated — a different version, seat or game is a different number, so
 *               knowing one roll tells you nothing about another;
 *   unbiased  — all six faces equally likely, because these rolls settle coin
 *               stakes and a thumb on the scale here is unfixable after the
 *               fact. Tested structurally rather than statistically; the
 *               reduction-width test explains why that distinction matters.
 *
 *   npm run test:edge
 */

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// The key is read once per isolate, so it has to be in place before lib.ts is
// first imported — hence the dynamic import below rather than a static one.
Deno.env.set("DICE_SECRET", "test-secret-do-not-use-in-production");
const { deriveDie, dieFromDigest, rngForDie } = await import("./lib.ts");
const { rollDice } = await import("../_shared/engine/index.js");

const GAME = "11111111-2222-3333-4444-555555555555";
const SEAT = "p1";

// --- rngForDie: the bridge into the engine -----------------------------------

Deno.test("rngForDie yields exactly the die it was given", () => {
  for (let die = 1; die <= 6; die++) {
    // The engine's own rollDie: Math.floor(rng() * 6) + 1.
    assertEquals(Math.floor(rngForDie(die)() * 6) + 1, die, `die ${die}`);
  }
});

Deno.test("rngForDie stays inside [0, 1) for every face", () => {
  for (let die = 1; die <= 6; die++) {
    const r = rngForDie(die)();
    assert(r >= 0 && r < 1, `die ${die} produced ${r}`);
  }
});

// --- deriveDie ---------------------------------------------------------------

Deno.test("deriveDie is stable for the same roll", async () => {
  const a = await deriveDie(GAME, 7, SEAT);
  const b = await deriveDie(GAME, 7, SEAT);
  assertEquals(a, b);
  assert(a !== null && a >= 1 && a <= 6, `out of range: ${a}`);
});

Deno.test("deriveDie separates version, seat and game", async () => {
  // Not an equality assertion on any single pair — one collision in six is
  // ordinary. Across a spread, a derivation that ignored an input would show
  // up as one value repeated for every step of it.
  const byVersion = new Set<number | null>();
  const bySeat = new Set<number | null>();
  const byGame = new Set<number | null>();
  for (let i = 0; i < 12; i++) {
    byVersion.add(await deriveDie(GAME, i, SEAT));
    bySeat.add(await deriveDie(GAME, 7, `seat-${i}`));
    byGame.add(await deriveDie(`game-${i}`, 7, SEAT));
  }
  assert(byVersion.size > 1, "version does not affect the die");
  assert(bySeat.size > 1, "seat does not affect the die");
  assert(byGame.size > 1, "game does not affect the die");
});

Deno.test("deriveDie is unavailable without a secret rather than guessable", async () => {
  // The die must go dark when there is no key — callers fall back to cryptoRng
  // and clients to the slow tumble. What must NEVER happen is a value derived
  // from an empty or in-repo key, because that is a published function of
  // public inputs: anyone who can read the source would know every roll.
  const secret = Deno.env.get("DICE_SECRET")!;
  Deno.env.delete("DICE_SECRET");
  try {
    assertEquals(await deriveDie(GAME, 1, SEAT), null);
  } finally {
    Deno.env.set("DICE_SECRET", secret);
  }
  assertNotEquals(await deriveDie(GAME, 1, SEAT), null); // and it comes back
});

Deno.test("the secret actually keys the die", async () => {
  // Same coordinates, different key. If these agreed, the secret would be
  // decoration and the derivation a plain hash of three public strings.
  const original = Deno.env.get("DICE_SECRET")!;
  const mine: (number | null)[] = [];
  const theirs: (number | null)[] = [];
  for (let v = 0; v < 24; v++) mine.push(await deriveDie(GAME, v, SEAT));
  Deno.env.set("DICE_SECRET", "a-completely-different-secret");
  try {
    for (let v = 0; v < 24; v++) theirs.push(await deriveDie(GAME, v, SEAT));
  } finally {
    Deno.env.set("DICE_SECRET", original);
  }
  assertNotEquals(mine.join(""), theirs.join(""));
});

Deno.test("the reduction reads the whole width, not one byte", async () => {
  // The regression this exists for: reducing a SINGLE byte of the digest gives
  // faces 1-4 a ~1.6% relative excess. That skew is real money over a session
  // and yet is invisible to any distribution test of runnable length — 12k
  // rolls of it produce a chi-square indistinguishable from fair, and pinning
  // it statistically would take on the order of a million.
  //
  // So test the property instead of the symptom: a narrowed reduction stops
  // depending on the bytes it dropped. Hold byte 0 fixed, vary each later byte
  // in the window, and the face must still move.
  for (let i = 1; i < 8; i++) {
    const seen = new Set<number>();
    for (let b = 0; b < 256; b++) {
      const digest = new Uint8Array(32);
      digest[i] = b;
      seen.add(dieFromDigest(digest));
    }
    assert(seen.size > 1, `byte ${i} of the digest does not affect the die`);
  }
});

Deno.test("the reduction covers all six faces and nothing else", () => {
  const seen = new Set<number>();
  for (let b = 0; b < 256; b++) {
    const digest = new Uint8Array(32);
    digest[7] = b;
    const die = dieFromDigest(digest);
    assert(die >= 1 && die <= 6, `out of range: ${die}`);
    seen.add(die);
  }
  assertEquals([...seen].sort(), [1, 2, 3, 4, 5, 6]);
});

Deno.test("deriveDie shows no gross bias across the faces", async () => {
  // A coarse net, and deliberately labelled as one: it catches a reduction that
  // is outright broken (stuck low, mod 2, a constant), not the subtle width bug
  // above — that one belongs to the structural test, which can actually see it.
  const n = 12_000;
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (let v = 0; v < n; v++) counts[(await deriveDie(GAME, v, SEAT))!]++;

  const expected = n / 6;
  // Chi-square over 6 buckets, 5 d.o.f.; 20.515 is the 99.9% critical value, so
  // a fair die trips this about once in a thousand runs.
  const chi2 = counts.slice(1).reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
  assert(chi2 < 20.515, `chi-square ${chi2.toFixed(2)} over ${counts.slice(1).join("/")}`);
});

// --- the two together, as turn.ts uses them ----------------------------------

Deno.test("a derived die drives the engine to that same value", async () => {
  const state = {
    gameId: GAME,
    status: "active",
    phase: "awaiting-roll",
    currentTurnPlayerId: "p1",
    players: [
      { id: "p1", userId: "u1", color: "red", isBot: false },
      { id: "p2", userId: "u2", color: "green", isBot: false },
    ],
    tokens: [
      ...["r1", "r2", "r3", "r4"].map((id) => ({ id, color: "red", position: "home" })),
      ...["g1", "g2", "g3", "g4"].map((id) => ({ id, color: "green", position: "home" })),
    ],
    consecutiveSixes: 0,
    actions: [],
    // deno-lint-ignore no-explicit-any
  } as any;

  for (let v = 0; v < 30; v++) {
    const die = (await deriveDie(GAME, v, "p1"))!;
    assertEquals(rollDice(state, rngForDie(die)).diceValue, die, `v=${v}`);
  }
});

Deno.test("the same roll re-derived after a lost write gives the same number", async () => {
  // Why a retry cannot roll twice even before the action-id dedup catches it:
  // the coordinates have not moved, so neither has the answer.
  assertNotEquals(await deriveDie(GAME, 41, SEAT), null);
  assertEquals(await deriveDie(GAME, 41, SEAT), await deriveDie(GAME, 41, SEAT));
});
