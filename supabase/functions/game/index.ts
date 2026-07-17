/**
 * Server-authoritative game function (Supabase Edge / Deno).
 *
 * All state mutations go through here so clients cannot cheat: the dice is
 * generated with crypto on the server, and every move is re-validated with the
 * shared engine before the new GameState is written. The function uses the
 * service-role key (auto-injected) to write past RLS, but authorizes each call
 * against the caller's JWT.
 *
 * Body: { op: "create" | "join" | "start" | "roll" | "move" | "pass" | "timeout" | "rematch" | "leave"
 *             | "quickMatch" | "quickBotFill", ... }
 * Always responds 200 with either a payload or `{ error }`.
 *
 * Quick match: "quickMatch" pairs the caller into the oldest open queue game
 * (atomic SQL claim) or opens a new one ({ waiting: true }). If nobody shows
 * up, the client calls "quickBotFill" and the server seats a hidden bot — a
 * real auth user with an ordinary profile, driven server-side from turn 1 via
 * chained waitUntil steps (see driveBotTurns). Nothing client-readable marks
 * the seat as a bot.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5";
import {
  applyMove,
  createGame as engineCreateGame,
  endTurn,
  getValidMoves,
  leaveGame as engineLeaveGame,
  rollDice,
  validateMove,
  type Color,
  type GameState,
  type Rng,
} from "../_shared/engine/index.js";
import { chooseMove } from "../_shared/bot/index.js";
import { corsHeaders } from "../_shared/cors.ts";

const FULL_ORDER: Color[] = ["red", "green", "yellow", "blue"];

/** How long a player has to act before any peer may skip their turn. */
const TURN_SECONDS = 30;

/** A fresh deadline for an active turn, or null once the game is over. */
function turnDeadline(state: GameState): string | null {
  return state.status === "active" ? new Date(Date.now() + TURN_SECONDS * 1000).toISOString() : null;
}

/** 2 players sit diagonally (red/yellow); otherwise clockwise. Mirrors the client. */
function seatColors(count: number): Color[] {
  return count === 2 ? ["red", "yellow"] : FULL_ORDER.slice(0, count);
}

function genCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 4294967296;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

/** Bookkeeping writes (audit log, presence) that must not block the response.
 *  waitUntil keeps the isolate alive until they settle; failures are swallowed
 *  — none of them affect game state. */
function afterResponse(task: PromiseLike<unknown>): void {
  const settled = Promise.resolve(task).catch(() => {});
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(settled);
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
async function authUserId(admin: SupabaseClient, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, jwks);
    if (typeof payload.sub === "string" && payload.sub) return payload.sub;
  } catch {
    // fall through to remote verification
  }
  const { data, error } = await admin.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

/** A racing write beat ours — return the current authoritative row instead. */
async function freshState(admin: SupabaseClient, gameId: string, fallback: GameState): Promise<Response> {
  const { data } = await admin.from("games").select("state, state_version").eq("id", gameId).single();
  return json({ state: (data?.state as GameState) ?? fallback, v: data?.state_version ?? null });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const userId = await authUserId(admin, token);
    if (!userId) return json({ error: "Not authenticated." });

    const body = await req.json();
    switch (body.op) {
      case "create":
        return await opCreate(admin, userId);
      case "join":
        return await opJoin(admin, userId, String(body.code ?? ""));
      case "start":
        return await opStart(admin, userId, String(body.gameId));
      case "roll":
        return await opTurn(admin, userId, String(body.gameId), "roll");
      case "move":
        return await opTurn(admin, userId, String(body.gameId), "move", String(body.tokenId));
      case "pass":
        return await opTurn(admin, userId, String(body.gameId), "pass");
      case "timeout":
        return await opTimeout(admin, userId, String(body.gameId));
      case "rematch":
        return await opRematch(admin, userId, String(body.gameId));
      case "leave":
        return await opLeave(admin, userId, String(body.gameId));
      case "quickMatch":
        return await opQuickMatch(admin, userId);
      case "quickBotFill":
        return await opQuickBotFill(admin, userId, String(body.gameId));
      case "walletGet":
        return await opWalletGet(admin, userId);
      case "walletTopup":
        return await opWalletTopup(admin, userId);
      default:
        return json({ error: "Unknown op." });
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) });
  }
});

