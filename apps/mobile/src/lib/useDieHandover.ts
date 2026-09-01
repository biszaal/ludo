/**
 * Keep the die beside the player who rolled it until their pawn has landed.
 *
 * The die is rendered beside whichever seat `currentTurnPlayerId` names, and a
 * turn-ending move arrives as ONE state: the token has moved, applyMove has
 * cleared `diceValue`, and the next player is already current. So the die left
 * the roller on the frame that state applied — mid-hop, with the number still
 * being the only explanation for why the pawn was moving. At a four-player
 * table an opponent's roll was routinely unreadable.
 *
 * This lives in the view layer on purpose. Nothing about the game changes: the
 * engine is still the source of truth and the board still animates the instant
 * the state lands. What is being delayed is one detail of the PROJECTION, which
 * is the view's own business — and putting it here means GameView gets it for
 * both the online and hot-seat stores without either of them growing a timer.
 *
 * The hold is deliberately not a freeze. The board hops, chips update, the
 * clock runs; only the die's ownership lags, and only for as long as the pawn
 * it belongs to is moving.
 */

import { useEffect, useRef, useState } from "react";
import type { GameState } from "@ludo/engine";
import { dieHoldFor, latchRoll, type RollLatch } from "./moveTiming";

/** The seat the die is still sitting at, and the number on its face. */
export interface HeldDie {
  playerId: string;
  value: number;
}

export function useDieHandover(
  state: GameState | null,
  lastRoll: number | null,
  rollSeq: number,
): HeldDie | null {
  const [held, setHeld] = useState<HeldDie | null>(null);
  const prev = useRef<GameState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The number of the roll on screen, latched rather than mirrored — the rule,
   * and why a mirror was the bug, are on `latchRoll` in lib/moveTiming.
   *
   * Folded during render, so the effect below always reads the value belonging
   * to the render that queued it.
   */
  const latch = useRef<RollLatch>({ seq: rollSeq, value: lastRoll });
  latch.current = latchRoll(latch.current, rollSeq, lastRoll);

  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (!was || !state) return;

    // Read once, then spend: this transition is the roll's resolution whether or
    // not it turns into a hold. See dieHoldFor.
    const rolledValue = latch.current.value;
    latch.current.value = null;

    const hold = dieHoldFor(was, state, rolledValue);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!hold) {
      // An immediate hand-off cancels any hold still running: this is a newer
      // truth than the one being held, and a stale die outliving it would sit
      // at a corner whose turn is long gone.
      setHeld(null);
      return;
    }

    setHeld({ playerId: hold.playerId, value: hold.value });
    timer.current = setTimeout(() => {
      timer.current = null;
      setHeld(null);
    }, hold.ms);
  }, [state]);

  // Leaving the table mid-hold must not leave a timer pointing at a screen that
  // is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return held;
}
