/**
 * Client store: a thin projection layer over the engine. The UI emits intents
 * (roll / select token / pass); the store runs the pure engine transitions and
 * holds the resulting GameState plus view-only derived data. No rules live here.
 *
 * Phase 2 scope: local hot-seat (all players share one device), with an optional
 * "vs AI" mode where the last seats are driven by the @ludo/bot policy on a timer.
 */

import { create } from "zustand";
import {
  applyMove,
  checkWin,
  createGame,
  endTurn,
  getValidMoves,
  mathRandomRng,
  rollDice,
  type Color as PlayerColor,
  type GameState,
  type Move,
} from "@ludo/engine";
import { chooseMove } from "@ludo/bot";
import { seatColors } from "../lib/seating";
import { useNav } from "./navStore";

const COLOR_LABEL: Record<PlayerColor, string> = {
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
};

/** Delay between a bot's actions, so a human can follow what it's doing. */
const BOT_DELAY = 650;
/** Pause before a human's forced action (auto-pass / lone move) so the dice reads. */
const AUTO_DELAY = 650;

interface GameStore {
  state: GameState | null;
  validMoves: Move[];
  lastRoll: number | null;
  /** Increments on every roll — drives the dice tumble animation. */
  rollSeq: number;
  message: string;
  /** Player ids controlled by the bot (the trailing seats in "vs AI" mode). */
  botIds: string[];

  newLocalGame: (numPlayers: number, numBots?: number) => void;
  roll: () => void;
  pass: () => void;
  selectToken: (tokenId: string) => void;
  leaveGame: () => void;

  currentColor: () => PlayerColor | null;
  isMovable: (tokenId: string) => boolean;
  isCurrentBot: () => boolean;
}

export const useGameStore = create<GameStore>((set, get) => ({
  state: null,
  validMoves: [],
  lastRoll: null,
  rollSeq: 0,
  message: "",
  botIds: [],

  newLocalGame: (numPlayers, numBots = 0) => {
    const colors = seatColors(numPlayers);
    const players = Array.from({ length: numPlayers }, (_unused, i) => ({
      id: `p${i + 1}`,
      userId: `local-${i + 1}`,
      color: colors[i]!,
    }));
    const state = createGame(players);
    const botIds = players.slice(numPlayers - numBots).map((p) => p.id);
    set({
      state,
      validMoves: [],
      lastRoll: null,
      rollSeq: 0,
      botIds,
      message: `${COLOR_LABEL[colors[0]!]} to roll`,
    });
    useNav.getState().push("localGame");
    kickBots();
  },

  roll: () => {
    clearAutoTimer();
    const { state } = get();
    if (!state || state.phase !== "awaiting-roll") return;

    const { newState, diceValue, busted } = rollDice(state, mathRandomRng);
    const color = playerColor(newState, state.currentTurnPlayerId);
    const rollSeq = get().rollSeq + 1;

    if (busted) {
      set({ state: newState, validMoves: [], lastRoll: diceValue, rollSeq, message: `${COLOR_LABEL[color]} rolled three 6s — turn forfeited` });
      kickBots();
      return;
    }

    const moves = getValidMoves(newState, newState.currentTurnPlayerId);
    set({
      state: newState,
      validMoves: moves,
      lastRoll: diceValue,
      rollSeq,
      message:
        moves.length === 0
          ? `${COLOR_LABEL[color]} rolled ${diceValue} — no moves`
          : `${COLOR_LABEL[color]} rolled ${diceValue} — choose a token`,
    });

    scheduleHumanAuto(); // auto-pass (no moves) or auto-play a lone move, for humans
    kickBots();
  },

  pass: () => {
    clearAutoTimer();
    const { state, validMoves } = get();
    if (!state || state.phase !== "awaiting-move" || validMoves.length > 0) return;
    const next = endTurn(state);
    set({ state: next, validMoves: [], message: `${COLOR_LABEL[playerColor(next, next.currentTurnPlayerId)]} to roll` });
    kickBots();
  },

  selectToken: (tokenId) => {
    clearAutoTimer();
    const { state, validMoves } = get();
    if (!state || state.phase !== "awaiting-move") return;
    if (!validMoves.some((m) => m.tokenId === tokenId)) return;

    const before = state.currentTurnPlayerId;
    const next = applyMove(state, { tokenId });

    const win = checkWin(next);
    if (win.finished && win.winnerPlayerId) {
      set({ state: next, validMoves: [], message: `${COLOR_LABEL[playerColor(next, win.winnerPlayerId)]} wins!` });
      return; // game over — no bot kick
    }

    const nowColor = playerColor(next, next.currentTurnPlayerId);
    set({
      state: next,
      validMoves: [],
      message:
        next.currentTurnPlayerId === before
          ? `${COLOR_LABEL[nowColor]} rolls again`
          : `${COLOR_LABEL[nowColor]} to roll`,
    });
    kickBots();
  },

  leaveGame: () => {
    stopBots();
    clearAutoTimer();
    set({ state: null, validMoves: [], lastRoll: null, botIds: [], message: "" });
    useNav.getState().popTo("home");
  },

  currentColor: () => {
    const { state } = get();
    return state ? playerColor(state, state.currentTurnPlayerId) : null;
  },

  isMovable: (tokenId) => get().validMoves.some((m) => m.tokenId === tokenId),

  isCurrentBot: () => {
    const { state, botIds } = get();
    return !!state && state.status === "active" && botIds.includes(state.currentTurnPlayerId);
  },
}));

