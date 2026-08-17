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
import { getIdentity } from "../lib/identityClient";

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
  /** Coins each seat put in (0 = friendly game). Winner takes stake × seats. */
  stake?: number | null;
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
  /** A bot the host asked for when filling a friend room (0035). Always false
   *  for quick match — those fill-ins are deliberately indistinguishable. */
  is_bot: boolean;
}

export interface Membership {
  gameId: string;
  roomCode: string;
  userId: string;
  myPlayerId: string;
  /** Coins each seat pays when the game starts (0 = friendly). */
  stake?: number;
}

/**
 * The user id, signing in if needed. Single-flight and keychain-backed — see
 * lib/identity.ts for why both of those are load-bearing.
 */
export async function ensureSignedIn(): Promise<string> {
  return await getIdentity().ensureSignedIn();
}

/**
 * Give up WAITING on a stalled call. Note what this does not do: the request
 * itself is not aborted and keeps travelling, so a timeout means "outcome
 * unknown", never "it didn't happen". Callers must not treat it as a failure
 * and undo optimistic work — a write that lands late still arrives over
 * realtime and dedupes on its version. See TimeoutError below.
 *
 * Congested mobile networks routinely push a round trip past 8s, which is what
 * this used to allow; the old budget turned ordinary lag into a phantom
 * failure several times a match.
 */
const CALL_TIMEOUT_MS = 20000;

/** Thrown when the wait elapsed with the request still in flight. The action
 *  may well have succeeded — reconcile against the server, don't roll back. */
export class TimeoutError extends Error {
  constructor() {
    super("Still waiting on the server — check your connection.");
    this.name = "TimeoutError";
  }
}

export const isTimeout = (e: unknown): boolean => e instanceof TimeoutError;

/** Invoke the `game` Edge Function and surface its `{ error }` payload as a throw. */
async function callGame<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
  const supabase = getSupabase();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), CALL_TIMEOUT_MS);
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

/** Open a private room. `stake` is the per-seat pot (0 = friendly); the server
 *  validates it against its tier list and collects it at start, not now. */
export async function createGame(stake = 0): Promise<Membership> {
  const userId = await ensureSignedIn();
  const res = await callGame<RoomResult>("create", { stake });
  return { gameId: res.gameId, roomCode: res.roomCode, userId, myPlayerId: res.playerId, stake: res.stake ?? 0 };
}

export async function joinGame(rawCode: string): Promise<Membership> {
  const userId = await ensureSignedIn();
  const res = await callGame<RoomResult>("join", { code: rawCode });
  return { gameId: res.gameId, roomCode: res.roomCode, userId, myPlayerId: res.playerId, stake: res.stake ?? 0 };
}

interface RoomResult {
  gameId: string;
  roomCode: string;
  playerId: string;
  /** Per-seat entry. Absent on old servers; treat as a friendly game. */
  stake?: number;
}

async function turnCall(op: string, payload: Record<string, unknown>): Promise<TurnResult> {
  const res = await callGame<{ state: GameState; v?: number | null }>(op, payload);
  return { state: res.state, v: res.v ?? null };
}

export interface QuickMatchResult {
  gameId: string;
  userId: string;
  myPlayerId: string;
  /** True: still seats to fill — wait for a match (or the fill). */
  waiting?: boolean;
  /** Set when the claim filled the room instantly: the game is already dealt. */
  state?: GameState;
  v?: number | null;
  /** Entry coins debited for this match. */
  stake?: number;
  /** The room's table size (2 = 1v1, 4 = free-for-all). */
  size?: number;
}

/** Pair into the oldest open quick game of this size AND stake tier, or open
 *  one and wait. The server validates the stake against its tier list. */
