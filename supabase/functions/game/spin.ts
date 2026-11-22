/**
 * Reward spin (0086): what a player is owed, and taking a spin.
 *
 * Thin on purpose. spin_status derives what is owed from existing records, and
 * spin_claim checks, draws, pays and logs in one transaction, so the rules have
 * exactly one home (SQL, tested in scripts/tests/spin.test.mjs). This layer adds
 * the input checks, the rate limit, and keeps a database error from ever
 * reading as a result.
 */

import { json, LIMITS, rateLimited, rateOk, safeError, type SupabaseClient } from "./lib.ts";

const SOURCES = new Set(["daily", "first", "match"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILED = "Could not spin. Try again.";

export async function opSpinState(admin: SupabaseClient, userId: string): Promise<Response> {
  if (!(await rateOk(admin, userId, "spinState", LIMITS.spinState))) return rateLimited();
  const { data, error } = await admin.rpc("spin_status", { p_user: userId });
  // Logged: a deploy that outran its migration would otherwise only show as a hidden tile.
  if (error) return safeError("spinState", error, FAILED);
  if (!data) return json({ error: FAILED });
  return json(data);
}

export async function opSpinClaim(
  admin: SupabaseClient,
  userId: string,
  source: string,
  requestId: string,
): Promise<Response> {
  if (!SOURCES.has(source) || !UUID.test(requestId)) return json({ error: "Bad request." });
  if (!(await rateOk(admin, userId, "spinClaim", LIMITS.spinClaim))) return rateLimited();
  const { data, error } = await admin.rpc("spin_claim", { p_user: userId, p_source: source, p_request_id: requestId });
  if (error) return safeError("spinClaim", error, FAILED);
  if (!data) return json({ error: FAILED });
  return json(data);
}