function playerColor(state: GameState, playerId: string): PlayerColor {
  return state.players.find((p) => p.id === playerId)!.color;
}

// --- Forced human actions ---------------------------------------------------
// After a human rolls, a turn with no legal moves auto-passes, and a turn with a
// single legal move auto-plays it — after a short delay so the dice is readable.
// Manual actions cancel the pending timer.

let autoTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoTimer(): void {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
}

function scheduleHumanAuto(): void {
  clearAutoTimer();
  const s = useGameStore.getState();
  const state = s.state;
  if (!state || state.status !== "active" || state.phase !== "awaiting-move") return;
  if (s.botIds.includes(state.currentTurnPlayerId)) return; // bots pace themselves

  if (s.validMoves.length === 0) {
    autoTimer = setTimeout(() => useGameStore.getState().pass(), AUTO_DELAY);
  } else if (s.validMoves.length === 1) {
    const only = s.validMoves[0]!.tokenId;
    autoTimer = setTimeout(() => useGameStore.getState().selectToken(only), AUTO_DELAY);
  }
}

// --- Bot auto-play loop -----------------------------------------------------
// Self-perpetuating timer loop that runs only during bot turns. Started by
// kickBots() at each human→bot hand-off; exits as soon as a human is on the clock.

let botLoopActive = false;
let botTimer: ReturnType<typeof setTimeout> | null = null;

function kickBots(): void {
  if (botLoopActive || !useGameStore.getState().isCurrentBot()) return;
  botLoopActive = true;
  botTimer = setTimeout(stepBots, BOT_DELAY);
}

function stepBots(): void {
  const s = useGameStore.getState();
  const state = s.state;
  if (!state || state.status !== "active" || !s.botIds.includes(state.currentTurnPlayerId)) {
    botLoopActive = false;
    return;
  }

  if (state.phase === "awaiting-roll") {
    s.roll();
  } else if (s.validMoves.length === 0) {
    s.pass();
  } else {
    const move = chooseMove(state, state.currentTurnPlayerId, s.validMoves);
    s.selectToken(move.tokenId);
  }

  botTimer = setTimeout(stepBots, BOT_DELAY);
}

function stopBots(): void {
  botLoopActive = false;
  if (botTimer) clearTimeout(botTimer);
  botTimer = null;
}
