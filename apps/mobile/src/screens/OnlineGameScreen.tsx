/**
 * Online game screen — wires the shared GameView to the online store. Input is
 * enabled only on the local player's turn; otherwise it shows whose turn it is.
 */

import { useEffect } from "react";
import { GameView } from "../components/GameView";
import { useOnlineStore } from "../store/onlineStore";
import { setBackInterceptor } from "../store/navStore";

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

export function OnlineGameScreen() {
  // Android back = leave the match (same as the Leave button), not a bare pop.
  useEffect(() => {
    setBackInterceptor(() => {
      useOnlineStore.getState().leave();
      return true;
    });
    return () => setBackInterceptor(null);
  }, []);

  const state = useOnlineStore((s) => s.state);
  const validMoves = useOnlineStore((s) => s.validMoves);
  const lastRoll = useOnlineStore((s) => s.lastRoll);
  const rollSeq = useOnlineStore((s) => s.rollSeq);
  const message = useOnlineStore((s) => s.message);
  const roomCode = useOnlineStore((s) => s.roomCode);
  const myPlayerId = useOnlineStore((s) => s.myPlayerId);
  const roll = useOnlineStore((s) => s.roll);
  const selectToken = useOnlineStore((s) => s.selectToken);
  const leave = useOnlineStore((s) => s.leave);

  if (!state) return null;

  const myTurn = state.status === "active" && state.currentTurnPlayerId === myPlayerId;
  const active = state.players.find((p) => p.id === state.currentTurnPlayerId)!;

  return (
    <GameView
      state={state}
      validMoves={validMoves}
      lastRoll={lastRoll}
      rollSeq={rollSeq}
      message={message}
      canAct={myTurn}
      waitingLabel={`Waiting for ${COLOR_LABEL[active.color]}…`}
      onRoll={() => void roll()}
      onSelectToken={(id) => void selectToken(id)}
      onLeave={leave}
      finishedLabel="Leave"
      roomCode={roomCode}
    />
  );
}