async function opCreate(admin: SupabaseClient, userId: string): Promise<Response> {
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

async function opJoin(admin: SupabaseClient, userId: string, rawCode: string): Promise<Response> {
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

async function opStart(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, host_user_id, status").eq("id", gameId).single();
  if (!game) return json({ error: "Game not found." });
  if (game.host_user_id !== userId) return json({ error: "Only the host can start." });
  if (game.status !== "waiting") return json({ error: "Game already started." });
  const started = await startGameNow(admin, gameId);
  return json(started);
}

type StartResult = { state: GameState; v: number } | { error: string };

/**
 * Deal the game from whoever is seated and flip the row to active. No host
 * check — quick-match paths start rooms on behalf of either seat. Racing
 * starts collapse via the version guard; the loser gets the live row back.
 */
async function startGameNow(admin: SupabaseClient, gameId: string): Promise<StartResult> {
  const { data: game } = await admin.from("games").select("id, status, is_quick, state, state_version").eq("id", gameId).single();
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
  if (error) return { error: error.message };
  if (!updated) {
    const { data } = await admin.from("games").select("state, state_version").eq("id", gameId).single();
    return data?.state
      ? { state: data.state as GameState, v: (data.state_version as number | null) ?? 0 }
      : { error: "Could not start the game." };
  }

  afterResponse(admin.from("players").update({ missed_turns: 0 }).eq("game_id", gameId));
  afterGameWrite(admin, gameId, !!game.is_quick, state);

  return { state, v: v + 1 };
}

/**
 * A player quits the room for good. Active game: the engine removes their
 * tokens and skips their turns from now on (2-player: the opponent wins).
 * Waiting lobby: the seat is freed (non-host). Idempotent and safe to call
 * as a fire-and-forget on the way out.
 */
async function opLeave(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, host_user_id, status, state, state_version, is_quick").eq("id", gameId).single();
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
  afterGameWrite(admin, gameId, !!game.is_quick, next);
  return json({ state: next, v: v + 1 });
}

/** Host-only: reset a finished game to a fresh state with the same seats/colors. */
async function opRematch(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, host_user_id, status, state, state_version, is_quick").eq("id", gameId).single();
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
  afterGameWrite(admin, gameId, !!game.is_quick, next);

  return json({ state: next, v: v + 1 });
}

async function opTurn(
  admin: SupabaseClient,
  userId: string,
  gameId: string,
  action: "roll" | "move" | "pass",
  tokenId?: string,
): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, state, state_version, is_quick").eq("id", gameId).single();
  if (!game || !game.state) return json({ error: "Game not found." });

  const state = game.state as GameState;
  const v = (game.state_version as number | null) ?? 0;
  if (state.status !== "active") return json({ error: "Game is not active." });

  const me = state.players.find((p) => p.userId === userId);
  if (!me) return json({ error: "You are not in this game." });
  if (me.id !== state.currentTurnPlayerId) return json({ error: "Not your turn." });

  let next: GameState;
  if (action === "roll") {
    if (state.phase !== "awaiting-roll") return json({ error: "You already rolled." });
    next = rollDice(state, cryptoRng).newState;
  } else if (action === "pass") {
    if (state.phase !== "awaiting-move") return json({ error: "Roll first." });
    if (getValidMoves(state, me.id).length > 0) return json({ error: "You still have a move." });
    next = endTurn(state);
  } else {
    if (state.phase !== "awaiting-move") return json({ error: "Roll first." });
    const check = validateMove(state, { tokenId: tokenId ?? "" });
    if (!check.valid) return json({ error: check.reason ?? "Illegal move." });
    next = applyMove(state, { tokenId: tokenId ?? "" });
  }

  // Version-guarded write: a racing write (stall bot, duplicate tap) loses
  // cleanly instead of silently clobbering, and the counter gives clients a
  // cheap dedup/ordering key for every realtime row.
  const { data: updated, error } = await admin
    .from("games")
    .update({
      state: next,
      status: next.status,
      current_turn_player_id: next.currentTurnPlayerId,
      turn_deadline: turnDeadline(next),
      state_version: v + 1,
    })
    .eq("id", gameId)
    .eq("state_version", v)
    .select("id")
    .maybeSingle();
  if (error) return json({ error: error.message });
  if (!updated) return await freshState(admin, gameId, state);

  afterResponse(
    admin.from("moves").insert({ game_id: gameId, player_id: me.id, action: { action, tokenId: tokenId ?? null, dice: next.diceValue } }),
  );
  // Acting proves the player is present — clear the idle strike counter. Only
  // write when something changes: every players write fans out a realtime
  // event that makes each client refetch the lobby.
  afterResponse(
    admin
      .from("players")
      .update({ missed_turns: 0, is_connected: true })
      .eq("game_id", gameId)
      .eq("user_id", userId)
      .or("missed_turns.neq.0,is_connected.eq.false"),
  );
  await settleIfFinished(admin, gameId, next);
  afterGameWrite(admin, gameId, !!game.is_quick, next);

  return json({ state: next, v: v + 1 });
}

/** Pause between the bot's writes so clients can animate each one — outlasts
 *  the ~700ms die tumble, mirroring the client autopilot's pacing. */
const BOT_STEP_PAUSE_MS = 900;
/**
 * Consecutive whole turns a player may idle through (bot-played) before the
 * server removes them from the game. A briefly-minimized app resets the count
 * the moment it comes back (resync / next action); a closed app never does.
 */
const MISSED_TURNS_TO_LEAVE = 3;
/** Safety cap on one call's bot actions (extra turns from 6s/captures chain).
 *  If a turn somehow runs longer, the peers' timers fire again and resume. */
const BOT_MAX_ACTIONS = 8;

/**
 * The current turn idled past its deadline — the player's app is closed or
 * asleep, so nothing local can act for them. The server's bot policy plays the
 * turn for them (roll, then the policy's move, or a forced pass), including any
 * extra turns it earns, paced so clients can animate each write. Any
 * participant may call this (the idle player rarely will); the server re-checks
 * the clock, so a client can't trigger it early. Every write is guarded on the
 * turn_deadline it read — the deadline refreshes on every write, so racing
 * callers and a returning player can never double-act a turn.
 */
async function opTimeout(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, state, turn_deadline, state_version, is_quick").eq("id", gameId).single();
  if (!game || !game.state) return json({ error: "Game not found." });
  let v = (game.state_version as number | null) ?? 0;

  const state = game.state as GameState;
  if (state.status !== "active") return json({ error: "Game is not active." });

  // Only participants can drive the room's clock.
  if (!state.players.some((p) => p.userId === userId)) return json({ error: "You are not in this game." });

  // Re-check the deadline server-side — the source of truth, not the caller.
  const deadline = game.turn_deadline ? Date.parse(game.turn_deadline) : NaN;
  if (!Number.isFinite(deadline) || Date.now() < deadline) {
    return json({ state, v }); // not actually expired (or already advanced) — no-op
  }

  const awayPlayerId = state.currentTurnPlayerId;
  const awayUserId = state.players.find((p) => p.id === awayPlayerId)?.userId;

  // Hidden-bot seat whose driver isolate died: no Away badge, no idle strikes
  // (either would out the bot). The loop below simply plays the turn.
  let stalledBot = false;
  if (game.is_quick && awayUserId) {
    const { data: botRow } = await admin
      .from("game_bots")
      .select("user_id")
      .eq("game_id", gameId)
      .eq("user_id", awayUserId)
      .maybeSingle();
    stalledBot = !!botRow;
  }

  // They idled through the whole clock — show the room an Away badge and count
  // the strike. Their own device clears both on foreground/resync (or their
  // next action); a closed app never comes back, so the strikes accumulate.
  if (awayUserId && !stalledBot) {
    const { data: row } = await admin
      .from("players")
      .select("missed_turns")
      .eq("game_id", gameId)
      .eq("user_id", awayUserId)
      .maybeSingle();
    const missed = (row?.missed_turns ?? 0) + 1;
    await admin
      .from("players")
      .update({ is_connected: false, missed_turns: missed })
      .eq("game_id", gameId)
      .eq("user_id", awayUserId);

    if (missed >= MISSED_TURNS_TO_LEAVE) {
      // Gone for good — remove them from the game instead of bot-playing
      // another turn. Guard on the deadline we read so a racing caller (or
      // the player suddenly returning) can't double-apply.
      const next = engineLeaveGame(state, awayPlayerId, { now: Date.now() });
      const { data: updated, error } = await admin
        .from("games")
        .update({ state: next, status: next.status, current_turn_player_id: next.currentTurnPlayerId, turn_deadline: turnDeadline(next), state_version: v + 1 })
        .eq("id", gameId)
        .eq("turn_deadline", game.turn_deadline!)
        .eq("state_version", v)
        .select("id")
        .maybeSingle();
      if (error) return json({ error: error.message });
      if (!updated) return await freshState(admin, gameId, state);
      afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: awayPlayerId, action: { action: "auto-leave", missed } }));
      await settleIfFinished(admin, gameId, next);
      afterGameWrite(admin, gameId, !!game.is_quick, next);
      return json({ state: next, v: v + 1 });
    }
  }

  let cur = state;
  let guard: string | null = game.turn_deadline;
  for (let step = 0; step < BOT_MAX_ACTIONS; step++) {
    let next: GameState;
    let logged: Record<string, unknown>;
    if (cur.phase === "awaiting-roll") {
      const roll = rollDice(cur, cryptoRng);
      next = roll.newState;
      logged = { action: "bot-roll", dice: roll.diceValue };
    } else {
      const moves = getValidMoves(cur, awayPlayerId);
      if (moves.length === 0) {
        next = endTurn(cur);
        logged = { action: "bot-pass", dice: cur.diceValue };
      } else {
        const move = chooseMove(cur, awayPlayerId, moves);
        next = applyMove(cur, { tokenId: move.tokenId });
        logged = { action: "bot-move", tokenId: move.tokenId, dice: cur.diceValue };
      }
    }

    const nextDeadline = turnDeadline(next);
    const { data: updated, error } = await admin
      .from("games")
      .update({ state: next, status: next.status, current_turn_player_id: next.currentTurnPlayerId, turn_deadline: nextDeadline, state_version: v + 1 })
      .eq("id", gameId)
      .eq("turn_deadline", guard!)
      .eq("state_version", v)
      .select("id")
      .maybeSingle();
    if (error) return json({ error: error.message });
    if (!updated) {
      // Someone else wrote first (racing caller, or the player came back) —
      // return the current authoritative state.
      return await freshState(admin, gameId, cur);
    }

    afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: awayPlayerId, action: logged }));

    cur = next;
    v += 1;
    guard = nextDeadline;
    if (next.status !== "active" || next.currentTurnPlayerId !== awayPlayerId || !guard) break;
    // Let clients animate this write (die tumble / token hops) before the next.
    await new Promise((resolve) => setTimeout(resolve, BOT_STEP_PAUSE_MS));
  }

  // If the turn handed off to a hidden bot (or the game just finished),
  // settle any pot and resume the quick-game machinery.
  await settleIfFinished(admin, gameId, cur);
  afterGameWrite(admin, gameId, !!game.is_quick, cur);

  return json({ state: cur, v });
}

