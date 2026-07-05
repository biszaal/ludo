/**
 * Network layer for online play.
 *
 * WRITES (create/join/start/roll/move/pass) go through the server-authoritative
 * `game` Edge Function — the server generates the dice and validates every move,
 * so a client can't cheat. READS (lobby, full game fetch, realtime, own presence)
 * stay direct, gated by RLS.
 */

import type { Color, GameState } from "@ludo/engine";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../lib/supabase";

export interface GameRow {
  id: string;
  room_code: string;
  host_user_id: string;
  status: "waiting" | "active" | "finished";
  state: GameState | null;
  current_turn_player_id: string | null;
}

export interface LobbyPlayer {
  id: string;
  user_id: string;
  color: Color;
  seat: number;
  is_host: boolean;
  is_connected: boolean;
}

export interface Membership {
  gameId: string;
  roomCode: string;
  userId: string;
  myPlayerId: string;
}

/** Sign in anonymously if there is no session yet; return the user id. */
export async function ensureSignedIn(): Promise<string> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session) return sessionData.session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(`Sign-in failed: ${error?.message ?? "unknown"}. Enable anonymous sign-ins in Supabase Auth.`);
  }
  return data.user.id;
}

/** Invoke the `game` Edge Function and surface its `{ error }` payload as a throw. */
async function callGame<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
  const supabase = getSupabase();
  const { data, error } = await supabase.functions.invoke("game", { body: { op, ...payload } });
  if (error) {
    let message = error.message;
    const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
    if (ctx?.json) {
      try {
        const parsed = await ctx.json();
        if (parsed?.error) message = parsed.error;
      } catch {
        // keep default message
      }
    }
    throw new Error(message);
  }
  if (data && (data as { error?: string }).error) throw new Error((data as { error: string }).error);
  return data as T;
}

export async function createGame(): Promise<Membership> {
  const userId = await ensureSignedIn();
  const res = await callGame<{ gameId: string; roomCode: string; playerId: string }>("create");
  return { gameId: res.gameId, roomCode: res.roomCode, userId, myPlayerId: res.playerId };
}

export async function joinGame(rawCode: string): Promise<Membership> {
  const userId = await ensureSignedIn();
  const res = await callGame<{ gameId: string; roomCode: string; playerId: string }>("join", { code: rawCode });
  return { gameId: res.gameId, roomCode: res.roomCode, userId, myPlayerId: res.playerId };
}

export async function startGame(gameId: string): Promise<GameState> {
  return (await callGame<{ state: GameState }>("start", { gameId })).state;
}

export async function rollAction(gameId: string): Promise<GameState> {
  return (await callGame<{ state: GameState }>("roll", { gameId })).state;
}

export async function moveAction(gameId: string, tokenId: string): Promise<GameState> {
  return (await callGame<{ state: GameState }>("move", { gameId, tokenId })).state;
}

export async function passAction(gameId: string): Promise<GameState> {
  return (await callGame<{ state: GameState }>("pass", { gameId })).state;
}

/** Host-only: reset a finished game to a fresh one with the same players. */
export async function rematchAction(gameId: string): Promise<GameState> {
  return (await callGame<{ state: GameState }>("rematch", { gameId })).state;
}

export interface Profile {
  user_id: string;
  display_name: string;
  avatar_id: string;
}

/** Fetch profiles for a set of users; missing rows simply aren't returned. */
export async function getProfiles(userIds: string[]): Promise<Profile[]> {
  if (userIds.length === 0) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, avatar_id")
    .in("user_id", userIds);
  if (error) return []; // profiles are cosmetic — never block on them
  return (data ?? []) as Profile[];
}

/** Upsert the caller's own profile row (RLS: self-write only). Best-effort. */
export async function upsertMyProfile(displayName: string, avatarId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return; // not signed in yet — create/join will sync it
  await supabase
    .from("profiles")
    .upsert({ user_id: userId, display_name: displayName.slice(0, 20), avatar_id: avatarId }, { onConflict: "user_id" });
}

export async function getLobby(gameId: string): Promise<LobbyPlayer[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("players")
    .select("id, user_id, color, seat, is_host, is_connected")
    .eq("game_id", gameId)
    .order("seat", { ascending: true });
  if (error) throw new Error(`Could not load players: ${error.message}`);
  return (data ?? []) as LobbyPlayer[];
}

export async function fetchGame(gameId: string): Promise<GameRow> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("games")
    .select("id, room_code, host_user_id, status, state, current_turn_player_id")
    .eq("id", gameId)
    .single();
  if (error || !data) throw new Error(`Could not load game: ${error?.message ?? "unknown"}`);
  return data as GameRow;
}

export async function setConnected(gameId: string, userId: string, connected: boolean): Promise<void> {
  const supabase = getSupabase();
  await supabase.from("players").update({ is_connected: connected }).eq("game_id", gameId).eq("user_id", userId);
}

export interface GameSubscription {
  onGame: (row: GameRow) => void;
  onLobby: () => void;
}

/** Subscribe to a game's row changes (state sync) and its players (lobby). */
export function subscribeGame(gameId: string, handlers: GameSubscription): RealtimeChannel {
  const supabase = getSupabase();
  return supabase
    .channel(`game:${gameId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` },
      (payload) => handlers.onGame(payload.new as GameRow),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `game_id=eq.${gameId}` },
      () => handlers.onLobby(),
    )
    .subscribe();
}

export function unsubscribe(channel: RealtimeChannel): void {
  getSupabase().removeChannel(channel);
}
