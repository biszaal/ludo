/**
 * Country flags (0083): record where a player is playing from.
 *
 * Cloudflare puts the caller's country on every request (`cf-ipcountry`), so
 * no IP database and no stored IP is needed: only the two-letter code reaches
 * the database, and profile_set_country fills it once, never for a bot, and
 * never after the player hid their flag. Gated to once per user every 5
 * minutes per isolate, so the request path pays nothing after the first time.
 */

import { createTouchGate, type SupabaseClient } from "./lib.ts";

/** The caller's ISO country code, or null for missing, unknown (XX), Tor (T1) or malformed values. */
export function countryFromHeaders(h: Headers): string | null {
  const code = (h.get("cf-ipcountry") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  return code;
}

/** Fill this player's country if it is still empty. Never throws. */
export async function recordCountry(admin: SupabaseClient, userId: string, h: Headers): Promise<void> {
  const code = countryFromHeaders(h);
  if (!code) return;
  try {
    await admin.rpc("profile_set_country", { p_user: userId, p_country: code });
  } catch {
    // Cosmetic; the next gated request tries again.
  }
}

/** One attempt per user every 5 minutes per isolate. Short enough that a brand-new
 *  player's first game already shows their flag (their profile row is written
 *  after their first request). */
export const countryGate = createTouchGate(5 * 60_000);
