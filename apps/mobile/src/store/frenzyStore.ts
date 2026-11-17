/**
 * Frenzy vs AI — the local store for the no-turns mode.
 *
 * Every seat owns a die (`state.frenzy.dice`): it rolls whenever that die is
 * empty and recharged, and moves on it. Nobody waits for anybody. The engine
 * keeps the rules; this store keeps the clocks:
 *
 * - the recharge: once a move lands, a seat waits FRENZY_RECHARGE_MS before it
 *   may roll again — unless the move earned what a turn-based game calls a
 *   bonus roll (a six, a capture, a finish), which skips the wait;
 * - each bot's pace: a human-like reaction before it rolls and a think before
 *   it moves. In a race the reaction time IS the difficulty, so these are the
 *   dial to turn, not the policy;
 * - the human's conveniences, as in turn-based play: a lone legal move plays
 *   itself, and a roll with none clears after a beat (there is no Pass).
 *
 * Moves go through a frame queue so each reaches the board as its own render.
 * Pausing freezes every clock; resuming pushes pending recharges back by the
 * time spent paused.
 */

import { create } from "zustand";
import {
  applyMove,
  createGame,
  frenzyPass,
  frenzyRoll,
  getValidMoves,
  inPlayPlayers,
  mathRandomRng,
  seatColors,
  type GameState,
} from "@ludo/engine";
import { chooseMove } from "@ludo/bot";
import { DICE_ROLL_MS, moveDurationMs } from "../lib/moveTiming";
import { createFrameQueue } from "../lib/frameQueue";
import { resetGameClock } from "../lib/gameClock";
import { useNav } from "./navStore";

/** Wait between a move landing (or a dead roll clearing) and the next roll. */
export const FRENZY_RECHARGE_MS = 1000;
/** How long a roll with no legal move stays readable after the tumble. */
export const FRENZY_NO_MOVE_HOLD_MS = 600;
/** From the human's roll to their lone legal move playing itself. */
export const FRENZY_AUTO_MOVE_MS = 900;
/** A bot's reaction once its die is ready, before it rolls. */
const BOT_REACT_MS: readonly [number, number] = [250, 700];
/** A bot's think after its die lands, before it moves. */
const BOT_THINK_MS: readonly [number, number] = [250, 600];

export interface FrenzyConfig {
  /** Seats at the table, 2–4. The human sits first. */
  players: number;
  /** Bot-driven trailing seats; defaults to every seat but the human's. */
  bots?: number;
}

/** One seat's die, as the table shows it. */
export interface SeatDie {
  /** The roll waiting to be moved; null when the die is spent. */
  held: number | null;
  /** The last face rolled, left showing after the move. Null before any roll. */
  face: number | null;
  /** Bumps on every roll — drives this seat's tumble. */
  rollSeq: number;
  /** May roll right now: the die is empty and recharged. */
  ready: boolean;
  /** The recharge window (epoch ms): it fills from `rechargeFrom` to `readyAt`. */
  rechargeFrom: number;
  readyAt: number;
}

interface FrenzyStore {
  state: GameState | null;
  seats: Record<string, SeatDie>;
  /** The human's seat. */
  me: string | null;
  botIds: string[];
  /** The last game's setup, so Results can offer an instant rematch. */
  lastConfig: FrenzyConfig | null;
  paused: boolean;

  newFrenzyGame: (config: FrenzyConfig) => void;
  roll: () => void;
  selectToken: (tokenId: string) => void;
  setPaused: (paused: boolean) => void;
  leaveGame: () => void;
}

export const useFrenzyStore = create<FrenzyStore>((set, get) => ({
  state: null,
  seats: {},
  me: null,
  botIds: [],
  lastConfig: null,
  paused: false,

  newFrenzyGame: (config) => {
    stopClocks();
    rolledAt.clear();
    // A local game's id is derived from its seats, so a rematch hands back
    // the same id: tell the elapsed clock this is a fresh deal.
    resetGameClock();
    const { players: count, bots = count - 1 } = config;
    const colors = seatColors(count);
    const players = Array.from({ length: count }, (_unused, i) => ({
      id: `p${i + 1}`,
      userId: `local-${i + 1}`,
      color: colors[i]!,
    }));
    const now = Date.now();
    set({
      state: createGame(players, { frenzy: true }),
      seats: Object.fromEntries(
        players.map((p) => [p.id, { held: null, face: null, rollSeq: 0, ready: true, rechargeFrom: now, readyAt: now }]),
      ),
      me: bots < count ? players[0]!.id : null,
      botIds: players.slice(count - bots).map((p) => p.id),
      lastConfig: config,
      paused: false,
    });
    useNav.getState().push("frenzyGame");
    for (const id of get().botIds) drive(id);
  },

  roll: () => {
    const { me } = get();
    if (me) rollSeat(me);
  },

  selectToken: (tokenId) => {
    const { me, seats } = get();
    if (!me || seats[me]?.held == null || !live()) return;
    clearSeat(me); // a lone move's auto-play is moot once the human picks
    queue.push(() => moveSeat(me, tokenId));
  },

  setPaused: (paused) => {
    const { state, seats } = get();
    if (!state || paused === get().paused) return;
    if (paused) {
      stopClocks();
      pausedAt = Date.now();
      set({ paused: true });
      return;
    }
    const shift = Date.now() - pausedAt;
    for (const [id, at] of rolledAt) rolledAt.set(id, at + shift);
    set({
      paused: false,
      seats: Object.fromEntries(
        Object.entries(seats).map(([id, d]) => [
          id,
          d.ready ? d : { ...d, rechargeFrom: d.rechargeFrom + shift, readyAt: d.readyAt + shift },
        ]),
      ),
    });
    for (const p of state.players) drive(p.id);
  },

  leaveGame: () => {
    stopClocks();
    rolledAt.clear();
    set({ state: null, seats: {}, me: null, botIds: [], paused: false });
    useNav.getState().popTo("home");
  },
}));