// --- Coins -------------------------------------------------------------------
// All balances live in `wallets`, mutated ONLY through the wallet_apply RPC
// (atomic, overdraw-guarded, ledgered). Quick match stakes a fixed entry;
// the winner takes the pot. Balances below the floor top back up on request
// so a player can always afford the next game.

const QUICK_STAKE = 100;
const WALLET_FLOOR = 100;

/** Returns the new balance, or null when a debit would overdraw (or the RPC failed). */
async function walletApply(
  admin: SupabaseClient,
  userId: string,
  delta: number,
  reason: string,
  gameId: string | null,
): Promise<number | null> {
  const { data, error } = await admin.rpc("wallet_apply", {
    p_user: userId,
    p_delta: delta,
    p_reason: reason,
    p_game: gameId,
  });
  if (error) return null;
  return (data as number | null) ?? null;
}

/**
 * Pay the pot exactly once when a staked game finishes: the payout_done CAS is
 * the latch, so racing finisher paths (opTurn, bot driver, leave, timeout)
 * collapse to a single credit. A winning hidden bot forfeits to the house.
 */
async function settleIfFinished(admin: SupabaseClient, gameId: string, next: GameState): Promise<void> {
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
  await walletApply(admin, winnerUserId, stake * 2, "win", gameId);
}

