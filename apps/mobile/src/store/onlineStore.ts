/**
 * Online multiplayer store (server-authoritative). Turn actions call the `game`
 * Edge Function, which generates the dice and validates moves; the function
 * returns the new authoritative GameState, which we apply. Realtime broadcasts
 * keep the other clients in sync, and resync() recovers missed updates on
 * reconnect. The client computes valid moves only for display/highlighting.
 */

import { create } from "zustand";
import {
  checkWin,
  getValidMoves,
  type Color as PlayerColor,
  type GameState,
  type Move,
} from "@ludo/engine";
import type { RealtimeChannel } from "@supabase/supabase-js";
import * as api from "../net/api";
import { applyChatEvent, type ChatEvent } from "../lib/chat";
import { useNav } from "./navStore";
import { useProfile } from "./profileStore";

const COLOR_LABEL: Record<PlayerColor, string> = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" };
const AUTO_DELAY = 700;
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
  /** Latest reaction per sender user_id (drives the floating bubbles). */
  latestReactions: Record<string, { value: string; seq: number }>;

  /** Local receipt time of the current turn (drives the countdown; display only). */
  turnStartedAt: number | null;
  /** Bumps each time the turn clock resets — re-keys the countdown animation. */
  turnSeq: number;

  sendReaction: (value: string) => void;
  sendMessage: (text: string) => void;
  markChatRead: () => void;

  create: () => Promise<void>;
  join: (code: string) => Promise<void>;
  start: () => Promise<void>;
  roll: () => Promise<void>;
  selectToken: (tokenId: string) => Promise<void>;
  pass: () => Promise<void>;
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
  latestReactions: {} as Record<string, { value: string; seq: number }>,
  turnStartedAt: null,
  turnSeq: 0,
};

