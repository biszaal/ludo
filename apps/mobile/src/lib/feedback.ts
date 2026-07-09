/**
 * Game-event feedback: one observer that diffs consecutive GameStates from both
 * stores and fires sounds/haptics (and, later, stats recording). Living here —
 * not in the stores — keeps gameStore/onlineStore free of native imports so the
 * Node test suite stays runnable. Import this ONLY from App.tsx.
 *
 * Animation-synced sounds (dice rattle, per-cell hops) stay with their
 * animations in Dice.tsx/Board.tsx; this module handles event sounds.
 */

import { SAFE_SQUARES, type Color, type GameState } from "@ludo/engine";
import { START_CELL_INDEX } from "../render/boardLayout";
import { useGameStore } from "../store/gameStore";
import { useOnlineStore } from "../store/onlineStore";
import { useProfile } from "../store/profileStore";
import { useStats } from "../store/statsStore";
import { computeStandings } from "./standings";
import { playSound } from "./sound";
import * as haptics from "./haptics";

const COLOR_LABEL: Record<Color, string> = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" };

// Only the four STARRED cells chime. The four start cells are also in the
// engine's SAFE_SQUARES (capture-proof), but the board draws no star there and
// chiming every yard-exit landing read as "sound while passing".
const STAR_CELLS = new Set([...SAFE_SQUARES].filter((i) => !Object.values(START_CELL_INDEX).includes(i)));

function diffAndFire(prev: GameState | null, next: GameState | null, myPlayerId: string | null): void {
  if (!prev || !next || prev === next) return;
  if (prev.gameId !== next.gameId) return; // fresh game — no transition to sound
  if (prev.status !== "active") return; // finished→active is a rematch reset, not captures

  let captured = false;
  let finished = false;
  let reachedSafety = false;
  const prevPos = new Map(prev.tokens.map((t) => [t.id, t.position]));
  for (const t of next.tokens) {
    const was = prevPos.get(t.id);
    if (was === undefined) continue;
    const moved = JSON.stringify(was) !== JSON.stringify(t.position);
    if (!moved) continue;
    if (t.position === "home" && was !== "home") captured = true;
    if (t.position === "finished" && was !== "finished") finished = true;
    // Sanctuary: LANDING on a starred cell, or entering the home column.
    if (typeof t.position === "object") {
      if (t.position.type === "track" && STAR_CELLS.has(t.position.index)) reachedSafety = true;
      if (t.position.type === "homePath" && typeof was === "object" && was.type === "track") reachedSafety = true;
    }
  }

  // Win outranks everything (a finishing move also set `finished`).
  if (next.status === "finished" && prev.status === "active") {
    playSound("win");
    haptics.win();
    return;
  }

  if (captured) {
    playSound("capture");
    haptics.capture();
  } else if (finished) {
    playSound("finish");
  } else if (reachedSafety) {
    playSound("safe");
    haptics.tapLight();
  }

  if (next.currentTurnPlayerId !== prev.currentTurnPlayerId && next.status === "active") {
    if (myPlayerId !== null && next.currentTurnPlayerId === myPlayerId) {
      playSound("ding"); // online: it just became my turn
      haptics.tapLight();
    } else {
      playSound("turn");
    }
  }
}

// A match records exactly once, on the active→finished edge (resyncs of an
// already-finished game never cross that edge again).
function justFinished(prev: GameState | null, next: GameState | null): next is GameState {
  return !!prev && !!next && prev.gameId === next.gameId && prev.status === "active" && next.status === "finished";
}

function recordLocal(state: GameState, botIds: string[]): void {
  const winner = computeStandings(state)[0]!;
  const vsAI = botIds.length > 0;
  const humanWon = vsAI && !botIds.includes(winner.playerId);
  useStats.getState().record({
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: vsAI ? "ai" : "pass",
    finishedAt: Date.now(),
    players: state.players.length,
    winnerLabel: humanWon ? useProfile.getState().displayName : COLOR_LABEL[winner.color],
    winnerColor: winner.color,
    didWin: vsAI ? humanWon : null,
  });
}

function recordOnline(state: GameState, myPlayerId: string | null): void {
  const winner = computeStandings(state)[0]!;
  const didWin = winner.playerId === myPlayerId;
  useStats.getState().record({
    id: `online-${state.gameId}-${Date.now()}`,
    mode: "online",
    finishedAt: Date.now(),
    players: state.players.length,
    winnerLabel: didWin ? useProfile.getState().displayName : COLOR_LABEL[winner.color],
    winnerColor: winner.color,
    didWin,
  });
}

/** Subscribe to both stores. Call once from App.tsx; returns an unsubscribe. */
export function initFeedback(): () => void {
  const unLocal = useGameStore.subscribe((s, prevS) => {
    diffAndFire(prevS.state, s.state, null);
    if (justFinished(prevS.state, s.state)) recordLocal(s.state, s.botIds);
  });
  const unOnline = useOnlineStore.subscribe((s, prevS) => {
    diffAndFire(prevS.state, s.state, s.myPlayerId);
    if (justFinished(prevS.state, s.state)) recordOnline(s.state, s.myPlayerId);
    // Incoming chatter: a soft cue per received event (own sends stay silent).
    if (s.chatSeq !== prevS.chatSeq) {
      const ev = s.chat[s.chat.length - 1];
      if (ev && ev.fromUserId !== s.userId) {
        playSound(ev.kind === "reaction" ? "pop" : "msg");
        haptics.tapLight();
      }
    }
  });
  return () => {
    unLocal();
    unOnline();
  };
}