export async function quickMatch(size: 2 | 4, stake?: number): Promise<QuickMatchResult> {
  const userId = await ensureSignedIn();
  const res = await callGame<{
    gameId: string;
    playerId: string;
    waiting?: boolean;
    state?: GameState;
    v?: number | null;
    stake?: number;
    size?: number;
  }>("quickMatch", stake == null ? { size } : { size, stake });
  return {
    gameId: res.gameId,
    userId,
    myPlayerId: res.playerId,
    waiting: res.waiting,
    state: res.state,
    v: res.v ?? null,
    stake: res.stake,
    size: res.size,
  };
}

/** Nobody joined in time — ask the server to seat an opponent and start. */
export async function quickBotFill(gameId: string): Promise<TurnResult> {
  return turnCall("quickBotFill", { gameId });
}

/** Best-effort region hint from the device locale ("en-NP" -> "NP"). Only a
 *  fallback: the server prefers its own geo header, since this is spoofable. */
function deviceRegion(): string | undefined {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return /-([A-Z]{2})\b/.exec(locale)?.[1];
  } catch {
    return undefined;
  }
}

/** Ad pacing + economy config for this region. Pacing and presentation only —
 *  every coin amount is re-decided server-side at grant time. */
export async function getConfig(): Promise<{ config: unknown; region: string | null }> {
  await ensureSignedIn();
  const res = await callGame<{ config: unknown; region: string | null }>("config", { region: deviceRegion() });
  return { config: res.config, region: res.region ?? null };
}

/** Own coin balance (server-authoritative; creates the wallet on first read). */
export async function getWallet(): Promise<number> {
  await ensureSignedIn();
  const res = await callGame<{ balance: number }>("walletGet");
  return res.balance;
}

export interface WalletState {
  balance: number;
  /** The money-backed subset of `balance` (0 until coin packs ship). */
  purchasedBalance: number;
  /** Premium currency. Old servers omit it; treat missing as 0. */
  gems?: number;
  streakDay: number;
  bonusClaimable: boolean;
  /** A once-a-day grant is available because the balance is at zero. */
  pityAvailable: boolean;
}

/** Balance, streak and what's claimable — one round trip for the wallet UI. */
export async function getWalletState(): Promise<WalletState> {
  await ensureSignedIn();
  return await callGame<WalletState>("walletState");
}

/** Claim today's bonus. Server-side idempotent by UTC date; `claimed` is 0 if
 *  it was already taken. */
export interface DailyBonusResult {
  balance: number;
  /** Gem total after the claim. Old servers omit it; treat missing as unknown. */
  gems?: number;
  streakDay: number;
  claimed: number;
  /** Gems paid by the streak finale; 0 on every other day. */
  gemsClaimed?: number;
}

export async function claimDailyBonus(): Promise<DailyBonusResult> {
  await ensureSignedIn();
  return await callGame<DailyBonusResult>("dailyBonus");
}

/** Last-resort grant for a player sitting at zero, once a day. */
export async function topupWallet(): Promise<number> {
  await ensureSignedIn();
  const res = await callGame<{ balance: number; granted: number }>("walletTopup");
  return res.balance;
}

export type RewardPlacement = "coins" | "free-entry" | "double-pot" | "gems";

/** Which ledger a placement pays into. Absent on old servers = coins. */
export type RewardCurrency = "coins" | "gems";

/** Reserve a rewarded grant BEFORE showing the ad. Returns the SSV nonce to
 *  pass as customData; grants nothing on its own — only AdMob's signed
 *  callback credits coins. */
export async function adRewardIntent(
  placement: RewardPlacement,
  gameId?: string,
): Promise<{ nonce: string; coins: number; currency?: RewardCurrency }> {
  await ensureSignedIn();
  return await callGame<{ nonce: string; coins: number; currency?: RewardCurrency }>("adRewardIntent", {
    placement,
    gameId,
  });
}

/** Poll after the ad reports EARNED_REWARD, until the SSV callback lands. */
export async function adRewardStatus(
  nonce: string,
): Promise<AdRewardStatus> {
  await ensureSignedIn();
  return await callGame<AdRewardStatus>("adRewardStatus", { nonce });
}

