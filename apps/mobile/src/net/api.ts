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
import { APP_VERSION } from "../lib/appVersion";

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
  /** When the current turn's clock runs out, server-side. Usually TURN_SECONDS
   *  out, but short for a seat the server already knows is away — clients read
   *  it rather than assuming, so a shortened clock is honoured everywhere. */
  turn_deadline?: string | null;
}

/** An authoritative state plus its version, as returned by every turn op. */
export interface TurnResult {
  state: GameState;
  v: number | null;
  /**
   * The server had already applied this action id — this is a retry catching up
   * with its own earlier attempt.
   *
   * The state here is authoritative but may be a beat STALE: a retry can
   * overlap the attempt it is replacing, so the row read to answer it can
   * predate the winner's write by milliseconds. Callers must not apply it over
   * a prediction; the real state is already on its way over realtime.
   */
  duplicate?: boolean;
  /**
   * This action left the same player owing another roll (a six, a capture or a
   * finish bonus), and here is the die that roll will produce.
   *
   * Carried on the response so a chained roll needs no prefetch of its own —
   * it is the one roll with no gap in front of it to prefetch during. Absent
   * from older servers and whenever the turn changed hands.
   */
  nextRoll?: PreparedRoll;
}

/**
 * A die the server has committed to, for a roll that has not happened yet.
 *
 * `v` is the `state_version` the roll must be made at. It is the whole safety
 * check: the number is only this roll's number while the board is still exactly
 * where it was when the server derived it, so a holder that no longer matches
 * the applied version has to be thrown away, not rolled.
 */