async function opWalletGet(admin: SupabaseClient, userId: string): Promise<Response> {
  await admin.from("wallets").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data } = await admin.from("wallets").select("balance").eq("user_id", userId).single();
  return json({ balance: (data?.balance as number | null) ?? 0 });
}

/** Top a low balance back up to the floor. Server-guarded: a balance at or
 *  above the floor gets nothing, so the client can't farm it. */
async function opWalletTopup(admin: SupabaseClient, userId: string): Promise<Response> {
  await admin.from("wallets").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data } = await admin.from("wallets").select("balance").eq("user_id", userId).single();
  const balance = (data?.balance as number | null) ?? 0;
  if (balance >= WALLET_FLOOR) return json({ balance });
  const topped = await walletApply(admin, userId, WALLET_FLOOR - balance, "floor-topup", null);
  return json({ balance: topped ?? balance });
}

// --- Quick match + hidden bots ----------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Beat before the hidden "opponent" reacts — reads as a human noticing their turn. */
const BOT_TURN_LEAD_MS = 900;
/** Short deadline while the server drives a bot: if the driving isolate dies,
 *  any client's timeout call resumes the turn after ~12s instead of 30. */
const BOT_TURN_SECONDS = 12;

/** Fill-in identities: everyday first names (some with an initial), mixed with
 *  the app's own guest-handle format so the pool reads like the player base. */
