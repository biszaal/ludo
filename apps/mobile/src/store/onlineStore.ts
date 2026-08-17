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
  type GameState,
  type Move,
} from "@ludo/engine";
import { chooseMove } from "@ludo/bot";
import type { RealtimeChannel } from "@supabase/supabase-js";
import * as api from "../net/api";
import { pushProfile } from "../net/profileSync";
import { applyChatEvent, type ChatEvent } from "../lib/chat";
import { stateAnimationMs } from "../lib/moveTiming";
import { BUST_HOLD_MS, bustedRollDice, colorOf, isBustHandoff, project } from "../lib/projection";
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

  /** Local receipt time of the current turn (drives the countdown; display only). */
  turnStartedAt: number | null;
  /** Bumps each time the turn clock resets — re-keys the countdown animation. */
  turnSeq: number;
  /** A busted third six is being shown on the roller's own die; the seat has
   *  not changed hands yet and no input should be accepted. */
  bustHold: boolean;
  /** I idled out my turn clock, so the bot policy plays my seat from this
   *  device until I take back control. Local-only — opponents just see moves. */
  autoPilot: boolean;

  sendReaction: (value: string) => void;
  sendMessage: (text: string) => void;
  markChatRead: () => void;

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
  /** Host-only: reset the finished game for everyone (guests follow via realtime). */
  rematch: () => Promise<void>;
  leave: () => void;
  resync: () => Promise<void>;
  /** Flag own presence when the app backgrounds/foregrounds (best-effort). */
  setAway: (away: boolean) => void;

  isMyTurn: () => boolean;
}

const INITIAL = {
  status: "idle" as Status,
  error: null,
  gameId: null,
  roomCode: null,
  userId: null,
  myPlayerId: null,
  isHost: false,
  starting: false,
  isQuick: false,
  quickSize: 2,
  stake: 0,
  lobby: [] as api.LobbyPlayer[],
  profiles: {} as Record<string, api.Profile>,
  state: null,
  validMoves: [] as Move[],
  lastRoll: null,
  rollSeq: 0,
  message: "",
  chat: [] as ChatEvent[],
  chatSeq: 0,
  chatUnread: 0,
  latestBubbles: {} as Record<string, { value: string; kind: ChatEvent["kind"]; seq: number }>,
  turnStartedAt: null,
  turnSeq: 0,
  bustHold: false,
  autoPilot: false,
};