// --- Clocks -----------------------------------------------------------------

/** One pending step per seat: its next roll, move, pass or recharge. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** When each seat's held die was rolled, to time what follows the tumble. */
const rolledAt = new Map<string, number>();
const queue = createFrameQueue();
let pausedAt = 0;

function later(id: string, ms: number, step: () => void): void {
  clearSeat(id);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      step();
    }, Math.max(0, ms)),
  );
}

function clearSeat(id: string): void {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

function stopClocks(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  queue.clear();
}

const jitter = ([lo, hi]: readonly [number, number]) => lo + Math.random() * (hi - lo);

/** The state, if the game is running and not paused — otherwise nothing may happen. */
function live(): GameState | null {
  const { state, paused } = useFrenzyStore.getState();
  return state && state.status === "active" && !paused ? state : null;
}

function inPlay(state: GameState, id: string): boolean {
  return inPlayPlayers(state).some((p) => p.id === id);
}

function patchSeat(id: string, patch: Partial<SeatDie>, state?: GameState): void {
  const { seats } = useFrenzyStore.getState();
  useFrenzyStore.setState({ ...(state ? { state } : {}), seats: { ...seats, [id]: { ...seats[id]!, ...patch } } });
}

/** Schedule a seat's next step from where it stands now. */
function drive(id: string): void {
  const state = live();
  if (!state) return;
  if (!inPlay(state, id)) {
    clearSeat(id);
    return;
  }
  const { seats, botIds } = useFrenzyStore.getState();
  const seat = seats[id]!;
  const bot = botIds.includes(id);

  if (seat.held !== null) {
    const elapsed = Date.now() - (rolledAt.get(id) ?? Date.now());
    const moves = getValidMoves(state, id);
    if (moves.length === 0) {
      later(id, DICE_ROLL_MS + FRENZY_NO_MOVE_HOLD_MS - elapsed, () => queue.push(() => passSeat(id)));
    } else if (bot) {
      later(id, DICE_ROLL_MS + jitter(BOT_THINK_MS) - elapsed, () => queue.push(() => botMove(id)));
    } else if (moves.length === 1) {
      later(id, FRENZY_AUTO_MOVE_MS - elapsed, () => queue.push(() => moveSeat(id, moves[0]!.tokenId)));
    } else {
      clearSeat(id); // the human picks
    }
    return;
  }

  if (!seat.ready) {
    later(id, seat.readyAt - Date.now(), () => {
      patchSeat(id, { ready: true });
      drive(id);
    });
    return;
  }

  if (bot) later(id, jitter(BOT_REACT_MS), () => rollSeat(id));
}

function rollSeat(id: string): void {
  const state = live();
  const seat = useFrenzyStore.getState().seats[id];
  if (!state || !seat?.ready || seat.held !== null || !inPlay(state, id)) return;
  const { newState, diceValue } = frenzyRoll(state, id, mathRandomRng);
  rolledAt.set(id, Date.now());
  patchSeat(id, { held: diceValue, face: diceValue, rollSeq: seat.rollSeq + 1, ready: false }, newState);
  drive(id);
}

function botMove(id: string): void {
  const state = live();
  if (!state) return;
  const moves = getValidMoves(state, id);
  if (moves.length === 0) return passSeat(id);
  moveSeat(id, chooseMove(state, id, moves, { difficulty: "normal" }).tokenId);
}

function moveSeat(id: string, tokenId: string): void {
  const state = live();
  if (!state) return;
  if (!getValidMoves(state, id).some((m) => m.tokenId === tokenId)) return drive(id);
  const was = state.tokens.find((t) => t.id === tokenId)!;
  const next = applyMove(state, { tokenId });
  const now = next.tokens.find((t) => t.id === tokenId);
  const walkMs = now ? moveDurationMs(was.color, was.position, now.position) : 0;
  const bonus = (next.lastAction?.payload as { bonus?: boolean } | null)?.bonus === true;
  settle(next, id, walkMs, bonus);
}

function passSeat(id: string): void {
  const state = live();
  if (!state || useFrenzyStore.getState().seats[id]?.held == null) return;
  if (getValidMoves(state, id).length > 0) return drive(id);
  settle(frenzyPass(state, id), id, 0, false);
}

/** Commit a spent die: start its recharge, and re-drive whoever it affects. */
function settle(next: GameState, id: string, walkMs: number, bonus: boolean): void {
  rolledAt.delete(id);
  const landed = Date.now() + walkMs;
  patchSeat(
    id,
    { held: null, ready: false, rechargeFrom: landed, readyAt: landed + (bonus ? 0 : FRENZY_RECHARGE_MS) },
    next,
  );
  if (next.status !== "active") return stopClocks();
  drive(id);
  // The human's held roll may have lost (or kept only one of) its moves.
  const { me, seats } = useFrenzyStore.getState();
  if (me && me !== id && seats[me]?.held != null) drive(me);
}
