/**
 * Deno tests for server-stamped chat.
 *
 * The whole point of moving chat onto the server is that `fromUserId` stops
 * being something the sender can choose. These tests pin that: the identity on
 * the wire comes from the verified JWT, and a client that puts someone else's
 * id in the body gets its own id broadcast anyway.
 *
 *   npm run test:edge
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CHAT_MAX_LEN, opChat, sanitizeChatValue } from "./chat.ts";
import type { SupabaseClient } from "./lib.ts";

const GAME = "11111111-2222-3333-4444-555555555555";
const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER = "bbbbbbbb-0000-0000-0000-000000000002";

/** Stub client: `seated` decides whether the players lookup finds a row. */
function stubClient(seated: boolean): SupabaseClient {
  return {
    rpc: () => Promise.resolve({ data: true, error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: seated ? { id: "seat" } : null, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

/** Capture the broadcast POST instead of hitting the network. */
function captureFetch(): { calls: Array<{ url: string; body: unknown }>; restore: () => void } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) });
    return Promise.resolve(new Response("{}", { status: 202 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const body = async (res: Response) => (await res.json()) as { ok?: boolean; error?: string };

// --- sanitizeChatValue -------------------------------------------------------

Deno.test("sanitizeChatValue caps length at the advertised maximum", () => {
  assertEquals(sanitizeChatValue("x".repeat(500))?.length, CHAT_MAX_LEN);
});

Deno.test("sanitizeChatValue collapses whitespace runs to a single space", () => {
  assertEquals(sanitizeChatValue("a\n\n\n\tb"), "a b");
});

Deno.test("sanitizeChatValue rejects empty, blank and non-string input", () => {
  assertEquals(sanitizeChatValue(""), null);
  assertEquals(sanitizeChatValue("   \n "), null);
  assertEquals(sanitizeChatValue(42), null);
  assertEquals(sanitizeChatValue(null), null);
});

// --- opChat ------------------------------------------------------------------

Deno.test("opChat broadcasts the JWT identity, not the one in the request body", async () => {
  const net = captureFetch();
  try {
    const res = await opChat(stubClient(true), ME, {
      gameId: GAME,
      kind: "text",
      value: "Nice move!",
      // A malicious client trying to speak as another player.
      fromUserId: OTHER,
    });

    assertEquals((await body(res)).ok, true);
    assertEquals(net.calls.length, 1);

    const sent = net.calls[0]!.body as { messages: Array<{ topic: string; payload: Record<string, unknown> }> };
    assertEquals(sent.messages[0]!.topic, `game:${GAME}`);
    assertEquals(sent.messages[0]!.payload.fromUserId, ME);
    assertEquals(sent.messages[0]!.payload.value, "Nice move!");
  } finally {
    net.restore();
  }
});

Deno.test("opChat refuses a caller who holds no seat in the game", async () => {
  const net = captureFetch();
  try {
    const res = await opChat(stubClient(false), ME, { gameId: GAME, kind: "text", value: "hi" });
    assertEquals((await body(res)).ok, undefined);
    assertEquals(net.calls.length, 0, "must not broadcast for a non-participant");
  } finally {
    net.restore();
  }
});

Deno.test("opChat rejects an unknown kind", async () => {
  const net = captureFetch();
  try {
    const res = await opChat(stubClient(true), ME, { gameId: GAME, kind: "system", value: "You win" });
    assertEquals((await body(res)).ok, undefined);
    assertEquals(net.calls.length, 0);
  } finally {
    net.restore();
  }
});

Deno.test("opChat rejects a malformed game id before touching the database", async () => {
  const net = captureFetch();
  try {
    const res = await opChat(stubClient(true), ME, { gameId: "not-a-uuid", kind: "text", value: "hi" });
    assertEquals((await body(res)).ok, undefined);
    assertEquals(net.calls.length, 0);
  } finally {
    net.restore();
  }
});

Deno.test("opChat rejects a blank message", async () => {
  const net = captureFetch();
  try {
    const res = await opChat(stubClient(true), ME, { gameId: GAME, kind: "text", value: "   " });
    assertEquals((await body(res)).ok, undefined);
    assertEquals(net.calls.length, 0);
  } finally {
    net.restore();
  }
});
