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

/**
 * The clock a seat gets once the server already knows nobody is behind it.
 *
 * A player who idled through a whole turn is presumed gone until they prove
 * otherwise (an action, or their app coming back to the foreground, both of
 * which clear `missed_turns`). Handing that seat another full 30 seconds every
 * round is what made an abandoned table unplayable for everyone still there —
 * the room spent more time watching a countdown than playing.
 */
export const AWAY_TURN_SECONDS = 6;

/**
 * How long a seat stays away before the server removes the player for good.
 *
 * Time, not turn count: away turns now resolve in seconds, so a strike counter
 * alone would drop someone who put their phone down for a moment. This is the
 * "they closed the app" threshold, and it has to stay comfortably longer than
 * the round trip of backgrounding, reading a message and coming back.
 */
export const AWAY_KICK_SECONDS = 90;

/** Quick-match default entry. */
export const QUICK_STAKE = 100;

/** Quick-match entry tiers. Fallback only — the server config's
 *  economy.stakeTiers is the authority when present. */
export const STAKE_TIERS = [100, 1000, 10000];

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh deadline for an active turn, or null once the game is over. */
export function turnDeadline(state: GameState, seconds = TURN_SECONDS): string | null {
  return state.status === "active" ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

/** Is this seat one the server has already seen idle through a whole clock?
 *  `missed_turns` is the flag: every path that proves presence resets it. */
export async function isAwaySeat(admin: SupabaseClient, gameId: string, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("players")
    .select("missed_turns")
    .eq("game_id", gameId)
    .eq("user_id", userId)
    .maybeSingle();
  return ((data?.missed_turns as number | null) ?? 0) > 0;
}

/** The user this state hands the turn to, or null once the game is over. */
export function turnHolder(state: GameState): string | null {
  if (state.status !== "active") return null;
  return state.players.find((p) => p.id === state.currentTurnPlayerId)?.userId ?? null;
}

/**
 * Where each seat sits, for a table of `count`.
 *
 * Two rules, and the game id decides between the rotations:
 *
 *   - Seats are consecutive on the board's clockwise cycle, so seat i and seat
 *     i+2 always face each other across the diagonal and turn order runs the
 *     way the board is drawn. A 2-player table takes the diagonal directly.
 *   - Which color a seat draws is rotated by the game id rather than fixed, so
 *     the host is not red in every game they ever open. The id is a v4 uuid, so
 *     its last hex digit is uniform; deriving the offset from it instead of
 *     storing one keeps the client able to predict the deal (the lobby previews
 *     these exact colors) without a column or a round trip.
 *
 * Mirrors apps/mobile/src/lib/seating.ts — keep the two in step.
 */
export function colorOffset(gameId?: string): number {
  if (!gameId) return 0;
  const last = parseInt(gameId.replace(/[^0-9a-f]/gi, "").slice(-1), 16);
  return Number.isFinite(last) ? last % FULL_ORDER.length : 0;
}

/** The color for one seat, independent of how many end up seated. Used while a
 *  room is still filling; the deal re-reads all of them through seatColors. */
export function seatColor(seat: number, gameId?: string): Color {
  return FULL_ORDER[(colorOffset(gameId) + seat) % FULL_ORDER.length]!;
}

export function seatColors(count: number, gameId?: string): Color[] {
  const from = colorOffset(gameId);
  const rotated = FULL_ORDER.map((_, i) => FULL_ORDER[(from + i) % FULL_ORDER.length]!);
  return count === 2 ? [rotated[0]!, rotated[2]!] : rotated.slice(0, count);
}

export function genCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

/** Postgres unique_violation. */
export const UNIQUE_VIOLATION = "23505";

/** Fresh codes to try before giving up on a room. */
const CODE_ATTEMPTS = 5;

/**
 * Insert a games row, picking a fresh room code for as long as it takes.
 *
 * `games.room_code` is globally unique over a 32^4 space, and both callers used
 * to insert a single guess and hand the raw Postgres error straight to the
 * player on collision — "duplicate key value violates unique constraint
 * games_room_code_key", which is both meaningless to them and a free look at
 * the schema that safeError exists to prevent. It is a birthday problem, so it
 * bites long before the space is anywhere near full.
 *
 * Retrying is the whole fix: each attempt is independent, so five of them make
 * a user-visible collision vanishingly unlikely even with a busy table.
 */
export async function insertGameWithCode(
  admin: SupabaseClient,
  row: Record<string, unknown>,
  where: string,
): Promise<{ id: string; roomCode: string } | { error: string }> {
  let last: unknown = null;
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const roomCode = genCode();
    const { data, error } = await admin
      .from("games")
      .insert({ ...row, room_code: roomCode })
      .select("id")
      .single();
    if (!error && data) return { id: String(data.id), roomCode };
    last = error;
    // Anything that is not a code collision will not be fixed by another code.
    if ((error as { code?: string } | null)?.code !== UNIQUE_VIOLATION) break;
  }
  console.error(`[${where}]`, last instanceof Error ? last.message : last);
  return { error: "Couldn't open a room just now. Try again." };
}

