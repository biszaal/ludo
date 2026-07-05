/**
 * Server-authoritative game function (Supabase Edge / Deno).
 *
 * All state mutations go through here so clients cannot cheat: the dice is
 * generated with crypto on the server, and every move is re-validated with the
 * shared engine before the new GameState is written. The function uses the
 * service-role key (auto-injected) to write past RLS, but authorizes each call
 * against the caller's JWT.
 *
 * Body: { op: "create" | "join" | "start" | "roll" | "move" | "pass" | "rematch", ... }
 * Always responds 200 with either a payload or `{ error }`.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyMove,
  createGame as engineCreateGame,
  endTurn,
  getValidMoves,
  rollDice,
  validateMove,
  type Color,
  type GameState,
  type Rng,
} from "../_shared/engine/index.js";
import { corsHeaders } from "../_shared/cors.ts";

const FULL_ORDER: Color[] = ["red", "green", "yellow", "blue"];

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !auth.user) return json({ error: "Not authenticated." });
    const userId = auth.user.id;

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
      case "rematch":
        return await opRematch(admin, userId, String(body.gameId));
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

  const { data: lobby } = await admin.from("players").select("id, user_id, color, seat").eq("game_id", gameId).order("seat");
  if (!lobby || lobby.length < 2) return json({ error: "Need at least 2 players." });

  const colors = seatColors(lobby.length);
  const players = lobby.map((p, i) => ({ id: p.id, userId: p.user_id, color: colors[i]! }));
  const state = engineCreateGame(players, { gameId });

  const { error } = await admin
    .from("games")
    .update({ state, status: "active", current_turn_player_id: state.currentTurnPlayerId })
    .eq("id", gameId);
  if (error) return json({ error: error.message });

  return json({ state });
}

/** Host-only: reset a finished game to a fresh state with the same seats/colors. */
async function opRematch(admin: SupabaseClient, userId: string, gameId: string): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, host_user_id, status, state").eq("id", gameId).single();
  if (!game || !game.state) return json({ error: "Game not found." });
  if (game.host_user_id !== userId) return json({ error: "Only the host can start a rematch." });
  if (game.status !== "finished") return json({ error: "The game is still in progress." });

  const prev = game.state as GameState;
  const players = prev.players.map((p) => ({ id: p.id, userId: p.userId, color: p.color }));
  const next = engineCreateGame(players, { gameId });

  const { error } = await admin
    .from("games")
    .update({ state: next, status: "active", current_turn_player_id: next.currentTurnPlayerId })
    .eq("id", gameId);
  if (error) return json({ error: error.message });

  const me = prev.players.find((p) => p.userId === userId);
  await admin.from("moves").insert({ game_id: gameId, player_id: me?.id ?? null, action: { action: "rematch" } });

  return json({ state: next });
}

async function opTurn(
  admin: SupabaseClient,
  userId: string,
  gameId: string,
  action: "roll" | "move" | "pass",
  tokenId?: string,
): Promise<Response> {
  const { data: game } = await admin.from("games").select("id, state").eq("id", gameId).single();
  if (!game || !game.state) return json({ error: "Game not found." });

  const state = game.state as GameState;
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

  const { error } = await admin
    .from("games")
    .update({ state: next, status: next.status, current_turn_player_id: next.currentTurnPlayerId })
    .eq("id", gameId);
  if (error) return json({ error: error.message });

  await admin.from("moves").insert({ game_id: gameId, player_id: me.id, action: { action, tokenId: tokenId ?? null, dice: next.diceValue } });

  return json({ state: next });
}
