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
import { useNav } from "./navStore";

const COLOR_LABEL: Record<PlayerColor, string> = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" };
const AUTO_DELAY = 700;

type Status = "idle" | "connecting" | "lobby" | "active" | "finished" | "error";

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

  state: GameState | null;
  validMoves: Move[];
  lastRoll: number | null;
  rollSeq: number;
  message: string;

  create: () => Promise<void>;
  join: (code: string) => Promise<void>;
  start: () => Promise<void>;
  roll: () => Promise<void>;
  selectToken: (tokenId: string) => Promise<void>;
  pass: () => Promise<void>;
  leave: () => void;
  resync: () => Promise<void>;

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
  state: null,
  validMoves: [] as Move[],
  lastRoll: null,
  rollSeq: 0,
  message: "",
};

export const useOnlineStore = create<OnlineStore>((set, get) => ({
  ...INITIAL,

  create: async () => {
    set({ status: "connecting", error: null });
    try {
      const m = await api.createGame();
      subscribe(m.gameId);
      const lobby = await api.getLobby(m.gameId);
      set({ gameId: m.gameId, roomCode: m.roomCode, userId: m.userId, myPlayerId: m.myPlayerId, isHost: true, lobby, status: "lobby" });
      useNav.getState().push("lobby");
    } catch (e) {
      set({ status: "error", error: errorText(e) });
    }
  },

  join: async (code) => {
    set({ status: "connecting", error: null });
    try {
      const m = await api.joinGame(code);
      subscribe(m.gameId);
      const lobby = await api.getLobby(m.gameId);
      const me = lobby.find((p) => p.user_id === m.userId);
      set({ gameId: m.gameId, roomCode: m.roomCode, userId: m.userId, myPlayerId: m.myPlayerId, isHost: me?.is_host ?? false, lobby });
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

  leave: () => {
    clearAuto();
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

  isMyTurn: () => {
    const { state, myPlayerId } = get();
    return !!state && state.status === "active" && state.currentTurnPlayerId === myPlayerId;
  },
}));

// --- Realtime + helpers -----------------------------------------------------

let channel: RealtimeChannel | null = null;
let autoTimer: ReturnType<typeof setTimeout> | null = null;

function clearAuto(): void {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
}

function subscribe(gameId: string): void {
  if (channel) api.unsubscribe(channel);
  channel = api.subscribeGame(gameId, { onGame: applyGameRow, onLobby: refreshLobby });
}

async function refreshLobby(): Promise<void> {
  const { gameId, isHost, status } = useOnlineStore.getState();
  if (!gameId) return;
  try {
    const lobby = await api.getLobby(gameId);
    useOnlineStore.setState({ lobby });
    if (isHost && status === "lobby" && lobby.length === 4 && !useOnlineStore.getState().starting) {
      void useOnlineStore.getState().start();
    }
  } catch {
    // ignore transient lobby refresh failures
  }
}

/** Apply an authoritative GameState into the view and navigate when active. */
function applyState(state: GameState, rolled: boolean): void {
  const st = useOnlineStore.getState();
  const proj = project(state, st.myPlayerId);
  useOnlineStore.setState({
    state,
    validMoves: proj.validMoves,
    lastRoll: proj.lastRoll,
    message: proj.message,
    status: proj.status,
    rollSeq: st.rollSeq + (rolled ? 1 : 0),
  });
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