export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 4294967296;
};

/**
 * The die a given roll will produce, derived rather than drawn.
 *
 * Online, the value used to come straight from `cryptoRng`, which meant the
 * client had nothing to land its tumble on until the round trip came back — on
 * a slow link, a die that rolls and rolls. Deriving it from a keyed hash of the
 * roll's own coordinates lets the server hand a player their number BEFORE they
 * tap (see opPrepareRoll), so the animation never waits on the network.
 *
 * The coordinates are `gameId:state_version:playerId`. `state_version` is the
 * load-bearing one: every roll advances it, so every roll hashes something new,
 * and nothing a client can do moves it during its own awaiting-roll turn — so
 * there is no way to re-draw a roll you don't like. The seat is in there too,
 * so one player's derivation says nothing about another's.
 *
 * Unguessable rests entirely on DICE_SECRET. Without it this is a published
 * function of public inputs, which is why there is no in-repo fallback key.
 */
const DICE_INFO = "ludo-die-v1";

/**
 * Cached per secret rather than once per isolate.
 *
 * The import is the expensive part and it still happens once, but keying the
 * cache on the secret itself means the unset case stays a live question rather
 * than a verdict frozen at first call — which is what lets a test cover the
 * no-key path in-process instead of taking the answer on trust.
 */
let diceKeyFor: { secret: string; key: Promise<CryptoKey | null> } | null = null;
let warnedNoSecret = false;

function diceKey(): Promise<CryptoKey | null> {
  const secret = Deno.env.get("DICE_SECRET");
  if (!secret) {
    // Not fatal: rolls fall back to cryptoRng and clients take the slow path
    // (tumble until the answer arrives), exactly as they did before. Loud once,
    // because the fast path is silently off until someone sets this.
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      console.error("[dice] DICE_SECRET is unset — dice prefetch disabled, rolls fall back to cryptoRng");
    }
    return Promise.resolve(null);
  }
  if (diceKeyFor?.secret === secret) return diceKeyFor.key;
  const key = crypto.subtle
    .importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    .catch((e) => {
      console.error("[dice] key import failed", e instanceof Error ? e.message : e);
      return null;
    });
  diceKeyFor = { secret, key };
  return key;
}

/**
 * Fold a digest down to a die face.
 *
 * DIE_BYTES wide, and the width is the whole point. 256 is not a multiple of
 * 6, so reducing a SINGLE byte hands faces 1-4 about a 1.6% relative excess —
 * far too small to notice by eye or in any test of practical length, and far
 * too large to be acceptable on rolls that settle coin stakes. Over 2^64 the
 * same leftover is ~6/2^64.
 *
 * Separate from deriveDie so the width is directly testable: a reduction that
 * quietly narrowed would stop depending on the later bytes, and that is a
 * property a test can pin down in a way a distribution never could at this
 * scale.
 */
const DIE_BYTES = 8;

export function dieFromDigest(digest: Uint8Array): number {
  let n = 0n;
  for (let i = 0; i < DIE_BYTES; i++) n = (n << 8n) | BigInt(digest[i]!);
  return Number(n % 6n) + 1;
}

