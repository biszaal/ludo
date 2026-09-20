/**
 * Deno tests for when a table with bots in it is allowed to end itself.
 *
 * The rule has two halves and they pull against each other. A table where every
 * remaining seat is a bot must end — one ran in production for a day and a half
 * writing 5,567 move rows to nobody. But "every remaining seat is a bot" was
 * read off `inPlayPlayers`, which drops a player the moment they come home, and
 * that is the one player who most wants to stay: the winner.
 *
 * Observed on 2026-09-17, game a61653a7: a 4-handed quick match, one human and
 * three hidden bots. The human won at 14:36:28 and stayed to watch the bots
 * race for 2nd and 3rd. Their own client armed the turn-clock timeout, as every
 * client does, and fired it 17 seconds later to ask the server to keep the game
 * moving — and the server answered by walking the bots out and stamping the
 * game finished. The player watched their match get closed for lack of anybody
 * watching it.
 *
 * So these pin both halves, and the difference between them is presence, not
 * placement: is a human still AT this table, racing or not.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
// @deno-types="../_shared/engine/index.d.ts"
import { createGame, type GameState } from "../_shared/engine/index.js";
import { endIfNoHumansLeft } from "./finish.ts";
import type { SupabaseClient } from "./lib.ts";

const GAME = "a61653a7-8669-47a9-b45d-de8bb1924adf";
const HUMAN = "d45f2b97-a67f-4ace-92b1-395046938cdf";
const BOT_A = "5a809681-94a9-415c-9e43-7c5bfa03cfdf";
const BOT_B = "494b0dac-401d-4e4a-bed6-a0571c304a01";
const BOT_C = "8b8b5742-9951-4bdf-b78c-7d85c3d6464d";

/** A four-handed quick match: one human, three hidden bots. */
function table(): GameState {
  return createGame(
    [
      { id: "p1", userId: HUMAN, color: "blue" },
      { id: "p2", userId: BOT_A, color: "red" },
      { id: "p3", userId: BOT_B, color: "green" },
      { id: "p4", userId: BOT_C, color: "yellow" },
    ],
    { gameId: GAME },
  );
}

/**
 * The two tables endIfNoHumansLeft reads: which seats are bots, and which of
 * the rest still have somebody behind them.
 *
 * `connected` is the set of user ids whose `players` row says is_connected —
 * the flag the room already keeps, set by every action and cleared when an app
 * backgrounds or a player leaves.
 */
function fake(connected: Set<string>, opts: { presenceError?: boolean } = {}): SupabaseClient {
  // deno-lint-ignore no-explicit-any
  const chain = (settle: () => { data?: unknown; error?: unknown }): any => {
    // deno-lint-ignore no-explicit-any
    const node: any = {
      eq: () => node,
      in: (_col: string, vals: string[]) => {
        node.__ids = vals;
        return node;
      },
      select: () => node,
      // deno-lint-ignore no-explicit-any
      then: (res: any, rej: any) => Promise.resolve(settle()).then(res, rej),
    };
    return node;
  };

  return {
    from: (t: string) => {
      if (t === "game_bots") {
        return chain(() => ({
          data: [BOT_A, BOT_B, BOT_C].map((user_id) => ({ user_id })),
          error: null,
        }));
      }
      if (t === "players") {
        // deno-lint-ignore no-explicit-any
        const node: any = chain(() =>
          opts.presenceError
            ? { data: null, error: { message: "boom" } }
            : { data: (node.__ids ?? []).filter((id: string) => connected.has(id)).map((user_id: string) => ({ user_id })), error: null }
        );
        return node;
      }
      throw new Error(`unexpected table ${t}`);
    },
  } as unknown as SupabaseClient;
}

Deno.test("the winner staying to watch the bots finish keeps the table alive", async () => {
  const state = { ...table(), finishedOrder: ["p1"] };
  // Their app is in front of them — which is exactly what watching looks like.
  const ended = await endIfNoHumansLeft(fake(new Set([HUMAN])), GAME, state);
  assertEquals(ended, null);
});

Deno.test("the winner closing the app leaves a bot-only table, which ends", async () => {
  const state = { ...table(), finishedOrder: ["p1"] };
  const ended = await endIfNoHumansLeft(fake(new Set()), GAME, state);
  assertEquals(ended?.status, "finished");
  // Walking a bot out is a departure, not a finish, so only the last one
  // standing takes a place. The winner keeps theirs — the whole reason this
  // ends the game through leaveGame rather than stamping `finished` on it.
  assertEquals(ended?.finishedOrder, ["p1", "p4"]);
});

Deno.test("a human still racing keeps the table alive whatever presence says", async () => {
  const ended = await endIfNoHumansLeft(fake(new Set()), GAME, table());
  assertEquals(ended, null);
});

Deno.test("a human who left is not watching, however their presence row reads", async () => {
  const state = table();
  const left = {
    ...state,
    players: state.players.map((p) => (p.id === "p1" ? { ...p, hasLeft: true } : p)),
  };
  // is_connected is cleared on leave, but a stale `true` must not resurrect a
  // seat the engine has already removed from the game.
  const ended = await endIfNoHumansLeft(fake(new Set([HUMAN])), GAME, left);
  assertEquals(ended?.status, "finished");
});

Deno.test("an unreadable presence row keeps the table rather than ending it", async () => {
  const state = { ...table(), finishedOrder: ["p1"] };
  const ended = await endIfNoHumansLeft(fake(new Set(), { presenceError: true }), GAME, state);
  assertEquals(ended, null);
});
