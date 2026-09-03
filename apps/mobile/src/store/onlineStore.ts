/**
 * Online multiplayer store (server-authoritative). Turn actions call the `game`
 * Edge Function, which generates the dice and validates moves; the function
 * returns the new authoritative GameState, which we apply. Realtime broadcasts
 * keep the other clients in sync, and resync() recovers missed updates on
 * reconnect. The client computes valid moves only for display/highlighting.
 */

import { create } from "zustand";
import {
  applyMove,
  endTurn,
  getValidMoves,
  rollDice,
  type GameState,
  type Move,
} from "@ludo/engine";
import { chooseMove } from "@ludo/bot";
import type { RealtimeChannel } from "@supabase/supabase-js";
import * as api from "../net/api";
import { pushProfile } from "../net/profileSync";
import { acceptChatPayload, applyChatEvent, CHAT_MAX_LEN, type ChatEvent } from "../lib/chat";
import { ROLL_PACING_MS, stateAnimationMs } from "../lib/moveTiming";
import { BUST_HOLD_MS, bustedRollDice, colorOf, isBustHandoff, project } from "../lib/projection";
import { isOverdue, readProposal, type Proposal, type RematchVote } from "../lib/rematch";
import { useNav } from "./navStore";
import { useProfile } from "./profileStore";
import { useWallet } from "./walletStore";

/** Pause before auto-passing a no-move roll: the die tumble runs ~700ms
 *  (Dice ROLL_MS), then the number needs a beat to be read. */
const AUTO_PASS_DELAY = 1000;
/** A lone legal move plays the moment the tumble settles — no choice to make. */
const AUTO_MOVE_DELAY = 600;
/** Pace of autopilot actions on the local seat — outlasts the ~700ms die
 *  tumble so each rolled number lands before the bot acts on it. */
const PILOT_DELAY = 900;
/** Retry pace when an autopilot action produced no write (declined or failed).
 *  Longer than PILOT_DELAY so a call still in flight isn't hammered. */
const PILOT_RETRY_MS = 4000;
const CHAT_MIN_INTERVAL_MS = 500;
/** Seconds a turn may sit idle before any client asks the server to skip it.
 *  Matches TURN_SECONDS in the edge function; drives the on-screen countdown. */
export const TURN_SECONDS = 30;
/** Grace past the deadline before firing the skip (server is the real clock). */
const TIMEOUT_GRACE_MS = 3000;

type Status = "idle" | "connecting" | "lobby" | "active" | "finished" | "error";

export type { ChatEvent } from "../lib/chat";

interface OnlineStore {
  status: Status;
  error: string | null;
  /** This seat has an action out with the server and no answer yet. Mirrors the
   *  private reconciliation locals; see syncInFlight. */
  actionInFlight: boolean;
  gameId: string | null;
  roomCode: string | null;
  userId: string | null;
  myPlayerId: string | null;
  isHost: boolean;
  starting: boolean;
  /** Quick-match room: the lobby shows "finding an opponent", no room code. */
  isQuick: boolean;
  /** Quick-match table size (2 = 1v1, 4 = free-for-all) — drives the lobby copy. */
  quickSize: number;
  /** Coins each seat staked (0 = friendly). Winner takes stake × 2. */
  stake: number;
  lobby: api.LobbyPlayer[];
  /** Display profiles keyed by auth user_id (cosmetic; color labels fall back). */
  profiles: Record<string, api.Profile>;

  state: GameState | null;
  validMoves: Move[];
  lastRoll: number | null;
  rollSeq: number;
  message: string;

  /** In-room chatter (broadcast-only; cleared on leave). */
  chat: ChatEvent[];
  /** Bumps once per appended chat event — feedback/UI retrigger key. */
  chatSeq: number;
  /** Text messages received since the chat sheet was last opened. */
  chatUnread: number;
  /** Latest event per sender user_id (drives the speech bubbles by avatars). */
  latestBubbles: Record<string, { value: string; kind: ChatEvent["kind"]; seq: number }>;
  /** user_ids this player has blocked. Loaded once per session; added to the
   *  moment they report someone, so the mute bites before the round trip. */
  mutedUserIds: string[];

  /** Local receipt time of the current turn (drives the countdown; display only). */
  turnStartedAt: number | null;
  /** Bumps each time the turn clock resets — re-keys the countdown animation. */
  turnSeq: number;
  /** How long the countdown ring should sweep for. TURN_SECONDS for any window
   *  this client watched open — the server's shorter deadlines for bot and
   *  away seats are resilience numbers, and drawing them names the seat (see
   *  clockSeconds). Only a window we arrived mid-way into draws what is left. */
  turnSeconds: number;
  /** A busted third six is being shown on the roller's own die; the seat has
   *  not changed hands yet and no input should be accepted. */
  bustHold: boolean;
  /** The table has just been dealt and the first roll is not armed yet — the
   *  screen covers the board rather than handing over a die that cannot answer
   *  instantly. Always clears: see dealReady and DEAL_READY_MS. */
  dealing: boolean;
  /** I idled out my turn clock, so the bot policy plays my seat from this
   *  device until I take back control. Local-only — opponents just see moves. */
  autoPilot: boolean;

  sendReaction: (value: string) => void;
  sendMessage: (text: string) => void;
  markChatRead: () => void;
  /** Fetch this player's block list. Safe to call more than once. */
  loadMuted: () => Promise<void>;
  /** Block a player and file a report about them. Mutes locally first. */
  reportPlayer: (targetUserId: string, message?: string) => Promise<void>;

  /** Open a room. `stake` is the per-seat pot; 0 (default) is a friendly game. */
  create: (stake?: number) => Promise<void>;
  join: (code: string) => Promise<void>;
  /** Play online: pair into a 2- or 4-player table (hidden bots fill a dry queue). */
  quickMatch: (size: 2 | 4, stake?: number) => Promise<void>;
  /** Host-only. `fill` seats bots in the empty chairs before dealing. */
  start: (fill?: boolean) => Promise<void>;
  roll: () => Promise<void>;
  selectToken: (tokenId: string) => Promise<void>;
  pass: () => Promise<void>;
  /** Tap-your-avatar reclaim: switch autopilot off and restart the idle clock. */
  takeControl: () => void;
  /** The standing rematch proposal, read off the lobby rows; null when none is
   *  running. Everyone still seated answers it, and the accepters (two or more)
   *  are dealt a fresh board. */
  rematchProposal: Proposal | null;
  /** Why the last proposal produced no game ("Nobody else wanted a rematch"),
   *  shown under the results buttons until someone proposes again. */
  rematchNotice: string | null;
  /** Open a rematch proposal, or accept the one already standing. */
  proposeRematch: () => Promise<void>;
  /** Answer the standing proposal. Declining doesn't sink it — the others can
   *  still play without you. */
  answerRematch: (accept: boolean) => Promise<void>;
  leave: () => void;
  clearError: () => void;
  resync: () => Promise<void>;
  /** Flag own presence when the app backgrounds/foregrounds (best-effort). */
  setAway: (away: boolean) => void;

  isMyTurn: () => boolean;
}

const INITIAL = {
  status: "idle" as Status,
  error: null,
  actionInFlight: false,
  gameId: null,
  roomCode: null,
  userId: null,
  myPlayerId: null,
  isHost: false,
  starting: false,
  isQuick: false,
  quickSize: 2,
  rematchProposal: null as Proposal | null,
  rematchNotice: null as string | null,
  stake: 0,
  lobby: [] as api.LobbyPlayer[],
  profiles: {} as Record<string, api.Profile>,
  state: null,
  validMoves: [] as Move[],
  lastRoll: null,
  rollSeq: 0,
  dealing: false,
  message: "",
  chat: [] as ChatEvent[],
  chatSeq: 0,
  chatUnread: 0,
  latestBubbles: {} as Record<string, { value: string; kind: ChatEvent["kind"]; seq: number }>,
  turnStartedAt: null,
  turnSeq: 0,
  turnSeconds: TURN_SECONDS,
  bustHold: false,
  autoPilot: false,
};

