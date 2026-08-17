/**
 * Dealing a room into a live game. Shared by the host's explicit "start" and by
 * both quick-match paths (a claim that fills the last seat, and the bot fill),
 * which is why it sits in its own module rather than inside either one.
 */

// @deno-types="../_shared/engine/index.d.ts"
import { createGame as engineCreateGame, type GameState } from "../_shared/engine/index.js";
import { afterResponse, seatColors, turnDeadline, type SupabaseClient, WRITE_FAILED } from "./lib.ts";
import { walletApply } from "./wallet.ts";
import { afterGameWrite } from "./bots.ts";

export type StartResult = { state: GameState; v: number } | { error: string };

interface Seat {
  user_id: string;
}

/**
 * The seats that actually pay into the pot.
 *
 * Bot seats never do. The house funds them and keeps their share if they place
 * (finish.ts skips bot user_ids on payout), so charging them here would take
 * coins from a pooled wallet and — once that wallet ran dry — fail the
 * all-or-nothing collection and block the start outright. Both sides read
 * game_bots, so the pot can't disagree with itself about who is a bot.
 */
export function payingSeats<T extends Seat>(lobby: T[], botUserIds: Set<string>): T[] {
  return lobby.filter((p) => !botUserIds.has(p.user_id));
}

/**
 * Take the entry fee from every seat, all or nothing.
 *
 * There is no multi-row transaction available from here, so this debits in
 * sequence and unwinds by hand the moment anyone comes up short. That unwind is
 * the whole reason this function exists: a partial collection would leave real
 * coins taken from players for a game that never started, and they would have
 * no way to notice, let alone complain about it precisely.
 *
 * Idempotent per seat via ext_id, so a retry after a timeout re-reads as the
 * same debit rather than a second one. The refunds deliberately do NOT carry an
 * ext_id — a refund is a new fact, and deduping it against the debit would make
 * the unwind silently no-op.
 */
export async function collectStakes(
  admin: SupabaseClient,
  gameId: string,
  lobby: Seat[],
  stake: number,
): Promise<{ ok: true } | { error: string }> {
  const paid: string[] = [];
  for (const seat of lobby) {
    const userId = seat.user_id as string;
    const after = await walletApply(admin, userId, -stake, "stake", gameId, "earned", `room-stake:${gameId}:${userId}`);
    if (after !== null) {
      paid.push(userId);
      continue;
    }
    // Someone can't cover it. Hand back everything already taken, then name
    // them — a bare "couldn't start" would send four people hunting for which
    // of them was short.
    for (const refundTo of paid) {
      await walletApply(admin, refundTo, stake, "stake-refund", gameId);
    }
    const { data: profile } = await admin
      .from("profiles")
      .select("display_name")
      .eq("user_id", userId)
      .maybeSingle();
    const who = (profile?.display_name as string | undefined) ?? "A player";
    return { error: `${who} doesn't have enough coins for this pot.` };
  }
  return { ok: true };
}

/**
 * Deal the game from whoever is seated and flip the row to active. No host
 * check — quick-match paths start rooms on behalf of either seat. Racing
 * starts collapse via the version guard; the loser gets the live row back.
 */
export async function startGameNow(admin: SupabaseClient, gameId: string): Promise<StartResult> {
  const { data: game } = await admin
    .from("games")
    .select("id, status, has_bots, state, state_version, is_quick, stake")
    .eq("id", gameId)
    .single();
  if (!game) return { error: "Game not found." };
  const v = (game.state_version as number | null) ?? 0;
  if (game.status !== "waiting") {
    return game.state ? { state: game.state as GameState, v } : { error: "Game already started." };
  }

  const { data: lobby } = await admin.from("players").select("id, user_id, color, seat").eq("game_id", gameId).order("seat");
  if (!lobby || lobby.length < 2) return { error: "Need at least 2 players." };

  // Friend rooms collect the pot here, at the moment play actually begins.
  // Quick match is excluded: it already debited each player as they took a
  // seat (quick.ts), because there the seat is the matchmaking queue.
  const stake = (game.stake as number | null) ?? 0;
  if (!game.is_quick && stake > 0) {
    const { data: bots } = await admin.from("game_bots").select("user_id").eq("game_id", gameId);
    const botIds = new Set((bots ?? []).map((b) => String(b.user_id)));
    const collected = await collectStakes(admin, gameId, payingSeats(lobby, botIds), stake);
    if ("error" in collected) return collected;
  }

  const colors = seatColors(lobby.length);
  const players = lobby.map((p, i) => ({ id: p.id, userId: p.user_id, color: colors[i]! }));
  const state = engineCreateGame(players, { gameId });

  const { data: updated, error } = await admin
    .from("games")
    .update({ state, status: "active", current_turn_player_id: state.currentTurnPlayerId, turn_deadline: turnDeadline(state), state_version: v + 1 })
    .eq("id", gameId)
    .eq("state_version", v)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[deal.write]", error.message);
    return { error: WRITE_FAILED };
  }
  if (!updated) {
    const { data } = await admin.from("games").select("state, state_version").eq("id", gameId).single();
    return data?.state
      ? { state: data.state as GameState, v: (data.state_version as number | null) ?? 0 }
      : { error: "Could not start the game." };
  }

  afterResponse(admin.from("players").update({ missed_turns: 0 }).eq("game_id", gameId));
  afterGameWrite(admin, gameId, !!game.has_bots, state);

  return { state, v: v + 1 };
}
