/**
 * Local game screen — wires the shared GameView to the local hot-seat store.
 * Input is disabled during a bot's turn (the bot plays on its own timer).
 * In vs-AI games the human seat carries the device profile; bot seats are
 * labeled by color. Rematch restarts with the same setup.
 *
 * Reactions work locally too (reactions-only — there is nobody to text): the
 * emoji pops as a bubble on the human's chip with its sound, purely on-device.
 */

import { useState } from "react";
import { GameView, type GameChat } from "../components/GameView";
import { resolveEmoji } from "../lib/emoji";
import { playSound } from "../lib/sound";
import { useGameStore } from "../store/gameStore";
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
  const displayName = useProfile((s) => s.displayName);
  const avatarId = useProfile((s) => s.avatarId);
  const diceSkinId = useProfile((s) => s.diceSkinId);

  // Local reactions-only chat: my emoji bubbles on my chip, with its voice.
  const [myBubble, setMyBubble] = useState<{ value: string; kind: "reaction"; seq: number } | null>(null);

  if (!state) return null;

  const botTurn = isCurrentBot();
  const vsAI = botIds.length > 0;
  const active = state.players.find((p) => p.id === state.currentTurnPlayerId)!;
  const botLabel = `${COLOR_LABEL[active.color]} is thinking…`;

  // vs AI: rotate the board so the human's seat is bottom-left. Pass & play keeps
  // the fixed orientation (the device is shared, so there's no single "you").
  const human = vsAI ? state.players.find((p) => !botIds.includes(p.id)) : undefined;
  const humanColor = human?.color;

  // Reactions in local play (vs AI only — pass & play has no single "you"):
  // one-way, on-device bubbles; the chat sheet stays hidden (reactionsOnly).
  const chat: GameChat | undefined =
    vsAI && human
      ? {
          events: [],
          unread: 0,
          latestBubbles: myBubble ? { [human.userId]: myBubble } : {},
          myUserId: human.userId,
          onSendReaction: (value) => {
            const spec = resolveEmoji(value);
            if (spec) playSound(spec.sound);
            setMyBubble({ value, kind: "reaction", seq: (myBubble?.seq ?? 0) + 1 });
          },
          onSendMessage: () => {},
          onOpened: () => {},
          reactionsOnly: true,
        }
      : undefined;

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
      canAct={!botTurn && state.status === "active"}
      waitingLabel={botTurn ? botLabel : null}
      onRoll={roll}
      onSelectToken={selectToken}
      onLeave={leaveGame}
      onRematch={lastConfig ? () => newLocalGame(lastConfig) : undefined}
      nameFor={nameFor}
      avatarFor={(playerId) => (vsAI && !botIds.includes(playerId) ? avatarId : null)}
      diceSkinFor={(playerId) => (vsAI && !botIds.includes(playerId) ? diceSkinId : null)}
      viewColor={humanColor}
      chat={chat}
    />
  );
}