/** The die for one roll, or null when there is no key to derive it with. */
export async function deriveDie(gameId: string, v: number, playerId: string): Promise<number | null> {
  const key = await diceKey();
  if (!key) return null;
  const msg = new TextEncoder().encode(`${DICE_INFO}:${gameId}:${v}:${playerId}`);
  return dieFromDigest(new Uint8Array(await crypto.subtle.sign("HMAC", key, msg)));
}

/**
 * An {@link Rng} that yields exactly `die` through the engine's
 * `Math.floor(rng() * 6) + 1`.
 *
 * The midpoint of the bucket rather than its floor: `(die - 1) / 6` also
 * round-trips today, but it sits exactly on the boundary, so it is one
 * refactor of rollDie away from landing a value low. The middle has no such
 * edge, and the engine is the only reader.
 */
export function rngForDie(die: number): Rng {
  return () => (die - 0.5) / 6;
}

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
  // Joining is the one op that takes a GUESSABLE key: room codes are four
  // characters over a 32-symbol alphabet, so ~1M combinations, of which only
  // the currently-waiting rooms are live. Unlimited, that is a free sweep of
  // the room space; opJoin also collapses its refusals into one message so the
  // reply cannot be used to tell "no such room" from "that room is full".
  // Higher than roomCreate because rejoining a room you are already in is a
  // normal reconnect path.
  roomJoin: 60,
  roomInvite: 60,
  quickMatch: 60,
  // Read-only ops. These are ABUSE ceilings on invocations and database reads,
  // not gameplay limits — every one of them is already authorized, and none can
  // move currency. Set well above what a foregrounded app reaches.
  //
  // adRewardStatus is the loosest on purpose: it is the poll that runs while an
  // ad settles, once per second until the deadline, and a player may legitimately
  // watch several ads in a session.
  adRewardStatus: 600,
  config: 120,
  entitlements: 120,
  friendCode: 60,
  friendsRecent: 240,
  presence: 240,
  // Irreversible, and an account can only delete itself once — but a failed
  // attempt on a bad connection is retried by a person who very much wants it
  // to work, so this sits at the same floor as the other low limits rather than
  // below it. Enough to stop a loop hammering the Auth admin API, not enough to
  // ever refuse someone their own deletion.
  deleteAccount: 10,
  // Registration follows app launches and the notifications toggle, both of
  // which a real player touches a handful of times a day at most.
  push: 60,
  // Reporting is a rare, deliberate act. Low enough that nobody can use it to
  // spam the moderation queue, high enough that a bad table is fully reportable.
  report: 30,
  // Generous on purpose: chat is now a server round trip, and a 30-minute
  // table of four chatty players is ordinary use, not abuse. The client's
  // 500ms send throttle is the first line; this is the backstop.
  chat: 600,
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

/**
 * Keys that must never be written through a merge.
 *
 * `JSON.parse` produces `__proto__` as an OWN enumerable property, so it
 * survives `Object.entries` — and `out[k] = v` on a plain object then hits the
 * prototype setter rather than defining a key, which is prototype pollution.
 * Both inputs here are `app_config` rows today, so only an operator can reach
 * it; the guard is so that stays true if a config value ever becomes
 * region-supplied or client-influenced.
 */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Deep-merge plain objects; `over` wins. Arrays and scalars replace wholesale
 *  so a country row can override a list without having to restate the rest. */
