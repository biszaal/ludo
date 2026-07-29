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

/** Shareable friend code: 6 chars from the same unambiguous alphabet. Mirrors
 *  gen_friend_code() in 0015 so a code minted here validates against its check. */
function genFriendCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let code = "";
  for (const b of buf) code += alphabet[b % 32];
  return code;
}

const FRIEND_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

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
        return await opQuickMatch(admin, userId, Number(body.size ?? 2), body.stake == null ? null : Number(body.stake));
      case "quickBotFill":
        return await opQuickBotFill(admin, userId, String(body.gameId));
      case "config":
        return await opConfig(admin, req, body.region ? String(body.region) : null);
      case "walletGet":
        return await opWalletGet(admin, userId);
      case "walletState":
        return await opWalletState(admin, userId);
      case "walletTopup":
        return await opWalletTopup(admin, userId);
      case "dailyBonus":
        return await opDailyBonus(admin, userId);
      case "adRewardIntent":
        return await opAdRewardIntent(
          admin,
          userId,
          String(body.placement ?? ""),
          body.gameId ? String(body.gameId) : null,
        );
      case "adRewardStatus":
        return await opAdRewardStatus(admin, userId, String(body.nonce ?? ""));
      case "entitlementsGet":
        return await opEntitlementsGet(admin, userId);
      case "shopBuy":
        return await opShopBuy(admin, userId, String(body.sku ?? ""));
      case "gemsBuy":
        return await opGemsBuy(admin, userId, String(body.productId ?? ""));
      case "gemsExchange":
        return await opGemsExchange(admin, userId, Number(body.gems ?? 0), body.key ? String(body.key) : null);
      case "friendCode":
        return await opFriendCode(admin, userId);
      case "friendLookup":
        return await opFriendLookup(admin, userId, String(body.code ?? ""));
      case "friendRequest":
        return await opFriendRequest(admin, userId, String(body.toUserId ?? ""));
      case "friendsRecent":
        return await opFriendsRecent(admin, userId);
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
  recordFinishStats(admin, gameId, next);
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
  recordFinishStats(admin, gameId, next);
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
      recordFinishStats(admin, gameId, next);
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
  recordFinishStats(admin, gameId, cur);
  afterGameWrite(admin, gameId, !!game.is_quick, cur);

  return json({ state: cur, v });
}

// --- Coins -------------------------------------------------------------------
// All balances live in `wallets`, mutated ONLY through the wallet_apply RPC
// (atomic, overdraw-guarded, ledgered). Quick match stakes a fixed entry;
// the winner takes the pot.
//
// Sources: winning a pot, the daily bonus, rewarded ads (SSV-verified only),
// and a once-a-day pity grant at zero. 0010's unlimited floor top-up is gone —
// it made coins impossible to run out of, so nothing was worth earning.
//
// FAIRNESS INVARIANT: coins buy ACCESS (match entry) and APPEARANCE (themes,
// avatars). Never outcome. No rewarded or purchased mechanic may improve a
// player's chance of winning a match — that is what keeps a coin-staked PvP
// game defensible once coins are real-money purchasable.

const QUICK_STAKE = 100;

/** Quick-match entry tiers. Fallback only — the server config's
 *  economy.stakeTiers is the authority when present. */
const STAKE_TIERS = [100, 1000, 10000];

/** Gem products. Fallback only — gems.products in server config wins. Kept
 *  minimal on purpose: three places carry these (migration seed, this const,
 *  client DEFAULT_CONFIG) and the config read is preferred everywhere. */
const GEM_PRODUCTS: Record<string, number> = {
  "gems.small": 60,
  "gems.medium": 340,
  "gems.large": 750,
};

/** The server's own view of the default config row — authority for economy
 *  gates (never the client's copy, never region-merged: gates don't vary by
 *  country). */
async function serverConfig(admin: SupabaseClient): Promise<Json> {
  const { data } = await admin.from("app_config").select("value").eq("key", "default").maybeSingle();
  return (data?.value ?? {}) as Json;
}

/** Daily bonus: base plus a step per consecutive day, capped. */
const DAILY_BONUS_BASE = 50;
const DAILY_STREAK_STEP = 25;
const DAILY_STREAK_MAX = 7;

/** Coins per rewarded ad, by placement. Server-owned — the client never says
 *  how much a view is worth, it only says which placement it wants. */
const REWARD_COINS: Record<string, number> = {
  coins: 100,
  "free-entry": QUICK_STAKE,
  "double-pot": 0, // computed from the game's stake at intent time
};
/** Rewarded grants a single account can bank per UTC day, by placement. */
const REWARD_DAILY_CAP: Record<string, number> = {
  coins: 8,
  "free-entry": 5,
  "double-pot": 3,
};

