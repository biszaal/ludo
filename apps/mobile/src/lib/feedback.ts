/**
 * Game-event feedback: one observer that diffs consecutive GameStates from both
 * stores and fires sounds/haptics (and, later, stats recording). Living here —
 * not in the stores — keeps gameStore/onlineStore free of native imports so the
 * Node test suite stays runnable. Import this ONLY from App.tsx.
 *
 * Animation-synced sounds (dice rattle, per-cell hops) stay with their
 * animations in Dice.tsx/Board.tsx; this module handles event sounds.
 */

import type { GameState } from "@ludo/engine";
import { useGameStore } from "../store/gameStore";
import { useOnlineStore } from "../store/onlineStore";
import { playSound } from "./sound";
import * as haptics from "./haptics";

function diffAndFire(prev: GameState | null, next: GameState | null, myPlayerId: string | null): void {
  if (!prev || !next || prev === next) return;
  if (prev.gameId !== next.gameId) return; // fresh game — no transition to sound

  let captured = false;
  let finished = false;
  const prevPos = new Map(prev.tokens.map((t) => [t.id, t.position]));
  for (const t of next.tokens) {
    const was = prevPos.get(t.id);
    if (was === undefined) continue;
    if (t.position === "home" && was !== "home") captured = true;
    if (t.position === "finished" && was !== "finished") finished = true;
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

/** Subscribe to both stores. Call once from App.tsx; returns an unsubscribe. */
export function initFeedback(): () => void {
  const unLocal = useGameStore.subscribe((s, prevS) => diffAndFire(prevS.state, s.state, null));
  const unOnline = useOnlineStore.subscribe((s, prevS) => diffAndFire(prevS.state, s.state, s.myPlayerId));
  return () => {
    unLocal();
    unOnline();
  };
}
