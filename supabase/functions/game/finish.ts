/** Finished results settle atomically in PostgreSQL; failed work remains retryable. */

// @deno-types="../_shared/engine/index.d.ts"
import { inPlayPlayers, leaveGame as engineLeaveGame, type GameState } from "../_shared/engine/index.js";
import { type SupabaseClient } from "./lib.ts";

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
 * SQL transaction in 0076 uses the same weights; these helpers preview them.
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

/** Read the durable result and commit payouts and statistics in one transaction. */
export async function settleIfFinished(admin: SupabaseClient, gameId: string, next: GameState): Promise<void> {
  if (next.status !== "finished") return;
  const { error } = await admin.rpc("settle_finished_game", { p_game: gameId });
  if (error) throw new Error(`Settlement failed: ${error.message}`);
}

/**
 * End a table whose last human has gone, walking the remaining bots out.
 *
 * A bot exists to keep a human's game moving. Once every seat still racing is a
 * bot there is nobody to keep moving for, and the table becomes a machine
 * playing itself: the turn clock expires, the cron tick drives a turn, the
 * clock resets, forever. Production ran one of these for 1.5 days and wrote
 * 5,567 move rows before anyone noticed.
 *
 * Returns the finished state, or null if a human is still racing or watching
 * (or the state is already exhausted, which the engine's own hand-off now
 * ends). Walking each bot out via leaveGame rather than stamping `finished`
 * directly keeps the standings honest — the last bot standing takes the final
 * placement — and reuses the one code path that knows how to end a game.
 *
 * Bots forfeit their share to the house in settleIfFinished either way, so this
 * changes who is paid only by paying the humans who already finished, sooner.
 */
export async function endIfNoHumansLeft(
  admin: SupabaseClient,
  gameId: string,
  state: GameState,
): Promise<GameState | null> {
  if (state.status !== "active") return null;
  const inPlay = inPlayPlayers(state);
  if (inPlay.length === 0) return null;

  const { data: bots } = await admin.from("game_bots").select("user_id").eq("game_id", gameId);
  const botIds = new Set((bots ?? []).map((b) => String(b.user_id)));
  if (botIds.size === 0) return null;
  if (inPlay.some((p) => !p.userId || !botIds.has(p.userId))) return null;
  if (await humanWatching(admin, gameId, state, botIds)) return null;

  let next = state;
  for (const p of inPlay) {
    if (next.status !== "active") break;
    next = engineLeaveGame(next, p.id, { now: Date.now() });
  }
  return next.status === "finished" ? next : null;
}

/**
 * Is a human still sitting at this table, even though none of them is racing?
 *
 * "Nobody left to keep moving for" and "nobody still racing" are not the same
 * thing, and the player they come apart for is the one who least deserves it:
 * the winner. A seat drops out of `inPlayPlayers` the moment it comes home, so
 * a quick match where the human won and stayed to watch the bots race for 2nd
 * and 3rd read here as a bot-only table.
 *
 * Production, 2026-09-17, game a61653a7: the human won at 14:36:28 and stayed.
 * Every client arms the turn-clock timeout, spectators included, so theirs
 * fired 17 seconds later to ask the server to keep the game moving — and this
 * function answered by walking the bots out and finishing the match in front of
 * them. The only device watching that table is what triggered its abandonment.
 *
 * `players.is_connected` is the presence the room already keeps: set by every
 * action and by join, cleared when the app backgrounds (onlineStore's setAway)
 * and when a player leaves. Nothing else can tell a winner watching the finish
 * from a winner who closed the app, because a placed seat never holds another
 * turn — the missed-turn strikes that catch an absent PLAYER can never catch an
 * absent watcher.
 *
 * Read only for seats the engine still has at the table: `hasLeft` is the
 * engine's own record of walking out, and it outranks a presence row that was
 * never cleared.
 */
async function humanWatching(
  admin: SupabaseClient,
  gameId: string,
  state: GameState,
  botIds: Set<string>,
): Promise<boolean> {
  const seated = state.players
    .filter((p) => !p.hasLeft && p.userId && !botIds.has(p.userId))
    .map((p) => p.userId!);
  if (seated.length === 0) return false;

  const { data, error } = await admin
    .from("players")
    .select("user_id")
    .eq("game_id", gameId)
    .eq("is_connected", true)
    .in("user_id", seated);
  // Unreadable presence fails toward keeping the table, exactly as an
  // unreadable game_bots does above: ending a match somebody is watching is the
  // bug this guard exists to prevent, and the table it spares is not the runaway
  // the abandonment check was written for — those bots are racing to a finish,
  // so the game still ends on its own.
  if (error) return true;
  return (data ?? []).length > 0;
}
