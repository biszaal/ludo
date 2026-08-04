/**
 * What happens the moment a game reaches `finished`: the pot is paid, and every
 * seat's public record is updated. Both are exactly-once under racing finisher
 * paths (opTurn, the bot driver, leave, timeout), each via its own CAS latch on
 * the games row.
 */

// @deno-types="../_shared/engine/index.d.ts"
import type { GameState } from "../_shared/engine/index.js";
import { afterResponse, type SupabaseClient } from "./lib.ts";
import { walletApply } from "./wallet.ts";

/**
 * Pay the pot exactly once when a staked game finishes: the payout_done CAS is
 * the latch, so racing finisher paths collapse to a single credit. A winning
 * hidden bot forfeits to the house.
 */
export async function settleIfFinished(admin: SupabaseClient, gameId: string, next: GameState): Promise<void> {
  if (next.status !== "finished") return;
  const { data: claimed } = await admin
    .from("games")
    .update({ payout_done: true })
    .eq("id", gameId)
    .eq("payout_done", false)
    .gt("stake", 0)
    .select("stake")
    .maybeSingle();
  if (!claimed) return;
  const stake = (claimed.stake as number | null) ?? 0;
  const winnerId = next.finishedOrder[0] ?? next.winnerPlayerId;
  const winnerUserId = next.players.find((p) => p.id === winnerId)?.userId;
  if (!winnerUserId || stake <= 0) return;
  const { data: botRow } = await admin
    .from("game_bots")
    .select("user_id")
    .eq("game_id", gameId)
    .eq("user_id", winnerUserId)
    .maybeSingle();
  if (botRow) return;
  // The pot scales with the table: every seat's entry (bot seats included —
  // the house stands their share, as it always has for the 1v1 fill-in).
  await walletApply(admin, winnerUserId, stake * next.players.length, "win", gameId);
}

/**
 * Record the finished game against every seat's public record, exactly once.
 *
 * A sibling of settleIfFinished rather than a branch inside it: that function
 * early-returns on `stake > 0`, so folding stats in there would silently skip
 * every unstaked (friend / quick) game — which is most of them.
 *
 * Fire-and-forget, unlike settlement: coins are money and are awaited, whereas
 * a dropped stats write is invisible, acceptable loss. The stats_done CAS goes
 * INSIDE the deferred task — it is atomic on its own, so exactly-once holds
 * regardless of when the task runs.
 *
 * Bots are recorded too. A bot profile reading "0 played" is a tell (0009).
 */
export function recordFinishStats(admin: SupabaseClient, gameId: string, next: GameState): void {
  if (next.status !== "finished") return;
  afterResponse((async () => {
    const { data: claimed } = await admin
      .from("games")
      .update({ stats_done: true })
      .eq("id", gameId)
      .eq("stats_done", false)
      .select("id")
      .maybeSingle();
    if (!claimed) return; // another finisher path already recorded it

    const userIds = next.players.map((p) => p.userId).filter((u): u is string => !!u);
    if (userIds.length === 0) return;
    const winnerId = next.finishedOrder[0] ?? next.winnerPlayerId;
    const winnerUserId = next.players.find((p) => p.id === winnerId)?.userId ?? null;
    await admin.rpc("stats_record", { p_user_ids: userIds, p_winner: winnerUserId });
  })());
}