export const useOnlineStore = create<OnlineStore>((set, get) => ({
  ...INITIAL,

  // Deliberately outside INITIAL, which is also the leave-the-room reset: a
  // block is about a person, not a room, and must survive into the next game.
  // Reloaded from the server at sign-in (loadMuted).
  mutedUserIds: [] as string[],

  create: async (stake = 0) => {
    set({ status: "connecting", error: null });
    try {
      const m = await api.createGame(stake);
      const synced = syncMyProfile();
      subscribe(m.gameId);
      const lobby = await api.getLobby(m.gameId);
      set({
        gameId: m.gameId,
        roomCode: m.roomCode,
        userId: m.userId,
        myPlayerId: m.myPlayerId,
        isHost: true,
        lobby,
        stake: m.stake ?? 0,
        status: "lobby",
      });
      void syncThenFetchProfiles(synced, lobby);
      useNav.getState().push("lobby");
    } catch (e) {
      set({ status: "error", error: errorText(e) });
    }
  },

  join: async (code) => {
    set({ status: "connecting", error: null });
    try {
      const m = await api.joinGame(code);
      const synced = syncMyProfile();
      subscribe(m.gameId);
      const lobby = await api.getLobby(m.gameId);
      const me = lobby.find((p) => p.user_id === m.userId);
      set({
        gameId: m.gameId,
        roomCode: m.roomCode,
        userId: m.userId,
        myPlayerId: m.myPlayerId,
        isHost: me?.is_host ?? false,
        lobby,
        stake: m.stake ?? 0,
      });
      void syncThenFetchProfiles(synced, lobby);
      const row = await api.fetchGame(m.gameId);
      if (row.status === "active" && row.state) {
        // A cold snapshot: this window may be most of the way through.
        applyGameRow(row, false);
      } else {
        set({ status: "lobby" });
        useNav.getState().push("lobby");
      }
    } catch (e) {
      set({ status: "error", error: errorText(e) });
    }
  },

  quickMatch: async (size, stake) => {
    set({ status: "connecting", error: null });
    try {
      const m = await api.quickMatch(size, stake);
      const synced = syncMyProfile();
      subscribe(m.gameId);
      const lobby = await api.getLobby(m.gameId);
      const me = lobby.find((p) => p.user_id === m.userId);
      set({
        gameId: m.gameId,
        roomCode: null, // quick rooms aren't shareable — keep the code off screen
        userId: m.userId,
        myPlayerId: m.myPlayerId,
        isHost: me?.is_host ?? false,
        isQuick: true,
        quickSize: m.size ?? size,
        stake: m.stake ?? 0,
        lobby,
        status: "lobby",
      });
      void syncThenFetchProfiles(synced, lobby);
      if (m.waiting) {
        // The setup sheet lives on Home, so the lobby stacks on top of it —
        // backing out of the lobby lands on the hub, never a stale picker.
        useNav.getState().push("lobby");
        armQuickFill(m.gameId);
      } else if (m.state) {
        // Claimed a seat opposite a waiting searcher — the game is already dealt.
        applyTurnResult({ state: m.state, v: m.v ?? null }, false);
      }
    } catch (e) {
      set({ status: "error", error: errorText(e) });
    }
  },

  // `fill` seats bots in the empty chairs, which is also what makes a solo host
  // a valid start — the usual 2-player floor is about having opponents, and
  // filling provides them.
  start: async (fill = false) => {
    const { gameId, isHost, lobby, starting } = get();
    if (!gameId || !isHost || starting) return;
    if (lobby.length < 2 && !fill) return;
    set({ starting: true });
    try {
      const res = await api.startGame(gameId, fill);
      applyTurnResult(res, false);
    } catch (e) {
      set({ error: errorText(e), starting: false });
    }
  },

  roll: async () => {
    clearAuto();
    const { state, gameId, myPlayerId, rollSeq, bustHold } = get();
    if (
      !state ||
      !gameId ||
      state.status !== "active" ||
      state.phase !== "awaiting-roll" ||
      state.currentTurnPlayerId !== myPlayerId ||
      bustHold ||
      rollInFlight
    )
      return;
    rollInFlight = true;
    syncInFlight();

    // FAST PATH: the server already told us this roll's number (prefetched as
    // the turn arrived, or sent back with the action that earned this roll), so
    // the die tumbles once and lands on it — the offline animation exactly,
    // however slow the link is.
    //
    // The version does the work: it proves the die was derived for the board
    // we are looking at, and versions only ever move forward, so a die whose
    // moment has passed can never look current again.
    //
    // `!pending` and consuming the cache on read are belt to that brace. An
    // optimistic roll does not advance lastAppliedV, so inside a prediction
    // window the version alone would still read as current — no route there is
    // reachable today (a roll always leaves the phase awaiting a MOVE, and the
    // move that follows carries its own prediction), but the cost of being
    // wrong about that is a die showing a number the server never rolled, and
    // the cost of the guards is two comparisons.
    const prepared =
      rollCache && rollCache.gameId === gameId && rollCache.v === lastAppliedV && !pending
        ? rollCache
        : null;
    rollCache = null;

    let predicted: GameState | null = null;
    if (prepared) {
      try {
        predicted = rollDice(state, () => (prepared.dice - 0.5) / 6).newState;
      } catch {
        predicted = null; // engine refused it — fall back to the slow path
      }
    }

    if (prepared && predicted) {
      // No rollBumped here, and that is deliberate. It is a ONE-SHOT flag,
      // spent by the next rolled state that gets applied — and this path never
      // applies one: the state that confirms this prediction is dropped as
      // already-on-screen, and a state that contradicts it MUST re-tumble.
      // Setting it would leave it lying around for the next rolled state that
      // does get applied, which is the player AFTER us: their number would
      // land on a die that never rolled.
      set({ rollSeq: rollSeq + 1, lastRoll: prepared.dice });
      // Same mechanism the optimistic move and pass use: show it now, let the
      // server's write confirm it. `rolled` is false because this apply is not
      // what brought the number in — the tap was, and it has already bumped
      // rollSeq. Saying otherwise would spend rollBumped here, on the one
      // state that must not re-tumble, instead of leaving it for whichever
      // authoritative state actually lands.
      pending = { baseV: lastAppliedV, predicted };
      syncInFlight();
      applyState(predicted, false);
    } else {
      // SLOW PATH (no prepared die — old server, no DICE_SECRET, or the
      // prefetch didn't make it). Here the server's answer IS applied when it
      // lands, so the flag is needed to stop it starting a second tumble over
      // the one this tap already began — and applying it spends the flag.
      //
      // Start the tumble anyway with lastRoll
      // cleared. A null value makes the die run another lap rather than settle,
      // so it can never be seen stopping on a face the server has not
      // confirmed, and a stale lastRoll here would hand it exactly that. See
      // the Dice.tsx header.
      rollBumped = true;
      set({ rollSeq: rollSeq + 1, lastRoll: null });
    }

    // One id for this tap, reused by every retry of it — see api.turnCall.
    const actionId = api.newActionId();
    try {
      const res = await enqueueSend(() => api.rollAction(gameId, actionId));
      // A retry that caught up with its own earlier attempt: the roll landed,
      // so leave the die tumbling for the state that is already on its way
      // rather than settling it on a row that may predate the write.
      if (res.duplicate) {
        slowResync(gameId);
        return;
      }
      applyTurnResult(res, true);
      const next = res.state;
      if (
        next.status === "active" &&
        next.phase === "awaiting-move" &&
        next.currentTurnPlayerId === myPlayerId
      ) {
        const moves = getValidMoves(next, myPlayerId);
        if (moves.length === 0)
          autoTimer = setTimeout(() => void get().pass(), AUTO_PASS_DELAY);
        else if (moves.length === 1) {
          const only = moves[0]!.tokenId;
          autoTimer = setTimeout(
            () => void get().selectToken(only),
            AUTO_MOVE_DELAY,
          );
        }
      }
    } catch (e) {
      // On a timeout the roll may already be recorded; leave the die airborne
      // and let the arriving state land its face rather than flashing an error
      // and re-triggering the tumble.
      if (!api.isTimeout(e)) rollBumped = false;
      onActionFailed(e, gameId);
    } finally {
      rollInFlight = false;
      syncInFlight();
    }
  },

  selectToken: async (tokenId) => {
    clearAuto();
    const { state, validMoves, gameId, myPlayerId } = get();
    if (
      !state ||
      !gameId ||
      state.phase !== "awaiting-move" ||
      state.currentTurnPlayerId !== myPlayerId ||
      pending
    )
      return;
    if (!validMoves.some((m) => m.tokenId === tokenId)) return;
    // The client runs the same pure engine as the server with no clock input,
    // so the outcome is byte-for-byte predictable: animate it immediately and
    // let the server's write confirm (or, on a race, correct) it.
    const predicted = applyMove(state, { tokenId });
    pending = { baseV: lastAppliedV, predicted };
    syncInFlight();
    applyState(predicted, false);
    const actionId = api.newActionId();
    try {
      const res = await enqueueSend(() => api.moveAction(gameId, tokenId, actionId));
      // Already applied — keep the pawn where the player put it and let the
      // authoritative state confirm it. Applying this row could snap it back.
      if (res.duplicate) slowResync(gameId);
      else applyTurnResult(res, false);
    } catch (e) {
      onActionFailed(e, gameId);
    }
  },

  pass: async () => {
    clearAuto();
    const { state, validMoves, gameId, myPlayerId } = get();
    if (
      !state ||
      !gameId ||
      state.phase !== "awaiting-move" ||
      validMoves.length > 0 ||
      state.currentTurnPlayerId !== myPlayerId ||
      pending
    )
      return;
    const predicted = endTurn(state);
    pending = { baseV: lastAppliedV, predicted };
    syncInFlight();
    applyState(predicted, false);
    const actionId = api.newActionId();
    try {
      const res = await enqueueSend(() => api.passAction(gameId, actionId));
      if (res.duplicate) slowResync(gameId);
      else applyTurnResult(res, false);
    } catch (e) {
      onActionFailed(e, gameId);
    }
  },

  proposeRematch: async () => {
    // Clearing the notice on the way out, not on the answer: the tap is the
    // moment the player stops being told about the last proposal, and waiting
    // for the round trip leaves "nobody wanted a rematch" under a button they
    // have just pressed.
    set({ rematchNotice: null });
    await castRematchVote("yes");
  },

  answerRematch: async (accept) => {
    set({ rematchNotice: null });
    await castRematchVote(accept ? "yes" : "no");
  },

  takeControl: () => {
    if (!get().autoPilot) return;
    set({ autoPilot: false });
    armAutoPilot(get().state?.status === "active"); // restart the idle clock
  },

  leave: () => {
    clearAuto();
    clearTimeoutTimer();
    clearPilotTimer();
    clearRowQueue();
    clearResync();
    clearLobbyTimer();
    clearQuickFill();
    clearRematchTimer();
    resetSyncState();
    const { gameId } = get();
    if (channel) {
      api.unsubscribe(channel);
      channel = null;
    }
    // Tell the server we're gone for good: active game → our tokens come off
    // the board and turns skip us; waiting lobby → the seat frees up.
    if (gameId) void api.leaveAction(gameId).catch(() => {});
    set({ ...INITIAL });
    useNav.getState().popTo("home");
  },

  /** Dismiss the current error. The game screen shows it transiently and then
   *  calls this; without it a rejection that is never followed by another
   *  authoritative write would sit on screen indefinitely. */
  clearError: () => {
    if (useOnlineStore.getState().error !== null) useOnlineStore.setState({ error: null });
  },

  resync: async () => {
    const { gameId } = get();
    if (gameId) scheduleResync(gameId, true);
  },

  setAway: (away) => {
    const { gameId, userId } = get();
    if (gameId && userId)
      void api.setConnected(gameId, userId, !away).catch(() => {});
  },

  isMyTurn: () => {
    const { state, myPlayerId } = get();
    return (
      !!state &&
      state.status === "active" &&
      state.currentTurnPlayerId === myPlayerId
    );
  },

  sendReaction: (value) => sendChatEvent("reaction", value),

  sendMessage: (text) => {
    const trimmed = text.trim().slice(0, CHAT_MAX_LEN);
    if (trimmed.length > 0) sendChatEvent("text", trimmed);
  },

  markChatRead: () => set({ chatUnread: 0 }),

  /** Pull the block list once, at sign-in. Silent on failure: an unreachable
   *  list must not stop the player getting into a game, and Report re-adds
   *  locally anyway. */
  loadMuted: async () => {
    try {
      set({ mutedUserIds: await api.blockedList() });
    } catch {
      // offline, or an older server without the op — leave the list as it is
    }
  },

  /**
   * Report a player and stop hearing from them.
   *
   * The mute is applied LOCALLY FIRST, before the request goes out. Someone
   * pressing this is asking for it to stop now, and making them wait on a round
   * trip — which may fail, on the exact flaky connection that makes a bad table
   * worse — would let the next message through. The server call is what makes
   * it durable and what files the report; it is not what makes it take effect.
   */
  reportPlayer: async (targetUserId, message) => {
    const { gameId, mutedUserIds, latestBubbles } = get();
    if (!targetUserId || mutedUserIds.includes(targetUserId)) return;

    // Drop anything of theirs already on screen, transcript and bubble alike.
    const bubbles = { ...latestBubbles };
    delete bubbles[targetUserId];
    set({
      mutedUserIds: [...mutedUserIds, targetUserId],
      chat: get().chat.filter((e) => e.fromUserId !== targetUserId),
      latestBubbles: bubbles,
    });

    try {
      await api.reportPlayer(targetUserId, gameId, message);
    } catch {
      // Filed or not, they are muted on this device. The list reloads at next
      // sign-in, which is when a failed report would quietly un-mute — so the
      // local entry stays either way.
    }
  },
}));