export interface PreparedRoll {
  v: number;
  dice: number;
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
  /** This seat's answer to the standing rematch proposal (0043); null until
   *  they answer. The earliest `rematch_voted_at` in the room is the proposal
   *  itself — see lib/rematch.ts. */
  rematch_vote?: "yes" | "no" | null;
  rematch_voted_at?: string | null;
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

/** Thrown when a call ended without the server ever answering: the wait elapsed
 *  with the request in flight, OR the transport failed outright. Both mean the
 *  same thing to a caller — the action may well have been applied, so reconcile
 *  against the server, never roll back. */
export class TimeoutError extends Error {
  constructor(message = "Still waiting on the server — check your connection.") {
    super(message);
    this.name = "TimeoutError";
  }
}

export const isTimeout = (e: unknown): boolean => e instanceof TimeoutError;

/**
 * What this module is allowed to know about the link.
 *
 * Kept as an injected interface rather than an import of connectionStore so
 * this file stays free of app state and testable on its own — and so that with
 * nothing installed, every call behaves exactly as it did before any of this
 * existed. `lib/connection.ts` installs the real one at launch.
 */
export interface LinkMonitor {
  /** A finished call: its round trip, or null if it was never answered. */
  observe(rttMs: number | null): void;
  isOffline(): boolean;
  /** Resolve true when the link is usable again, false when `budgetMs` runs out. */
  waitForOnline(budgetMs: number): Promise<boolean>;
}

let linkMonitor: LinkMonitor | null = null;
export function setLinkMonitor(m: LinkMonitor | null): void {
  linkMonitor = m;
}

/**
 * Did the request fail before the server answered?
 *
 * functions-js reports three kinds of failure and only one of them is a verdict:
 *
 *   FunctionsHttpError  — the function RAN and returned non-2xx. A real answer.
 *   FunctionsFetchError — the request never completed. No answer.
 *   FunctionsRelayError — the gateway failed to relay it. No answer.
 *
 * The last two were being thrown as plain Errors, so isTimeout said false and
 * every caller treated "I could not ask" as "the server said no". That is what
 * snapped an optimistic move back on a congested network: the write may have
 * landed perfectly well, and the client discarded its prediction anyway. The
 * 20s timeout was never the only way to fail to get an answer — it was just
 * the only one being modelled.
 */
function unanswered(error: { name?: string }): boolean {
  return error.name === "FunctionsFetchError" || error.name === "FunctionsRelayError";
}

/** Invoke the `game` Edge Function and surface its `{ error }` payload as a throw. */
async function callGame<T>(
  op: string,
  payload: Record<string, unknown> = {},
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<T> {
  const supabase = getSupabase();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();
  // An unanswered call is not a round trip, so it is reported as `null` rather
  // than as a very slow one — see LinkMonitor.observe. Feeding the timeout in
  // as a measurement would leave the app reading "slow" long after recovery.
  const observe = (rttMs: number | null) => linkMonitor?.observe(rttMs);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      observe(null);
      reject(new TimeoutError());
    }, timeoutMs);
  });
  const { data, error } = await Promise.race([
    // appVersion goes on LAST so a payload cannot overwrite it: the server
    // decides what protocol this client can be spoken to in, and a caller must
    // not be able to misreport the build it is running.
    supabase.functions.invoke("game", { body: { op, ...payload, appVersion: APP_VERSION } }),
    timeout,
  ]).finally(() => clearTimeout(timer));
  if (error) {
    // No answer ever arrived — same contract as the timeout above.
    if (unanswered(error)) {
      observe(null);
      throw new TimeoutError();
    }
    observe(Date.now() - startedAt);
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
  observe(Date.now() - startedAt);
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

/**
 * Budget for ONE attempt at a turn op, and how many attempts a tap gets.
 *
 * Shorter than CALL_TIMEOUT_MS on purpose. A single 20s wait was the only thing
 * a dropped roll could do — 20 seconds of a 30-second turn spent on a request
 * that was never going to be answered, and then a resync that snapped the board
 * back and asked the player to roll again. Re-firing at 6s recovers a dropped
 * packet in seconds instead of never, and four attempts still land inside the
 * turn clock with room to spare.
 *
 * Re-firing is only safe because the server dedupes on the action id: a slow
 * link that answers at 8s gets its first attempt abandoned and its second one
 * deduped to the same result, never to a second roll.
 *
 * Do not shorten the first attempt to "recover a dropped packet sooner". That
 * was tried, at 2s, and it is the mistake CALL_TIMEOUT_MS above already
 * describes: a congested link routinely takes longer than that to answer, so
 * every op became a phantom failure and re-fired up to four times — through
 * enqueueSend, which serialises them. The link that most needed help got a
 * retry storm on top of the congestion. Slow-link recovery has to come from
 * somewhere other than a tighter deadline.
 */
const TURN_TIMEOUT_MS = 6000;
const TURN_TRIES = 4;
const TURN_RETRY_PAUSE_MS = 300;

/**
 * Wall clock for the whole ladder, retries and pauses included.
 *
 * The four attempts above already fit inside TURN_SECONDS by construction. This
 * is the belt for the case they cannot cover: an attempt parked on
 * `waitForOnline` is waiting on a radio, not on a budget of its own, and
 * without an outer limit a long outage would hold the call open well past the
 * point where the turn is gone and the stall bot has played the seat. Once the
 * turn is lost, further attempts only delay the resync that would show the
 * player the truth.
 */
const TURN_LADDER_BUDGET_MS = 25_000;

/** Distinct enough to be unique inside one game, short enough for the server's
 *  64-char cap and the unique index behind it. */
let actionCounter = 0;
export function newActionId(): string {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${(actionCounter++).toString(36)}-${rand}`;
}

/**
 * Send a turn op, re-firing it until the server actually answers.
 *
 * Only an UNANSWERED attempt is retried. A verdict — "Not your turn", "Illegal
 * move" — is the server speaking, and asking again cannot change its mind, so
 * it throws on the first attempt exactly as it always did.
 *
 * Every attempt carries the same `actionId`, which is what makes this safe:
 * an attempt that was travelling all along still lands, and the server applies
 * whichever arrives first and answers the rest with `duplicate`.
 *
 * With no signal, the pause between attempts is replaced by a wait on the link
 * itself. Re-firing every 300ms into an outage cannot succeed and floods the
 * connection the moment it returns; parking on the radio instead means the
 * retry goes out the instant there is something to send it down — which on the
 * flaky links this exists for (a tunnel, a lift, a crowded room) is the whole
 * difference between losing the turn and keeping it.
 */
async function turnCall(
  op: string,
  payload: Record<string, unknown>,
  actionId?: string,
): Promise<TurnResult> {
  const body = actionId ? { ...payload, actionId } : payload;
  const timeoutMs = actionId ? TURN_TIMEOUT_MS : CALL_TIMEOUT_MS;
  const tries = actionId ? TURN_TRIES : 1;
  const ladderEndsAt = Date.now() + TURN_LADDER_BUDGET_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await callGame<{
        state: GameState;
        v?: number | null;
        duplicate?: boolean;
        nextRoll?: PreparedRoll;
      }>(op, body, timeoutMs);
      return {
        state: res.state,
        v: res.v ?? null,
        duplicate: res.duplicate === true,
        ...(res.nextRoll ? { nextRoll: res.nextRoll } : {}),
      };
    } catch (e) {
      if (attempt >= tries || !isTimeout(e)) throw e;
      const budgetLeft = ladderEndsAt - Date.now();
      if (budgetLeft <= 0) throw e;
      if (linkMonitor?.isOffline()) {
        // Park on the radio, not on a cadence. False means the outage outlived
        // the ladder, so stop here rather than firing one more doomed attempt.
        if (!(await linkMonitor.waitForOnline(budgetLeft))) throw e;
      } else {
        await new Promise((resolve) => setTimeout(resolve, TURN_RETRY_PAUSE_MS));
      }
    }
  }
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

/** How much of a placement's daily allowance is left.
 *
 *  The sheet greys its ad row out on this, so it comes from the SERVER rather
 *  than being counted locally: a local tally would reset with the app and
 *  disagree with the endpoint that actually refuses the grant. Old servers
 *  don't have the op — callers treat a throw as "unknown", not as "empty",
 *  since greying the row out on a network hiccup would hide a working reward.
 */
export async function adRewardQuota(placement: RewardPlacement): Promise<AdRewardQuota> {
  await ensureSignedIn();
  return await callGame<AdRewardQuota>("adRewardQuota", { placement });
}

export interface AdRewardQuota {
  /** Amount one view pays, denominated in `currency`. */
  amount: number;
  /** Views a single account can bank per day. */
  cap: number;
  used: number;
  remaining: number;
  currency?: RewardCurrency;
  /** False when the tier itself is switched off, which is not the same as a
   *  spent allowance — the row hides rather than greying. */
  enabled?: boolean;
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

// The three player-driven turn ops. Each takes the caller's `actionId` for the
// tap behind it — mint one per tap, never per attempt (see turnCall).

export async function rollAction(gameId: string, actionId?: string): Promise<TurnResult> {
  return turnCall("roll", { gameId }, actionId);
}

export async function moveAction(gameId: string, tokenId: string, actionId?: string): Promise<TurnResult> {
  return turnCall("move", { gameId, tokenId }, actionId);
}

/**
 * Budget for the dice prefetch. Short, and tried exactly once.
 *
 * Nothing waits on this call: it runs during the previous player's animation to
 * make the NEXT tap instant, and if it doesn't arrive in time the tap simply
 * takes the path it always took. So a slow answer is worth less than no answer
 * — retrying it would only queue work behind a link that is already struggling,
 * on behalf of an optimisation.
 */
const PREPARE_TIMEOUT_MS = 4000;

/**
 * Wake the `game` function up, so the first op of a match doesn't have to.
 *
 * Every op — rolls included — is one Deno function whose module scope imports
 * supabase-js, jose, and the built engine and bot. A cold isolate pays that
 * whole import graph before it answers anything, and the FIRST thing a dealt
 * match asks for is `prepareRoll`: the read whose entire purpose is to have the
 * die's number in hand before the player taps. Miss it and the roll falls back
 * to tumbling on a null value until the round trip lands — which is a die
 * visibly rolling over and over.
 *
 * The gap that bites is the wait in a lobby. Creating the room warms the
 * function, but a friend room can then sit for minutes before anyone starts,
 * and by the time the board is dealt the isolate is long gone.
 *
 * `config` is the cheapest op there is (one app_config read, no writes, no
 * game state), so it is what we knock with. Fire-and-forget and swallowing
 * everything: a warm-up that can fail loudly is worse than no warm-up.
 */
export function warmUp(): void {
  void callGame("config", {}, PREPARE_TIMEOUT_MS).catch(() => {});
}

/**
 * Ask for the die our next roll will produce, so the tumble has something to
 * land on the moment it starts.
 *
 * Deliberately NOT a turnCall: no action id, no retries, and it must never join
 * the store's send chain — that chain waits on the previous turn op's
 * settlement, which can be four attempts and 25 seconds, and putting a
 * best-effort read in front of a real roll would make the die slower, not
 * faster.
 *
 * Every failure is null, including a server too old to know the op. The caller
 * treats null and "not available" identically: roll the slow way.
 */
export async function prepareRoll(gameId: string): Promise<PreparedRoll | null> {
  try {
    const res = await callGame<{ available?: boolean; v?: number; dice?: number }>(
      "prepareRoll",
      { gameId },
      PREPARE_TIMEOUT_MS,
    );
    if (!res?.available || typeof res.v !== "number" || typeof res.dice !== "number") return null;
    return { v: res.v, dice: res.dice };
  } catch {
    return null;
  }
}

export async function passAction(gameId: string, actionId?: string): Promise<TurnResult> {
  return turnCall("pass", { gameId }, actionId);
}

/** Skip the current turn once its server deadline has passed (any participant). */
export async function timeoutAction(gameId: string): Promise<TurnResult> {
  return turnCall("timeout", { gameId });
}

/** Host-only: reset a finished game to a fresh one with the same players. */
/**
 * Answer the standing rematch proposal, opening one if there isn't any.
 *
 * The reply carries a state only when this vote was the one that settled it —
 * otherwise it echoes the finished game at its current version, which
 * applyTurnResult discards as an echo. The vote's visible effect arrives the
 * other way: it is a players-row write, so every device in the room (this one
 * included) sees it through the lobby subscription.
 */
export async function rematchVote(gameId: string, vote: "yes" | "no"): Promise<TurnResult> {
  return turnCall("rematch", { gameId, vote });
}

/** Ask the server to settle a proposal whose clock has run out. Any participant
 *  may call it; the server re-checks the deadline against its own clock. */
export async function rematchClose(gameId: string): Promise<TurnResult> {
  return turnCall("rematchClose", { gameId });
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
 * Null when there is no row yet, or when offline/sign-in failed; callers treat
 * that as "unknown" — never as "no name" — and stay permissive rather than
 * locking the field on a failed read.
 */
export async function getMyProfile(): Promise<MyProfile | null> {
  const supabase = getSupabase();
  // Wait for the session instead of reading whatever getSession() holds this
  // instant: at launch the restore is still in flight, so an immediate read
  // returns null — which callers read as "the server has no name for you", not
  // as "ask again later". That is what made an untouched name field look like
  // an edit on the Account screen.
  let userId: string;
  try {
    userId = await ensureSignedIn();
  } catch {
    return null;
  }
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

/**
 * Mark this session online, and let the server decide whether any friend
 * should be told about it.
 *
 * Only the FIRST heartbeat of a session goes through here — the rest are the
 * plain table upsert in net/friends.ts. The server has to see the presence row
 * as it was BEFORE this session freshened it to know whether the player was
 * genuinely away, and it owns the notification budgets, which is not somewhere
 * a client can be trusted to enforce them.
 */
export async function announceOnlineOp(): Promise<void> {
  await ensureSignedIn();
  await callGame<{ ok: true }>("presenceOnline");
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
 *  Reads only; turn ops retry through turnCall, which carries an action id so
 *  the server can tell a replay from a second roll.
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
      .select("id, user_id, color, seat, is_host, is_connected, is_bot, rematch_vote, rematch_voted_at")
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
      .select("id, room_code, host_user_id, status, state, current_turn_player_id, state_version, stake, turn_deadline")
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

/**
 * What a players-table event says happened to a seat.
 *
 * The row travels WITH the event rather than being fetched after it. `players`
 * keeps REPLICA IDENTITY FULL (0020), so every event — insert, update, delete —
 * carries the whole row already; going back to ask for it turned one seat write
 * into a REST round trip and a store write on every client in the room, which
 * on a four-handed table is where an opponent's presence blip cost everybody a
 * dropped frame mid-hop.
 *
 * `unknown` means the payload didn't parse (a column set we don't model, a
 * partial row): the subscriber falls back to a full refetch, which is what it
 * used to do unconditionally.
 */
export type LobbyEvent =
  | { type: "seat"; row: LobbyPlayer }
  | { type: "gone"; id: string }
  | { type: "unknown" };

/**
 * A die the server rolled, delivered on its own rather than inside a state
 * write. Folding tables stop writing the roll (the die is re-derivable from
 * the unchanged version), so this is how everyone else at the table learns
 * what was rolled, at the moment it was rolled.
 */
export interface RollPayload {
  die: number;
  /** The seat that rolled — a handle, matching state.currentTurnPlayerId. */
  playerId: string;
  /** The state_version the roll was made at, still unwritten. */
  v: number;
}

export interface GameSubscription {
  onGame: (row: GameRow) => void;
  onLobby: (event: LobbyEvent) => void;
  onChat?: (payload: ChatPayload) => void;
  /** A die rolled on a folding table. Absent on unfolded tables. */
  onRoll?: (payload: RollPayload) => void;
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
      (payload) => handlers.onLobby(lobbyEvent(payload)),
    )
    .on("broadcast", { event: "chat" }, (msg) => handlers.onChat?.(msg.payload as ChatPayload))
    .on("broadcast", { event: "roll" }, (msg) => handlers.onRoll?.(msg.payload as RollPayload))
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

/** Read a players-table realtime payload as a lobby event. */
function lobbyEvent(payload: {
  eventType: string;
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}): LobbyEvent {
  if (payload.eventType === "DELETE") {
    const id = payload.old?.id;
    return typeof id === "string" ? { type: "gone", id } : { type: "unknown" };
  }
  const row = toLobbyPlayer(payload.new);
  return row ? { type: "seat", row } : { type: "unknown" };
}

/** Pick a LobbyPlayer out of a raw row, or null if it isn't one. Deliberately
 *  field-by-field: a realtime payload carries every column of the table, and
 *  the extras must not leak into a value that gets compared for equality. */
function toLobbyPlayer(raw: unknown): LobbyPlayer | null {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || typeof r.id !== "string" || typeof r.user_id !== "string" || typeof r.seat !== "number") {
    return null;
  }
  if (typeof r.color !== "string") return null;
  return {
    id: r.id,
    user_id: r.user_id,
    color: r.color as Color,
    seat: r.seat,
    is_host: !!r.is_host,
    is_connected: !!r.is_connected,
    is_bot: !!r.is_bot,
    rematch_vote: (r.rematch_vote as LobbyPlayer["rematch_vote"]) ?? null,
    rematch_voted_at: (r.rematch_voted_at as string | null) ?? null,
  };
}

/** Do these two seat lists say the same thing? Used to drop a lobby write that
 *  changes nothing — a presence heartbeat re-upserting the same row used to
 *  hand React a fresh array and re-render the whole game screen for it. */
export function lobbyEqual(a: LobbyPlayer[], b: LobbyPlayer[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return (
      x.id === y.id &&
      x.user_id === y.user_id &&
      x.color === y.color &&
      x.seat === y.seat &&
      x.is_host === y.is_host &&
      x.is_connected === y.is_connected &&
      x.is_bot === y.is_bot &&
      (x.rematch_vote ?? null) === (y.rematch_vote ?? null) &&
      (x.rematch_voted_at ?? null) === (y.rematch_voted_at ?? null)
    );
  });
}

export function unsubscribe(channel: RealtimeChannel): void {
  getSupabase().removeChannel(channel);
}
