/**
 * Sending push notifications through Expo's push service.
 *
 * No credentials live here: APNs keys and the FCM service account are held by
 * EAS, and Expo's endpoint authenticates the MESSAGE by the token it is
 * addressed to. That is also why push_tokens (0029) has no select policy —
 * anyone holding a token can push to that device.
 *
 * Every call is best-effort and must never fail the op that triggered it. A
 * player whose invite lands but whose notification doesn't is mildly
 * inconvenienced; one whose invite fails BECAUSE Expo was slow has lost the
 * actual feature. Callers fire-and-forget via afterResponse.
 */

import type { SupabaseClient } from "./lib.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts up to 100 messages per request. */
const BATCH = 100;

export interface PushMessage {
  title: string;
  body: string;
  /** Routed by the client's response listener (e.g. { type, roomCode }). */
  data?: Record<string, unknown>;
}

interface ExpoTicket {
  status?: string;
  details?: { error?: string };
}

/**
 * Push to every device belonging to these users.
 *
 * Tokens Expo reports as DeviceNotRegistered are deleted: they are permanently
 * dead (app uninstalled, notifications revoked), and keeping them means every
 * future send carries a growing tail of garbage.
 */
export async function sendPush(
  admin: SupabaseClient,
  userIds: string[],
  message: PushMessage,
): Promise<void> {
  if (userIds.length === 0) return;

  const { data: rows } = await admin
    .from("push_tokens")
    .select("token")
    .in("user_id", userIds);

  const tokens = (rows ?? []).map((r) => r.token as string).filter(Boolean);
  if (tokens.length === 0) return;

  for (let i = 0; i < tokens.length; i += BATCH) {
    const slice = tokens.slice(i, i + BATCH);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(
          slice.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data ?? {},
            sound: "default",
            channelId: "default",
          })),
        ),
      });
      if (!res.ok) continue;

      // Tickets come back positionally, so index i of the response is token i.
      const payload = (await res.json()) as { data?: ExpoTicket[] };
      const dead: string[] = [];
      (payload.data ?? []).forEach((ticket, idx) => {
        if (ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          const token = slice[idx];
          if (token) dead.push(token);
        }
      });
      if (dead.length > 0) await admin.from("push_tokens").delete().in("token", dead);
    } catch (e) {
      // Network trouble reaching Expo. Nothing to retry against — the in-app
      // realtime path still delivers to anyone with the app open.
      console.warn("[push.send]", e instanceof Error ? e.message : e);
    }
  }
}

/** A player's display name, for notification copy. Falls back rather than
 *  leaking a raw uuid into a lock screen. */
export async function displayNameOf(admin: SupabaseClient, userId: string): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.display_name as string | undefined) ?? "A friend";
}