/** Returns the new balance, or null when a debit would overdraw (or the RPC failed). */
async function walletApply(
  admin: SupabaseClient,
  userId: string,
  delta: number,
  reason: string,
  gameId: string | null,
  bucket: "earned" | "purchased" = "earned",
  extId: string | null = null,
): Promise<number | null> {
  const { data, error } = await admin.rpc("wallet_apply", {
    p_user: userId,
    p_delta: delta,
    p_reason: reason,
    p_game: gameId,
    p_bucket: bucket,
    p_ext_id: extId,
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
function recordFinishStats(admin: SupabaseClient, gameId: string, next: GameState): void {
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

// --- Remote config -----------------------------------------------------------

type Json = Record<string, unknown>;

/** Deep-merge plain objects; `over` wins. Arrays and scalars replace wholesale
 *  so a country row can override a list without having to restate the rest. */
function deepMerge(base: Json, over: Json): Json {
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const prev = out[k];
    const bothPlain =
      prev !== null && typeof prev === "object" && !Array.isArray(prev) &&
      v !== null && typeof v === "object" && !Array.isArray(v);
    out[k] = bothPlain ? deepMerge(prev as Json, v as Json) : v;
  }
  return out;
}

/** Ad pacing + economy display config, resolved for the caller's region.
 *
 *  Region comes from the edge network's geo header when present, falling back
 *  to whatever the client claims. That fallback is spoofable — fine here,
 *  since everything this returns is pacing and presentation. Never gate coin
 *  PURCHASES on it; use the store receipt's billing country for that. */
async function opConfig(admin: SupabaseClient, req: Request, claimed: string | null): Promise<Response> {
  const geo = req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country");
  const region = (geo && geo !== "XX" ? geo : claimed ?? "").trim().toUpperCase().slice(0, 2);

  const keys = region ? ["default", region] : ["default"];
  const { data } = await admin.from("app_config").select("key, value").in("key", keys);

  const rows = data ?? [];
  const base = (rows.find((r) => r.key === "default")?.value ?? {}) as Json;
  const local = region ? ((rows.find((r) => r.key === region)?.value ?? {}) as Json) : {};
  return json({ config: deepMerge(base, local), region: region || null });
}

async function opWalletGet(admin: SupabaseClient, userId: string): Promise<Response> {
  await admin.from("wallets").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data } = await admin.from("wallets").select("balance").eq("user_id", userId).single();
  return json({ balance: (data?.balance as number | null) ?? 0 });
}

/** UTC calendar day, as a `date`-comparable string. */
function utcDay(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}

interface WalletRow {
  balance: number;
  purchased_balance: number;
  gems: number;
  last_bonus_on: string | null;
  streak_day: number;
  last_pity_at: string | null;
}

async function readWallet(admin: SupabaseClient, userId: string): Promise<WalletRow> {
  await admin.from("wallets").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data } = await admin
    .from("wallets")
    .select("balance, purchased_balance, gems, last_bonus_on, streak_day, last_pity_at")
    .eq("user_id", userId)
    .single();
  return {
    balance: (data?.balance as number | null) ?? 0,
    purchased_balance: (data?.purchased_balance as number | null) ?? 0,
    gems: (data?.gems as number | null) ?? 0,
    last_bonus_on: (data?.last_bonus_on as string | null) ?? null,
    streak_day: (data?.streak_day as number | null) ?? 0,
    last_pity_at: (data?.last_pity_at as string | null) ?? null,
  };
}

/** Everything the wallet UI needs in one round trip. */
async function opWalletState(admin: SupabaseClient, userId: string): Promise<Response> {
  const w = await readWallet(admin, userId);
  return json({
    balance: w.balance,
    purchasedBalance: w.purchased_balance,
    gems: w.gems,
    streakDay: w.streak_day,
    bonusClaimable: w.last_bonus_on !== utcDay(),
    pityAvailable: pityReady(w),
  });
}

/** Returns the new gem count, or null when a debit would overdraw. */
async function gemApply(
  admin: SupabaseClient,
  userId: string,
  delta: number,
  reason: string,
  extId: string | null = null,
): Promise<number | null> {
  const { data, error } = await admin.rpc("gem_apply", {
    p_user: userId,
    p_delta: delta,
    p_reason: reason,
    p_ext_id: extId,
  });
  if (error) return null;
  return (data as number | null) ?? null;
}

// --- Gems --------------------------------------------------------------------
//
// Purchases are double-locked: gems.purchasesEnabled is the public flag, and
// while the provider is the stub, gems.allowStubProvider (server-only, never
// seeded true) must ALSO be set — a mistakenly flipped public flag cannot
// mint unpaid gems. A real store receipt later swaps the stub branch for
// verification and credits through the exact same table + rpc.
async function opGemsBuy(admin: SupabaseClient, userId: string, productId: string): Promise<Response> {
  const cfg = await serverConfig(admin);
  const gems = (cfg.gems ?? {}) as Json;
  if (gems.enabled !== true || gems.purchasesEnabled !== true) {
    return json({ error: "Purchases aren't available yet." });
  }
  if (gems.allowStubProvider !== true) {
    return json({ error: "Purchases aren't available yet." });
  }

  const products = Array.isArray(gems.products) ? (gems.products as { id?: string; gems?: number }[]) : [];
  const fromCfg = products.find((p) => p.id === productId)?.gems;
  const amount = typeof fromCfg === "number" && fromCfg > 0 ? fromCfg : GEM_PRODUCTS[productId];
  if (!amount) return json({ error: "Unknown product." });

  const { data: purchase, error } = await admin
    .from("iap_purchases")
    .insert({ user_id: userId, product_id: productId, gems: amount, provider: "stub" })
    .select("id")
    .single();
  if (error || !purchase) return json({ error: "Could not start the purchase." });

  const newGems = await gemApply(admin, userId, amount, "iap-stub", `iap:${purchase.id}`);
  if (newGems === null) return json({ error: "Could not complete the purchase." });

  await admin
    .from("iap_purchases")
    .update({ status: "credited", credited_at: new Date().toISOString() })
    .eq("id", purchase.id);
  return json({ gems: newGems, purchaseId: purchase.id });
}

/** One-way gems→coins at the server's rate. `key` makes a client retry a
 *  no-op — without one, each call is its own exchange. */
async function opGemsExchange(
  admin: SupabaseClient,
  userId: string,
  gemsWanted: number,
  key: string | null,
): Promise<Response> {
  const cfg = await serverConfig(admin);
  const gemsCfg = (cfg.gems ?? {}) as Json;
  if (gemsCfg.enabled !== true) return json({ error: "Exchange isn't available." });

  const rate = typeof gemsCfg.exchangeRate === "number" && gemsCfg.exchangeRate > 0 ? gemsCfg.exchangeRate : 10;
  const min = typeof gemsCfg.exchangeMin === "number" && gemsCfg.exchangeMin > 0 ? gemsCfg.exchangeMin : 10;
  const amount = Math.floor(gemsWanted);
  if (!Number.isFinite(amount) || amount < min) {
    return json({ error: `Exchange at least ${min} gems.` });
  }

  const extId = `gemx:${userId}:${key ?? crypto.randomUUID()}`;
  const { data, error } = await admin.rpc("gems_exchange", {
    p_user: userId,
    p_gems: amount,
    p_rate: rate,
    p_ext_id: extId,
  });
  if (error) {
    return json({ error: error.message.includes("insufficient") ? "Not enough gems." : "Exchange failed." });
  }
  const row = Array.isArray(data) ? data[0] : data;
  return json({ gems: (row?.gems as number | null) ?? 0, balance: (row?.balance as number | null) ?? 0 });
}

/** Once per UTC day, growing with the streak. Idempotent by date: the claim is
 *  a conditional update, so a double-tap or a retry can't pay twice. */
async function opDailyBonus(admin: SupabaseClient, userId: string): Promise<Response> {
  const today = utcDay();
  const w = await readWallet(admin, userId);
  if (w.last_bonus_on === today) {
    return json({ balance: w.balance, streakDay: w.streak_day, claimed: 0, bonusClaimable: false });
  }

  // Consecutive only if yesterday's claim is the last one on record.
  const yesterday = utcDay(new Date(Date.now() - 86_400_000));
  const streak = w.last_bonus_on === yesterday ? Math.min(w.streak_day + 1, DAILY_STREAK_MAX) : 1;

  // CAS on last_bonus_on: whoever flips it away from the old value owns the payout.
  const claim = admin.from("wallets").update({ last_bonus_on: today, streak_day: streak }).eq("user_id", userId);
  const { data: claimed } = await (w.last_bonus_on === null
    ? claim.is("last_bonus_on", null)
    : claim.eq("last_bonus_on", w.last_bonus_on)
  ).select("user_id").maybeSingle();
  if (!claimed) {
    const fresh = await readWallet(admin, userId);
    return json({ balance: fresh.balance, streakDay: fresh.streak_day, claimed: 0, bonusClaimable: false });
  }

  const amount = DAILY_BONUS_BASE + DAILY_STREAK_STEP * (streak - 1);
  const balance = await walletApply(admin, userId, amount, "daily-bonus", null);
  return json({ balance: balance ?? w.balance, streakDay: streak, claimed: amount, bonusClaimable: false });
}

/** A broke player is never hard-stuck: one small grant a day, only at zero.
 *  Replaces 0010's unlimited floor top-up, which made coins meaningless. */
function pityReady(w: WalletRow): boolean {
  if (w.balance > 0) return false;
  if (!w.last_pity_at) return true;
  return Date.now() - new Date(w.last_pity_at).getTime() >= 86_400_000;
}

async function opWalletTopup(admin: SupabaseClient, userId: string): Promise<Response> {
  const w = await readWallet(admin, userId);
  if (!pityReady(w)) return json({ balance: w.balance, granted: 0 });

  // CAS on last_pity_at so concurrent calls can't double-grant.
  const stamp = admin.from("wallets").update({ last_pity_at: new Date().toISOString() }).eq("user_id", userId);
  const { data: claimed } = await (w.last_pity_at === null
    ? stamp.is("last_pity_at", null)
    : stamp.eq("last_pity_at", w.last_pity_at)
  ).select("user_id").maybeSingle();
  if (!claimed) return json({ balance: w.balance, granted: 0 });

  const balance = await walletApply(admin, userId, QUICK_STAKE, "pity-topup", null);
  return json({ balance: balance ?? w.balance, granted: QUICK_STAKE });
}

// --- Rewarded ads ------------------------------------------------------------
// Two-phase by design. The client asks for an INTENT (this grants nothing), the
// ad plays, and AdMob's signed server-to-server callback is what actually
// credits coins — see functions/ads-ssv. A client that lies, replays, or skips
// the ad entirely gets nothing, which matters because these coins are staked
// against other players and will later be purchasable with real money.
async function opAdRewardIntent(
  admin: SupabaseClient,
  userId: string,
  placement: string,
  gameId: string | null,
): Promise<Response> {
  if (!(placement in REWARD_COINS)) return json({ error: "Unknown placement." });

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await admin
    .from("ad_rewards")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("placement", placement)
    .eq("status", "granted")
    .gte("created_at", since);
  if ((count ?? 0) >= (REWARD_DAILY_CAP[placement] ?? 0)) {
    return json({ error: "That's all the ad rewards for today — try again tomorrow." });
  }

  let coins = REWARD_COINS[placement];
  if (placement === "double-pot") {
    // Half the pot again, house-funded. Post-match and paid by us, never
    // debited from the loser — a reward may never come out of an opponent.
    if (!gameId) return json({ error: "Missing game." });
    const { data: g } = await admin.from("games").select("stake, state").eq("id", gameId).single();
    const stake = (g?.stake as number | null) ?? 0;
    const seats = ((g?.state as GameState | null)?.players ?? []).length;
    coins = Math.floor((stake * seats) / 2);
  }
  if (coins <= 0) return json({ error: "Nothing to award here." });

  const { data: row, error } = await admin
    .from("ad_rewards")
    .insert({ user_id: userId, placement, coins, game_id: gameId })
    .select("id, coins")
    .single();
  if (error || !row) return json({ error: error?.message ?? "Could not start the reward." });

  return json({ nonce: row.id as string, coins: row.coins as number });
}

/** Polled after the ad reports EARNED_REWARD, until SSV lands. */
async function opAdRewardStatus(admin: SupabaseClient, userId: string, nonce: string): Promise<Response> {
  const { data } = await admin
    .from("ad_rewards")
    .select("status, coins")
    .eq("id", nonce)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return json({ error: "Unknown reward." });
  const w = await readWallet(admin, userId);
  return json({ status: data.status as string, coins: data.coins as number, balance: w.balance });
}

// --- Shop --------------------------------------------------------------------

async function opEntitlementsGet(admin: SupabaseClient, userId: string): Promise<Response> {
  // Grandfather: pricing the cosmetics came AFTER people had already picked
  // them, so anyone already wearing a now-paid avatar keeps it for free. Taking
  // something back that a player is currently using is never worth the coins.
  const { data: profile } = await admin
    .from("profiles")
    .select("avatar_id")
    .eq("user_id", userId)
    .maybeSingle();
  const wornSku = profile?.avatar_id ? `avatar.${profile.avatar_id as string}` : null;
  if (wornSku) {
    await admin
      .from("entitlements")
      .insert({ user_id: userId, sku: wornSku, source: "grant" })
      .select("sku")
      .maybeSingle();
    // Duplicate key = already granted, which is the normal path. Ignored.
  }

  const [owned, catalog] = await Promise.all([
    admin.from("entitlements").select("sku").eq("user_id", userId),
    admin.from("catalog").select("sku, kind, price, currency, active").eq("active", true),
  ]);
  return json({
    skus: (owned.data ?? []).map((r) => r.sku as string),
    catalog: catalog.data ?? [],
  });
}

/** Buy a cosmetic. Price AND currency come from the catalog, never from the
 *  client, and the debit is what gates the grant — no debit, no entitlement. */
async function opShopBuy(admin: SupabaseClient, userId: string, sku: string): Promise<Response> {
  const { data: item } = await admin
    .from("catalog")
    .select("sku, price, currency, active")
    .eq("sku", sku)
    .maybeSingle();
  if (!item || !item.active) return json({ error: "That item isn't available." });

  const { data: already } = await admin
    .from("entitlements")
    .select("sku")
    .eq("user_id", userId)
    .eq("sku", sku)
    .maybeSingle();
  if (already) return json({ error: "You already own that." });

  const price = (item.price as number | null) ?? 0;
  const inGems = item.currency === "gems";
  if (price > 0) {
    const paid = inGems
      ? await gemApply(admin, userId, -price, `shop:${sku}`)
      : await walletApply(admin, userId, -price, "shop-purchase", null);
    if (paid === null) return json({ error: inGems ? "Not enough gems." : "Not enough coins." });
  }

  const { error } = await admin
    .from("entitlements")
    .insert({ user_id: userId, sku, source: inGems ? "gems" : "coins" });
  if (error) {
    // Refund rather than silently pocketing the currency.
    if (price > 0) {
      if (inGems) await gemApply(admin, userId, price, "shop-refund");
      else await walletApply(admin, userId, price, "shop-refund", null);
    }
    return json({ error: "Could not complete the purchase." });
  }

  const w = await readWallet(admin, userId);
  return json({ sku, balance: w.balance, gems: w.gems });
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

/** Dice skin ids mirrored from the client's diceSkins.ts set, weighted toward
 *  classic/cheap — the same distribution 0014_dice_skins.sql used to dress
 *  the existing bot pool — so an equipped skin never becomes a bot tell.
 *  Never the gold-and-up prestige tiers: a hidden "opponent" flexing a
 *  75,000-coin skin invites exactly the scrutiny bots are built to avoid. */
function pickBotDiceSkin(rng: () => number): string | null {
  const r = rng();
  if (r < 0.55) return null;
  if (r < 0.7) return "cherry";
  if (r < 0.8) return "mint";
  if (r < 0.88) return "midnight";
  if (r < 0.93) return "bubblegum";
  if (r < 0.97) return "walnut";
  return "neon";
}

/**
 * Pair the caller into the oldest open quick game of their chosen size (1v1 or
 * 4-player), or open a new one. The SQL claim is atomic (row lock + seat insert
 * in one transaction), so simultaneous searchers can't both end up hosting
 * empty rooms. A room starts the moment its last seat fills; part-filled rooms
 * keep waiting (each seated client's fill timer bot-fills the rest).
 */
async function opQuickMatch(
  admin: SupabaseClient,
  userId: string,
  rawSize: number,
  rawStake: number | null,
): Promise<Response> {
  const size = rawSize === 4 ? 4 : 2;

  // Tier must be on the server's list — a hacked client can't invent a pool.
  // Old clients send no stake and get the default tier, unchanged behavior.
  let stake = QUICK_STAKE;
  if (rawStake != null) {
    const cfg = await serverConfig(admin);
    const economy = (cfg.economy ?? {}) as Json;
    const tiers =
      Array.isArray(economy.stakeTiers) && economy.stakeTiers.every((t) => typeof t === "number")
        ? (economy.stakeTiers as number[])
        : STAKE_TIERS;
    if (!tiers.includes(rawStake)) return json({ error: "That entry isn't available." });
    stake = rawStake;
  }

  // Re-tap while already searching: hand back the same waiting room (whatever
  // size it was opened for — one search at a time).
  const { data: mine } = await admin
    .from("players")
    .select("id, game_id, games!inner(status, is_quick, quick_size, stake)")
    .eq("user_id", userId)
    .eq("games.status", "waiting")
    .eq("games.is_quick", true)
    .limit(1)
    .maybeSingle();
  if (mine) {
    const g = mine.games as unknown as { quick_size: number | null; stake: number | null };
    return json({ gameId: mine.game_id, playerId: mine.id, waiting: true, size: g?.quick_size ?? 2, stake: g?.stake ?? QUICK_STAKE });
  }

  const { data: claimed, error: claimErr } = await admin.rpc("quick_match_claim", {
    p_user: userId,
    p_size: size,
    p_stake: stake,
  });
  if (claimErr) return json({ error: claimErr.message });
  if (claimed) {
    const gameId = String(claimed.game_id);
    const playerId = String(claimed.player_id);
    const seated = Number(claimed.seated ?? size);
    // Seat first, stake second: an overdraw hands the seat straight back.
    const debited = await walletApply(admin, userId, -stake, "stake", gameId);
    if (debited === null) {
      await admin.from("players").delete().eq("id", playerId);
      return json({ error: `Not enough coins — you need ${stake} to play.` });
    }
    if (seated < size) {
      // Joined a part-filled 4-player room — keep waiting for the rest.
      return json({ gameId, playerId, waiting: true, size, stake });
    }
    const started = await startGameNow(admin, gameId);
    if ("error" in started) return json({ error: started.error });
    return json({ gameId, playerId, state: started.state, v: started.v, size, stake });
  }

  const debited = await walletApply(admin, userId, -stake, "stake", null);
  if (debited === null) return json({ error: `Not enough coins — you need ${stake} to play.` });

  const { data: game, error } = await admin
    .from("games")
    .insert({ room_code: genCode(), host_user_id: userId, status: "waiting", is_quick: true, quick_size: size, stake })
    .select("id")
    .single();
  if (error || !game) {
    await walletApply(admin, userId, stake, "stake-refund", null);
    return json({ error: error?.message ?? "Could not start matchmaking." });
  }

  const { data: player, error: pErr } = await admin
    .from("players")
    .insert({ game_id: game.id, user_id: userId, color: "red", seat: 0, is_host: true })
    .select("id")
    .single();
  if (pErr || !player) {
    await walletApply(admin, userId, stake, "stake-refund", game.id);
    return json({ error: pErr?.message ?? "Could not start matchmaking." });
  }

  return json({ gameId: game.id, playerId: player.id, waiting: true, size, stake });
}

/**
 * Nobody joined the caller's quick game in time — seat a hidden bot and start.
 * If a human slipped in while the client's timer ran, this just starts the
 * game with them instead (all the races collapse into "start with whoever is
 * seated"; the version guard dedups racing starts).
 */
async function opQuickBotFill(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, status, is_quick, quick_size, state, state_version").eq("id", gameId).single();
  if (!game || !game.is_quick) return json({ error: "Game not found." });
  if (game.status !== "waiting") {
    return game.state
      ? json({ state: game.state as GameState, v: (game.state_version as number | null) ?? 0 })
      : json({ error: "Game not found." });
  }
  const size = (game.quick_size as number | null) ?? 2;

  const { data: seated } = await admin.from("players").select("id, user_id, seat").eq("game_id", gameId).order("seat");
  if (!seated?.some((p) => p.user_id === userId)) return json({ error: "You are not in this game." });

  // Seat bots into every still-empty chair. Colors follow the room size
  // (1v1 diagonal red/yellow, 4-player clockwise) — mirrors the SQL claim.
  const colors = seatColors(size);
  for (let seat = seated.length; seat < size; seat++) {
    const botUserId = await claimOrCreateBotIdentity(admin, gameId);
    if (!botUserId) {
      if (seat > 1) break; // enough seats for a game — start with what we have
      return json({ error: "Could not find an opponent. Try again." });
    }
    const { error: seatErr } = await admin
      .from("players")
      .insert({ game_id: gameId, user_id: botUserId, color: colors[seat], seat });
    if (seatErr) {
      // A human took the seat between our read and the insert — release the
      // identity; the human fills that chair instead.
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
  const diceSkin = pickBotDiceSkin(cryptoRng);
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = pickBotName(cryptoRng, attempt);
    const { error: profErr } = await admin
      .from("profiles")
      .insert({ user_id: uid, display_name: name, avatar_id: avatar, dice_skin: diceSkin });
    if (!profErr) return uid;
    if (!/unique|duplicate/i.test(profErr.message)) break;
  }
  // Names exhausted (or another failure): a timestamp guest handle is unique enough.
  await admin
    .from("profiles")
    .insert({ user_id: uid, display_name: `guest${String(Date.now()).slice(-6)}`, avatar_id: avatar, dice_skin: diceSkin })
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
        recordFinishStats(admin, gameId, next);
        await admin.from("bot_identities").update({ in_use_game_id: null }).eq("in_use_game_id", gameId);
        return;
      }
      if (!nextIsBot) return;
    }
    // CAS loss: loop back, re-read the winner's row and re-decide from there.
    await sleep(BOT_STEP_PAUSE_MS);
  }
}