const BOT_NAMES = [
  "Maya", "Arjun K", "Sofia", "Leo M", "Priya", "Daniel", "Amara", "Kenji",
  "Lucas P", "Anika", "Mateo", "Zoe", "Rahul", "Elena V", "Sam T", "Nadia",
  "Omar", "Isla", "Ravi J", "Clara", "Tomas", "Mina K", "Jonas", "Aisha",
  "Nikhil", "Lena", "Marco B", "Tara", "Felix", "Divya", "Noah S", "Ipsita",
];

function pickBotName(rng: () => number, attempt: number): string {
  // A third of the pool presents as app guests; the rest as chosen names.
  if (rng() < 0.34) return `guest${String(Math.floor(rng() * 900000) + 100000)}`;
  const base = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)]!;
  return attempt === 0 ? base : `${base}${Math.floor(rng() * 90) + 10}`;
}

/** Avatar ids mirrored from the client's Avatar.tsx set. */
const BOT_AVATARS = ["leo", "sunny", "coco", "zara", "rex", "nina", "milo", "ivy", "ace", "ruby", "bruno", "kito"];

/**
 * Pair the caller into the oldest open quick game, or open a new one. The SQL
 * claim is atomic (row lock + seat insert in one transaction), so simultaneous
 * searchers can't both end up hosting empty rooms.
 */
async function opQuickMatch(admin: SupabaseClient, userId: string): Promise<Response> {
  // Re-tap while already searching: hand back the same waiting room.
  const { data: mine } = await admin
    .from("players")
    .select("id, game_id, games!inner(status, is_quick)")
    .eq("user_id", userId)
    .eq("games.status", "waiting")
    .eq("games.is_quick", true)
    .limit(1)
    .maybeSingle();
  if (mine) return json({ gameId: mine.game_id, playerId: mine.id, waiting: true });

  const { data: claimed, error: claimErr } = await admin.rpc("quick_match_claim", { p_user: userId });
  if (claimErr) return json({ error: claimErr.message });
  if (claimed) {
    const gameId = String(claimed.game_id);
    const playerId = String(claimed.player_id);
    // Seat first, stake second: an overdraw hands the seat straight back.
    const debited = await walletApply(admin, userId, -QUICK_STAKE, "stake", gameId);
    if (debited === null) {
      await admin.from("players").delete().eq("id", playerId);
      return json({ error: `Not enough coins — you need ${QUICK_STAKE} to play.` });
    }
    const started = await startGameNow(admin, gameId);
    if ("error" in started) return json({ error: started.error });
    return json({ gameId, playerId, state: started.state, v: started.v, stake: QUICK_STAKE });
  }

  const debited = await walletApply(admin, userId, -QUICK_STAKE, "stake", null);
  if (debited === null) return json({ error: `Not enough coins — you need ${QUICK_STAKE} to play.` });

  const { data: game, error } = await admin
    .from("games")
    .insert({ room_code: genCode(), host_user_id: userId, status: "waiting", is_quick: true, stake: QUICK_STAKE })
    .select("id")
    .single();
  if (error || !game) {
    await walletApply(admin, userId, QUICK_STAKE, "stake-refund", null);
    return json({ error: error?.message ?? "Could not start matchmaking." });
  }

  const { data: player, error: pErr } = await admin
    .from("players")
    .insert({ game_id: game.id, user_id: userId, color: "red", seat: 0, is_host: true })
    .select("id")
    .single();
  if (pErr || !player) {
    await walletApply(admin, userId, QUICK_STAKE, "stake-refund", game.id);
    return json({ error: pErr?.message ?? "Could not start matchmaking." });
  }

  return json({ gameId: game.id, playerId: player.id, waiting: true, stake: QUICK_STAKE });
}