// --- Realtime + helpers -----------------------------------------------------

let channel: RealtimeChannel | null = null;
let autoTimer: ReturnType<typeof setTimeout> | null = null;
let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

// --- Quick-match fill --------------------------------------------------------
// If nobody claims the seat while we wait, ask the server to fill it. The
// window is jittered so "found an opponent" doesn't land on a suspiciously
// exact clock; a real human joining first flips the game active via realtime
// and the fired timer no-ops on the status check.

const QUICK_FILL_MIN_MS = 8000;
const QUICK_FILL_JITTER_MS = 6000;
let quickFillTimer: ReturnType<typeof setTimeout> | null = null;

function clearQuickFill(): void {
  if (quickFillTimer) clearTimeout(quickFillTimer);
  quickFillTimer = null;
}

function armQuickFill(gameId: string): void {
  clearQuickFill();
  quickFillTimer = setTimeout(() => {
    quickFillTimer = null;
    void (async () => {
      const st = useOnlineStore.getState();
      if (st.gameId !== gameId || st.status !== "lobby") return;
      try {
        const res = await api.quickBotFill(gameId);
        // The bot just seated is a fresh row fetchProfiles has never seen —
        // pull it in now, so its (server-assigned) name/avatar/dice skin are
        // ready by the time this client's own GameView mounts, rather than
        // waiting on the `players` realtime event to refresh them.
        const freshLobby = await api.getLobby(gameId);
        useOnlineStore.setState({ lobby: freshLobby });
        void fetchProfiles(freshLobby);
        applyTurnResult(res, false);
      } catch {
        // The server refused (raced start, network blip) — the realtime row or
        // a resync will surface the truth.
        scheduleResync(gameId);
      }
    })();
  }, QUICK_FILL_MIN_MS + Math.random() * QUICK_FILL_JITTER_MS);
}

// --- Optimistic action state ---------------------------------------------------
// The server stamps every games write with a monotonic state_version (v).
// lastAppliedV is the version on screen; anything at or below it is an echo.

let lastAppliedV = -1;
/** The optimistic move/pass currently awaiting the server's verdict. */
let pending: { baseV: number; predicted: GameState } | null = null;
/** A roll request is in flight (its tumble already started on the tap). */
let rollInFlight = false;
/** The tap already bumped rollSeq — swallow the arriving state's bump. */
let rollBumped = false;

/**
 * The die the server has already committed to for our next roll.
 *
 * This is what makes an online roll land in one lap: with the number in hand at
 * the tap, the die animates exactly as it does offline instead of tumbling
 * until the network answers. It arrives either from a prefetch fired as the
 * turn reaches us, or piggybacked on the response to the action that earned us
 * another roll.
 *
 * `v` pins it to one board position. An optimistic roll does NOT advance
 * lastAppliedV, so "is this still current?" cannot be answered by the version
 * alone mid-chain — see roll() for the second half of that guard.
 */
let rollCache: { gameId: string; v: number; dice: number } | null = null;

/** Discriminates prefetch responses: a slow one landing after a newer request
 *  (or after the turn moved on) must not install itself over the current cache. */
let prepareSeq = 0;

/**
 * Mirror the two in-flight locals above into store state, for the UI.
 *
 * They stay module-private because nothing outside reconciliation has any
 * business reading a prediction — but "is this seat waiting on the server?" is
 * something the screen genuinely needs, and without it a player on a weak link
 * got no acknowledgement at all: the board just sat there while the retry
 * ladder worked, and the first thing they saw was the stall bot taking a turn
 * they thought they had played.
 *
 * Called after every assignment to either local. Guarded so an unchanged value
 * never publishes a store write — this runs on paths that fire per realtime
 * row, and the Board memo is what keeps those cheap.
 */
function syncInFlight(): void {
  const now = pending !== null || rollInFlight;
  if (useOnlineStore.getState().actionInFlight !== now) {
    useOnlineStore.setState({ actionInFlight: now });
  }
}

function recordApplied(v: number | null | undefined): void {
  if (v != null && v > lastAppliedV) lastAppliedV = v;
}

/** Deterministic-engine equality: both sides build states with identical key
 *  order (same code, same JSON-roundtripped input), so stringify compares. */
