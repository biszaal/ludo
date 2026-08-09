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
 * How the pot divides by finishing place, per seat count.
 *
 * Winner-take-all is brutal at a 4-player table: three of four players lose
 * their whole entry, and the two who spent ten minutes finishing 2nd and 3rd
 * are treated exactly like the one who came last. Paying the podium keeps a
 * losing game worth playing out — which also matters mechanically, since a
 * player with nothing left to gain is a player who quits and leaves the rest
 * waiting on a turn clock.
 *
 * Integer weights, so a pot divides exactly at every stake tier:
 *   2 seats  1/1               winner takes all
 *   3 seats  2/3, 1/3          200 / 100 of a 300 pot
 *   4 seats  5/8, 2/8, 1/8     250 / 100 / 50 of a 400 pot
 *
 * MIRRORED in apps/mobile/src/lib/economy.ts (payoutSplit) for display. The
 * numbers here are the ones that move money; that copy only previews them.
 */
const PLACE_WEIGHTS: Record<number, number[]> = {
  2: [1],
  3: [2, 1],
  4: [5, 2, 1],
};

/**
 * Coins for each finishing place, longest-first. Index 0 is the winner.
 * Any rounding remainder goes to 1st, so the shares always sum to the pot.
 */
export function payoutSplit(stake: number, seats: number): number[] {
  if (stake <= 0 || seats <= 0) return [];
  const pot = stake * seats;
  const weights = PLACE_WEIGHTS[seats] ?? [1];
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor((pot * w) / total));
  shares[0] = (shares[0] ?? 0) + (pot - shares.reduce((a, b) => a + b, 0));
  return shares;
}

/**
 * Pay the pot exactly once when a staked game finishes: the payout_done CAS is
 * the latch, so racing finisher paths collapse to a single settlement.
 *
 * Hidden bots forfeit their share to the house, and so does any place nobody
 * reached — a table where two players quit has no 3rd place to pay. Quitters
 * can never be paid by construction: leaveGame only appends a player to
 * finishedOrder if they actually finished or were the last one standing.
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
  if (stake <= 0) return;

  // The pot scales with the table: every seat's entry, bot seats included —
  // the house stands their share, as it always has for the 1v1 fill-in.
  const shares = payoutSplit(stake, next.players.length);
  const order = next.finishedOrder.length > 0
    ? next.finishedOrder
    : next.winnerPlayerId ? [next.winnerPlayerId] : [];
  if (order.length === 0) return;

  const { data: bots } = await admin.from("game_bots").select("user_id").eq("game_id", gameId);
  const botIds = new Set((bots ?? []).map((b) => b.user_id as string));

  for (let place = 0; place < shares.length; place++) {
    const amount = shares[place]!;
    if (amount <= 0) continue;
    const playerId = order[place];
    if (!playerId) continue; // nobody reached this place — house keeps it
    const userId = next.players.find((p) => p.id === playerId)?.userId;
    if (!userId || botIds.has(userId)) continue;
    // ext_id per place: the CAS latch already makes settlement once-only, but
    // this keeps each credit individually idempotent, so a partial failure can
    // be retried without double-paying the places that already landed.
    await walletApply(admin, userId, amount, "win", gameId, "earned", `win:${gameId}:${place}`);
  }
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
