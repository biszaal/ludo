/**
 * Local game screen — wires the shared GameView to the local hot-seat store.
 * Input is disabled during a bot's turn (the bot plays on its own timer).
 * In vs-AI games the human seat carries the device profile; bot seats are
 * labeled by color. Rematch restarts with the same setup.
 */

import { GameView } from "../components/GameView";
import { TURN_SECONDS, useGameStore } from "../store/gameStore";
import { useProfile } from "../store/profileStore";

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

export function GameScreen() {
  const state = useGameStore((s) => s.state);
  const validMoves = useGameStore((s) => s.validMoves);
  const lastRoll = useGameStore((s) => s.lastRoll);
  const rollSeq = useGameStore((s) => s.rollSeq);
  const message = useGameStore((s) => s.message);
  const botIds = useGameStore((s) => s.botIds);
  const lastConfig = useGameStore((s) => s.lastConfig);
  const roll = useGameStore((s) => s.roll);
  const selectToken = useGameStore((s) => s.selectToken);
  const leaveGame = useGameStore((s) => s.leaveGame);
  const newLocalGame = useGameStore((s) => s.newLocalGame);
  const isCurrentBot = useGameStore((s) => s.isCurrentBot);
  const turnSeq = useGameStore((s) => s.turnSeq);
  const autoPilot = useGameStore((s) => s.autoPilot);
  const takeControl = useGameStore((s) => s.takeControl);
  const displayName = useProfile((s) => s.displayName);
  const avatarId = useProfile((s) => s.avatarId);

  if (!state) return null;

  const botTurn = isCurrentBot();
  const vsAI = botIds.length > 0;
  const active = state.players.find((p) => p.id === state.currentTurnPlayerId)!;
  const botLabel = `${COLOR_LABEL[active.color]} is thinking…`;

  // vs AI: rotate the board so the human's seat is bottom-left. Pass & play keeps
  // the fixed orientation (the device is shared, so there's no single "you").
  const human = vsAI ? state.players.find((p) => !botIds.includes(p.id)) : undefined;
  const humanColor = human?.color;

  // vs AI: the human seat is "you"; pass & play seats stay color-named.
  const nameFor = (playerId: string): string | null => {
    if (!vsAI) return null;
    if (botIds.includes(playerId)) {
      const bot = state.players.find((p) => p.id === playerId)!;
      return `${COLOR_LABEL[bot.color]} · AI`;
    }
    return displayName;
  };

  return (
    <GameView
      state={state}
      validMoves={validMoves}
      lastRoll={lastRoll}
      rollSeq={rollSeq}
      message={message}
      canAct={!botTurn && !autoPilot && state.status === "active"}
      waitingLabel={botTurn ? botLabel : autoPilot ? "Bot is playing for you — tap your avatar to take control" : null}
      onRoll={roll}
      onSelectToken={selectToken}
      onLeave={leaveGame}
      onRematch={lastConfig ? () => newLocalGame(lastConfig) : undefined}
      nameFor={nameFor}
      avatarFor={(playerId) => (vsAI && !botIds.includes(playerId) ? avatarId : null)}
      viewColor={humanColor}
      turnTimer={vsAI && !botTurn && !autoPilot && state.status === "active" ? { seq: turnSeq, seconds: TURN_SECONDS } : null}
      autoPilot={autoPilot && human ? { playerId: human.id, onTakeControl: takeControl } : null}
    />
  );
}