export interface AdRewardStatus {
  status: "pending" | "granted" | "expired";
  /** Amount granted, denominated in `currency`. */
  coins: number;
  currency?: RewardCurrency;
  balance: number;
  gems?: number;
}

export interface CatalogItem {
  sku: string;
  kind: "theme" | "avatar" | "entitlement" | "dice";
  price: number;
  /** Old servers omit it; treat missing as "coins". */
  currency?: "coins" | "gems";
  active: boolean;
}

/** Owned cosmetic SKUs plus the live catalog. */
export async function getEntitlements(): Promise<{ skus: string[]; catalog: CatalogItem[] }> {
  await ensureSignedIn();
  return await callGame<{ skus: string[]; catalog: CatalogItem[] }>("entitlementsGet");
}

/** Buy a cosmetic. Price AND currency are decided server-side. */
export async function shopBuy(sku: string): Promise<{ sku: string; balance: number; gems?: number }> {
  await ensureSignedIn();
  return await callGame<{ sku: string; balance: number; gems?: number }>("shopBuy", { sku });
}

/** Permanently delete the caller's account and all data keyed to it (cascade).
 *  The server derives the user from the JWT, so this only ever deletes yourself. */
export async function deleteAccount(): Promise<void> {
  await ensureSignedIn();
  await callGame<{ ok: boolean }>("deleteAccount");
}

/** Buy a gem pack (stub provider until real billing ships — server-gated). */
export async function gemsBuy(productId: string): Promise<{ gems: number; purchaseId: string }> {
  await ensureSignedIn();
  return await callGame<{ gems: number; purchaseId: string }>("gemsBuy", { productId });
}

/** Exchange gems for coins, one-way, at the server's rate. `key` makes a
 *  retry idempotent. */
export async function gemsExchange(gems: number, key?: string): Promise<{ gems: number; balance: number }> {
  await ensureSignedIn();
  return await callGame<{ gems: number; balance: number }>("gemsExchange", key ? { gems, key } : { gems });
}

/** Host-only. `fill` seats bots in the empty chairs first — labelled as bots,
 *  unlike quick match's hidden fill-ins. */
export async function startGame(gameId: string, fill = false): Promise<TurnResult> {
  return turnCall("start", { gameId, fill });
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
  /** Equipped dice skin id, or null for classic (inherits the viewer's board theme). */
  dice_skin: string | null;
}

/** Fetch profiles for a set of users; missing rows simply aren't returned. */
export async function getProfiles(userIds: string[]): Promise<Profile[]> {
  if (userIds.length === 0) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, avatar_id, dice_skin")
    .in("user_id", userIds);
  if (error) return []; // profiles are cosmetic — never block on them
  return (data ?? []) as Profile[];
}

export interface MyProfile {
  /** The name the SERVER has registered — not the local draft. */
  displayName: string;
  /** When the one allowed username change was spent; null = still available. */
  nameChangedAt: string | null;
}

/**
 * The caller's own registered identity. Distinct from the local profile store,
 * which tracks the text field as you type — this is what other players actually
 * see, and the only safe thing to compare a draft against when deciding whether
 * a name is "changed" at all.
 *
 * Null when signed out or offline; callers treat that as "unknown" and stay
 * permissive rather than locking the field on a failed read.
 */
export async function getMyProfile(): Promise<MyProfile | null> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, name_changed_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    displayName: (data.display_name as string) ?? "",
    nameChangedAt: (data.name_changed_at as string | null) ?? null,
  };
}

/**
 * Upsert the caller's own profile row (RLS: self-write only). Best-effort — a
 * display name already registered to another user is rejected by the DB's
 * unique index, and the previous server-side name simply stays. A priced dice
 * skin the caller doesn't own is silently stripped server-side (see the
 * profiles_enforce_dice_skin trigger) rather than rejecting the whole write.
 * A second username change is reverted the same silent way (0030's
 * profiles_enforce_name_change_once) — one change per account, ever.
 *
 * Returns what the server ACTUALLY stored, so the caller can reconcile. Without
 * this readback the strip is invisible: the owner keeps seeing their skin while
 * every opponent sees classic, and nothing anywhere reports a problem.
 */