// --- Friends: discovery -------------------------------------------------------
//
// Most of the friends system is direct-to-table under RLS (0005) and stays that
// way — accept/decline/cancel/unfriend are already correctly constrained and
// expose no discovery surface. Only these four ops need service role:
//
//  - friendCode / friendLookup: a lookup by code must read a row the caller is
//    not party to, and must be throttled. RLS cannot express either.
//  - friendRequest: needs to see game_bots to set auto_decline_at.
//  - friendsRecent: MUST subtract bots, and the client cannot read game_bots
//    (0009). This is the op that forces the whole group server-side.
//
// Errors follow the file convention: HTTP 200 with an { error } body.

const FRIEND_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FRIEND_LOOKUPS_PER_HOUR = 40;
const FRIEND_REQUESTS_PER_HOUR = 20;
const RECENT_OPPONENT_LIMIT = 20;

/** True when the call is within its hourly budget. */
async function rateOk(admin: SupabaseClient, userId: string, bucket: string, limit: number): Promise<boolean> {
  const { data, error } = await admin.rpc("rate_limit_hit", {
    p_user: userId,
    p_bucket: bucket,
    p_limit: limit,
  });
  if (error) return true; // never lock players out of the app on a counter failure
  return data !== false;
}

/** Delete bot-targeted requests whose randomized decline delay has elapsed.
 *  pg_cron is the primary reaper; this covers environments without it. */
