/**
 * Shared primitives for the `game` function's op modules: auth, responses,
 * deferred work, the turn clock, and the remote config read.
 *
 * Nothing here reaches for another op module — this is the bottom of the
 * dependency graph, so the layering above it stays acyclic.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5";
// @deno-types="../_shared/engine/index.d.ts"
import type { Color, GameState, Rng } from "../_shared/engine/index.js";
import { corsHeaders } from "../_shared/cors.ts";

export type { SupabaseClient };

export const FULL_ORDER: Color[] = ["red", "green", "yellow", "blue"];

/** How long a player has to act before any peer may skip their turn. */
export const TURN_SECONDS = 30;

/** Quick-match default entry. */
export const QUICK_STAKE = 100;

/** Quick-match entry tiers. Fallback only — the server config's
 *  economy.stakeTiers is the authority when present. */
export const STAKE_TIERS = [100, 1000, 10000];

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh deadline for an active turn, or null once the game is over. */
export function turnDeadline(state: GameState): string | null {
  return state.status === "active" ? new Date(Date.now() + TURN_SECONDS * 1000).toISOString() : null;
}

/** 2 players sit diagonally (red/yellow); otherwise clockwise. Mirrors the client. */
export function seatColors(count: number): Color[] {
  return count === 2 ? ["red", "yellow"] : FULL_ORDER.slice(0, count);
}

export function genCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 4294967296;
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Log the real failure, return something safe to show a player.
 *
 * Postgres error text names constraints, columns and functions — a free map of
 * the schema for anyone who can provoke a failure, and every op here is
 * reachable by any signed-in user. The detail belongs in the function logs,
 * where we can actually read it; the client gets a sentence it can act on.
 *
 * `where` is a short tag ("turn.write", "room.rematch") so a report of the
 * generic message can still be traced to one call site in the logs.
 */
export function safeError(where: string, err: unknown, message = "Something went wrong. Try again."): Response {
  console.error(`[${where}]`, err instanceof Error ? err.message : err);
  return json({ error: message });
}

/** The message every version-guarded write shares: someone else's write landed
 *  first, or the write itself failed. Either way the client resyncs. */
export const WRITE_FAILED = "Couldn't save that move — reconnecting.";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/** Work that must not block the response: bookkeeping writes (audit log,
 *  presence) and the paced bot turns. waitUntil keeps the isolate alive until
 *  they settle; failures are swallowed. Anything that moves money awaits its
 *  own writes INSIDE the deferred task, so ordering still holds there. */
export function afterResponse(task: PromiseLike<unknown>): void {
  const settled = Promise.resolve(task).catch(() => {});
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(settled);
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

/** Auth JWKS, fetched once per cold start and cached by jose. */
const jwks = createRemoteJWKSet(new URL(`${Deno.env.get("SUPABASE_URL")}/auth/v1/.well-known/jwks.json`));

/**
 * Resolve the caller's user id from their JWT, verifying the signature locally
 * (no auth-server round trip on the hot path). Local verification can't see
 * session revocation — acceptable for a game. Projects still on legacy HS256
 * signing have no usable JWKS, so any local failure falls back to the auth
 * server's verdict; invalid tokens just pay one extra hop on their way to a 401.
 */
export async function authUserId(admin: SupabaseClient, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, jwks);
    if (typeof payload.sub === "string" && payload.sub) return payload.sub;
  } catch {
    // fall through to remote verification
  }
  const { data, error } = await admin.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

// --- Rate limiting -----------------------------------------------------------
// One hourly counter per (user, bucket), in Postgres so it survives isolate
// recycling and applies across a user's devices.
//
// These are ABUSE ceilings, not game balance. The economy's real protection is
// elsewhere and unchanged: grants are per-UTC-day, rewarded coins only move on
// a signed AdMob callback, and prices come from the catalog. What was missing
// is a bound on how fast a script can hammer the ops at all — every one of them
// writes rows and costs edge invocations, and only friend lookup had a limit.
//
// Numbers are set well above what a human can reach: a player who trips one is
// not playing.

/** Hourly ceilings per op. */
export const LIMITS = {
  adReward: 30,
  dailyBonus: 10,
  walletTopup: 10,
  shopBuy: 30,
  gemsExchange: 20,
  gemsBuy: 20,
  roomCreate: 30,
  roomInvite: 60,
  quickMatch: 60,
} as const;

/**
 * True when the call is within its hourly budget.
 *
 * Fails OPEN: if the counter itself errors we allow the call. A limiter that
 * locks players out of their own wallet when a table hiccups is worse than the
 * abuse it prevents — and the per-day economic caps still hold underneath.
 */
export async function rateOk(
  admin: SupabaseClient,
  userId: string,
  bucket: string,
  limit: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc("rate_limit_hit", {
    p_user: userId,
    p_bucket: bucket,
    p_limit: limit,
  });
  if (error) return true;
  return data !== false;
}

/** Standard refusal for a tripped limit. */
export function rateLimited(): Response {
  return json({ error: "You're doing that too fast. Give it a minute." });
}

/** A racing write beat ours — return the current authoritative row instead. */
export async function freshState(admin: SupabaseClient, gameId: string, fallback: GameState): Promise<Response> {
  const { data } = await admin.from("games").select("state, state_version").eq("id", gameId).single();
  return json({ state: (data?.state as GameState) ?? fallback, v: data?.state_version ?? null });
}

/** UTC calendar day, as a `date`-comparable string. */
export function utcDay(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

// --- Remote config -----------------------------------------------------------

export type Json = Record<string, unknown>;

/** Deep-merge plain objects; `over` wins. Arrays and scalars replace wholesale
 *  so a country row can override a list without having to restate the rest. */
export function deepMerge(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const prev = out[k];
    const bothPlain =
      prev !== null && typeof prev === "object" && !Array.isArray(prev) &&
      v !== null && typeof v === "object" && !Array.isArray(v);
    out[k] = bothPlain ? deepMerge(prev as Json, v as Json) : v;
  }
  return out;
}

/** The server's own view of the default config row — authority for economy
 *  gates (never the client's copy, never region-merged: gates don't vary by
 *  country). */
export async function serverConfig(admin: SupabaseClient): Promise<Json> {
  const { data } = await admin.from("app_config").select("value").eq("key", "default").maybeSingle();
  return (data?.value ?? {}) as Json;
}
