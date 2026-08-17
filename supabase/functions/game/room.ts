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
  LIMITS,
  rateLimited,
  rateOk,
  safeError,
  serverConfig,
  STAKE_TIERS,
  turnDeadline,
  type Json,
  type SupabaseClient,
  WRITE_FAILED,
} from "./lib.ts";
import { afterGameWrite, seatBots } from "./bots.ts";
import { startGameNow } from "./deal.ts";
import { recordFinishStats, settleIfFinished } from "./finish.ts";
import { walletApply } from "./wallet.ts";

/**
 * Validate a host-chosen room stake against the server's tier list.
 *
 * 0 is always allowed — a friendly game is the default and must never depend
 * on config. Anything else has to be a tier the server published, for the same
 * reason quick match checks (quick.ts): a modified client must not be able to
 * invent a pool, least of all one it can talk friends into joining.
 */
async function validRoomStake(admin: SupabaseClient, raw: number | null): Promise<number | null> {
  if (raw == null || raw === 0) return 0;
  if (!Number.isFinite(raw) || raw < 0) return null;
  const cfg = await serverConfig(admin);
  const economy = (cfg.economy ?? {}) as Json;
  const tiers =
    Array.isArray(economy.stakeTiers) && economy.stakeTiers.every((t) => typeof t === "number")
      ? (economy.stakeTiers as number[])
      : STAKE_TIERS;
  return tiers.includes(raw) ? raw : null;
}

export async function opCreate(admin: SupabaseClient, userId: string, rawStake: number | null): Promise<Response> {
  if (!(await rateOk(admin, userId, "roomCreate", LIMITS.roomCreate))) return rateLimited();

  const stake = await validRoomStake(admin, rawStake);
  if (stake === null) return json({ error: "That entry isn't available." });

  const roomCode = genCode();
  // No debit here. Unlike quick match (which debits on seat, because the seat
  // IS the queue), a room can sit unstarted for as long as the host likes —
  // charging at creation would strand coins in a lobby nobody ever begins.
  // deal.ts collects from every seat at start instead.
  const { data: game, error } = await admin
    .from("games")
    .insert({ room_code: roomCode, host_user_id: userId, status: "waiting", stake })
    .select("id")
    .single();
  if (error || !game) return json({ error: error?.message ?? "Could not create game." });

  const { data: player, error: pErr } = await admin
    .from("players")
    .insert({ game_id: game.id, user_id: userId, color: "red", seat: 0, is_host: true })
    .select("id")
    .single();
  if (pErr || !player) return json({ error: pErr?.message ?? "Could not seat host." });

  return json({ gameId: game.id, roomCode, playerId: player.id, stake });
}

export async function opJoin(admin: SupabaseClient, userId: string, rawCode: string): Promise<Response> {
  const roomCode = rawCode.trim().toUpperCase();
  const { data: game } = await admin
    .from("games")
    .select("id, status, stake")
    .eq("room_code", roomCode)
    .maybeSingle();
  if (!game) return json({ error: "No game found with that code." });
  if (game.status !== "waiting") return json({ error: "That game has already started." });
  const stake = (game.stake as number | null) ?? 0;

  const { data: existing } = await admin.from("players").select("id, user_id, seat").eq("game_id", game.id).order("seat");
  const mine = existing?.find((p) => p.user_id === userId);
  if (mine) return json({ gameId: game.id, roomCode, playerId: mine.id, stake });
  if ((existing?.length ?? 0) >= 4) return json({ error: "That game is full." });

  const seat = existing?.length ?? 0;
  const { data: player, error } = await admin
    .from("players")
    .insert({ game_id: game.id, user_id: userId, color: FULL_ORDER[seat], seat })
    .select("id")
    .single();
  if (error || !player) return json({ error: error?.message ?? "Could not join." });

  return json({ gameId: game.id, roomCode, playerId: player.id, stake });
}

/**
 * Host starts the room. With `fill`, the empty chairs are seated with bots
 * first, so three friends can play a full four-handed game instead of waiting
 * on a fourth who isn't coming.
 *
 * Unlike quick match these bots are LABELLED (players.is_bot, 0035). In a
 * private room everyone knows who was invited, so an unexplained extra name
 * would read as a stranger walking in.
 *
 * FRIENDLY ROOMS ONLY. The pot is stake × every seat and the house stands the
 * bot seats' share (finish.ts), which is fine when nobody chose to be matched
 * with a bot — but a host who can summon them on demand could open a
 * max-stake room, fill it with three bots, and farm the house at better than
 * even odds. Staked rooms need real opponents; the client hides the toggle,
 * and this is the rule that actually enforces it.
 */