function reapAutoDeclines(admin: SupabaseClient): void {
  afterResponse(
    admin.from("friendships").delete().not("auto_decline_at", "is", null).lt("auto_decline_at", new Date().toISOString()),
  );
}

/** The caller's own code, minted on first read if the 0015 trigger missed it. */
async function opFriendCode(admin: SupabaseClient, userId: string): Promise<Response> {
  const { data: existing } = await admin.from("friend_codes").select("code").eq("user_id", userId).maybeSingle();
  if (existing?.code) return json({ code: existing.code });

  // Retry on collision — the unique index is the real guarantee, mirroring how
  // wallet_apply handles a lost ext_id race (0013).
  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "";
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    for (const b of buf) code += FRIEND_CODE_ALPHABET[b % 32];
    const { data, error } = await admin
      .from("friend_codes")
      .insert({ user_id: userId, code })
      .select("code")
      .maybeSingle();
    if (data?.code) return json({ code: data.code });
    // Someone assigned ours concurrently — take theirs and stop.
    if (error) {
      const { data: raced } = await admin.from("friend_codes").select("code").eq("user_id", userId).maybeSingle();
      if (raced?.code) return json({ code: raced.code });
    }
  }
  return json({ error: "Could not create your friend code. Try again." });
}

/**
 * Resolve a friend code to a player card.
 *
 * Malformed and not-found return the identical message on purpose, so the
 * response shape cannot be used to tell "this code is well-formed but unused"
 * from "this is not a code" — that difference is what makes scanning cheap.
 */
