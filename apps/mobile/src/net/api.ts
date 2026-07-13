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
  /** Monotonic write counter — dedup/ordering key for every authoritative
   *  state. Null only on rows written before the column existed. */
  state_version: number | null;
}

/** An authoritative state plus its version, as returned by every turn op. */
export interface TurnResult {
  state: GameState;
  v: number | null;
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

/** Give up on a stalled call well before fetch's own timeout — the caller
 *  resyncs, and a write that lands late anyway dedupes via its version. */
const CALL_TIMEOUT_MS = 8000;

/** Invoke the `game` Edge Function and surface its `{ error }` payload as a throw. */
async function callGame<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
  const supabase = getSupabase();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The server took too long — check your connection.")), CALL_TIMEOUT_MS);
  });
  const { data, error } = await Promise.race([
    supabase.functions.invoke("game", { body: { op, ...payload } }),
    timeout,
  ]).finally(() => clearTimeout(timer));
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

async function turnCall(op: string, payload: Record<string, unknown>): Promise<TurnResult> {
  const res = await callGame<{ state: GameState; v?: number | null }>(op, payload);
  return { state: res.state, v: res.v ?? null };
}

export async function startGame(gameId: string): Promise<TurnResult> {
  return turnCall("start", { gameId });
}

export async function rollAction(gameId: string): Promise<TurnResult> {
  return turnCall("roll", { gameId });
}

export async function moveAction(gameId: string, tokenId: string): Promise<TurnResult> {
  return turnCall("move", { gameId, tokenId });
}

export async function passAction(gameId: string): Promise<TurnResult> {
  return turnCall("pass", { gameId });
}

/** Skip the current turn once its server deadline has passed (any participant). */
export async function timeoutAction(gameId: string): Promise<TurnResult> {
  return turnCall("timeout", { gameId });
}

/** Host-only: reset a finished game to a fresh one with the same players. */
export async function rematchAction(gameId: string): Promise<TurnResult> {
  return turnCall("rematch", { gameId });
}

/** Quit the room for good: active game → tokens removed and turns skipped;
 *  waiting lobby → the seat is freed. Fire-and-forget on the way out. */
export async function leaveAction(gameId: string): Promise<void> {
  await callGame<unknown>("leave", { gameId });
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

/** Upsert the caller's own profile row (RLS: self-write only). Best-effort —
 *  a display name already registered to another user is rejected by the DB's
 *  unique index, and the previous server-side name simply stays. */
export async function upsertMyProfile(displayName: string, avatarId: string): Promise<void> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return; // not signed in yet — create/join will sync it
  await supabase
    .from("profiles")
    .upsert({ user_id: userId, display_name: displayName.slice(0, 20), avatar_id: avatarId }, { onConflict: "user_id" });
}

/** Is this display name already registered to ANOTHER user? Best-effort: false
 *  on any failure or when signed out (the unique index still has final say). */
export async function isNameTaken(name: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const me = sessionData.session?.user.id;
  if (!me) return false;
  // ilike with wildcards escaped = case-insensitive equality, matching the index.
  const escaped = name.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .ilike("display_name", escaped)
    .neq("user_id", me)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

/** Retry an idempotent read a couple of times with backoff — flaky mobile
 *  networks drop individual requests far more often than they go fully dark.
 *  Never used for turn ops: replaying a lost roll could double-act a turn. */
async function withRetry<T>(fn: () => Promise<T>, tries = 3, delayMs = 400): Promise<T> {
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (--tries <= 0) throw e;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

export async function getLobby(gameId: string): Promise<LobbyPlayer[]> {
  const supabase = getSupabase();
  return withRetry(async () => {
    const { data, error } = await supabase
      .from("players")
      .select("id, user_id, color, seat, is_host, is_connected")
      .eq("game_id", gameId)
      .order("seat", { ascending: true });
    if (error) throw new Error(`Could not load players: ${error.message}`);
    return (data ?? []) as LobbyPlayer[];
  });
}

export async function fetchGame(gameId: string): Promise<GameRow> {
  const supabase = getSupabase();
  return withRetry(async () => {
    const { data, error } = await supabase
      .from("games")
      .select("id, room_code, host_user_id, status, state, current_turn_player_id, state_version")
      .eq("id", gameId)
      .single();
    if (error || !data) throw new Error(`Could not load game: ${error?.message ?? "unknown"}`);
    return data as GameRow;
  });
}

export async function setConnected(gameId: string, userId: string, connected: boolean): Promise<void> {
  const supabase = getSupabase();
  // Coming back also clears the idle-strike counter — proof this was a
  // minimized app, not a closed one (the server auto-leaves at 3 strikes).
  const patch = connected ? { is_connected: true, missed_turns: 0 } : { is_connected: false };
  await supabase.from("players").update(patch).eq("game_id", gameId).eq("user_id", userId);
}

/** Ephemeral in-room chatter carried on the realtime channel (never stored). */
export interface ChatPayload {
  kind: "reaction" | "text";
  value: string;
  fromUserId: string;
}

export interface GameSubscription {
  onGame: (row: GameRow) => void;
  onLobby: () => void;
  onChat?: (payload: ChatPayload) => void;
  /** The socket dropped and rejoined: row updates in the gap were lost, not
   *  queued — the subscriber must refetch to catch up. */
  onReconnect?: () => void;
}

/** Subscribe to a game's row changes (state sync), its players (lobby), and chat. */
export function subscribeGame(gameId: string, handlers: GameSubscription): RealtimeChannel {
  const supabase = getSupabase();
  let everSubscribed = false;
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
    .on("broadcast", { event: "chat" }, (msg) => handlers.onChat?.(msg.payload as ChatPayload))
    .subscribe((status) => {
      // Fires SUBSCRIBED again on every automatic rejoin after a drop.
      if (status !== "SUBSCRIBED") return;
      if (everSubscribed) handlers.onReconnect?.();
      everSubscribed = true;
    });
}

/** Broadcast a reaction/message to the room (senders don't receive their own). */
export function sendChat(channel: RealtimeChannel, payload: ChatPayload): void {
  void channel.send({ type: "broadcast", event: "chat", payload }).catch(() => {});
}

export function unsubscribe(channel: RealtimeChannel): void {
  getSupabase().removeChannel(channel);
}