export async function opStart(
  admin: SupabaseClient,
  userId: string,
  gameId: string,
  fill: boolean,
): Promise<Response> {
  const { data: game } = await admin
    .from("games")
    .select("id, host_user_id, status, stake")
    .eq("id", gameId)
    .single();
  if (!game) return json({ error: "Game not found." });
  if (game.host_user_id !== userId) return json({ error: "Only the host can start." });
  if (game.status !== "waiting") return json({ error: "Game already started." });

  if (fill) {
    if (((game.stake as number | null) ?? 0) > 0) {
      return json({ error: "Bots can only fill a friendly room. Coin games need real players." });
    }
    const { data: seated } = await admin.from("players").select("id").eq("game_id", gameId);
    const taken = seated?.length ?? 0;
    // A lone host filling up gets a full table; otherwise top up to four.
    if (taken < FULL_ORDER.length) {
      await seatBots(admin, gameId, taken, FULL_ORDER.length, FULL_ORDER, true);
    }
  }

  const started = await startGameNow(admin, gameId);
  return json(started);
}

/**
 * Hand a waiting quick-match room's entry fees back.
 *
 * The ext_id is what makes this safe to call from a fire-and-forget leave: the
 * client sends `leave` without awaiting it and the reaper may sweep the same
 * room later, so the refund has to be idempotent per (game, player) rather than
 * merely rare. wallet_txns_ext_id_uidx (0013) is the backstop.
 */
async function refundSeats(
  admin: SupabaseClient,
  gameId: string,
  stake: number,
  userIds: string[],
): Promise<void> {
  for (const uid of new Set(userIds)) {
    await walletApply(admin, uid, stake, "stake-refund", gameId, "earned", `leave-refund:${gameId}:${uid}`);
  }
}

/**
 * A player quits the room for good. Active game: the engine removes their
 * tokens and skips their turns from now on (2-player: the opponent wins) — the
 * stake is forfeited, which the client warns about before calling this.
 * Waiting lobby: the seat is freed and any quick-match entry is refunded.
 * Idempotent and safe to call as a fire-and-forget on the way out.
 */
export async function opLeave(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin
    .from("games")
    .select("id, host_user_id, status, state, state_version, is_quick, has_bots, stake")
    .eq("id", gameId)
    .single();
  if (!game) return json({ error: "Game not found." });
  const v = (game.state_version as number | null) ?? 0;

  if (game.status === "waiting") {
    if (game.is_quick && game.host_user_id === userId) {
      // Cancel matchmaking: tear the queue room down so another searcher
      // can't claim a seat opposite someone who already walked away.
      //
      // Read the seats BEFORE the delete — `players` cascades from `games`, so
      // afterwards there is nothing left to tell us who to pay back. Every
      // seated player was debited by quick_match_claim, not just the host, so
      // cancelling a part-filled 4-player room has to refund all of them.
      const { data: seated } = await admin.from("players").select("user_id").eq("game_id", gameId);
      // The status guard no-ops if a claim+start won the race (no refund then —
      // the game is live and the stake rides on it).
      const { data: deleted } = await admin
        .from("games")
        .delete()
        .eq("id", gameId)
        .eq("status", "waiting")
        .select("stake");
      const stake = (deleted?.[0]?.stake as number | null) ?? 0;
      if (stake > 0) await refundSeats(admin, gameId, stake, (seated ?? []).map((p) => String(p.user_id)));
      return json({ ok: true });
    }
    // Free the seat so someone else can take it. The host's seat stays (the
    // room is theirs); their absence just leaves the lobby idle.
    if (game.host_user_id !== userId) {
      const { data: removed } = await admin
        .from("players")
        .delete()
        .eq("game_id", gameId)
        .eq("user_id", userId)
        .select("id");
      // Nothing was seated (already left, or never here) — nothing to refund.
      if (!removed?.length) return json({ ok: true });

      // Quick match debits on seat claim (quick.ts), so a guest walking out of
      // the queue is owed their entry back. Friend rooms don't debit until the
      // host starts (deal.ts), so there is nothing to return there.
      const stake = (game.stake as number | null) ?? 0;
      if (game.is_quick && stake > 0) {
        // Re-read the status: a claim+start could have filled the table between
        // our read and this delete, and once the game is live the stake rides
        // on it — refunding then would hand a seated player their entry back.
        const { data: after } = await admin.from("games").select("status").eq("id", gameId).maybeSingle();
        if (after?.status === "waiting") await refundSeats(admin, gameId, stake, [userId]);
      }
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
  if (error) return safeError("room.write", error, WRITE_FAILED);
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
  if (error) return safeError("room.write", error, WRITE_FAILED);
  if (!updated) return await freshState(admin, gameId, prev);

  afterResponse(admin.from("players").update({ missed_turns: 0 }).eq("game_id", gameId));
  const me = prev.players.find((p) => p.userId === userId);
  afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: me?.id ?? null, action: { action: "rematch" } }));
  afterGameWrite(admin, gameId, !!game.has_bots, next);

  return json({ state: next, v: v + 1 });
}
