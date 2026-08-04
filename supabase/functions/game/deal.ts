/**
 * Dealing a room into a live game. Shared by the host's explicit "start" and by
 * both quick-match paths (a claim that fills the last seat, and the bot fill),
 * which is why it sits in its own module rather than inside either one.
 */

// @deno-types="../_shared/engine/index.d.ts"
import { createGame as engineCreateGame, type GameState } from "../_shared/engine/index.js";
import { afterResponse, seatColors, turnDeadline, type SupabaseClient, WRITE_FAILED } from "./lib.ts";
import { afterGameWrite } from "./bots.ts";

export type StartResult = { state: GameState; v: number } | { error: string };

/**
 * Deal the game from whoever is seated and flip the row to active. No host
 * check — quick-match paths start rooms on behalf of either seat. Racing
 * starts collapse via the version guard; the loser gets the live row back.
 */
export async function startGameNow(admin: SupabaseClient, gameId: string): Promise<StartResult> {
  const { data: game } = await admin
    .from("games")
    .select("id, status, has_bots, state, state_version")
    .eq("id", gameId)
    .single();
  if (!game) return { error: "Game not found." };
  const v = (game.state_version as number | null) ?? 0;
  if (game.status !== "waiting") {
    return game.state ? { state: game.state as GameState, v } : { error: "Game already started." };
  }

  const { data: lobby } = await admin.from("players").select("id, user_id, color, seat").eq("game_id", gameId).order("seat");
  if (!lobby || lobby.length < 2) return { error: "Need at least 2 players." };

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
