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

import { json, LIMITS, rateLimited, rateOk, safeError, UNIQUE_VIOLATION, type SupabaseClient } from "./lib.ts";
import { maskProfanity } from "./moderation.ts";

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
 *
 * Blocked terms are masked last, on the clamped string, so a word split across
 * the length cut cannot survive by being half a token. Masking rather than
 * refusing: see moderation.ts for why. This is the filter half of the
 * user-generated-content obligation; the report and block halves are
 * opReportPlayer and the client's mute list.
 */
export function sanitizeChatValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LEN);
  return clean.length > 0 ? maskProfanity(clean) : null;
}

/**
 * Relay one message to a room's topic as the service role (bypasses the 0037
 * policies, which is the point — no other sender can reach this topic).
 *
 * Generalised over the event so the turn path can deliver a die the same way:
 * that the service role is the ONLY possible sender here is exactly what makes
 * a received payload trustworthy, and a die is worth no less trust than a
 * chat bubble.
 */
export async function broadcastToRoom(
  gameId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
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
        messages: [{ topic: `game:${gameId}`, event, payload, private: true }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Chat's own sender, unchanged in behavior. */
function broadcast(gameId: string, payload: Record<string, unknown>): Promise<boolean> {
  return broadcastToRoom(gameId, "chat", payload);
}

/**
 * Send as a seat the server itself controls (bots.ts).
 *
 * Deliberately not routed through opChat: there is no JWT to stamp an identity
 * from, and LIMITS.chat is a per-human abuse budget that a hidden seat should
 * neither consume nor be throttled by — its own cooldown and per-game cap are
 * the limit. The value is still sanitized, because the render path downstream
 * is the same one human messages reach.
 */
export async function relayChat(
  gameId: string,
  fromUserId: string,
  kind: "reaction" | "text",
  value: string,
): Promise<boolean> {
  const clean = sanitizeChatValue(value);
  if (clean === null) return false;
  return await broadcast(gameId, { kind, value: clean, fromUserId });
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

// --- Reporting ---------------------------------------------------------------

/** Longest snippet we keep with a report. Matches the column's check. */
const REPORT_MESSAGE_MAX = 200;

const REPORT_REASONS = new Set(["chat", "conduct", "name"]);

/**
 * Report a player, and block them in the same action.
 *
 * The two are one gesture on purpose. Someone who has just been abused in a
 * game wants it to stop first and be dealt with second, and a Report button
 * that files a ticket while leaving the person talking is the version people
 * rightly complain about. So the block is what the caller feels immediately;
 * the report is what a human reads later (0056).
 *
 * Neither half is allowed to fail the other: the block is the part that matters
 * to the person pressing it, so a duplicate report — they pressed it twice, or
 * already reported this player in this game — still returns ok.
 *
 * Deliberately NOT gated on sharing a game. Reporting someone should not
 * require still being in the room with them, and a report about a display name
 * has no room at all.
 */
export async function opReportPlayer(
  admin: SupabaseClient,
  userId: string,
  req: { userId: unknown; gameId: unknown; message: unknown; reason: unknown },
): Promise<Response> {
  if (!(await rateOk(admin, userId, "report", LIMITS.report))) return rateLimited();

  const reported = String(req.userId ?? "");
  if (!UUID_RE.test(reported)) return json({ error: "That isn't a player we know." });
  if (reported === userId) return json({ error: "You can't report yourself." });

  const gameId = typeof req.gameId === "string" && UUID_RE.test(req.gameId) ? req.gameId : null;
  const reason = REPORT_REASONS.has(String(req.reason)) ? String(req.reason) : "chat";
  // Already sanitized on the way in; clamped again because this row is written
  // from whatever the client sends, not from the message we relayed.
  const message = typeof req.message === "string"
    ? req.message.replace(/\s+/g, " ").trim().slice(0, REPORT_MESSAGE_MAX) || null
    : null;

  // Block first — this is the half the caller is waiting on.
  const { error: blockErr } = await admin
    .from("blocks")
    .insert({ blocker_user_id: userId, blocked_user_id: reported });
  // A duplicate means they were already blocked, which is the desired end state.
  if (blockErr && blockErr.code !== UNIQUE_VIOLATION) {
    return safeError("chat.report.block", blockErr, "Couldn't block that player. Try again.");
  }

  // The report is bookkeeping for a human queue; a duplicate is one complaint.
  const { error: reportErr } = await admin
    .from("player_reports")
    .insert({
      reporter_user_id: userId,
      reported_user_id: reported,
      game_id: gameId,
      message,
      reason,
    });
  if (reportErr && reportErr.code !== UNIQUE_VIOLATION) {
    // Logged, not surfaced: they are blocked, which is what they asked for.
    console.error("[chat.report]", reportErr.message);
  }

  return json({ ok: true, blocked: reported });
}

/**
 * The user_ids this player has blocked.
 *
 * Read through the function rather than the table so one round trip serves the
 * whole mute list at game entry. `blocks` is self-readable over RLS, so this is
 * convenience rather than access — but the client needs it before the first
 * message arrives, and bundling it here keeps that a single call.
 */
export async function opBlockedList(admin: SupabaseClient, userId: string): Promise<Response> {
  const { data } = await admin
    .from("blocks")
    .select("blocked_user_id")
    .eq("blocker_user_id", userId);
  return json({ userIds: (data ?? []).map((r) => String(r.blocked_user_id)) });
}
