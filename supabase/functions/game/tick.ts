/**
 * The heartbeat for games nobody is watching.
 *
 * Every other path into this function is driven by a client: a player rolls, a
 * peer's timer fires opTimeout, a bot is driven in the waitUntil tail of
 * someone else's write. That works right up until the last device closes the
 * app — and then the game simply stops. driveBotTurns stands down when the turn
 * belongs to a human (bots.ts), opTimeout needs a caller, and reap_stale_games
 * only ever looked at 'waiting' and 'finished' rows. An abandoned active game
 * sat frozen forever: the bots waited on a turn that would never be played, and
 * because the game never reached 'finished', settleIfFinished was never reached
 * either, so the pot stayed debited and nobody was paid.
 *
 * pg_cron calls this once a minute (0034). It is the only op that is not
 * authorized against a user JWT — there is no user — so it authenticates with a
 * shared secret instead, and fails closed if that secret is not configured.
 */

// @deno-types="../_shared/engine/index.d.ts"
import type { GameState } from "../_shared/engine/index.js";
import { json, type SupabaseClient } from "./lib.ts";
import { settleIfFinished } from "./finish.ts";
import { advanceStalledGame, type StalledGameRow } from "./turn.ts";

/**
 * Games advanced per tick. The cron runs every minute, so this is a ceiling on
 * concurrent abandoned tables, not on throughput — anything not reached this
 * minute is picked up the next, oldest deadline first.
 */
const MAX_GAMES_PER_TICK = 25;

/** Unpaid finished games settled per tick. Normally zero: this is a net under
 *  the exactly-once payout latch, not the mechanism that pays. */
const MAX_SETTLE_PER_TICK = 25;

/**
 * Grace beyond the turn deadline before the tick steps in. A client's own
 * opTimeout (deadline + ~3s jitter) should always win the race; the tick is the
 * backstop for when no client exists to fire it.
 */
const TICK_GRACE_MS = 15_000;

/** Constant-time-ish compare so the secret can't be probed a byte at a time. */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/**
 * Pay out any game that reached `finished` without being settled.
 *
 * settleIfFinished is already exactly-once (the payout_done CAS), and every
 * finisher path calls it — but every one of those paths runs inside a request
 * that can be evicted mid-flight. This re-runs the claim for anything that slipped.
 */
async function settleUnpaid(admin: SupabaseClient): Promise<number> {
  const { data: games } = await admin
    .from("games")
    .select("id, state")
    .eq("status", "finished")
    .eq("payout_done", false)
    .gt("stake", 0)
    .limit(MAX_SETTLE_PER_TICK);
  if (!games?.length) return 0;

  let settled = 0;
  for (const g of games) {
    const state = g.state as GameState | null;
    if (!state) continue;
    await settleIfFinished(admin, String(g.id), state);
    settled++;
  }
  return settled;
}

/** Drive every active game whose turn clock ran out with nobody there to notice. */
async function advanceStalled(admin: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - TICK_GRACE_MS).toISOString();
  const { data: games } = await admin
    .from("games")
    .select("id, state, turn_deadline, state_version, is_quick, has_bots")
    .eq("status", "active")
    .not("turn_deadline", "is", null)
    .lt("turn_deadline", cutoff)
    .order("turn_deadline", { ascending: true })
    .limit(MAX_GAMES_PER_TICK);
  if (!games?.length) return 0;

  let advanced = 0;
  for (const row of games) {
    const state = row.state as GameState | null;
    if (!state) continue;
    const outcome = await advanceStalledGame(admin, { ...(row as unknown as StalledGameRow), state });
    if (outcome.kind === "advanced") advanced++;
  }
  return advanced;
}

export async function opTick(admin: SupabaseClient, req: Request): Promise<Response> {
  const expected = Deno.env.get("TICK_SECRET") ?? "";
  const given = req.headers.get("x-tick-secret") ?? "";
  // Fail closed: an unset secret must not turn the tick into an open endpoint.
  if (!expected || !secretMatches(given, expected)) return json({ error: "Not authenticated." });

  const settled = await settleUnpaid(admin);
  const advanced = await advanceStalled(admin);
  return json({ ok: true, settled, advanced });
}
