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

import { json, LIMITS, rateLimited, rateOk, type SupabaseClient } from "./lib.ts";

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

// --- Registration ------------------------------------------------------------
//
// Both writes moved here in 0055. They key on the TOKEN — a device has one, and
// it must belong to exactly one account — while the RLS policies they replaced
// keyed on the OWNER, so neither could touch a row left behind by a previous
// account on the same install. The visible bug was a player turning
// notifications off and still getting them, and a device that had signed into a
// second account pushing to the first.
//
// The service role is what makes the token-keyed write possible, so the checks
// that RLS used to make have to be made explicitly here instead.

/** Platforms we accept a token for. Anything else is a client we don't ship. */
const PLATFORMS = new Set(["ios", "android"]);

/** Expo tokens look like `ExponentPushToken[...]` or `ExpoPushToken[...]`.
 *  Bounded and shape-checked because this value reaches Expo's API verbatim. */
const TOKEN_RE = /^Ex(?:ponent|po)PushToken\[[A-Za-z0-9_-]{1,128}\]$/;

/** Claim this device's push token for the calling account.
 *
 *  Conflict on the TOKEN, not the user: one device pushes to one account, so
 *  signing in as somebody else MOVES the row rather than leaving the previous
 *  account subscribed to this handset. */
export async function opPushRegister(
  admin: SupabaseClient,
  userId: string,
  token: string,
  platform: string,
): Promise<Response> {
  if (!(await rateOk(admin, userId, "push", LIMITS.push))) return rateLimited();
  if (!TOKEN_RE.test(token)) return json({ error: "That isn't a valid device token." });
  if (!PLATFORMS.has(platform)) return json({ error: "That isn't a valid platform." });

  const { error } = await admin
    .from("push_tokens")
    .upsert(
      { token, user_id: userId, platform, updated_at: new Date().toISOString() },
      { onConflict: "token" },
    );
  if (error) return json({ error: "Couldn't turn notifications on. Try again." });
  return json({ ok: true });
}

/** Drop this device's registration, whoever currently owns it.
 *
 *  Deliberately not scoped to the caller's own rows: the whole point is to clear
 *  a row a PREVIOUS identity on this install left behind, which is the case the
 *  policy could not express. Naming someone else's token would unregister their
 *  device — but anyone who knows a token can already push to that device
 *  directly through Expo, which is why push_tokens has no read path at all, so
 *  the knowledge is what leaks, not this op. */
export async function opPushDisable(
  admin: SupabaseClient,
  userId: string,
  token: string,
): Promise<Response> {
  if (!(await rateOk(admin, userId, "push", LIMITS.push))) return rateLimited();
  if (!TOKEN_RE.test(token)) return json({ error: "That isn't a valid device token." });

  const { error } = await admin.from("push_tokens").delete().eq("token", token);
  if (error) return json({ error: "Couldn't turn notifications off. Try again." });
  return json({ ok: true });
}