function statesEqual(a: GameState, b: GameState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Chain turn-op sends so a quick follow-up (an extra-turn roll fired on an
 *  optimistic move) can't overtake the previous request on the wire. The UI
 *  never waits on this — it already animated. */
let sendChain: Promise<unknown> = Promise.resolve();
function enqueueSend<T>(fn: () => Promise<T>): Promise<T> {
  const run = sendChain.then(fn, fn);
  sendChain = run.catch(() => {});
  return run;
}

/**
 * Ask the server for the die our next roll will produce.
 *
 * Fired when the turn ARRIVES rather than when the die is tapped, so the round
 * trip happens during the previous player's animation and the tap has the
 * number already. Best effort throughout: no retry, failures are null, and
 * everything downstream still works without it.
 *
 * Only ever primed from an AUTHORITATIVE version. Priming while a prediction is
 * outstanding would read a row the roll's own write has not reached yet and
 * cache a die for a version we have already moved past — the same stale number
 * twice. Chained rolls don't need it anyway: their die rides back on the
 * response that earned them (see nextRoll).
 */
/**
 * How long the board may stay covered while the first die is fetched.
 *
 * A ceiling, not a target: the cover lifts the moment prepareRoll answers, and
 * on any ordinary connection that is well inside this. What it guarantees is the
 * failure mode — no key configured, a request that never returns, an old server
 * — where the answer is simply never coming. A player must never be left looking
 * at a loading screen because an optimisation did not arrive.
 */
const DEAL_READY_MS = 2_000;
let dealTimer: ReturnType<typeof setTimeout> | null = null;

/** The board is playable: uncover it. Idempotent, and called from every path
 *  that ends the wait — including the ones that end it by failing. */
function dealReady(): void {
  if (dealTimer) {
    clearTimeout(dealTimer);
    dealTimer = null;
  }
  if (useOnlineStore.getState().dealing) useOnlineStore.setState({ dealing: false });
}

/**
 * Cover the board while the table is dealt and the opening roll is armed.
 *
 * The first roll of a game is the one whose die prefetch is least likely to have
 * landed — the request is queued behind everything else a fresh game screen
 * starts — so it was reliably the one roll that had to wait on the network with
 * a player already tapping. The die handles that correctly now (it simply rolls
 * for as long as the server takes), but the better answer is not to hand
 * somebody a die that cannot answer yet.
 *
 * Armed with its own timeout, because the thing being waited for is an
 * optimisation and optimisations are allowed to fail.
 */
function dealPending(): void {
  if (dealTimer) clearTimeout(dealTimer);
  useOnlineStore.setState({ dealing: true });
  dealTimer = setTimeout(dealReady, DEAL_READY_MS);
}

function primeRoll(): void {
  const { state, gameId, myPlayerId } = useOnlineStore.getState();
  // Every exit below means there is no die to wait for — either it is not our
  // turn, or one is already in hand. Uncover the board on all of them, or a seat
  // that simply is not first to play would sit behind the cover for its timeout.
  if (!gameId || !state || pending || rollInFlight) return dealReady();
  if (state.status !== "active" || state.phase !== "awaiting-roll") return dealReady();
  if (state.currentTurnPlayerId !== myPlayerId) return dealReady();
  const v = lastAppliedV;
  if (v < 0) return dealReady();
  if (rollCache && rollCache.gameId === gameId && rollCache.v === v) return dealReady();
  const seq = ++prepareSeq;
  // Wrapped, not just awaited: this runs from the middle of applying an
  // authoritative state, and a prefetch is an optimisation. Nothing about it
  // — including a transport that throws on the way out — may be allowed to
  // take down the state path it is riding on.
  void Promise.resolve()
    .then(() => api.prepareRoll(gameId))
    .then((prepared) => {
    // Anything that moved on while this was in flight invalidates it: a newer
    // request, a different game, or a board that has advanced past the version
    // the die was derived for.
      if (!prepared || seq !== prepareSeq) return;
      if (useOnlineStore.getState().gameId !== gameId) return;
      if (prepared.v !== lastAppliedV) return;
      rollCache = { gameId, v: prepared.v, dice: prepared.dice };
      adoptPreparedRoll();
    })
    .catch(() => {})
    // Settled either way: the die is armed, or it is not coming and the player
    // takes the slow path — which now simply rolls for longer.
    .finally(dealReady);
}

/**
 * A prefetch that arrived too late for the tap, but not too late for the die.
 *
 * The opening roll of a game is the one most likely to be tapped before its
 * prefetch lands — the board has only just been dealt and the request is
 * queued behind everything else the screen starts up. That roll then takes the
 * slow path, and the die tumbles on a null value until the round trip answers.
 * Past ~360ms it can no longer land on the lap it is running, so it runs a
 * whole second one, which reads as the die rolling twice.
 *
 * But the prefetch was sent BEFORE the tap, so its answer very often beats the
 * roll's. And it is the same number: both derive from the same game, seat and
 * state_version, and the roll in flight was sent against that same version. So
 * the moment it lands we can do what the tap could not — give the die its
 * number and predict the state — and the roll already on the wire becomes the
 * confirmation for it.
 *
 * Guarded to the exact situation it describes: our own roll in flight, nothing
 * else predicted, no number on the die yet, and a board that has not moved.
 */
function adoptPreparedRoll(): void {
  if (!rollInFlight || pending || !rollCache) return;
  const st = useOnlineStore.getState();
  if (st.lastRoll !== null || st.bustHold) return; // the die already has a number
  if (!st.state || !st.gameId || st.gameId !== rollCache.gameId) return;
  if (rollCache.v !== lastAppliedV) return;
  if (st.state.status !== "active" || st.state.phase !== "awaiting-roll") return;
  if (st.state.currentTurnPlayerId !== st.myPlayerId) return;

  const dice = rollCache.dice;
  rollCache = null;
  let predicted: GameState;
  try {
    predicted = rollDice(st.state, () => (dice - 0.5) / 6).newState;
  } catch {
    return; // engine refused it — leave the slow path alone
  }
  // Fast-path semantics from here: the confirming state is no longer applied,
  // so there is no bump left to swallow, and a contradicting one must tumble.
  rollBumped = false;
  pending = { baseV: lastAppliedV, predicted };
  syncInFlight();
  useOnlineStore.setState({ lastRoll: dice });
  applyState(predicted, false);
}

/**
 * A prediction we had on screen turned out to be wrong, and the authoritative
 * state is about to replace it.
 *
 * If that prediction was a ROLL, its number is sitting on a die that has
 * already stopped, and the correcting state carries a different one. Painting
 * it straight on is the die changing its mind — the exact thing Dice.tsx loops
 * its tumble to avoid. Clearing rollBumped lets applyStateNow bump rollSeq, so
 * the corrected number arrives the way every number does: on a roll.
 */
function unwindPrediction(): void {
  pending = null;
  syncInFlight();
  rollBumped = false;
}

/**
 * Apply a turn op's HTTP response, reconciling any optimistic prediction.
 * The realtime echo may have arrived first — versions decide, not timing.
 */
function applyTurnResult(res: api.TurnResult, rolled: boolean): void {
  const { state, v } = res;
  /**
   * A folding table answers the ROLL at the version it was sent at.
   *
   * The die is derived rather than written (see receiveRoll), so there is no
   * new version to carry — the roll's transition rides along with the move or
   * pass that follows it. That makes this the one authoritative answer in the
   * protocol whose version does not advance, and the staleness rule below —
   * "at or below the applied version is an echo of a write we already have" —
   * would otherwise throw it away. Which leaves the roller's own prediction
   * pending forever, and `pending` is what selectToken and pass refuse to act
   * through: the die lands, and the seat can neither move nor pass again.
   *
   * The server flags it rather than the client inferring it, because inference
   * cannot tell the two apart: an UNFOLDED roll whose realtime echo beat its
   * own HTTP response home also arrives at the applied version, and that one
   * must still drop — applied again it re-tumbles a die that already landed.
   *
   * Narrow on purpose. Only an EQUAL version qualifies: a folded answer the
   * board has since moved past (a stall bot wrote while ours was in flight) is
   * below the applied one and still drops.
   */
  const foldedRoll = res.folded === true && v != null && v === lastAppliedV;
  if (v != null && v <= lastAppliedV && !foldedRoll) return; // realtime/resync got there first

  if (pending) {
    const confirmed =
      (v == null || v === pending.baseV + (foldedRoll ? 0 : 1)) &&
      statesEqual(state, pending.predicted);
    if (confirmed) {
      pending = null;
      syncInFlight();
      recordApplied(v);
      cacheNextRoll(res);
      primeRoll();
      return; // already on screen from the optimistic apply
    }
    // The server disagreed, or another write (stall bot) won the race and our
    // own write bounced off the version guard — snap to the server's truth.
    unwindPrediction();
    recordApplied(v);
    applyState(state, rolled);
    cacheNextRoll(res);
    return;
  }

  recordApplied(v);
  applyState(state, rolled);
  cacheNextRoll(res);
}

/**
 * Keep the die the server sent back for a roll this action just earned us.
 *
 * Cached only once the response's own version is the applied one, so a stale
 * or superseded answer can't leave a die behind for a board that has moved.
 */
function cacheNextRoll(res: api.TurnResult): void {
  const { gameId } = useOnlineStore.getState();
  if (!res.nextRoll || !gameId || res.duplicate) return;
  if (res.nextRoll.v !== lastAppliedV) return;
  prepareSeq++; // outrank any prefetch still in flight for the previous version
  rollCache = { gameId, v: res.nextRoll.v, dice: res.nextRoll.dice };
}

/**
 * A turn op didn't come back cleanly. What happens next hinges on WHY.
 *
 * A timeout is not a failure — the request was never aborted, so it is very
 * likely still in flight and about to be applied. Undoing the optimistic move
 * here is what made a laggy connection eat a move: the pawn snapped back, the
 * player moved again, and the original write landed anyway. So on a timeout we
 * keep the prediction on screen, say nothing, and let reconciliation decide —
 * the realtime echo confirms it (dedupes to a no-op) or the resync corrects it.
 *
 * The resync is deliberately slow in that case: at the normal 500ms it would
 * refetch a pre-move state and cause the very snap-back we're avoiding.
 *
 * A real rejection ("Not your turn", "Illegal move") is different: the server
 * has spoken, so drop the prediction and surface it immediately.
 */
function onActionFailed(e: unknown, gameId: string): void {
  if (api.isTimeout(e)) {
    slowResync(gameId);
    return;
  }
  pending = null;
  syncInFlight();
  useOnlineStore.setState({ error: errorText(e) });
  scheduleResync(gameId);
}

/** Forget all per-game optimistic/sync bookkeeping (leave, new subscribe). */
function resetSyncState(): void {
  stopKeepWarm();
  clearBustHold();
  dealReady();
  lastAppliedV = -1;
  pending = null;
  syncInFlight();
  rollInFlight = false;
  syncInFlight();
  rollBumped = false;
  rollCache = null;
  prepareSeq++;
  sendChain = Promise.resolve();
}

function clearAuto(): void {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
}

function clearTimeoutTimer(): void {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  timeoutTimer = null;
}

/**
 * Every client arms a stall-timer for the active turn (including the current
 * player's — an AFK player's own app may be asleep). Fires a few seconds past
 * the deadline with per-client jitter so racers don't all pile on; the server
 * re-checks the clock and has the bot play the stalled turn. Any fresh state
 * reschedules this, so only a genuinely stalled turn ever fires.
 *
 * `deadlineAt` is the server's own clock for this turn, carried on the games
 * row. This used to assume every turn ran the full TURN_SECONDS, which was true
 * until the server started handing a short clock to a seat it already knows is
 * away — with the assumption baked in here, that shorter deadline was invisible
 * to every device in the room and the table still waited out the whole 30
 * seconds. Absent (a local action's response carries no row), the full clock
 * remains the right guess.
 */
function scheduleTimeout(active: boolean, deadlineAt: number | null = null): void {
  clearTimeoutTimer();
  if (!active) return;
  const remaining = deadlineAt != null ? Math.max(0, deadlineAt - Date.now()) : TURN_SECONDS * 1000;
  const delay = remaining + TIMEOUT_GRACE_MS + Math.random() * 2000;
  timeoutTimer = setTimeout(() => void requestTimeout(), delay);
}

async function requestTimeout(): Promise<void> {
  const { gameId, state } = useOnlineStore.getState();
  if (!gameId || state?.status !== "active") return;
  try {
    const res = await api.timeoutAction(gameId);
    // The response carries the stall bot's FIRST action; any extra turns it
    // earns are written server-side afterwards and stream in as realtime rows.
    // Queue it rather than apply it directly, so it can't leap ahead of their
    // animations (it dedupes to a no-op when realtime got here first).
    enqueueGameRow({ state: res.state, status: res.state.status, state_version: res.v });
  } catch {
    // transient — the re-arm below is what retries it
  } finally {
    // Re-arm unconditionally. Every other clock in this store is wound by an
    // authoritative write landing (applyStateNow), which is fine while someone
    // else is playing — but on OUR seat nobody else writes, so a call that
    // failed, or one the server answered with "not expired yet" (a row that
    // dedupes and never reaches applyStateNow), used to leave the client with
    // nothing scheduled at all: our turn, frozen, and no clock left to notice.
    // A fresh state simply replaces this timer, so re-arming can't double up.
    const st = useOnlineStore.getState();
    if (st.gameId === gameId) scheduleTimeout(st.state?.status === "active");
  }
}

/**
 * Keep the game function awake for as long as a room is waiting to start.
 *
 * The opening roll is the one roll in a match with nothing in front of it: no
 * previous turn's animation to prefetch under, and — after a lobby wait — very
 * likely a cold isolate to ask. `prepareRoll` gives up after four seconds, and
 * a roll that times out there tumbles on a null value until the round trip
 * answers, which is the die rolling five or six times before it settles.
 *
 * So we knock on the door while the player is waiting anyway. Only between
 * joining a room and being dealt a board — the moment the board arrives the
 * match's own traffic keeps the isolate hot, and this stops.
 */
const WARM_INTERVAL_MS = 45_000;
let warmTimer: ReturnType<typeof setInterval> | null = null;

function startKeepWarm(): void {
  if (warmTimer) return;
  api.warmUp();
  warmTimer = setInterval(() => {
    // Dealt, finished, or gone: the room no longer needs propping up.
    if (useOnlineStore.getState().status !== "lobby") {
      stopKeepWarm();
      return;
    }
    api.warmUp();
  }, WARM_INTERVAL_MS);
}

function stopKeepWarm(): void {
  if (warmTimer) clearInterval(warmTimer);
  warmTimer = null;
}

function subscribe(gameId: string): void {
  if (channel) api.unsubscribe(channel);
  clearRowQueue();
  clearRematchTimer();
  resetSyncState();
  startKeepWarm();
  channel = api.subscribeGame(gameId, {
    onGame: enqueueGameRow,
    onLobby: refreshLobby,
    onChat: receiveChat,
    onRoll: receiveRoll,
    // Row updates during a socket drop are lost, not replayed — refetch.
    onReconnect: () => scheduleResync(gameId, true),
  });
}

/**
 * A die that arrived on its own, ahead of the state that will explain it.
 *
 * On a folding table the server does not write the roll — the die is derivable
 * from the unchanged version, so the write was only ever carrying a number for
 * other people to look at. It comes as a broadcast instead, and the state that
 * follows carries the die AND the move together.
 *
 * Two things this must not do:
 *
 *   * animate a die the local player already animated. The roller bumps
 *     rollSeq on its own tap (prepareRoll gives it the value up front), and the
 *     server broadcasts to everyone including the roller — so our own roll
 *     arrives back here and must be ignored;
 *   * let the folded state push animate the same die a second time. That is
 *     exactly what `rollBumped` already exists for: it is the one-shot flag
 *     applyStateNow spends to swallow an arriving state's bump.
 */
function receiveRoll(payload: api.RollPayload): void {
  const st = useOnlineStore.getState();
  // Not our table any more, or a straggler from a version already left behind.
  if (!st.state || st.state.status !== "active") return;
  if (payload.v < lastAppliedV) return;
  // Our own roll, already animated on the tap.
  if (payload.playerId === st.myPlayerId) return;

  // Everything else this broadcast has to be judged against — whose turn it is,
  // whether the board is even at the version the die was derived for — is a
  // question about a state this client may not have caught up to yet. Park it
  // and let the row queue decide when it becomes true.
  // Version order, and never twice: a re-delivered broadcast is not a re-roll.
  if (!pendingRolls.some((r) => r.v === payload.v && r.playerId === payload.playerId)) {
    pendingRolls.push(payload);
    pendingRolls.sort((a, b) => a.v - b.v);
  }
  startPendingRoll();
}

/**
 * Die broadcasts waiting for the board to catch up to them.
 *
 * A QUEUE, and it has to be. The first cut kept one, on the reasoning that a
 * second broadcast can only exist because the roll before it was resolved by a
 * write — true, but the write is queued too, and on a link slow enough to need
 * this pacing at all, several rolls and their writes are in flight together. A
 * single slot meant the newer broadcast overwrote the older one and that seat's
 * roll was never animated: its own resolving write is a folded state carrying no
 * die, so nothing behind it re-tumbled either. Turns silently missing their
 * animation, on exactly the connections that could least afford to lose them.
 *
 * Kept in version order and drained the same way, so each roll animates against
 * the board it was actually made on.
 */
let pendingRolls: api.RollPayload[] = [];

/**
 * Animate the parked broadcast, if the board is finally standing where it
 * describes.
 *
 * The broadcast used to be applied the instant it arrived, which is wrong on
 * exactly the connection the pacing exists for. Under lag the row queue holds
 * states back so each animation plays out, so `lastAppliedV` and `st.state` lag
 * the server — and the checks the old code made against them were therefore
 * being asked of the wrong board:
 *
 *   * an opponent who rolls again quickly had their next tumble start ON TOP of
 *     the hop the queue was still playing out — the die visibly rolling while
 *     their token was moving;
 *   * a roll that had handed over to a DIFFERENT seat failed
 *     `payload.playerId !== currentTurnPlayerId` against the stale state and was
 *     dropped outright — and a folded state carries no die, so nothing behind it
 *     re-tumbled either. That roll was never animated at all.
 *
 * Arming `rowHoldTimer` is what closes the loop: the tumble now owns the pacing
 * clock for its own duration, so the folded state that resolves it queues behind
 * the animation instead of landing on top of it.
 */
function startPendingRoll(): boolean {
  // Anything the board has already moved past announced a roll that is now
  // ancient — drop them before looking at the front of the queue.
  while (pendingRolls.length > 0 && pendingRolls[0]!.v < lastAppliedV) pendingRolls.shift();
  const payload = pendingRolls[0];
  if (!payload) return false;
  // Something is still animating — this is not our moment. drainRowQueue asks
  // again the instant it is. Deliberately NOT gated on the queue being empty:
  // the roll at version v happened before the write at v+1, so once the board is
  // standing at v the tumble goes first and the queued row waits behind it.
  if (rowHoldTimer) return false;
  // The state this roll was derived against has not arrived yet. Wait: it is
  // the very next thing the queue will hand us.
  if (payload.v > lastAppliedV) return false;

  const st = useOnlineStore.getState();
  if (!st.state || st.state.status !== "active") {
    pendingRolls = [];
    return false;
  }
  // Now that the board is current, these mean what they say.
  if (st.state.phase !== "awaiting-roll" || st.state.currentTurnPlayerId !== payload.playerId) {
    pendingRolls.shift();
    return false;
  }

  pendingRolls.shift();
  rollBumped = true;
  useOnlineStore.setState({ lastRoll: payload.die, rollSeq: st.rollSeq + 1 });
  // The same budget stateAnimationMs charges a written roll — see ROLL_PACING_MS.
  rowHoldTimer = setTimeout(drainRowQueue, ROLL_PACING_MS);
  return true;
}

// --- Paced application of realtime rows ----------------------------------------
// Under lag the socket can deliver several row updates in one burst. Applied
// immediately they'd collapse into one render — the same token's two moves merge
// into a >6-cell jump the Board won't hop, and a mid-animation restart cuts the
// previous move short. Queue them instead: each state applies only after the
// previous one's animation has played out. Local action responses still apply
// directly (the actor wants instant feedback); their realtime echoes dedupe here.

/** The slice of a games row the sync path actually consumes. */
type GameSnapshot = Pick<api.GameRow, "state" | "status" | "state_version" | "stake" | "turn_deadline">;

/** Small buffer after each animation before the next state lands. */
const ROW_HOLD_PAD_MS = 80;
let rowQueue: GameSnapshot[] = [];
let rowHoldTimer: ReturnType<typeof setTimeout> | null = null;

function clearRowQueue(): void {
  rowQueue = [];
  pendingRolls = [];
  if (rowHoldTimer) clearTimeout(rowHoldTimer);
  rowHoldTimer = null;
}

function enqueueGameRow(row: GameSnapshot): void {
  rowQueue.push(row);
  if (!rowHoldTimer) drainRowQueue();
}

function drainRowQueue(): void {
  rowHoldTimer = null;
  // A die waiting on the board to catch up goes first: it belongs to the version
  // now on screen, and anything queued is a write that came after it. Firing it
  // arms the hold timer, so this returns and the timer re-enters here.
  if (startPendingRoll()) return;
  const row = rowQueue.shift();
  if (!row) return;
  const prev = useOnlineStore.getState().state;
  // Read with `prev`, not after the row is applied: applyStateNow sets lastRoll
  // from the incoming state, which on a folding table is null — so reading it
  // later would always say "no roll here" and drop the hand-off from the pacing,
  // which is the very thing this is for.
  const heldRoll = useOnlineStore.getState().lastRoll;
  const v = row.state_version ?? null;

  // Echo of a state already applied (our own action's response/prediction, or
  // a resync that overtook the stream): skip — don't restart the countdown or
  // delay whatever is queued behind it. Versions decide when present; the
  // stringify compare remains for rows written before the version column.
  const stale =
    v != null
      ? v <= lastAppliedV
      : !!(prev && row.state && JSON.stringify(prev) === JSON.stringify(row.state));
  if (stale) {
    drainRowQueue();
    return;
  }

  if (pending && row.state && v != null) {
    if (v === pending.baseV + 1 && statesEqual(row.state, pending.predicted)) {
      // The realtime echo of our optimistic action — already on screen.
      pending = null;
      syncInFlight();
      recordApplied(v);
      drainRowQueue();
      return;
    }
    // A write we didn't predict landed at or past our slot (stall bot won the
    // race; our own write bounced off the version guard). Snap to it and keep
    // draining — anything queued behind is newer still.
    unwindPrediction();
  }

  // Straight off the realtime stream — a window that opens here opens NOW.
  applyGameRow(row, true);
  const hold = prev && row.state ? stateAnimationMs(prev, row.state, heldRoll) + ROW_HOLD_PAD_MS : 0;
  rowHoldTimer = setTimeout(drainRowQueue, hold);
}

// --- Local-seat autopilot -----------------------------------------------------
// When the local player idles out TURN_SECONDS on their own turn, the bot
// policy starts playing their seat from this device (ordinary turn actions —
// opponents can't tell) until they tap their avatar. Beats the server-side
// stall bot (TURN_SECONDS + grace), which stays armed as the safety net for
// when this device is asleep or the app is closed.

let pilotTimer: ReturnType<typeof setTimeout> | null = null;

function clearPilotTimer(): void {
  if (pilotTimer) clearTimeout(pilotTimer);
  pilotTimer = null;
}

/** Re-armed on every authoritative write (the server refreshes the deadline
 *  the same way): a fresh idle clock off autopilot, the next bot step on it. */
function armAutoPilot(active: boolean): void {
  clearPilotTimer();
  const st = useOnlineStore.getState();
  if (!active) {
    if (st.autoPilot) useOnlineStore.setState({ autoPilot: false });
    return;
  }
  if (st.state?.currentTurnPlayerId !== st.myPlayerId) return;
  if (st.autoPilot) {
    pilotTimer = setTimeout(autoPilotStep, PILOT_DELAY);
  } else {
    pilotTimer = setTimeout(() => {
      // An action of our own still on the wire is the opposite of an idle
      // player: they acted, and a slow link is retrying it for them. Handing
      // the seat to the bot here takes the turn away mid-flight and drops
      // canAct, which is the very "my roll got cancelled" this whole path
      // exists to stop. Wait it out instead — a landing write re-arms this
      // timer, and the retries give up well inside one more idle clock.
      if (rollInFlight || pending) {
        armAutoPilot(true);
        return;
      }
      useOnlineStore.setState({ autoPilot: true });
      autoPilotStep();
    }, TURN_SECONDS * 1000);
  }
}

function autoPilotStep(): void {
  const st = useOnlineStore.getState();
  const state = st.state;
  if (
    !st.autoPilot ||
    !state ||
    state.status !== "active" ||
    state.currentTurnPlayerId !== st.myPlayerId
  )
    return;
  if (state.phase === "awaiting-roll") {
    void st.roll();
  } else if (st.validMoves.length > 0) {
    void st.selectToken(
      chooseMove(state, st.myPlayerId!, st.validMoves).tokenId,
    );
  } else {
    void st.pass();
  }
  // The dispatched action may decline (a request is already in flight) or fail
  // on the wire, and neither outcome produces the write that re-arms this loop.
  // Without a retry the bot silently stops mid-turn while `autoPilot` stays on
  // — which also holds canAct false, so the player can't roll for themselves
  // either. A real state supersedes this timer through armAutoPilot.
  clearPilotTimer();
  pilotTimer = setTimeout(autoPilotStep, PILOT_RETRY_MS);
}

// --- Chat (ephemeral broadcast) ----------------------------------------------

let lastChatSentAt = 0;

/** Send own reaction/message: broadcast to the room and append locally
 *  (broadcast doesn't echo to the sender). Light rate limit against spam. */
function sendChatEvent(kind: ChatEvent["kind"], value: string): void {
  const { userId, gameId, status } = useOnlineStore.getState();
  if (!channel || !userId || !gameId || status === "idle" || status === "error") return;
  const now = Date.now();
  if (now - lastChatSentAt < CHAT_MIN_INTERVAL_MS) return;
  lastChatSentAt = now;
  // The server relays this to everyone else and stamps the sender; the local
  // echo is what makes our own message feel instant despite the round trip.
  api.sendChat(gameId, kind, value);
  appendChat({ kind, value, fromUserId: userId });
}

function receiveChat(payload: api.ChatPayload): void {
  const { userId, lobby } = useOnlineStore.getState();
  const ev = acceptChatPayload(payload, {
    seatedUserIds: lobby.map((p) => p.user_id),
    selfUserId: userId,
    mutedUserIds: useOnlineStore.getState().mutedUserIds,
  });
  if (ev) appendChat(ev);
}

function appendChat(p: Omit<ChatEvent, "id" | "at">): void {
  const st = useOnlineStore.getState();
  useOnlineStore.setState(applyChatEvent(st, p));
}

/** players-table events arrive in bursts (join + presence toggles) — coalesce
 *  them into one lobby fetch instead of one HTTP round trip per event. Only the
 *  fallback path debounces now; an event that carries its own row is applied on
 *  the spot, because there is nothing to coalesce. */
const LOBBY_DEBOUNCE_MS = 150;
let lobbyTimer: ReturnType<typeof setTimeout> | null = null;

function clearLobbyTimer(): void {
  if (lobbyTimer) clearTimeout(lobbyTimer);
  lobbyTimer = null;
}

/**
 * A seat changed.
 *
 * The event carries the whole row (players is REPLICA IDENTITY FULL, 0020), so
 * the common cases — a presence toggle, a rematch vote, a seat leaving — are
 * folded straight into the lobby we already hold. Only an event we can't read
 * falls back to the refetch this used to do every time.
 *
 * This is the online-only cost that offline play never paid: every seat write
 * fanned out to every client, each of which answered it with an HTTP round trip
 * and a store write, and a store write re-renders the game screen — during
 * whatever hop happened to be on screen.
 */
function refreshLobby(event?: api.LobbyEvent): void {
  const prev = useOnlineStore.getState().lobby;
  if (event && prev.length > 0) {
    if (event.type === "seat") {
      const i = prev.findIndex((p) => p.id === event.row.id);
      const next = [...prev];
      if (i === -1) {
        next.push(event.row);
        next.sort((a, b) => a.seat - b.seat); // getLobby orders by seat; match it
      } else {
        next[i] = event.row;
      }
      applyLobby(next);
      return;
    }
    if (event.type === "gone") {
      applyLobby(prev.filter((p) => p.id !== event.id));
      return;
    }
  }
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    void doRefreshLobby();
  }, LOBBY_DEBOUNCE_MS);
}