export async function upsertMyProfile(
  displayName: string,
  avatarId: string,
  diceSkinId: string,
): Promise<{ diceSkin: string | null; displayName: string; nameChangedAt: string | null } | null> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null; // not signed in yet — create/join will sync it
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: userId,
        display_name: displayName.slice(0, 20),
        avatar_id: avatarId,
        dice_skin: diceSkinId === "classic" ? null : diceSkinId,
      },
      { onConflict: "user_id" },
    )
    .select("dice_skin, display_name, name_changed_at")
    .maybeSingle();
  if (error || !data) return null;
  return {
    diceSkin: (data.dice_skin as string | null) ?? null,
    displayName: (data.display_name as string) ?? displayName,
    nameChangedAt: (data.name_changed_at as string | null) ?? null,
  };
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

export interface PublicStats {
  games_played: number;
  games_won: number;
}

/** The caller's own shareable friend code, minted on first call. */
export async function getMyFriendCode(): Promise<string | null> {
  await ensureSignedIn();
  try {
    const { code } = await callGame<{ code: string }>("friendCode");
    return code ?? null;
  } catch {
    return null; // cosmetic — the Add Friend screen shows a retry instead
  }
}

/** Resolve a friend code to a player card. Throws with a user-facing message
 *  (not found, rate limited) — the caller surfaces it inline. */
export async function lookupFriendCode(code: string): Promise<{ user: Profile; stats: PublicStats }> {
  await ensureSignedIn();
  return await callGame<{ user: Profile; stats: PublicStats }>("friendLookup", { code });
}

/** Resolve an EXACT username (case-insensitive) to a player card. Shares the
 *  code-lookup throttle server-side, and returns the same opaque "not found"
 *  for an absent, blocked, bot or self match. */
export async function searchPlayerByName(name: string): Promise<{ user: Profile; stats: PublicStats }> {
  await ensureSignedIn();
  return await callGame<{ user: Profile; stats: PublicStats }>("friendSearch", { name });
}

/** Invite a friend to a room. Server-side so it can also PUSH the invite —
 *  see functions/game/social.ts opRoomInvite. */
export async function inviteToRoomOp(toUserId: string, roomCode: string, stake = 0): Promise<void> {
  await ensureSignedIn();
  await callGame<{ ok: true }>("roomInvite", { toUserId, roomCode, stake });
}

/** Send a friend request through the edge function, which enforces blocks and
 *  rate limits with readable errors and handles the hidden-bot case. */
export async function requestFriend(toUserId: string): Promise<void> {
  await ensureSignedIn();
  await callGame<{ ok: true }>("friendRequest", { toUserId });
}

/** Opponents from recent games who aren't already friends. Server-side because
 *  hidden bots must be filtered out and only the service role can see them. */
export async function getRecentPlayers(): Promise<Profile[]> {
  await ensureSignedIn();
  try {
    const { players } = await callGame<{ players: Profile[] }>("friendsRecent");
    return players ?? [];
  } catch {
    return []; // discovery is best-effort; never block the screen
  }
}

/** Public match record for a set of users. Best-effort: a missing row is a
 *  player who hasn't finished an online game yet. */
export async function getPlayerStats(userIds: string[]): Promise<Record<string, PublicStats>> {
  if (userIds.length === 0) return {};
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("player_stats")
    .select("user_id, games_played, games_won")
    .in("user_id", userIds);
  if (error) return {};
  const out: Record<string, PublicStats> = {};
  for (const r of data ?? []) {
    out[r.user_id as string] = { games_played: r.games_played as number, games_won: r.games_won as number };
  }
  return out;
}