/**
 * Nobody joined the caller's quick game in time — seat a hidden bot and start.
 * If a human slipped in while the client's timer ran, this just starts the
 * game with them instead (all the races collapse into "start with whoever is
 * seated"; the version guard dedups racing starts).
 */
async function opQuickBotFill(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, status, is_quick, state, state_version").eq("id", gameId).single();
  if (!game || !game.is_quick) return json({ error: "Game not found." });
  if (game.status !== "waiting") {
    return game.state
      ? json({ state: game.state as GameState, v: (game.state_version as number | null) ?? 0 })
      : json({ error: "Game not found." });
  }

  const { data: seated } = await admin.from("players").select("id, user_id").eq("game_id", gameId);
  if (!seated?.some((p) => p.user_id === userId)) return json({ error: "You are not in this game." });

  if (seated.length === 1) {
    const botUserId = await claimOrCreateBotIdentity(admin, gameId);
    if (!botUserId) return json({ error: "Could not find an opponent. Try again." });

    const { error: seatErr } = await admin
      .from("players")
      .insert({ game_id: gameId, user_id: botUserId, color: "yellow", seat: 1 });
    if (seatErr) {
      // A human took the seat between our read and the insert — release the
      // identity and fall through to start with them.
      afterResponse(
        admin.from("bot_identities").update({ in_use_game_id: null }).eq("user_id", botUserId).eq("in_use_game_id", gameId),
      );
    } else {
      await admin.from("game_bots").insert({ game_id: gameId, user_id: botUserId });
    }
  }

  const started = await startGameNow(admin, gameId);
  return json(started);
}

/**
 * Reuse a free identity from the pool, or mint one: a real auth user (so the
 * profiles FK holds) with an ordinary profile row — indistinguishable from a
 * human to every client-readable surface.
 */
async function claimOrCreateBotIdentity(admin: SupabaseClient, gameId: string): Promise<string | null> {
  const { data: claimed } = await admin.rpc("claim_bot_identity", { p_game: gameId });
  if (claimed) return String(claimed);

  const { data: created, error } = await admin.auth.admin.createUser({
    email: `bot-${crypto.randomUUID()}@bots.ludo.internal`,
    email_confirm: true,
  });
  if (error || !created?.user) return null;
  const uid = created.user.id;
  await admin.from("bot_identities").insert({ user_id: uid, in_use_game_id: gameId });

  const avatar = BOT_AVATARS[Math.floor(cryptoRng() * BOT_AVATARS.length)]!;
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = pickBotName(cryptoRng, attempt);
    const { error: profErr } = await admin.from("profiles").insert({ user_id: uid, display_name: name, avatar_id: avatar });
    if (!profErr) return uid;
    if (!/unique|duplicate/i.test(profErr.message)) break;
  }
  // Names exhausted (or another failure): a timestamp guest handle is unique enough.
  await admin
    .from("profiles")
    .insert({ user_id: uid, display_name: `guest${String(Date.now()).slice(-6)}`, avatar_id: avatar })
    .then(undefined, () => {});
  return uid;
}

/**
 * Post-write hook for quick games: on finish, release the bots' identities back
 * to the pool; while active, if the turn just landed on a hidden bot, drive it
 * after a human-feeling pause. Runs via waitUntil — never on the response path.
 * Every write inside is version-guarded, so a duplicate driver (racing calls,
 * an opTimeout fallback) loses cleanly instead of double-acting.
 */
