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
  type RuleConfig,
} from "@ludo/engine";
import { chooseMove } from "@ludo/bot";
import { seatColors } from "../lib/seating";
import { ordinal } from "../lib/standings";
import { useNav } from "./navStore";

const COLOR_LABEL: Record<PlayerColor, string> = {
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
};

/** Delay between a bot's actions, so a human can follow what it's doing. */
const BOT_DELAY = 450;
/** Pause before auto-passing a no-move roll: the die tumble runs ~700ms
 *  (Dice ROLL_MS), then the number needs a beat to be read. */
const AUTO_PASS_DELAY = 1000;
/** A lone legal move plays the moment the tumble settles — no choice to make. */
const AUTO_MOVE_DELAY = 600;
/** vs-AI: seconds a human has per action before the bot policy acts for them.
 *  Matches the online TURN_SECONDS so the countdown ring reads the same. */
export const TURN_SECONDS = 30;

export interface LocalGameConfig {
  /** Seats at the table, 2–4. */
  players: number;
  /** Bot-driven trailing seats: 0 for pass-and-play, players−1 for "vs AI". */
  bots?: number;
  /** House-rule overrides; omitted keys fall back to DEFAULT_RULES. */
  rules?: Partial<RuleConfig>;
}

interface GameStore {
  state: GameState | null;
  validMoves: Move[];
  lastRoll: number | null;
  /** Increments on every roll — drives the dice tumble animation. */
  rollSeq: number;
  message: string;
  /** Player ids controlled by the bot (the trailing seats in "vs AI" mode). */
  botIds: string[];
  /** The last game's setup, so Results can offer an instant rematch. */
  lastConfig: LocalGameConfig | null;
  /** Bumps whenever the human's turn clock (vs AI) restarts — re-keys the ring. */
  turnSeq: number;
  /** vs AI: the human idled out the turn clock, so the bot plays their seat
   *  until they take back control (local-only — nothing leaves the device). */
  autoPilot: boolean;

  newLocalGame: (config: LocalGameConfig) => void;
  roll: () => void;
  pass: () => void;
  selectToken: (tokenId: string) => void;
  takeControl: () => void;
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
  lastConfig: null,
  turnSeq: 0,
  autoPilot: false,

  newLocalGame: (config) => {
    const { players: numPlayers, bots: numBots = 0 } = config;
    const colors = seatColors(numPlayers);
    const players = Array.from({ length: numPlayers }, (_unused, i) => ({
      id: `p${i + 1}`,
      userId: `local-${i + 1}`,
      color: colors[i]!,
    }));
    const state = createGame(players, { rules: config.rules });
    const botIds = players.slice(numPlayers - numBots).map((p) => p.id);
    set({
      state,
      validMoves: [],
      lastRoll: null,
      rollSeq: 0,
      botIds,
      lastConfig: config,
      autoPilot: false,
      message: `${COLOR_LABEL[colors[0]!]} to roll`,
    });
    useNav.getState().push("localGame");
    kickBots();
    scheduleHumanClock();
  },

  roll: () => {
    clearAutoTimer();
    const { state } = get();
    if (!state || state.phase !== "awaiting-roll") return;

    const { newState, diceValue, busted } = rollDice(state, mathRandomRng);
    const color = playerColor(newState, state.currentTurnPlayerId);
    const rollSeq = get().rollSeq + 1;

    if (busted) {
      set({
        state: newState,
        validMoves: [],
        lastRoll: diceValue,
        rollSeq,
        message: `${COLOR_LABEL[color]} rolled three 6s — turn forfeited`,
      });
      kickBots();
      scheduleHumanClock();
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
    scheduleHumanClock();
  },

  pass: () => {
    clearAutoTimer();
    const { state, validMoves } = get();
    if (!state || state.phase !== "awaiting-move" || validMoves.length > 0)
      return;
    const next = endTurn(state);
    set({
      state: next,
      validMoves: [],
      message: `${COLOR_LABEL[playerColor(next, next.currentTurnPlayerId)]} to roll`,
    });
    kickBots();
    scheduleHumanClock();
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
      clearHumanClock();
      set({
        state: next,
        validMoves: [],
        message: `${COLOR_LABEL[playerColor(next, win.winnerPlayerId)]} wins!`,
      });
      return; // game over — no bot kick
    }

    // Play-to-completion: announce a player locking in a podium place.
    const placed =
      next.finishedOrder.length > (state.finishedOrder?.length ?? 0)
        ? `${COLOR_LABEL[playerColor(next, before)]} finished ${ordinal(next.finishedOrder.length)}! `
        : "";
    const nowColor = playerColor(next, next.currentTurnPlayerId);
    set({
      state: next,
      validMoves: [],
      message:
        next.currentTurnPlayerId === before
          ? `${placed}${COLOR_LABEL[nowColor]} rolls again`
          : `${placed}${COLOR_LABEL[nowColor]} to roll`,
    });
    kickBots();
    scheduleHumanClock();
  },