/**
 * The row asked for is not there FOR THIS USER — deleted, or hidden because
 * they are not a participant (games/players are row-scoped by RLS, 0019).
 *
 * Separate from an ordinary failure because it is a settled answer, not a
 * missed packet: no amount of retrying turns "you are not in this game" into a
 * row. Callers should give up and get the player out, not back off and ask
 * again.
 */
export class RowGoneError extends Error {
  constructor(what: string) {
    super(`This ${what} is no longer available.`);
    this.name = "RowGoneError";
  }
}

/** Retry an idempotent read a couple of times with backoff — flaky mobile
 *  networks drop individual requests far more often than they go fully dark.
 *  Never used for turn ops: replaying a lost roll could double-act a turn.
 *
 *  A {@link RowGoneError} is rethrown immediately: it is an answer, and asking
 *  again three times only multiplies the requests behind a decision that has
 *  already been made. */
async function withRetry<T>(fn: () => Promise<T>, tries = 3, delayMs = 400): Promise<T> {
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof RowGoneError) throw e;
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
      .select("id, user_id, color, seat, is_host, is_connected, is_bot")
      .eq("game_id", gameId)
      .order("seat", { ascending: true });
    if (error) throw new Error(`Could not load players: ${error.message}`);
    return (data ?? []) as LobbyPlayer[];
  });
}

/**
 * The game row, or {@link RowGoneError} if it is not visible to this user.
 *
 * Deliberately NOT `.single()`. That sends PostgREST's object Accept header,
 * which answers "not exactly one row" with HTTP 406 — an error indistinguishable
 * from a transport failure, so a game the caller had been reaped out of (or was
 * never seated in) surfaced as something worth retrying. Between withRetry's 3
 * attempts and runResync's endless backoff that produced ~100 requests for one
 * dead game id, all of them 406, none of which could ever have succeeded.
 *
 * Selecting a list instead makes "no row for you" an ordinary empty 200, and the
 * distinction between "gone" and "the network dropped it" explicit here rather
 * than encoded in a status code.
 */
export async function fetchGame(gameId: string): Promise<GameRow> {
  const supabase = getSupabase();
  return withRetry(async () => {
    const { data, error } = await supabase
      .from("games")
      .select("id, room_code, host_user_id, status, state, current_turn_player_id, state_version, stake")
      .eq("id", gameId)
      .limit(1);
    if (error) throw new Error(`Could not load game: ${error.message}`);
    const row = (data ?? [])[0];
    if (!row) throw new RowGoneError("game");
    return row as GameRow;
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

/** Subscribe to a game's row changes (state sync), its players (lobby), and chat.
 *
 *  Private channel: joining and sending are both gated by RLS on
 *  realtime.messages (0037), which asks is_game_participant — the same check
 *  behind the games/players read policies. Without it the topic is open to
 *  anyone holding the publishable key who knows the game id, and the id is not
 *  a secret. supabase-js keeps the socket's JWT current on auth state change,
 *  so nothing here has to call realtime.setAuth by hand. */
export function subscribeGame(gameId: string, handlers: GameSubscription): RealtimeChannel {
  const supabase = getSupabase();
  let everSubscribed = false;
  return supabase
    .channel(`game:${gameId}`, { config: { private: true } })
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

/**
 * Send a reaction/message to the room, via the server.
 *
 * Deliberately NOT a channel.send: clients have no insert on realtime.messages
 * (0037), so the only sender on this topic is the `chat` op, which stamps
 * fromUserId from the verified JWT. That is what makes the sender on an
 * incoming payload mean anything — a client that broadcast its own identity
 * could claim to be any player at the table.
 *
 * Fire-and-forget, like the broadcast it replaces: the caller has already
 * echoed the message locally, and a failed send is not worth an error dialog
 * mid-game. Senders don't receive their own message back.
 */
export function sendChat(gameId: string, kind: ChatPayload["kind"], value: string): void {
  void callGame("chat", { gameId, kind, value }).catch(() => {});
}

export function unsubscribe(channel: RealtimeChannel): void {
  getSupabase().removeChannel(channel);
}
