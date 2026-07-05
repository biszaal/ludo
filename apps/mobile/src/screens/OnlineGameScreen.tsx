/**
 * Online game screen — wires the shared GameView to the online store. Input is
 * enabled only on the local player's turn; otherwise it shows whose turn it is.
 * Leaving asks for confirmation (the match continues without you). Online
 * rematch arrives with the M7 backend op.
 */

import { GameView } from "../components/GameView";
import { useOnlineStore } from "../store/onlineStore";

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

export function OnlineGameScreen() {
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
      confirmLeave
      nameFor={(playerId) => (playerId === myPlayerId ? "You" : null)}
      roomCode={roomCode}
    />
  );
}
