/**
 * Deno tests for what a hidden seat says and how often.
 *
 * Two things matter here. First, attribution: a bot must react to the right
 * moment as the right player, and the mover is read off the moved token's
 * colour rather than whoever holds the turn afterwards — get that wrong and a
 * bot celebrates being captured. Second, restraint: the cap and the cooldown
 * are hard stops, and no personality talks past them.
 *
 *   npm run test:edge
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// @deno-types="../_shared/engine/index.d.ts"
import type { GameState } from "../_shared/engine/index.js";
import {
  CHAT_COOLDOWN_MS,
  classifyEvent,
  composeMessage,
  EMOJI_IDS,
  personalityFor,
  QUICK_MESSAGES,
  shouldSpeak,
  VOICES,
  type BotEvent,
} from "./botChat.ts";

const BOT = "bbbbbbbb-0000-0000-0000-000000000001";
const HUMAN = "hhhhhhhh-0000-0000-0000-000000000002";
const BOTS = new Set([BOT]);

/** Minimal state: red is the human, green is the bot. `turn` is whose it is. */
function state(turn: "red" | "green", over = false): GameState {
  return {
    gameId: "g",
    status: over ? "finished" : "active",
    players: [
      { id: "p-red", userId: HUMAN, color: "red", isConnected: true },
      { id: "p-green", userId: BOT, color: "green", isConnected: true },
    ],
    currentTurnPlayerId: turn === "red" ? "p-red" : "p-green",
    phase: "awaiting-roll",
    lastAction: null,
  } as unknown as GameState;
}

function withAction(s: GameState, type: string, payload: unknown): GameState {
  return { ...s, lastAction: { type, payload, timestamp: 0 } } as unknown as GameState;
}

const always = () => 0;
const never = () => 0.999999;

Deno.test("a bot reacts to being captured, as the victim", () => {
  // Red (human) moved and sent green-1 home. The turn is red's (bonus roll).
  const next = withAction(state("red"), "move", { tokenId: "red-0", to: { type: "track", index: 9 }, captures: ["green-1"] });
  assertEquals(classifyEvent(null, next, BOTS), { event: "botCaptured", speakerUserId: BOT });
});

Deno.test("a bot reacts to its own capture, as the captor", () => {
  const next = withAction(state("green"), "move", { tokenId: "green-2", to: { type: "track", index: 4 }, captures: ["red-3"] });
  assertEquals(classifyEvent(null, next, BOTS), { event: "botCaptures", speakerUserId: BOT });
});

Deno.test("attribution follows the token colour, not whoever holds the turn", () => {
  // The bot captured and the turn has ALREADY handed back to red. Reading
  // currentTurnPlayerId here would blame the human for the bot's capture.
  const next = withAction(state("red"), "move", { tokenId: "green-2", to: { type: "track", index: 4 }, captures: ["red-3"] });
  const moment = classifyEvent(null, next, BOTS);
  assertEquals(moment?.event, "botCaptures");
  assertEquals(moment?.speakerUserId, BOT);
});

Deno.test("two humans colliding is a bystander moment nobody owns", () => {
  const s = state("red");
  const threeWay = {
    ...s,
    players: [
      ...s.players,
      { id: "p-blue", userId: "cccccccc-0000-0000-0000-000000000003", color: "blue", isConnected: true },
    ],
  } as unknown as GameState;
  const next = withAction(threeWay, "move", { tokenId: "red-0", to: { type: "track", index: 9 }, captures: ["blue-1"] });
  assertEquals(classifyEvent(null, next, BOTS), { event: "humansClash", speakerUserId: null });
});

Deno.test("a bot getting a token home is worth a word", () => {
  const next = withAction(state("green"), "move", { tokenId: "green-0", to: "finished", captures: [] });
  assertEquals(classifyEvent(null, next, BOTS), { event: "botFinishedToken", speakerUserId: BOT });
});

Deno.test("an ordinary move is not an event", () => {
  const next = withAction(state("green"), "move", { tokenId: "green-0", to: { type: "track", index: 7 }, captures: [] });
  assertEquals(classifyEvent(null, next, BOTS), null);
});

Deno.test("a six belongs to the roller, who is still on turn", () => {
  const next = withAction(state("green"), "roll", { dice: 6, busted: false });
  assertEquals(classifyEvent(null, next, BOTS), { event: "botSix", speakerUserId: BOT });
});

Deno.test("a human's six is nobody's moment", () => {
  const next = withAction(state("red"), "roll", { dice: 6, busted: false });
  assertEquals(classifyEvent(null, next, BOTS), null);
});

Deno.test("a busted three-six is attributed from prev, since the turn moved on", () => {
  const prev = state("green");
  const next = withAction(state("red"), "roll", { dice: 6, busted: true });
  assertEquals(classifyEvent(prev, next, BOTS), { event: "botBusted", speakerUserId: BOT });
  // Without prev there is nothing left to read the roller off, so we stay quiet
  // rather than guess and blame the wrong seat.
  assertEquals(classifyEvent(null, next, BOTS), null);
});

