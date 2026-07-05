/**
 * Local game screen — wires the shared GameView to the local hot-seat store.
 * Input is disabled during a bot's turn (the bot plays on its own timer).
 */

import { useEffect } from "react";
import { GameView } from "../components/GameView";
import { useGameStore } from "../store/gameStore";
import { setBackInterceptor } from "../store/navStore";

export function GameScreen() {
  // Android back = leave the game (with bot/timer cleanup), not a bare pop.
  useEffect(() => {
    setBackInterceptor(() => {
      useGameStore.getState().leaveGame();
      return true;
    });
    return () => setBackInterceptor(null);
  }, []);

  const state = useGameStore((s) => s.state);
  const validMoves = useGameStore((s) => s.validMoves);
  const lastRoll = useGameStore((s) => s.lastRoll);
  const rollSeq = useGameStore((s) => s.rollSeq);
  const message = useGameStore((s) => s.message);
  const roll = useGameStore((s) => s.roll);
  const selectToken = useGameStore((s) => s.selectToken);
  const leaveGame = useGameStore((s) => s.leaveGame);
  const isCurrentBot = useGameStore((s) => s.isCurrentBot);

  if (!state) return null;

  const botTurn = isCurrentBot();
  const active = state.players.find((p) => p.id === state.currentTurnPlayerId)!;
  const botLabel = `${active.color[0]!.toUpperCase() + active.color.slice(1)} is thinking…`;

  return (
    <GameView
      state={state}
      validMoves={validMoves}
      lastRoll={lastRoll}
      rollSeq={rollSeq}
      message={message}
      canAct={!botTurn && state.status === "active"}
      waitingLabel={botTurn ? botLabel : null}
      onRoll={roll}
      onSelectToken={selectToken}
      onLeave={leaveGame}
    />
  );
}
