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
import { dieHandoverMs } from "./moveTiming";

/** The seat the die is still sitting at, and the number on its face. */
export interface HeldDie {
  playerId: string;
  value: number;
}

export function useDieHandover(state: GameState | null, lastRoll: number | null): HeldDie | null {
  const [held, setHeld] = useState<HeldDie | null>(null);
  const prev = useRef<GameState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read in the effect below, which must not re-run when only the roll changes:
  // lastRoll is a fallback for the number, never a reason to start a hold.
  const latestRoll = useRef(lastRoll);
  latestRoll.current = lastRoll;

  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (!was || !state) return;

    const ms = dieHandoverMs(was, state, latestRoll.current);
    if (ms <= 0) {
      // An immediate hand-off cancels any hold still running: this is a newer
      // truth than the one being held, and a stale die outliving it would sit
      // at a corner whose turn is long gone.
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setHeld(null);
      return;
    }

    // On a folding table the number is only ever in lastRoll — `was.diceValue`
    // is null there — so the fallback is the NORMAL path for an opponent's
    // roll, not a safety net.
    const value = was.diceValue ?? latestRoll.current;
    if (value == null) return;

    if (timer.current) clearTimeout(timer.current);
    setHeld({ playerId: was.currentTurnPlayerId, value });
    timer.current = setTimeout(() => {
      timer.current = null;
      setHeld(null);
    }, ms);
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