Deno.test("a finished game outranks the move that finished it", () => {
  const next = withAction(state("green", true), "move", { tokenId: "green-0", to: "finished", captures: [] });
  assertEquals(classifyEvent(null, next, BOTS), { event: "gameOver", speakerUserId: null });
});

Deno.test("the stall hint is what produces a hurry-up", () => {
  const next = withAction(state("red"), "roll", { dice: 3, busted: false });
  assertEquals(classifyEvent(null, next, BOTS, { stalled: true }), { event: "humanStalled", speakerUserId: null });
});

Deno.test("a table with no bots never speaks", () => {
  const next = withAction(state("green"), "move", { tokenId: "green-2", to: { type: "track", index: 4 }, captures: ["red-3"] });
  assertEquals(classifyEvent(null, next, new Set<string>()), null);
});

Deno.test("the per-game cap holds even when every roll says yes", () => {
  // quiet caps at 2, average at 4, talkative at 7.
  assertEquals(shouldSpeak("quiet", "botCaptured", 2, null, 0, always), false);
  assertEquals(shouldSpeak("average", "botCaptured", 4, null, 0, always), false);
  assertEquals(shouldSpeak("talkative", "botCaptured", 7, null, 0, always), false);
  assertEquals(shouldSpeak("talkative", "botCaptured", 6, null, 0, always), true);
});

Deno.test("the cooldown holds even when every roll says yes", () => {
  const now = 1_000_000;
  assertEquals(shouldSpeak("talkative", "botCaptured", 0, now - 1_000, now, always), false);
  assertEquals(shouldSpeak("talkative", "botCaptured", 0, now - CHAT_COOLDOWN_MS, now, always), true);
});

Deno.test("an unlucky roll stays silent whatever the personality", () => {
  assertEquals(shouldSpeak("talkative", "botCaptured", 0, null, 0, never), false);
});

Deno.test("quiet bots are measurably quieter than talkative ones", () => {
  const trials = 4000;
  const rate = (p: "talkative" | "average" | "quiet") => {
    let spoke = 0;
    let seed = 12345;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    // No cap, no cooldown — this measures the dial alone.
    for (let i = 0; i < trials; i++) if (shouldSpeak(p, "botCaptured", 0, null, 0, rng)) spoke++;
    return spoke / trials;
  };
  const talkative = rate("talkative");
  const average = rate("average");
  const quiet = rate("quiet");
  assert(talkative > average, `${talkative} should exceed ${average}`);
  assert(average > quiet, `${average} should exceed ${quiet}`);
  // The subtle dial: even the chattiest seat stays under half the events.
  assert(talkative < 0.5, `talkative ${talkative} should stay under half`);
});

Deno.test("a common moment is weighted below a dramatic one", () => {
  assert(VOICES.botSix.weight < VOICES.botCaptured.weight);
  assert(VOICES.humansClash.weight < VOICES.botCaptures.weight);
});

Deno.test("personality is stable for an identity and spread across the pool", () => {
  assertEquals(personalityFor(BOT), personalityFor(BOT));

  const counts: Record<string, number> = { talkative: 0, average: 0, quiet: 0 };
  for (let i = 0; i < 3000; i++) counts[personalityFor(crypto.randomUUID())]++;
  for (const kind of ["talkative", "average", "quiet"]) {
    assert(counts[kind]! > 300, `${kind} got only ${counts[kind]} of 3000`);
  }
  // The middle bucket is the widest by design.
  assert(counts.average! > counts.quiet!);
  assert(counts.average! > counts.talkative!);
});

Deno.test("a bot can only say things a human could have tapped", () => {
  for (const [event, voice] of Object.entries(VOICES)) {
    assert(voice.emoji.length > 0, `${event} has no reaction to fall back on`);
    for (const text of voice.text) {
      assert(
        (QUICK_MESSAGES as readonly string[]).includes(text),
        `"${text}" (${event}) is not a quick-message chip`,
      );
    }
    for (const id of voice.emoji) {
      assert((EMOJI_IDS as readonly string[]).includes(id), `"${id}" (${event}) is not a reaction sprite`);
    }
  }
});

Deno.test("composed messages stay inside the two registries", () => {
  const events = Object.keys(VOICES) as BotEvent[];
  let seed = 99;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (const event of events) {
    for (let i = 0; i < 200; i++) {
      const { kind, value } = composeMessage(event, rng);
      const pool = kind === "text" ? (QUICK_MESSAGES as readonly string[]) : (EMOJI_IDS as readonly string[]);
      assert(pool.includes(value), `${event} produced ${kind} "${value}"`);
    }
  }
});