async function opFriendLookup(admin: SupabaseClient, userId: string, rawCode: string): Promise<Response> {
  const notFound = { error: "No player with that code." };
  if (!(await rateOk(admin, userId, "friendLookup", FRIEND_LOOKUPS_PER_HOUR))) {
    return json({ error: "Too many lookups. Try again later." });
  }
  const code = rawCode.trim().toUpperCase();
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) return json(notFound);

  const { data: row } = await admin.from("friend_codes").select("user_id").eq("code", code).maybeSingle();
  const targetId = row?.user_id as string | undefined;
  if (!targetId || targetId === userId) return json(notFound);

  const { data: blocked } = await admin.rpc("is_blocked", { a: userId, b: targetId });
  if (blocked === true) return json(notFound); // don't confirm the account exists

  const [{ data: profile }, { data: stats }] = await Promise.all([
    admin.from("profiles").select("user_id, display_name, avatar_id, dice_skin").eq("user_id", targetId).maybeSingle(),
    admin.from("player_stats").select("games_played, games_won").eq("user_id", targetId).maybeSingle(),
  ]);
  if (!profile) return json(notFound);

  return json({
    user: profile,
    stats: stats ?? { games_played: 0, games_won: 0 },
  });
}

/**
 * Send a friend request.
 *
 * RLS already enforces the block check and the rate caps on insert; this op
 * exists to turn those into readable errors and to set auto_decline_at, which
 * needs game_bots visibility the client does not have.
 */