async function doRefreshLobby(): Promise<void> {
  if (!useOnlineStore.getState().gameId) return;
  try {
    applyLobby(await api.getLobby(useOnlineStore.getState().gameId!));
  } catch {
    // ignore transient lobby refresh failures
  }
}

/**
 * Adopt a seat list, however it arrived.
 *
 * The equality gate is the point: a presence heartbeat re-upserting an
 * unchanged row is the commonest players write there is, and handing React a
 * fresh array for it re-rendered GameView, four PlayerChips and four Skia
 * avatars for a change of nothing.
 */
function applyLobby(lobby: api.LobbyPlayer[]): void {
  const { gameId, isHost, status, lobby: prev } = useOnlineStore.getState();
  if (!gameId) return;
  if (!api.lobbyEqual(prev, lobby)) useOnlineStore.setState({ lobby });
  void fetchProfiles(lobby);
  readRematchVotes(gameId, lobby);
  if (isHost && status === "lobby" && lobby.length === 4 && !useOnlineStore.getState().starting) {
    void useOnlineStore.getState().start();
  }
}

/** Merge profiles for these players into the store (best-effort, cosmetic).
 *  Already-cached users are skipped — profiles barely change mid-game, and
 *  presence churn shouldn't cost a fetch. A user whose row didn't come back
 *  stays "missing", so the next lobby refresh asks for them again: on a first
 *  session my own row may not exist yet when the first fetch goes out. */
