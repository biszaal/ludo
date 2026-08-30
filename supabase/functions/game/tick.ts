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
import { json, secretMatches, type SupabaseClient } from "./lib.ts";
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

/**
 * How long a window of rewarded-ad intents must go entirely unpaid before we
 * call it an outage rather than a quiet spell.
 *
 * The threshold has to be set against the REAL base rate, and the base rate is
 * nothing like intuition. On 2026-08-24, the one day SSV is confirmed to have
 * worked end to end, only 8 of 32 intents were ever granted — a 25% grant rate.
 * An intent is minted when the sheet asks for one; the other 75% are people who
 * dismissed the ad, got no fill, or backed out. `pending` is the ordinary
 * outcome, not the alarming one.
 *
 * So "no grants" is only evidence in proportion to how many intents it spans:
 *
 *     n=3   42%  |  n=5   24%  |  n=8   10%  |  n=12  3%
 *
 * ...as the chance of seeing it with a perfectly healthy pipeline. A threshold
 * of 3 — which is what this shipped with — would have fired on nearly half of
 * all quiet stretches, and an alert that cries wolf twice a week teaches you to
 * ignore the one time it is right.
 *
 * 12 over 24h puts the false-positive rate near 3%. At today's traffic that
 * bar is rarely reached, so this usually reports "unknown" and says nothing —
 * which is the correct behaviour on thin data, and starts working on its own as
 * the game grows.
 */
const SSV_WATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Below this, "no grants" is indistinguishable from a run of dismissed ads. */
const SSV_WATCH_MIN_INTENTS = 12;

/**
 * Is the rewarded-ad pipeline actually paying anybody?
 *
 * This exists because it once wasn't, for four days, in total silence. AdMob's
 * signed callback is the only thing that credits a rewarded ad; when its URL is
 * missing from an ad unit, Google simply never calls, so there is no error to
 * see — no failed request, no rejected signature, no log line anywhere. The
 * only visible trace is in this table: intents piling up as `pending` while
 * `granted` flatlines. Players watch the whole video and get nothing.
 *
 * Cheap enough to run on the heartbeat: two counts, both on the index
 * ad_rewards already has. Logs and returns; deciding what to do about it is a
 * job for whoever reads the logs.
 */
async function checkAdRewardHealth(admin: SupabaseClient): Promise<boolean | null> {
  const since = new Date(Date.now() - SSV_WATCH_WINDOW_MS).toISOString();
  const countSince = async (status: string) => {
    const { count } = await admin
      .from("ad_rewards")
      .select("id", { count: "exact", head: true })
      .eq("status", status)
      .gte("created_at", since);
    return count ?? 0;
  };

  const [granted, pending] = await Promise.all([countSince("granted"), countSince("pending")]);
  const intents = granted + pending;
  if (intents < SSV_WATCH_MIN_INTENTS) return null; // too little traffic to judge

  const healthy = granted > 0;
  if (!healthy) {
    console.error(
      `[ads-ssv] NO REWARDED GRANTS in ${SSV_WATCH_WINDOW_MS / 3_600_000}h across ${intents} intents ` +
        "(~3% likely by chance at the historical 25% grant rate) — AdMob's SSV callback may not be " +
        "reaching ads-ssv. Check the callback URL is set on EVERY rewarded ad unit (it is per-unit), " +
        "then use 'Send test callback'. Confirm before acting: watch one rewarded ad to completion and " +
        "check for a 'granted' row.",
    );
  }
  return healthy;
}

export async function opTick(admin: SupabaseClient, req: Request): Promise<Response> {
  const expected = Deno.env.get("TICK_SECRET") ?? "";
  const given = req.headers.get("x-tick-secret") ?? "";
  // Fail closed: an unset secret must not turn the tick into an open endpoint.
  if (!expected || !secretMatches(given, expected)) return json({ error: "Not authenticated." });

  const settled = await settleUnpaid(admin);
  const advanced = await advanceStalled(admin);
  const adRewardsHealthy = await checkAdRewardHealth(admin);
  return json({ ok: true, settled, advanced, adRewardsHealthy });
}