export const useOnlineStore = create<OnlineStore>((set, get) => ({
  ...INITIAL,

  create: async () => {
    set({ status: "connecting", error: null });
    try {
      const m = await api.createGame();
      syncMyProfile();
      subscribe(m.gameId);
      const lobby = await api.getLobby(m.gameId);
      set({ gameId: m.gameId, roomCode: m.roomCode, userId: m.userId, myPlayerId: m.myPlayerId, isHost: true, lobby, status: "lobby" });
      void fetchProfiles(lobby);
      useNav.getState().push("lobby");
    } catch (e) {
      set({ status: "error", error: errorText(e) });
    }
  },

  join: async (code) => {
    set({ status: "connecting", error: null });
    try {
      const m = await api.joinGame(code);
      syncMyProfile();
      subscribe(m.gameId);
      const lobby = await api.getLobby(m.gameId);
      const me = lobby.find((p) => p.user_id === m.userId);
      set({ gameId: m.gameId, roomCode: m.roomCode, userId: m.userId, myPlayerId: m.myPlayerId, isHost: me?.is_host ?? false, lobby });
      void fetchProfiles(lobby);
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

  start: async () => {
    const { gameId, isHost, lobby, starting } = get();
    if (!gameId || !isHost || starting || lobby.length < 2) return;
    set({ starting: true });
    try {
      const state = await api.startGame(gameId);
      applyState(state, false);
    } catch (e) {
      set({ error: errorText(e), starting: false });
    }
  },

  roll: async () => {
    clearAuto();
    const { state, gameId, myPlayerId } = get();
    if (!state || !gameId || state.phase !== "awaiting-roll" || state.currentTurnPlayerId !== myPlayerId) return;
    try {
      const next = await api.rollAction(gameId);
      applyState(next, true);
      if (next.status === "active" && next.phase === "awaiting-move" && next.currentTurnPlayerId === myPlayerId) {
        const moves = getValidMoves(next, myPlayerId);
        if (moves.length === 0) autoTimer = setTimeout(() => void get().pass(), AUTO_DELAY);
        else if (moves.length === 1) {
          const only = moves[0]!.tokenId;
          autoTimer = setTimeout(() => void get().selectToken(only), AUTO_DELAY);
        }
      }
    } catch (e) {
      set({ error: errorText(e) });
      await resyncGame(gameId);
    }
  },

  selectToken: async (tokenId) => {
    clearAuto();
    const { state, validMoves, gameId, myPlayerId } = get();
    if (!state || !gameId || state.phase !== "awaiting-move" || state.currentTurnPlayerId !== myPlayerId) return;
    if (!validMoves.some((m) => m.tokenId === tokenId)) return;
    try {
      const next = await api.moveAction(gameId, tokenId);
      applyState(next, false);
    } catch (e) {
      set({ error: errorText(e) });
      await resyncGame(gameId);
    }
  },

  pass: async () => {
    clearAuto();
    const { state, validMoves, gameId, myPlayerId } = get();
    if (!state || !gameId || state.phase !== "awaiting-move" || validMoves.length > 0 || state.currentTurnPlayerId !== myPlayerId) return;
    try {
      const next = await api.passAction(gameId);
      applyState(next, false);
    } catch (e) {
      set({ error: errorText(e) });
      await resyncGame(gameId);
    }
  },

  rematch: async () => {
    const { gameId, isHost, state } = get();
    if (!gameId || !isHost || state?.status !== "finished") return;
    try {
      const next = await api.rematchAction(gameId);
      applyState(next, false);
    } catch (e) {
      set({ error: errorText(e) });
    }
  },

  leave: () => {
    clearAuto();
    clearTimeoutTimer();
    const { gameId, userId } = get();
    if (channel) {
      api.unsubscribe(channel);
      channel = null;
    }
    if (gameId && userId) void api.setConnected(gameId, userId, false).catch(() => {});
    set({ ...INITIAL });
    useNav.getState().popTo("home");
  },

  resync: async () => {
    const { gameId } = get();
    if (gameId) await resyncGame(gameId);
  },

  setAway: (away) => {
    const { gameId, userId } = get();
    if (gameId && userId) void api.setConnected(gameId, userId, !away).catch(() => {});
  },

  isMyTurn: () => {
    const { state, myPlayerId } = get();
    return !!state && state.status === "active" && state.currentTurnPlayerId === myPlayerId;
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

function clearAuto(): void {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
}

function clearTimeoutTimer(): void {
  if (timeoutTimer) clearTimeout(timeoutTimer);
  timeoutTimer = null;
}

/**
 * Every client arms a skip for the active turn (including the current player's —
 * an AFK player's own app may be asleep). Fires a few seconds past the deadline
 * with per-client jitter so racers don't all pile on; the server dedupes. Any
 * fresh state reschedules this, so only a genuinely stalled turn ever fires.
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
    const next = await api.timeoutAction(gameId);
    applyState(next, false);
  } catch {
    // transient — realtime or the next resync will correct us
  }
}

function subscribe(gameId: string): void {
  if (channel) api.unsubscribe(channel);
  channel = api.subscribeGame(gameId, { onGame: applyGameRow, onLobby: refreshLobby, onChat: receiveChat });
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
  appendChat({ kind: payload.kind, value: String(payload.value).slice(0, 80), fromUserId: payload.fromUserId });
}

function appendChat(p: Omit<ChatEvent, "id" | "at">): void {
  const st = useOnlineStore.getState();
  useOnlineStore.setState(applyChatEvent(st, p));
}

async function refreshLobby(): Promise<void> {
  const { gameId, isHost, status } = useOnlineStore.getState();
  if (!gameId) return;
  try {
    const lobby = await api.getLobby(gameId);
    useOnlineStore.setState({ lobby });
    void fetchProfiles(lobby);
    if (isHost && status === "lobby" && lobby.length === 4 && !useOnlineStore.getState().starting) {
      void useOnlineStore.getState().start();
    }
  } catch {
    // ignore transient lobby refresh failures
  }
}

/** Merge profiles for these players into the store (best-effort, cosmetic). */
async function fetchProfiles(lobby: api.LobbyPlayer[]): Promise<void> {
  try {
    const rows = await api.getProfiles(lobby.map((p) => p.user_id));
    if (rows.length === 0) return;
    const profiles = { ...useOnlineStore.getState().profiles };
    for (const r of rows) profiles[r.user_id] = r;
    useOnlineStore.setState({ profiles });
  } catch {
    // color labels remain the fallback
  }
}

/** Push the local profile to the server once a session exists (create/join). */
function syncMyProfile(): void {
  const { displayName, avatarId } = useProfile.getState();
  void api.upsertMyProfile(displayName, avatarId).catch(() => {});
}

/** Apply an authoritative GameState into the view and navigate when active. */
function applyState(state: GameState, rolled: boolean): void {
  const st = useOnlineStore.getState();
  const proj = project(state, st.myPlayerId);
  // Reset the per-turn countdown on every active write (mirrors the server, which
  // refreshes turn_deadline on every write). Idle turns keep the same clock.
  const active = proj.status === "active";
  useOnlineStore.setState({
    state,
    validMoves: proj.validMoves,
    lastRoll: proj.lastRoll,
    message: proj.message,
    status: proj.status,
    rollSeq: st.rollSeq + (rolled ? 1 : 0),
    turnStartedAt: active ? Date.now() : null,
    turnSeq: active ? st.turnSeq + 1 : st.turnSeq,
  });
  scheduleTimeout(active);
  if (proj.status !== "lobby") {
    // Enter the game screen; replace a lobby entry so back never returns to a dead lobby.
    const nav = useNav.getState();
    const top = nav.stack[nav.stack.length - 1]!.name;
    if (top === "lobby") nav.replace("onlineGame");
    else if (top !== "onlineGame") nav.push("onlineGame");
  }
}

function applyGameRow(row: api.GameRow): void {
  if (!row.state || row.status === "waiting") {
    useOnlineStore.setState({ status: "lobby" });
    return;
  }
  const st = useOnlineStore.getState();
  const prevDice = st.state?.diceValue ?? null;
  const rolled = row.state.diceValue != null && (st.state?.phase !== "awaiting-move" || prevDice !== row.state.diceValue);
  applyState(row.state, rolled);
}

async function resyncGame(gameId: string): Promise<void> {
  try {
    if (!channel) subscribe(gameId);
    const { userId } = useOnlineStore.getState();
    if (userId) void api.setConnected(gameId, userId, true).catch(() => {});
    const lobby = await api.getLobby(gameId);
    useOnlineStore.setState({ lobby });
    void fetchProfiles(lobby);
    const row = await api.fetchGame(gameId);
    applyGameRow(row);
  } catch {
    // best-effort
  }
}

interface Projection {
  validMoves: Move[];
  message: string;
  status: Status;
  lastRoll: number | null;
}

function project(state: GameState, myPlayerId: string | null): Projection {
  const win = checkWin(state);
  if (win.finished && win.winnerPlayerId) {
    return { validMoves: [], message: `${COLOR_LABEL[colorOf(state, win.winnerPlayerId)]} wins!`, status: "finished", lastRoll: state.diceValue };
  }
  const myTurn = state.currentTurnPlayerId === myPlayerId;
  const validMoves = myTurn && state.phase === "awaiting-move" ? getValidMoves(state, myPlayerId!) : [];
  const turnColor = COLOR_LABEL[colorOf(state, state.currentTurnPlayerId)];
  let message: string;
  if (!myTurn) {
    message = `Waiting for ${turnColor}…`;
  } else if (state.phase === "awaiting-roll") {
    message = "Your turn — roll";
  } else {
    message = validMoves.length === 0 ? "No moves — passing…" : "Choose a token";
  }
  return { validMoves, message, status: "active", lastRoll: state.diceValue };
}

function colorOf(state: GameState, playerId: string): PlayerColor {
  return state.players.find((p) => p.id === playerId)!.color;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}