async function fetchProfiles(lobby: api.LobbyPlayer[]): Promise<void> {
  try {
    const known = useOnlineStore.getState().profiles;
    const missing = lobby.filter((p) => !known[p.user_id]).map((p) => p.user_id);
    if (missing.length === 0) return;
    const rows = await api.getProfiles(missing);
    if (rows.length === 0) return;
    const profiles = { ...useOnlineStore.getState().profiles };
    for (const r of rows) profiles[r.user_id] = r;
    useOnlineStore.setState({ profiles });
  } catch {
    // color labels remain the fallback
  }
}

// --- Rematch proposal ---------------------------------------------------------
// The vote rides the players table (0043), so it arrives here the same way a
// seat change does: a realtime event on that table, coalesced into one refetch,
// which lands in readRematchVotes below. Nothing subscribes separately and no
// vote is held in memory — the rows ARE the proposal (lib/rematch.ts).

/** Fire the close call a moment after the window ends, with per-client jitter
 *  so four devices watching the same clock don't all ask at once. */
const REMATCH_CLOSE_GRACE_MS = 2000;
const REMATCH_CLOSE_JITTER_MS = 1500;
let rematchCloseTimer: ReturnType<typeof setTimeout> | null = null;

function clearRematchTimer(): void {
  if (rematchCloseTimer) clearTimeout(rematchCloseTimer);
  rematchCloseTimer = null;
}