export function deepMerge(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (UNSAFE_KEYS.has(k)) continue;
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

/**
 * Is `version` at least `min`, comparing numerically?
 *
 * `app_version` is free text a client wrote, so this must not trust its shape.
 * Anything that does not parse — including the null every pre-handshake binary
 * sends — is "no": the gate's safe direction is always toward the protocol
 * that works everywhere.
 *
 * Numeric per component on purpose. "1.10.0" < "1.9.0" as strings, which would
 * quietly disable folding for every build after 1.9.
 */
export function versionAtLeast(version: string | null, min: string): boolean {
  if (!version) return false;
  const parse = (s: string): number[] | null => {
    const parts = s.split(".");
    const nums: number[] = [];
    for (const p of parts) {
      if (!/^\d+$/.test(p)) return null;
      nums.push(Number(p));
    }
    return nums.length > 0 ? nums : null;
  };
  const a = parse(version);
  const b = parse(min);
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * The first client release that understands a die arriving over broadcast.
 * Below this, a seat renders the opponent die from the roll WRITE, so folding
 * that write away takes the die from them and there is no OTA channel to fix
 * it.
 *
 * Hearing the die was only ever half of it. 1.0.2 carries the appVersion
 * handshake and the broadcast receiver, so it renders an OPPONENT's folded
 * die correctly — and then deadlocks on its own, because it drops the roll
 * response as a stale echo of a version it already has (a folded roll answers
 * at the version it was sent at) and never clears the prediction that
 * selectToken and pass refuse to act through. The seat rolls and can then
 * neither move nor pass.
 *
 * So the floor is 1.0.3: the first release that reads the `folded` flag on the
 * response. 1.0.2 was in store review when this was found, and this gate is
 * what stops it shipping into a folding table. Every half of the protocol must
 * land in one build — a binary that satisfies this gate and is missing any of
 * them is unreachable by any OTA fix.
 */
export const FOLD_MIN_VERSION = "1.0.3";

/**
 * May this table be spoken to in the folded protocol?
 *
 * Every human seat must be new enough. Bot seats are exempt: they have no
 * client and never render, and their app_version is always null.
 *
 * `botUserIds` MUST come from `game_bots`, not from `players.is_bot` — the
 * latter is the visible-tag flag and is false for hidden quick-match bots,
 * which would make this return false for most real games.
 */
export function foldAllowed(
  seats: Array<{ user_id: string; app_version: string | null }>,
  botUserIds: Set<string>,
): boolean {
  if (seats.length === 0) return false;
  return seats.every(
    (s) => botUserIds.has(String(s.user_id)) || versionAtLeast(s.app_version, FOLD_MIN_VERSION),
  );
}

/**
 * Re-exported so the cron entrypoints here keep importing it from one place.
 * The implementation moved to _shared once the RevenueCat webhook — a separate
 * function, and the one path that mints paid currency — needed it too.
 */
export { secretMatches } from "../_shared/secret.ts";

/**
 * Should we spend a round trip recording that this user is alive?
 *
 * touch_activity (0053) already bounds the WRITE to once per user per 6 hours in
 * its own WHERE clause. This bounds the CALL. Without it, opTurn — several times
 * per player per minute — would fire an RPC per request: a 30-minute four-player
 * match becomes ~400 round trips to record 4 facts, all of them no-ops.
 *
 * Per-isolate and lossy on purpose. A cold start forgets everyone, and that is
 * fine: the SQL guard catches the duplicate and the fact being recorded has a
 * horizon of months. The two throttles are belt and braces, and this is the belt.
 *
 * Bounded so a long-lived isolate can't grow the map without limit. Eviction is
 * "drop the oldest half when full" rather than true LRU — at 5k entries against
 * a 30-minute TTL the difference is unobservable, and this must stay cheap
 * enough to run in front of every request.
 */
export function createTouchGate(ttlMs = 30 * 60_000, max = 5_000) {
  const seen = new Map<string, number>();
  return {
    should(userId: string, now = Date.now()): boolean {
      const last = seen.get(userId);
      if (last !== undefined && now - last < ttlMs) return false;
      if (seen.size >= max && last === undefined) {
        // Map iterates in insertion order, so the first half is the oldest half.
        let drop = Math.ceil(seen.size / 2);
        for (const key of seen.keys()) {
          seen.delete(key);
          if (--drop <= 0) break;
        }
      }
      seen.set(userId, now);
      return true;
    },
    /** Test seam. */
    size(): number {
      return seen.size;
    },
  };
}

/** The router's gate. One per isolate, by design — see createTouchGate. */
export const touchGate = createTouchGate();