export const useOnlineStore = create<OnlineStore>((set, get) => ({
  ...INITIAL,

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
        applyGameRow(row);
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
    const { state, gameId, myPlayerId, rollSeq } = get();
    if (
      !state ||
      !gameId ||
      state.phase !== "awaiting-roll" ||
      state.currentTurnPlayerId !== myPlayerId ||
      rollInFlight
    )
      return;
    // The number is server-generated, but the animation needn't wait for it:
    // start the tumble on the tap with lastRoll cleared — a null value tells
    // the die to hold airborne until the response lands the real one (a stale
    // lastRoll here would hand it a wrong face to settle on). rollBumped stops
    // the arriving state from re-triggering the tumble.
    rollInFlight = true;
    rollBumped = true;
    set({ rollSeq: rollSeq + 1, lastRoll: null });
    try {
      const res = await enqueueSend(() => api.rollAction(gameId));
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
    applyState(predicted, false);
    try {
      const res = await enqueueSend(() => api.moveAction(gameId, tokenId));
      applyTurnResult(res, false);
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
    applyState(predicted, false);
    try {
      const res = await enqueueSend(() => api.passAction(gameId));
      applyTurnResult(res, false);
    } catch (e) {
      onActionFailed(e, gameId);
    }
  },

  rematch: async () => {
    const { gameId, isHost, state } = get();
    if (!gameId || !isHost || state?.status !== "finished") return;
    try {
      const res = await api.rematchAction(gameId);
      applyTurnResult(res, false);
    } catch (e) {
      set({ error: errorText(e) });
    }
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
    const trimmed = text.trim().slice(0, 80);
    if (trimmed.length > 0) sendChatEvent("text", trimmed);
  },

  markChatRead: () => set({ chatUnread: 0 }),
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
 * Apply a turn op's HTTP response, reconciling any optimistic prediction.
 * The realtime echo may have arrived first — versions decide, not timing.
 */
function applyTurnResult(res: api.TurnResult, rolled: boolean): void {
  const { state, v } = res;
  if (v != null && v <= lastAppliedV) return; // realtime/resync got there first

  if (pending) {
    const confirmed =
      (v == null || v === pending.baseV + 1) && statesEqual(state, pending.predicted);
    pending = null;
    recordApplied(v);
    if (confirmed) return; // already on screen from the optimistic apply
    // The server disagreed, or another write (stall bot) won the race and our
    // own write bounced off the version guard — snap to the server's truth.
    applyState(state, rolled);
    return;
  }

  recordApplied(v);
  applyState(state, rolled);
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
  useOnlineStore.setState({ error: errorText(e) });
  scheduleResync(gameId);
}

/** Forget all per-game optimistic/sync bookkeeping (leave, new subscribe). */
function resetSyncState(): void {
  clearBustHold();
  lastAppliedV = -1;
  pending = null;
  rollInFlight = false;
  rollBumped = false;
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
 */
function scheduleTimeout(active: boolean): void {
  clearTimeoutTimer();
  if (!active) return;
  const delay = TURN_SECONDS * 1000 + TIMEOUT_GRACE_MS + Math.random() * 2000;
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

function subscribe(gameId: string): void {
  if (channel) api.unsubscribe(channel);
  clearRowQueue();
  resetSyncState();
  channel = api.subscribeGame(gameId, {
    onGame: enqueueGameRow,
    onLobby: refreshLobby,
    onChat: receiveChat,
    // Row updates during a socket drop are lost, not replayed — refetch.
    onReconnect: () => scheduleResync(gameId, true),
  });
}

// --- Paced application of realtime rows ----------------------------------------
// Under lag the socket can deliver several row updates in one burst. Applied
// immediately they'd collapse into one render — the same token's two moves merge
// into a >6-cell jump the Board won't hop, and a mid-animation restart cuts the
// previous move short. Queue them instead: each state applies only after the
// previous one's animation has played out. Local action responses still apply
// directly (the actor wants instant feedback); their realtime echoes dedupe here.

/** The slice of a games row the sync path actually consumes. */
type GameSnapshot = Pick<api.GameRow, "state" | "status" | "state_version" | "stake">;

/** Small buffer after each animation before the next state lands. */
const ROW_HOLD_PAD_MS = 80;
let rowQueue: GameSnapshot[] = [];
let rowHoldTimer: ReturnType<typeof setTimeout> | null = null;

function clearRowQueue(): void {
  rowQueue = [];
  if (rowHoldTimer) clearTimeout(rowHoldTimer);
  rowHoldTimer = null;
}

function enqueueGameRow(row: GameSnapshot): void {
  rowQueue.push(row);
  if (!rowHoldTimer) drainRowQueue();
}

function drainRowQueue(): void {
  rowHoldTimer = null;
  const row = rowQueue.shift();
  if (!row) return;
  const prev = useOnlineStore.getState().state;
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
      recordApplied(v);
      drainRowQueue();
      return;
    }
    // A write we didn't predict landed at or past our slot (stall bot won the
    // race; our own write bounced off the version guard). Snap to it and keep
    // draining — anything queued behind is newer still.
    pending = null;
  }

  applyGameRow(row);
  const hold = prev && row.state ? stateAnimationMs(prev, row.state) + ROW_HOLD_PAD_MS : 0;
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
  const { userId, status } = useOnlineStore.getState();
  if (!channel || !userId || status === "idle" || status === "error") return;
  const now = Date.now();
  if (now - lastChatSentAt < CHAT_MIN_INTERVAL_MS) return;
  lastChatSentAt = now;
  api.sendChat(channel, { kind, value, fromUserId: userId });
  appendChat({ kind, value, fromUserId: userId });
}

function receiveChat(payload: api.ChatPayload): void {
  const { userId } = useOnlineStore.getState();
  if (!payload?.value || payload.fromUserId === userId) return;
  if (payload.kind !== "reaction" && payload.kind !== "text") return;
  appendChat({
    kind: payload.kind,
    value: String(payload.value).slice(0, 80),
    fromUserId: payload.fromUserId,
  });
}

function appendChat(p: Omit<ChatEvent, "id" | "at">): void {
  const st = useOnlineStore.getState();
  useOnlineStore.setState(applyChatEvent(st, p));
}

/** players-table events arrive in bursts (join + presence toggles) — coalesce
 *  them into one lobby fetch instead of one HTTP round trip per event. */
const LOBBY_DEBOUNCE_MS = 150;
let lobbyTimer: ReturnType<typeof setTimeout> | null = null;

function clearLobbyTimer(): void {
  if (lobbyTimer) clearTimeout(lobbyTimer);
  lobbyTimer = null;
}

function refreshLobby(): void {
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    void doRefreshLobby();
  }, LOBBY_DEBOUNCE_MS);
}

async function doRefreshLobby(): Promise<void> {
  const { gameId, isHost, status } = useOnlineStore.getState();
  if (!gameId) return;
  try {
    const lobby = await api.getLobby(gameId);
    useOnlineStore.setState({ lobby });
    void fetchProfiles(lobby);
    if (
      isHost &&
      status === "lobby" &&
      lobby.length === 4 &&
      !useOnlineStore.getState().starting
    ) {
      void useOnlineStore.getState().start();
    }
  } catch {
    // ignore transient lobby refresh failures
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
function applyState(state: GameState, rolled: boolean): void {
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
      applyStateNow(state, false);
    }, BUST_HOLD_MS);
    return;
  }
  clearBustHold(); // any newer authoritative state wins over a pending hold
  applyStateNow(state, rolled);
}

function applyStateNow(state: GameState, rolled: boolean): void {
  const st = useOnlineStore.getState();
  const prev = st.state;
  const proj = project(state, st.myPlayerId);
  const active = proj.status === "active";
  if (active) clearQuickFill(); // matched — no bot fill needed
  // Game over: the server just settled any pot — pull the fresh balance
  // (and its floor top-up) so the results and home screens show it.
  if (proj.status === "finished" && st.status !== "finished") void useWallet.getState().refresh();
  // Our own roll's tumble already started on the tap — don't restart it when
  // the rolled state arrives (whichever of HTTP/realtime/resync gets it here).
  const bump = rolled && !rollBumped;
  if (rolled) rollBumped = false;

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
    bustHold: false,
    validMoves: proj.validMoves,
    lastRoll: proj.lastRoll,
    message: proj.message,
    status: proj.status,
    rollSeq: st.rollSeq + (bump ? 1 : 0),
    turnStartedAt: !active ? null : clockReset ? Date.now() : st.turnStartedAt,
    turnSeq: active && clockReset ? st.turnSeq + 1 : st.turnSeq,
  });
  scheduleTimeout(active);
  armAutoPilot(active);
  // Enter the game screen; replace a lobby entry so back never returns to a
  // dead lobby. A 2-player quick table can be dealt outright from the Home
  // setup sheet (no lobby stop) — that lands in the push branch.
  const nav = useNav.getState();
  const top = nav.stack[nav.stack.length - 1]!.name;
  if (top === "lobby") nav.replace("onlineGame");
  else if (top !== "onlineGame") nav.push("onlineGame");
}

function applyGameRow(row: GameSnapshot): void {
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
  applyState(row.state, rolled);
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
    // The fetch is the freshest truth — anything queued or predicted is older.
    pending = null;
    clearRowQueue();
    applyGameRow(row);
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
