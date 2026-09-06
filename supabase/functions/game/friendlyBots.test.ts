/**
 * Deno tests for the wall between a labelled friend-room bot and a hidden
 * quick-match one (0062).
 *
 * The leak these pin: a friend-room fill-in used to draw from the SAME identity
 * pool as quick match and show its name and face next to a BOT tag, so a player
 * who filled one room learned a real opponent name for later. And it chatted,
 * which taught them what a bot sounds like too.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { maybeBotChat, seatBots, type BotSeats } from "./bots.ts";
import type { SupabaseClient } from "./lib.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, type GameState } from "../_shared/engine/index.js";

const GAME = "77777777-7777-7777-7777-777777777777";
const POOLED = "88888888-8888-8888-8888-888888888888";

interface Calls {
  rpcs: string[];
  players: Array<Record<string, unknown>>;
  gameBots: Array<Record<string, unknown>>;
  profiles: Array<Record<string, unknown>>;
}

/** An admin client that hands out one pooled identity and records the writes. */
function fakeAdmin(): { admin: SupabaseClient; calls: Calls } {
  const calls: Calls = { rpcs: [], players: [], gameBots: [], profiles: [] };
  const ok = { data: null, error: null };
  // deno-lint-ignore no-explicit-any
  const admin: any = {
    rpc: (name: string) => {
      calls.rpcs.push(name);
      return Promise.resolve({ data: POOLED, error: null });
    },
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table === "players") calls.players.push(row);
        if (table === "game_bots") calls.gameBots.push(row);
        if (table === "profiles") calls.profiles.push(row);
        return Promise.resolve(ok);
      },
      update: () => ({ eq: () => ({ eq: () => Promise.resolve(ok) }) }),
    }),
  };
  return { admin: admin as SupabaseClient, calls };
}

Deno.test("a friend-room fill draws from the visible pool, never the hidden one", async () => {
  const { admin, calls } = fakeAdmin();
  await seatBots(admin, GAME, [1], ["red", "green", "yellow", "blue"], true);
  assertEquals(calls.rpcs, ["claim_visible_bot_identity"]);
});

Deno.test("a quick-match fill still draws from the hidden pool", async () => {
  const { admin, calls } = fakeAdmin();
  await seatBots(admin, GAME, [1], ["red", "green", "yellow", "blue"], false);
  assertEquals(calls.rpcs, ["claim_bot_identity"]);
});

Deno.test("a labelled seat is tagged and mute; a hidden one is neither", async () => {
  const friendly = fakeAdmin();
  await seatBots(friendly.admin, GAME, [1], ["red", "green", "yellow", "blue"], true);
  assertEquals(friendly.calls.players[0]!.is_bot, true);
  assertEquals(friendly.calls.gameBots[0]!.can_chat, false);

  const quick = fakeAdmin();
  await seatBots(quick.admin, GAME, [1], ["red", "green", "yellow", "blue"], false);
  assertEquals(quick.calls.players[0]!.is_bot, false);
  assertEquals(quick.calls.gameBots[0]!.can_chat, true);
});

Deno.test("reusing a pooled identity never mints a profile — the disguise is minted, not reused", async () => {
  // Both pools claim rather than create here, so neither writes a profile. The
  // point of the assertion is the MINT path is the only place a name is chosen;
  // a claim of either kind touches nothing about identity.
  const { admin, calls } = fakeAdmin();
  await seatBots(admin, GAME, [1, 3], ["red", "green", "yellow", "blue"], true);
  assertEquals(calls.profiles.length, 0);
  assertEquals(calls.players.length, 2);
});


/** A uuid whose personality hash lands on "talkative" — the loudest seat there
 *  is, so a run that stays silent stayed silent by rule, not by luck. */
const TALKATIVE = "99999999-9999-9999-9999-999999999991";
const TALKATIVE_B = "99999999-9999-9999-9999-99999999999c";

/** A freshly dealt table: lastAction is createGame, which classifies as the
 *  "gameStart" moment — the one every seat at the table may answer. */
function dealtGame(): GameState {
  return createGame(
    [
      { id: "p1", userId: TALKATIVE, color: "red" },
      { id: "p2", userId: TALKATIVE_B, color: "yellow" },
    ],
    { gameId: GAME },
  );
}

function chatSeats(canChat: boolean): BotSeats {
  return new Map([
    [TALKATIVE, { chatCount: 0, lastChatAtMs: null, canChat }],
    [TALKATIVE_B, { chatCount: 0, lastChatAtMs: null, canChat }],
  ]);
}

/** Count the broadcasts a run sends. Chat is the only thing maybeBotChat can
 *  put on the wire, so a count of zero is proof of silence. */
async function countingSends(run: () => Promise<void>): Promise<number> {
  const original = globalThis.fetch;
  let sends = 0;
  globalThis.fetch = ((_url: string | URL | Request, _init?: RequestInit) => {
    sends++;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return sends;
}

Deno.test({
  name: "a labelled friend-room table never speaks, however loud its seats would be",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { admin } = fakeAdmin();
    const state = dealtGame();
    const seats = chatSeats(false);
    const sends = await countingSends(async () => {
      // Two talkative seats answering a game start 200 times over. With the
      // mute flag off this is a near-certain chorus; with it on it must be
      // exactly nothing, and nothing is cheap — the gate returns before the
      // reaction beat, so this loop does not sleep.
      for (let i = 0; i < 200; i++) await maybeBotChat(admin, GAME, seats, null, state, {});
    });
    assertEquals(sends, 0);
  },
});

Deno.test({
  name: "the same table with hidden seats does speak — the gate is the flag, not the wiring",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { admin } = fakeAdmin();
    const state = dealtGame();
    const seats = chatSeats(true);
    const sends = await countingSends(async () => {
      // Stops at the first word: the per-game cap and the 25s cooldown are the
      // dials this test is not about, and one send is all the wiring claim needs.
      for (let i = 0; i < 200; i++) {
        await maybeBotChat(admin, GAME, seats, null, state, {});
        if ([...seats.values()].some((m) => m.chatCount > 0)) return;
      }
    });
    assertEquals(sends > 0, true);
  },
});