function afterGameWrite(admin: SupabaseClient, gameId: string, isQuick: boolean, next: GameState): void {
  if (!isQuick) return;
  afterResponse(
    (async () => {
      const { data } = await admin.from("game_bots").select("user_id").eq("game_id", gameId);
      const botIds = new Set((data ?? []).map((r) => String(r.user_id)));
      if (botIds.size === 0) return;

      if (next.status === "finished") {
        await admin.from("bot_identities").update({ in_use_game_id: null }).eq("in_use_game_id", gameId);
        return;
      }
      if (next.status !== "active") return;

      // A rematch re-deals the same room — re-mark the identities as in use
      // (best-effort; purely advisory bookkeeping for the reuse pool).
      if (next.lastAction?.type === "createGame") {
        await admin
          .from("bot_identities")
          .update({ in_use_game_id: gameId })
          .in("user_id", [...botIds])
          .is("in_use_game_id", null);
      }

      const uid = next.players.find((p) => p.id === next.currentTurnPlayerId)?.userId;
      if (!uid || !botIds.has(uid)) return;
      await sleep(BOT_TURN_LEAD_MS);
      await driveBotTurns(admin, gameId, botIds);
    })(),
  );
}

/**
 * Server-side driver for hidden-bot seats: re-read, act, CAS-write, pace,
 * repeat while the turn belongs to a bot. Re-reading every step makes racing
 * drivers harmless — a lost write just re-reads the winner's row and carries
 * on from there. The step cap bounds one isolate's run; the short bot deadline
 * plus the clients' opTimeout path resumes a turn if the isolate is evicted.
 */
async function driveBotTurns(admin: SupabaseClient, gameId: string, botIds: Set<string>): Promise<void> {
  for (let step = 0; step < BOT_MAX_ACTIONS * 3; step++) {
    const { data: game } = await admin.from("games").select("state, state_version").eq("id", gameId).single();
    const cur = game?.state as GameState | undefined;
    if (!cur) return;
    const v = (game!.state_version as number | null) ?? 0;
    if (cur.status !== "active") {
      await admin.from("bot_identities").update({ in_use_game_id: null }).eq("in_use_game_id", gameId);
      return;
    }
    const pid = cur.currentTurnPlayerId;
    const uid = cur.players.find((p) => p.id === pid)?.userId;
    if (!uid || !botIds.has(uid)) return; // a human's turn — stand down

    let next: GameState;
    let logged: Record<string, unknown>;
    if (cur.phase === "awaiting-roll") {
      const roll = rollDice(cur, cryptoRng);
      next = roll.newState;
      logged = { action: "bot-roll", dice: roll.diceValue };
    } else {
      const moves = getValidMoves(cur, pid);
      if (moves.length === 0) {
        next = endTurn(cur);
        logged = { action: "bot-pass", dice: cur.diceValue };
      } else {
        const move = chooseMove(cur, pid, moves);
        next = applyMove(cur, { tokenId: move.tokenId });
        logged = { action: "bot-move", tokenId: move.tokenId, dice: cur.diceValue };
      }
    }

    const nextUid = next.players.find((p) => p.id === next.currentTurnPlayerId)?.userId;
    const nextIsBot = !!nextUid && botIds.has(nextUid);
    const deadlineSecs = nextIsBot ? BOT_TURN_SECONDS : TURN_SECONDS;
    const { data: updated, error } = await admin
      .from("games")
      .update({
        state: next,
        status: next.status,
        current_turn_player_id: next.currentTurnPlayerId,
        turn_deadline: next.status === "active" ? new Date(Date.now() + deadlineSecs * 1000).toISOString() : null,
        state_version: v + 1,
      })
      .eq("id", gameId)
      .eq("state_version", v)
      .select("id")
      .maybeSingle();
    if (error) return;

    if (updated) {
      afterResponse(admin.from("moves").insert({ game_id: gameId, player_id: pid, action: logged }));
      if (next.status !== "active") {
        await settleIfFinished(admin, gameId, next);
        await admin.from("bot_identities").update({ in_use_game_id: null }).eq("in_use_game_id", gameId);
        return;
      }
      if (!nextIsBot) return;
    }
    // CAS loss: loop back, re-read the winner's row and re-decide from there.
    await sleep(BOT_STEP_PAUSE_MS);
  }
}