/**
 * Adopt the proposal the freshly-read rows describe.
 *
 * Also the only place that can tell a proposal DIDN'T pass. Nothing announces
 * that: the server clears the votes and writes no new state, so from here it
 * looks like votes that were there a moment ago and now aren't, with the game
 * still finished. Which is exactly the condition to say so on screen — without
 * it the results overlay would silently drop back to a Rematch button and the
 * player who accepted would be left wondering whether their tap registered.
 */
function readRematchVotes(gameId: string, lobby: api.LobbyPlayer[]): void {
  const st = useOnlineStore.getState();
  if (st.gameId !== gameId) return;
  const had = st.rematchProposal;
  const proposal = readProposal(lobby);

  // Votes cleared while the game is still over: the proposal resolved into
  // nothing. (Had it passed, the game would be active and this screen gone.)
  const cancelled = !!had && !proposal && st.state?.status === "finished";
  useOnlineStore.setState({
    rematchProposal: proposal,
    rematchNotice: cancelled ? "Not enough players wanted a rematch." : proposal ? null : st.rematchNotice,
  });

  clearRematchTimer();
  if (isOverdue(lobby)) {
    // The window already ran out before these rows reached us (a client that
    // was backgrounded, or a proposal nobody's clock was watching). Settle it
    // now rather than waiting for a deadline that has already passed.
    void closeRematch(gameId);
    return;
  }
  if (!proposal) return;

  const wait = proposal.endsAt - Date.now() + REMATCH_CLOSE_GRACE_MS + Math.random() * REMATCH_CLOSE_JITTER_MS;
  rematchCloseTimer = setTimeout(() => {
    rematchCloseTimer = null;
    void closeRematch(gameId);
  }, Math.max(0, wait));
}

/**
 * Ask the server to settle a proposal whose clock has run out.
 *
 * Best effort by design: this is a race every device in the room enters, and
 * losing it is the normal outcome — the winner's write comes back to everyone
 * over realtime. A failure isn't worth an error dialog on a results screen; the
 * next lobby event re-arms this anyway.
 */
async function closeRematch(gameId: string): Promise<void> {
  const st = useOnlineStore.getState();
  if (st.gameId !== gameId || st.state?.status !== "finished") return;
  try {
    applyTurnResult(await api.rematchClose(gameId), false);
  } catch {
    // Somebody else will have got there, or the next refresh will retry.
  }
}

/**
 * Send my own answer.
 *
 * The response is applied for the one case where it carries something — this
 * vote being the one that completed the tally, so the server dealt the rematch
 * and answered with the new board. Every other time it echoes the finished game
 * at its current version and applyTurnResult drops it as stale, which is
 * correct: my vote's visible effect is a players-row write, and it comes back
 * to this device through the lobby subscription like everyone else's.
 */
async function castRematchVote(vote: RematchVote): Promise<void> {
  const { gameId, state } = useOnlineStore.getState();
  if (!gameId || state?.status !== "finished") return;
  try {
    applyTurnResult(await api.rematchVote(gameId, vote), false);
  } catch (e) {
    useOnlineStore.setState({ error: errorText(e) });
    return;
  }
  // Don't wait on the realtime echo to show my own tick: the round trip has
  // already confirmed the write, and a button that stays un-answered for a
  // beat is a button people press twice.
  refreshLobby();
}

/** Publish my own profile BEFORE reading the table's, so the very first fetch
 *  of a fresh account can actually see my row instead of racing past it. */
async function syncThenFetchProfiles(synced: Promise<void>, lobby: api.LobbyPlayer[]): Promise<void> {
  await synced;
  await fetchProfiles(lobby);
}

/** Push the local profile to the server once a session exists (create/join),
 *  adopting whatever the server kept — see pushProfile. */
function syncMyProfile(): Promise<void> {
  const { displayName, avatarId, diceSkinId } = useProfile.getState();
  return pushProfile(displayName, avatarId, diceSkinId).catch(() => {});
}

/** Runs while a busted third six is held on screen before the seat changes. */
let bustTimer: ReturnType<typeof setTimeout> | null = null;

function clearBustHold(): void {
  if (bustTimer) clearTimeout(bustTimer);
  bustTimer = null;
}

/**
 * Apply an authoritative GameState, pausing first on a busted third six.
 *
 * The server bundles the bust and the hand-off into one write, so this state
 * already belongs to the NEXT player and carries no die. Applied straight
 * through, the six flashed at the wrong corner and the roller just lost their
 * turn with nothing to look at. Paint the roller's own six first, then the
 * truth — everyone at the table sees the same beat.
 */
function applyState(
  state: GameState,
  rolled: boolean,
  deadlineAt: number | null = null,
  watched = false,
): void {
  const st = useOnlineStore.getState();
  const prev = st.state;
  const busted = prev ? bustedRollDice(state) : null;
  if (prev && busted !== null && isBustHandoff(prev, state)) {
    clearBustHold();
    // Don't apply anything yet — `prev` stays on screen, so the roller is still
    // the current player and the die still sits at their corner. Only lastRoll
    // and the freeze flag change.
    useOnlineStore.setState({
      lastRoll: busted,
      validMoves: [],
      bustHold: true,
      rollSeq: st.rollSeq + (rolled && !rollBumped ? 1 : 0),
    });
    if (rolled) rollBumped = false;
    bustTimer = setTimeout(() => {
      bustTimer = null;
      // The room may have moved on (resync, leave) during the hold.
      if (useOnlineStore.getState().state?.gameId !== state.gameId) return;
      applyStateNow(state, false, deadlineAt, watched);
    }, BUST_HOLD_MS);
    return;
  }
  clearBustHold(); // any newer authoritative state wins over a pending hold
  applyStateNow(state, rolled, deadlineAt, watched);
}

/**
 * Did the room deal a new game without this seat?
 *
 * Only a rematch can do this. The accepters are dealt onto the same game id and
 * everyone who declined — or never answered — is left behind, so the very next
 * authoritative state simply has no chair for them.
 *
 * Applying it would put this device on a live board it has no player in: no
 * seat to act with, somebody else's turn forever, and a results screen that
 * vanished without explanation. Checked on the auth user id as well as the
 * player handle, for the same reason OnlineGameScreen's isMe is — the handle is
 * per-game and can drift, the user id cannot.
 */
function seatIsGone(state: GameState, myPlayerId: string | null, userId: string | null): boolean {
  if (state.status !== "active" || !myPlayerId) return false;
  return !state.players.some((p) => p.id === myPlayerId || (!!userId && p.userId === userId));
}