async function opFriendRequest(admin: SupabaseClient, userId: string, toUserId: string): Promise<Response> {
  reapAutoDeclines(admin);
  if (!toUserId || toUserId === userId) return json({ error: "That isn't a valid player." });
  if (!(await rateOk(admin, userId, "friendRequest", FRIEND_REQUESTS_PER_HOUR))) {
    return json({ error: "You've sent a lot of requests. Try again in an hour." });
  }

  const { data: blocked } = await admin.rpc("is_blocked", { a: userId, b: toUserId });
  if (blocked === true) return json({ error: "You can't add this player." });

  // They already asked us — accept instead of creating a reverse duplicate.
  const { data: reverse } = await admin
    .from("friendships")
    .select("id, status")
    .eq("requester_user_id", toUserId)
    .eq("addressee_user_id", userId)
    .maybeSingle();
  if (reverse) {
    if (reverse.status === "pending") {
      await admin.from("friendships").update({ status: "accepted", auto_decline_at: null }).eq("id", reverse.id);
    }
    return json({ ok: true, status: "accepted" });
  }

  // Hidden bots decline on a randomized 45s-4min delay. Instant would be a
  // tell; this reads exactly like a human getting round to it.
  const { data: botRow } = await admin.from("bot_identities").select("user_id").eq("user_id", toUserId).maybeSingle();
  const autoDeclineAt = botRow
    ? new Date(Date.now() + (45 + Math.random() * 195) * 1000).toISOString()
    : null;

  const { error } = await admin
    .from("friendships")
    .upsert(
      { requester_user_id: userId, addressee_user_id: toUserId, status: "pending", auto_decline_at: autoDeclineAt },
      { onConflict: "requester_user_id,addressee_user_id" },
    );
  if (error) return json({ error: "Could not send that request." });
  return json({ ok: true, status: "pending" });
}

