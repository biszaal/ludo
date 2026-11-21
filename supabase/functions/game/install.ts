/**
 * Install source and device check (0084): the edge side.
 *
 *   * opInstallSource: the app sends the Play install referrer once, on its
 *     first launch. Only the utm fields and a friend code are kept; a friend
 *     code that belongs to another player records a referral (source 'link').
 *   * opDeviceSeen: the app sends a device ID once per account. Only a salted
 *     SHA-256 of it reaches the database, and it is read by one rule only: a
 *     referral on a phone that already earned a referral payout pays nothing.
 *
 * Both are write-once in SQL, so a retry or a replay changes nothing.
 */

import { json, LIMITS, rateLimited, rateOk, type SupabaseClient } from "./lib.ts";

const FRIEND_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export interface Referrer {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  friendCode?: string;
}

/** The fields we keep from a Play install referrer (a query string). Never throws. */
export function parseReferrer(raw: string): Referrer {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return {};
  }
  const out: Referrer = {};
  const field = (name: string) => {
    const v = (params.get(name) ?? "").trim().slice(0, 200);
    return v === "" ? undefined : v;
  };
  const source = field("utm_source");
  const medium = field("utm_medium");
  const campaign = field("utm_campaign");
  const friend = (params.get("friend") ?? "").trim().toUpperCase();
  if (source) out.utmSource = source;
  if (medium) out.utmMedium = medium;
  if (campaign) out.utmCampaign = campaign;
  if (FRIEND_CODE.test(friend)) out.friendCode = friend;
  return out;
}

/** What the database stores for a device: SHA-256 hex of a salted ID. */
export async function deviceHash(id: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ludo-device:${id}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function opInstallSource(
  admin: SupabaseClient,
  userId: string,
  platform: string,
  referrer: string,
): Promise<Response> {
  if (platform !== "android" && platform !== "ios") return json({ error: "Unknown platform." });
  if (referrer.length > 500) return json({ error: "Referrer too long." });
  if (!(await rateOk(admin, userId, "installSource", LIMITS.installSource))) return rateLimited();

  const r = parseReferrer(referrer);
  const { data, error } = await admin.rpc("install_source_record", {
    p_user: userId,
    p_platform: platform,
    p_referrer: referrer === "" ? null : referrer,
    p_utm_source: r.utmSource ?? null,
    p_utm_medium: r.utmMedium ?? null,
    p_utm_campaign: r.utmCampaign ?? null,
    p_friend_code: r.friendCode ?? null,
  });
  if (error || !data) return json({ error: "Could not record install." });
  return json(data);
}

export async function opDeviceSeen(admin: SupabaseClient, userId: string, deviceId: string): Promise<Response> {
  if (deviceId.length < 8 || deviceId.length > 128) return json({ error: "Bad device." });
  if (!(await rateOk(admin, userId, "deviceSeen", LIMITS.deviceSeen))) return rateLimited();

  const { error } = await admin.rpc("device_record", { p_user: userId, p_hash: await deviceHash(deviceId) });
  if (error) return json({ error: "Could not record device." });
  return json({ ok: true });
}
