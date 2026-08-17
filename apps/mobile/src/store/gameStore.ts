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
import { BUST_HOLD_MS } from "../lib/projection";
import { DICE_ROLL_MS } from "../lib/moveTiming";
import { ordinal } from "../lib/standings";
import { useNav } from "./navStore";

const COLOR_LABEL: Record<PlayerColor, string> = {
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
};

/**
 * Delay between a bot's actions, so a human can follow what it's doing.
 *
 * Must outlast the die tumble (DICE_ROLL_MS): at 450 the bot's pawn started
 * hopping while its own die was still in the air, so nobody watching could see
 * what it had rolled.
 */
const BOT_DELAY = DICE_ROLL_MS + 200;
/** Pause before auto-passing a no-move roll: the tumble runs, then the number
 *  needs a beat to be read. */
const AUTO_PASS_DELAY = DICE_ROLL_MS + 300;
/** A lone legal move plays once the tumble settles — no choice to make, but the
 *  number still has to land before the pawn leaves. */
const AUTO_MOVE_DELAY = DICE_ROLL_MS + 200;

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
  /** A busted third six is being shown on the roller's own die; the seat has
   *  not changed hands yet and no input should be accepted. */
  bustHold: boolean;
  message: string;
  /** Player ids controlled by the bot (the trailing seats in "vs AI" mode). */
  botIds: string[];
  /** The last game's setup, so Results can offer an instant rematch. */
  lastConfig: LocalGameConfig | null;

  newLocalGame: (config: LocalGameConfig) => void;
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
  bustHold: false,
  message: "",
  botIds: [],
  lastConfig: null,

  newLocalGame: (config) => {
    // Re-dealing abandons any hold left over from the previous game.
    clearAutoTimer();
    clearBustTimer();
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
      bustHold: false,
      botIds,
      lastConfig: config,
      message: `${COLOR_LABEL[colors[0]!]} to roll`,
    });
    useNav.getState().push("localGame");
    kickBots();
  },

  roll: () => {
    clearAutoTimer();
    const { state, bustHold } = get();
    // A forfeit is mid-hand-off. `state` is still the pre-roll state, so every
    // phase check below would wave a second roll through on the very turn the
    // rule just ended. Nothing acts until the hold applies its state.
    if (bustHold) return;
    if (!state || state.phase !== "awaiting-roll") return;

    const { newState, diceValue, busted } = rollDice(state, mathRandomRng);
    const color = playerColor(newState, state.currentTurnPlayerId);
    const rollSeq = get().rollSeq + 1;

    if (busted) {
      // Show the six landing on the roller's own die BEFORE the seat changes.
      // rollDice advances the turn in the same transition, so applying newState
      // straight away moved the die to the next player's corner mid-tumble —
      // the forfeit read as "my turn vanished", not "I rolled a third six".
      // `state` is deliberately left untouched (still the pre-roll state, still
      // the roller's turn); only the display carries the six.
      set({
        validMoves: [],
        lastRoll: diceValue,
        rollSeq,
        bustHold: true,
        message: `${COLOR_LABEL[color]} rolled three 6s — turn forfeited`,
      });
      clearBustTimer();
      bustTimer = setTimeout(() => {
        bustTimer = null;
        // Re-check: the player may have left or restarted during the hold.
        if (get().state?.gameId !== newState.gameId) return;
        set({
          state: newState,
          validMoves: [],
          bustHold: false,
          message: `${COLOR_LABEL[playerColor(newState, newState.currentTurnPlayerId)]} to roll`,
        });
        kickBots();
      }, BUST_HOLD_MS);
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
    const { state, validMoves, bustHold } = get();
    if (bustHold) return; // a forfeit is mid-hand-off — see roll()
    if (!state || state.phase !== "awaiting-move" || validMoves.length > 0)
      return;
    const next = endTurn(state);
    set({
      state: next,
      validMoves: [],
      message: `${COLOR_LABEL[playerColor(next, next.currentTurnPlayerId)]} to roll`,
    });
    kickBots();
  },

  selectToken: (tokenId) => {
    clearAutoTimer();
    const { state, validMoves, bustHold } = get();
    if (bustHold) return; // a forfeit is mid-hand-off — see roll()
    if (!state || state.phase !== "awaiting-move") return;
    if (!validMoves.some((m) => m.tokenId === tokenId)) return;

    const before = state.currentTurnPlayerId;
    const next = applyMove(state, { tokenId });

    const win = checkWin(next);
    if (win.finished && win.winnerPlayerId) {
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
  },

  leaveGame: () => {
    stopBots();
    clearAutoTimer();
    clearBustTimer();
    set({
      state: null,
      validMoves: [],
      lastRoll: null,
      bustHold: false,
      botIds: [],
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

/** Is this seat bot-driven right now? (i.e. one of the vs-AI opponent seats) */
function isDriven(playerId: string): boolean {
  return useGameStore.getState().botIds.includes(playerId);
}

// --- Forced human actions ---------------------------------------------------
// After a human rolls, a turn with no legal moves auto-passes (paused so the
// dice is readable), and a turn with a single legal move auto-plays it as soon
// as the die lands. Manual actions cancel the pending timer.

let autoTimer: ReturnType<typeof setTimeout> | null = null;
/** Runs while a busted third six is held on screen (see BUST_HOLD_MS). */
let bustTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoTimer(): void {
  if (autoTimer) clearTimeout(autoTimer);
  autoTimer = null;
}

/**
 * Abandon a pending forfeit hand-off. Only for leaving or re-dealing — the
 * hold IS the forfeit, so cancelling it anywhere else silently gives the
 * roller back the turn the three-sixes rule just took. It used to live inside
 * clearAutoTimer, which every action calls on entry; a bot stepping mid-hold
 * therefore wiped the forfeit and rolled again.
 */
function clearBustTimer(): void {
  if (bustTimer) clearTimeout(bustTimer);
  bustTimer = null;
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

// Note: local games never hand a human's seat to the bot on idle. The human
// takes as long as they like; only the vs-AI OPPONENT seats auto-play (below).
// Idle-out-to-bot exists solely online, where a stalled seat blocks real
// opponents — see onlineStore.

// --- Bot auto-play loop -----------------------------------------------------
// Self-perpetuating timer loop that runs only during bot-driven (vs-AI
// opponent) turns. Started by kickBots() at each hand-off; exits as soon as a
// human-controlled seat is on the clock.

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

  // BOT_DELAY (450ms) is shorter than BUST_HOLD_MS (1400ms), so without this
  // the loop stepped straight into a forfeit it had just triggered — and the
  // held state still reads as this bot's turn awaiting a roll, so it rolled
  // again and the three-sixes rule quietly did nothing. Stand down and let the
  // hold's own timer restart the loop once the seat has actually changed.
  if (s.bustHold) {
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
