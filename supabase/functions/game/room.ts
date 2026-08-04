/**
 * Room lifecycle: opening a room, joining by code, starting, leaving, and the
 * rematch. Turn actions live in turn.ts; matchmaking in quick.ts.
 */

// @deno-types="../_shared/engine/index.d.ts"
import {
  createGame as engineCreateGame,
  leaveGame as engineLeaveGame,
  type GameState,
} from "../_shared/engine/index.js";
import {
  afterResponse,
  freshState,
  FULL_ORDER,
  genCode,
  json,
  turnDeadline,
  type SupabaseClient,
} from "./lib.ts";
import { afterGameWrite } from "./bots.ts";
import { startGameNow } from "./deal.ts";
import { recordFinishStats, settleIfFinished } from "./finish.ts";
import { walletApply } from "./wallet.ts";

export async function opCreate(admin: SupabaseClient, userId: string): Promise<Response> {
  const roomCode = genCode();
  const { data: game, error } = await admin
    .from("games")
    .insert({ room_code: roomCode, host_user_id: userId, status: "waiting" })
    .select("id")
    .single();
  if (error || !game) return json({ error: error?.message ?? "Could not create game." });

  const { data: player, error: pErr } = await admin
    .from("players")
    .insert({ game_id: game.id, user_id: userId, color: "red", seat: 0, is_host: true })
    .select("id")
    .single();
  if (pErr || !player) return json({ error: pErr?.message ?? "Could not seat host." });

  return json({ gameId: game.id, roomCode, playerId: player.id });
}

export async function opJoin(admin: SupabaseClient, userId: string, rawCode: string): Promise<Response> {
  const roomCode = rawCode.trim().toUpperCase();
  const { data: game } = await admin.from("games").select("id, status").eq("room_code", roomCode).maybeSingle();
  if (!game) return json({ error: "No game found with that code." });
  if (game.status !== "waiting") return json({ error: "That game has already started." });

  const { data: existing } = await admin.from("players").select("id, user_id, seat").eq("game_id", game.id).order("seat");
  const mine = existing?.find((p) => p.user_id === userId);
  if (mine) return json({ gameId: game.id, roomCode, playerId: mine.id });
  if ((existing?.length ?? 0) >= 4) return json({ error: "That game is full." });

  const seat = existing?.length ?? 0;
  const { data: player, error } = await admin
    .from("players")
    .insert({ game_id: game.id, user_id: userId, color: FULL_ORDER[seat], seat })
    .select("id")
    .single();
  if (error || !player) return json({ error: error?.message ?? "Could not join." });

  return json({ gameId: game.id, roomCode, playerId: player.id });
}

export async function opStart(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, host_user_id, status").eq("id", gameId).single();
  if (!game) return json({ error: "Game not found." });
  if (game.host_user_id !== userId) return json({ error: "Only the host can start." });
  if (game.status !== "waiting") return json({ error: "Game already started." });
  const started = await startGameNow(admin, gameId);
  return json(started);
}

/**
 * A player quits the room for good. Active game: the engine removes their
 * tokens and skips their turns from now on (2-player: the opponent wins).
 * Waiting lobby: the seat is freed (non-host). Idempotent and safe to call
 * as a fire-and-forget on the way out.
 */
export async function opLeave(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin
    .from("games")
    .select("id, host_user_id, status, state, state_version, is_quick, has_bots")
    .eq("id", gameId)
    .single();
  if (!game) return json({ error: "Game not found." });
  const v = (game.state_version as number | null) ?? 0;

  if (game.status === "waiting") {
    if (game.is_quick && game.host_user_id === userId) {
      // Cancel matchmaking: tear the queue room down so another searcher
      // can't claim a seat opposite someone who already walked away. The
      // status guard no-ops if a claim+start won the race (no refund then —
      // the game is live and the stake rides on it).
      const { data: deleted } = await admin
        .from("games")
        .delete()
        .eq("id", gameId)
        .eq("status", "waiting")
        .select("stake");
      const stake = (deleted?.[0]?.stake as number | null) ?? 0;
      if (stake > 0) await walletApply(admin, userId, stake, "stake-refund", gameId);
      return json({ ok: true });
    }
    // Free the seat so someone else can take it. The host's seat stays (the
    // room is theirs); their absence just leaves the lobby idle.
    if (game.host_user_id !== userId) {
      await admin.from("players").delete().eq("game_id", gameId).eq("user_id", userId);
    }
    return json({ ok: true });
  }

  const state = game.state as GameState | null;
  if (!state) return json({ error: "Game not found." });
  const me = state.players.find((p) => p.userId === userId);
  if (!me) return json({ error: "You are not in this game." });

  afterResponse(admin.from("players").update({ is_connected: false }).eq("game_id", gameId).eq("user_id", userId));
  if (game.status !== "active" || me.hasLeft) return json({ state, v });

  const next = engineLeaveGame(state, me.id, { now: Date.now() });
  const { data: updated, error } = await admin
    .from("games")
    .update({ state: next, status: next.status, current_turn_player_id: next.currentTurnPlayerId, turn_deadline: turnDeadline(next), state_version: v + 1 })
    .eq("id", gameId)
    .eq("state_version", v)
    .select("id")
    .maybeSingle();
  if (error) return json({ error: error.message });
  if (!updated) return await freshState(admin, gameId, state);

  afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: me.id, action: { action: "leave" } }));
  await settleIfFinished(admin, gameId, next);
  recordFinishStats(admin, gameId, next);
  afterGameWrite(admin, gameId, !!game.has_bots, next);
  return json({ state: next, v: v + 1 });
}

/** Host-only: reset a finished game to a fresh state with the same seats/colors. */
export async function opRematch(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin
    .from("games")
    .select("id, host_user_id, status, state, state_version, has_bots")
    .eq("id", gameId)
    .single();
  if (!game || !game.state) return json({ error: "Game not found." });
  if (game.host_user_id !== userId) return json({ error: "Only the host can start a rematch." });
  if (game.status !== "finished") return json({ error: "The game is still in progress." });
  const v = (game.state_version as number | null) ?? 0;

  const prev = game.state as GameState;
  // Players who left are gone for good — the rematch seats whoever stayed.
  const stayed = prev.players.filter((p) => !p.hasLeft);
  if (stayed.length < 2) return json({ error: "Not enough players left for a rematch." });
  const players = stayed.map((p) => ({ id: p.id, userId: p.userId, color: p.color }));
  const next = engineCreateGame(players, { gameId });

  const { data: updated, error } = await admin
    .from("games")
    // Rematches play for fun: the previous pot is already paid out, and
    // silently re-debiting seated guests would be a hidden charge — so the
    // stake resets along with the payout latch.
    .update({ state: next, status: "active", current_turn_player_id: next.currentTurnPlayerId, turn_deadline: turnDeadline(next), state_version: v + 1, stake: 0, payout_done: false })
    .eq("id", gameId)
    .eq("state_version", v)
    .select("id")
    .maybeSingle();
  if (error) return json({ error: error.message });
  if (!updated) return await freshState(admin, gameId, prev);

  afterResponse(admin.from("players").update({ missed_turns: 0 }).eq("game_id", gameId));
  const me = prev.players.find((p) => p.userId === userId);
  afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: me?.id ?? null, action: { action: "rematch" } }));
  afterGameWrite(admin, gameId, !!game.has_bots, next);

  return json({ state: next, v: v + 1 });
}
