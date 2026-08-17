/**
 * In-room chat, stamped by the server.
 *
 * Chat used to be pure peer-to-peer broadcast: the client put its own
 * `fromUserId` in the payload and every other client believed it. Realtime
 * relays broadcast without inspecting it, and RLS cannot help — the write
 * check on realtime.messages runs for the first message on a connection and is
 * then cached for the rest of it, so a policy comparing the payload to
 * auth.uid() would pass once and wave everything after it through. Anyone at
 * the table could speak under another player's name, and the bubble would pop
 * beside that player's avatar wearing their handle.
 *
 * So the identity comes from the JWT instead, here, where it is verified.
 * 0037 leaves clients with SELECT on realtime.messages and no INSERT, which
 * means the only sender left on the topic is the service role — this file.
 * A `fromUserId` in the request body is ignored, not rejected: it costs a
 * branch to reject and tells a prober which field mattered.
 *
 * Errors follow the file convention: HTTP 200 with an { error } body.
 */

import { json, LIMITS, rateLimited, rateOk, type SupabaseClient } from "./lib.ts";

/** Longest message we relay. Mirrors CHAT_MAX_LEN in the app's src/lib/chat.ts;
 *  the client caps its input, this is the cap that actually holds. */
export const CHAT_MAX_LEN = 80;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ChatRequest {
  gameId: unknown;
  kind: unknown;
  value: unknown;
}

/**
 * Clamp one message to something safe to render, or null if nothing survives.
 *
 * Whitespace runs collapse to a single space: the transcript row in ChatSheet
 * has no line cap, so newlines are a way to shove other players' messages off
 * screen. Length is cut after collapsing, so padding can't buy extra room.
 */
export function sanitizeChatValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LEN);
  return clean.length > 0 ? clean : null;
}

/** Relay one message to the room's topic as the service role (bypasses the
 *  0037 policies, which is the point — no other sender can reach this topic). */
async function broadcast(gameId: string, payload: Record<string, unknown>): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ topic: `game:${gameId}`, event: "chat", payload, private: true }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send a reaction or a short message to a room you hold a seat in.
 *
 * The seat lookup is the authorization: 0037 lets any participant JOIN the
 * topic (they must, to receive), so "can reach the channel" is not "may speak
 * in it" — a spectator who kept an old game id would otherwise be able to post.
 */
export async function opChat(admin: SupabaseClient, userId: string, req: ChatRequest): Promise<Response> {
  const gameId = String(req.gameId ?? "");
  if (!UUID_RE.test(gameId)) return json({ error: "That isn't a valid room." });

  const kind = req.kind;
  if (kind !== "reaction" && kind !== "text") return json({ error: "That isn't a valid message." });

  const value = sanitizeChatValue(req.value);
  if (value === null) return json({ error: "That isn't a valid message." });

  if (!(await rateOk(admin, userId, "chat", LIMITS.chat))) return rateLimited();

  const { data: seat } = await admin
    .from("players")
    .select("id")
    .eq("game_id", gameId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!seat) return json({ error: "You're not in that room." });

  // fromUserId is set HERE, from the verified JWT — never read from the body.
  const ok = await broadcast(gameId, { kind, value, fromUserId: userId });
  if (!ok) return json({ error: "Message didn't send. Try again." });

  return json({ ok: true });
}