/**
 * People you've played with recently and could still add.
 *
 * Server-side because the bot subtraction is not expressible client-side: the
 * client cannot read game_bots at all (0009), and a "friend" who is never
 * online and never answers an invite would unravel the quick-match illusion.
 */
async function opFriendsRecent(admin: SupabaseClient, userId: string): Promise<Response> {
  reapAutoDeclines(admin);

  // Games I was in, most recent first (players_user_recent_idx, 0015).
  const { data: mine } = await admin
    .from("players")
    .select("game_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(40);
  const gameIds = (mine ?? []).map((r) => r.game_id as string);
  if (gameIds.length === 0) return json({ players: [] });

  const { data: seats } = await admin
    .from("players")
    .select("user_id, game_id, created_at")
    .in("game_id", gameIds)
    .neq("user_id", userId)
    .order("created_at", { ascending: false });
  if (!seats || seats.length === 0) return json({ players: [] });

  // Subtract bots, then anyone already in a friendship, then blocks.
  const [{ data: bots }, { data: rels }, { data: blocks }] = await Promise.all([
    admin.from("game_bots").select("user_id").in("game_id", gameIds),
    admin
      .from("friendships")
      .select("requester_user_id, addressee_user_id")
      .or(`requester_user_id.eq.${userId},addressee_user_id.eq.${userId}`),
    admin.from("blocks").select("blocker_user_id, blocked_user_id").or(`blocker_user_id.eq.${userId},blocked_user_id.eq.${userId}`),
  ]);

  const excluded = new Set<string>([userId]);
  for (const b of bots ?? []) excluded.add(b.user_id as string);
  for (const r of rels ?? []) {
    excluded.add(r.requester_user_id as string);
    excluded.add(r.addressee_user_id as string);
  }
  for (const b of blocks ?? []) {
    excluded.add(b.blocker_user_id as string);
    excluded.add(b.blocked_user_id as string);
  }

  const ordered: string[] = [];
  for (const s of seats) {
    const uid = s.user_id as string;
    if (excluded.has(uid)) continue;
    excluded.add(uid); // dedupe: keep the most recent encounter only
    ordered.push(uid);
    if (ordered.length >= RECENT_OPPONENT_LIMIT) break;
  }
  if (ordered.length === 0) return json({ players: [] });

  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id, display_name, avatar_id, dice_skin")
    .in("user_id", ordered);

  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  return json({ players: ordered.map((uid) => byId.get(uid)).filter(Boolean) });
}