function applyStateNow(
  state: GameState,
  rolled: boolean,
  deadlineAt: number | null,
  watched: boolean,
): void {
  const st = useOnlineStore.getState();
  // The room played on without us. Hold the finished game we're looking at —
  // its result is still the last thing that happened to this player — and say
  // why nothing more is coming. Home is the only way on from here, and it is
  // already on screen.
  if (seatIsGone(state, st.myPlayerId, st.userId)) {
    clearRematchTimer();
    useOnlineStore.setState({
      rematchProposal: null,
      rematchNotice: "The rematch started without you.",
    });
    return;
  }
  const prev = st.state;
  const proj = project(state, st.myPlayerId);
  const active = proj.status === "active";
  if (active) clearQuickFill(); // matched — no bot fill needed
  // A board is on: whatever the last rematch proposal did or didn't do is
  // finished business. Left standing, a "nobody wanted a rematch" from two
  // games ago would reappear under the buttons the next time this room's
  // results came up.
  if (active && (st.rematchProposal || st.rematchNotice)) {
    clearRematchTimer();
    useOnlineStore.setState({ rematchProposal: null, rematchNotice: null });
  }
  // Game over: the server just settled any pot — pull the fresh balance
  // (and its floor top-up) so the results and home screens show it.
  if (proj.status === "finished" && st.status !== "finished") void useWallet.getState().refresh();
  // Our own roll's tumble already started on the tap — don't restart it when
  // the rolled state arrives (whichever of HTTP/realtime/resync gets it here).
  const bump = rolled && !rollBumped;
  // Spent on ANY authoritative state, not only one that `rolled`.
  //
  // The flag means "the tumble for the roll now in flight has already been
  // started", and the state that resolves that roll is the one that ends it —
  // whether or not the state still carries a die. On a folding table it does
  // NOT: the roll and the move are written together, so applyMove has already
  // cleared diceValue and `rolled` is false. Spending the flag only on a rolled
  // state therefore never spent it there at all, and it stayed set for the rest
  // of the match.
  //
  // Left set, it swallows the NEXT roll's bump — and rollSeq is the only thing
  // that starts the tumble or plays the rattle. That is the die that flips
  // straight to a number without rolling, and the roll that makes no sound: not
  // an animation fault, an accounting one. Two symptoms, one stale boolean.
  rollBumped = false;

  // The countdown resets when a new ACTION WINDOW opens, not on every write.
  // It used to bump on all of them, so an opponent's roll restarted the ring
  // sweeping their avatar mid-turn — which read as their profile picture
  // refreshing every single time they rolled.
  //
  // Two things open a window, and both match a deadline the server actually
  // refreshed: the turn changing hands, and the same player earning another
  // roll (a six, a capture, a finish). Rolling does NOT — that is the middle of
  // a window, not the start of one. Without the second case a long chain of
  // capture bonuses would drain the ring to zero while the server was happily
  // extending the real deadline.
  const handedOver = !prev || prev.currentTurnPlayerId !== state.currentTurnPlayerId;
  const newRollWindow = !!prev && prev.phase !== "awaiting-roll" && state.phase === "awaiting-roll";
  const clockReset = handedOver || newRollWindow;

  useOnlineStore.setState({
    state,
    // An authoritative state is the answer to whatever the last error was
    // about, so the message stops being true the moment this lands. It used to
    // persist — cleared only on create/join/quickMatch/leave — so a rejection
    // mid-game followed you all the way into the NEXT room's lobby, which is
    // the one screen that actually renders it.
    error: null,
    bustHold: false,
    validMoves: proj.validMoves,
    lastRoll: proj.lastRoll,
    message: proj.message,
    status: proj.status,
    rollSeq: st.rollSeq + (bump ? 1 : 0),
    turnStartedAt: !active ? null : clockReset ? Date.now() : st.turnStartedAt,
    turnSeq: active && clockReset ? st.turnSeq + 1 : st.turnSeq,
    // `watched && !!prev`: a realtime row is only evidence that a window opened
    // now if we were already holding the state it opened FROM. The first row of
    // a session has no such predecessor, whichever way it arrived.
    turnSeconds: clockReset ? clockSeconds(deadlineAt, watched && !!prev) : st.turnSeconds,
  });
  scheduleTimeout(active, deadlineAt);
  armAutoPilot(active);
  // Enter the game screen; replace a lobby entry so back never returns to a
  // dead lobby. A 2-player quick table can be dealt outright from the Home
  // setup sheet (no lobby stop) — that lands in the push branch.
  const nav = useNav.getState();
  const top = nav.stack[nav.stack.length - 1]!.name;
  if (top === "lobby") nav.replace("onlineGame");
  else if (top !== "onlineGame") nav.push("onlineGame");

  // A table has just been dealt — a fresh game, or a rematch onto the same id.
  // Cover the board until the opening die is armed; primeRoll below uncovers it,
  // on every route including the ones that fail.
  if (active && (!prev || prev.gameId !== state.gameId || st.status !== "active")) dealPending();

  // Dealt: the match's own traffic keeps the function hot from here.
  stopKeepWarm();
  // The turn may have just reached us. Fetch the die now, while the board is
  // still animating this state, so the tap that follows has nothing to wait for.
  primeRoll();
}

function applyGameRow(row: GameSnapshot, watched: boolean): void {
  if (!row.state || row.status === "waiting") {
    useOnlineStore.setState({ status: "lobby" });
    return;
  }
  recordApplied(row.state_version);
  // Rows carry the authoritative stake (rematches reset it server-side).
  if (row.stake != null) useOnlineStore.setState({ stake: row.stake });
  const st = useOnlineStore.getState();
  const prevDice = st.state?.diceValue ?? null;
  // A busted third six never reaches diceValue (the same write hands the turn
  // off), so detect it via lastAction; the turn change dedupes re-deliveries.
  const busted =
    bustedRollDice(row.state) !== null &&
    st.state?.currentTurnPlayerId !== row.state.currentTurnPlayerId;
  const rolled =
    busted ||
    (row.state.diceValue != null &&
      (st.state?.phase !== "awaiting-move" || prevDice !== row.state.diceValue));
  applyState(row.state, rolled, row.turn_deadline ? Date.parse(row.turn_deadline) : null, watched);
}

/**
 * The countdown length to draw for a turn.
 *
 * NOT simply the server's deadline, because that deadline is not only a clock.
 * The server shortens it for seats it drives or has written off — 12s while a
 * bot plays, 6s for a human it knows is away — as internal resilience numbers
 * deciding how soon the table may be resumed. Drawn literally they turn the ring
 * into a bot detector: a quick-match fill-in is deliberately never flagged to
 * the client, and its ring sweeping two and a half times faster than a human's
 * gave the whole disguise away.
 *
 * So a window this client actually WATCHED open is drawn at full length. We know
 * it started now, so the only thing the server's number could add is the fact we
 * must not show. The skip is unaffected — scheduleTimeout still arms on the real
 * deadline, so an away seat is still passed at 6s; the ring simply stops early
 * rather than announcing in advance that it will.
 *
 * A window we merely ARRIVED INTO — a join, a resync — is different: it may be
 * most of the way through, and drawing 30s there would promise time that does
 * not exist. There the server's remaining is the honest answer and the only one
 * we have.
 */
function clockSeconds(deadlineAt: number | null, watchedOpen: boolean): number {
  if (watchedOpen || deadlineAt == null) return TURN_SECONDS;
  return Math.max(1, Math.min(TURN_SECONDS, Math.round((deadlineAt - Date.now()) / 1000)));
}

// Coalesced, single-flight resync. Errors and reconnects tend to arrive in
// bursts on exactly the connections that can least afford four extra requests
// per burst — collapse them into one fetch, and back off while it keeps failing.

const RESYNC_COALESCE_MS = 500;
const RESYNC_BACKOFF_MAX_MS = 4000;
/** Grace given to a request that timed out but is still travelling, before we
 *  refetch and risk reading a state it hasn't been written into yet. */
const RESYNC_AFTER_TIMEOUT_MS = 6000;
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let resyncRunning = false;
let resyncAgain = false;
let resyncWantsLobby = false;
let resyncBackoffMs = 0;

function clearResync(): void {
  if (resyncTimer) clearTimeout(resyncTimer);
  resyncTimer = null;
  resyncRunning = false;
  resyncAgain = false;
  resyncWantsLobby = false;
  resyncBackoffMs = 0;
}

/** Request a resync; bursts coalesce into one run. `withLobby` refetches the
 *  players list too (reconnects — seat changes were missed; action errors
 *  don't need it, the realtime lobby stream is still alive). */
function scheduleResync(gameId: string, withLobby = false): void {
  resyncWantsLobby ||= withLobby;
  if (resyncRunning) {
    resyncAgain = true;
    return;
  }
  if (resyncTimer) return;
  resyncTimer = setTimeout(
    () => {
      resyncTimer = null;
      void runResync(gameId);
    },
    Math.max(RESYNC_COALESCE_MS, resyncBackoffMs),
  );
}

/**
 * Resync on a long fuse, for when an action timed out with its write still in
 * flight. Any authoritative state arriving first (the realtime echo of that
 * very write) cancels it — there is nothing left to reconcile.
 */
function slowResync(gameId: string): void {
  if (resyncTimer || resyncRunning) return;
  // What "already reconciled" means is that a NEWER authoritative state landed
  // while we waited — not that `pending` is empty. Only moves and passes set
  // pending; a roll never does, so keying off it meant a timed-out roll got no
  // reconciliation whatsoever. On our own turn that is terminal: nobody else
  // writes the game, so nothing would ever arrive to correct us.
  const armedAtV = lastAppliedV;
  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    const st = useOnlineStore.getState();
    if (st.gameId !== gameId) return;
    if (lastAppliedV > armedAtV) return; // a newer state got here first
    void runResync(gameId);
  }, RESYNC_AFTER_TIMEOUT_MS);
}

async function runResync(gameId: string): Promise<void> {
  if (useOnlineStore.getState().gameId !== gameId) return; // left the game
  resyncRunning = true;
  const withLobby = resyncWantsLobby;
  resyncWantsLobby = false;
  try {
    if (!channel) subscribe(gameId);
    const { userId } = useOnlineStore.getState();
    if (userId) void api.setConnected(gameId, userId, true).catch(() => {});
    if (withLobby) {
      const lobby = await api.getLobby(gameId);
      useOnlineStore.setState({ lobby });
      void fetchProfiles(lobby);
    }
    const row = await api.fetchGame(gameId);
    // The fetch is the freshest truth — anything queued, predicted or prepared
    // is older. A prepared die especially: it was derived for a version this
    // fetch may well have moved past.
    pending = null;
    syncInFlight();
    rollCache = null;
    prepareSeq++;
    clearRowQueue();
    // A refetch, so treat it as an arrival rather than a window we watched.
    applyGameRow(row, false);
    resyncBackoffMs = 0;
  } catch (e) {
    if (e instanceof api.RowGoneError) {
      // The game is deleted, or we are no longer seated in it (a reaped waiting
      // room, an auto-leave). Backing off and asking again cannot change that —
      // it just resyncs forever against a row we will never be shown. Stop, and
      // tell the player instead of spinning silently.
      resyncBackoffMs = 0;
      resyncAgain = false;
      // Re-check the guard from the top of this function: the awaits above mean
      // the player may have left and joined a DIFFERENT game while we waited,
      // and failing that one over this one's dead row would be a fresh bug.
      if (useOnlineStore.getState().gameId === gameId) {
        useOnlineStore.setState({ status: "error", error: errorText(e) });
      }
      return;
    }
    // Still failing — retry with backoff until it succeeds or the game ends.
    resyncBackoffMs = Math.min(Math.max(resyncBackoffMs * 2, 1000), RESYNC_BACKOFF_MAX_MS);
    resyncWantsLobby ||= withLobby;
    resyncAgain = true;
  } finally {
    resyncRunning = false;
    if (resyncAgain) {
      resyncAgain = false;
      scheduleResync(gameId, resyncWantsLobby);
    }
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}