  takeControl: () => {
    if (!get().autoPilot) return;
    set({ autoPilot: false });
    scheduleHumanAuto();
    scheduleHumanClock();
  },

  leaveGame: () => {
    stopBots();
    clearAutoTimer();
    clearHumanClock();
    set({
      state: null,
      validMoves: [],
      lastRoll: null,
      botIds: [],
      autoPilot: false,
      message: "",
    });
    useNav.getState().popTo("home");
  },

  currentColor: () => {
    const { state } = get();
    return state ? playerColor(state, state.currentTurnPlayerId) : null;
  },

  isMovable: (tokenId) => get().validMoves.some((m) => m.tokenId === tokenId),

  isCurrentBot: () => {
    const { state, botIds } = get();
    return (
      !!state &&
      state.status === "active" &&
      botIds.includes(state.currentTurnPlayerId)
    );
  },
}));

function playerColor(state: GameState, playerId: string): PlayerColor {
  return state.players.find((p) => p.id === playerId)!.color;
}

/** Is this seat bot-driven right now? (a bot seat, or the human's on autopilot) */
function isDriven(playerId: string): boolean {
  const s = useGameStore.getState();
  return s.botIds.includes(playerId) || s.autoPilot;
}

// --- Forced human actions ---------------------------------------------------
// After a human rolls, a turn with no legal moves auto-passes (paused so the
// dice is readable), and a turn with a single legal move auto-plays it as soon
// as the die lands. Manual actions cancel the pending timer.

let autoTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoTimer(): void {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
}

function scheduleHumanAuto(): void {
  clearAutoTimer();
  const s = useGameStore.getState();
  const state = s.state;
  if (!state || state.status !== "active" || state.phase !== "awaiting-move")
    return;
  if (isDriven(state.currentTurnPlayerId)) return; // bot-driven seats pace themselves

  if (s.validMoves.length === 0) {
    autoTimer = setTimeout(() => useGameStore.getState().pass(), AUTO_PASS_DELAY);
  } else if (s.validMoves.length === 1) {
    const only = s.validMoves[0]!.tokenId;
    autoTimer = setTimeout(
      () => useGameStore.getState().selectToken(only),
      AUTO_MOVE_DELAY,
    );
  }
}

// --- vs-AI human turn clock ---------------------------------------------------
// Every human action (or turn hand-off) restarts a 30s clock, mirroring the
// online server's per-write deadline. On expiry, the seat flips to autopilot:
// the bot policy plays it (at bot pace) until the human taps their avatar to
// take back control. Pass & play has no clock — couch games are leisurely.

let humanClock: ReturnType<typeof setTimeout> | null = null;

function clearHumanClock(): void {
  if (humanClock) clearTimeout(humanClock);
  humanClock = null;
}

function scheduleHumanClock(): void {
  clearHumanClock();
  const s = useGameStore.getState();
  const state = s.state;
  if (!state || state.status !== "active") return;
  if (s.botIds.length === 0) return; // pass & play — no clock
  if (s.autoPilot) return; // the bot loop is playing the seat — no countdown
  if (s.botIds.includes(state.currentTurnPlayerId)) return; // bots pace themselves
  useGameStore.setState({ turnSeq: s.turnSeq + 1 });
  humanClock = setTimeout(engageAutoPilot, TURN_SECONDS * 1000);
}

function engageAutoPilot(): void {
  const s = useGameStore.getState();
  const state = s.state;
  if (
    !state ||
    state.status !== "active" ||
    s.botIds.includes(state.currentTurnPlayerId)
  )
    return;
  clearAutoTimer(); // the bot loop takes over any pending forced action
  useGameStore.setState({ autoPilot: true });
  kickBots();
}

// --- Bot auto-play loop -----------------------------------------------------
// Self-perpetuating timer loop that runs only during bot-driven turns (bot
// seats, plus the human's while on autopilot). Started by kickBots() at each
// hand-off; exits as soon as a human-controlled seat is on the clock.

let botLoopActive = false;
let botTimer: ReturnType<typeof setTimeout> | null = null;

function kickBots(): void {
  const state = useGameStore.getState().state;
  if (
    botLoopActive ||
    !state ||
    state.status !== "active" ||
    !isDriven(state.currentTurnPlayerId)
  )
    return;
  botLoopActive = true;
  botTimer = setTimeout(stepBots, BOT_DELAY);
}

function stepBots(): void {
  const s = useGameStore.getState();
  const state = s.state;
  if (
    !state ||
    state.status !== "active" ||
    !isDriven(state.currentTurnPlayerId)
  ) {
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
