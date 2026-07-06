/**
 * Online game screen — wires the shared GameView to the online store. Input is
 * enabled only on the local player's turn. Seats show profile names/avatars
 * when a profile row exists (color labels otherwise). The host can trigger a
 * rematch from the results overlay; guests follow via the realtime update.
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
  const isHost = useOnlineStore((s) => s.isHost);
  const profiles = useOnlineStore((s) => s.profiles);
  const roll = useOnlineStore((s) => s.roll);
  const selectToken = useOnlineStore((s) => s.selectToken);
  const rematch = useOnlineStore((s) => s.rematch);
  const leave = useOnlineStore((s) => s.leave);
  const userId = useOnlineStore((s) => s.userId);
  const chat = useOnlineStore((s) => s.chat);
  const chatUnread = useOnlineStore((s) => s.chatUnread);
  const latestReactions = useOnlineStore((s) => s.latestReactions);
  const sendReaction = useOnlineStore((s) => s.sendReaction);
  const sendMessage = useOnlineStore((s) => s.sendMessage);
  const markChatRead = useOnlineStore((s) => s.markChatRead);

  if (!state) return null;

  const myTurn = state.status === "active" && state.currentTurnPlayerId === myPlayerId;
  const active = state.players.find((p) => p.id === state.currentTurnPlayerId)!;

  const profileOf = (playerId: string) => {
    const player = state.players.find((p) => p.id === playerId);
    return player ? profiles[player.userId] : undefined;
  };

  return (
    <GameView
      state={state}
      validMoves={validMoves}
      lastRoll={lastRoll}
      rollSeq={rollSeq}
      message={message}
      canAct={myTurn}
      waitingLabel={`Waiting for ${profileOf(active.id)?.display_name ?? COLOR_LABEL[active.color]}…`}
      onRoll={() => void roll()}
      onSelectToken={(id) => void selectToken(id)}
      onLeave={leave}
      confirmLeave
      onRematch={isHost ? () => void rematch() : undefined}
      resultsFootnote={isHost ? null : "Waiting for the host to start a rematch…"}
      nameFor={(playerId) => profileOf(playerId)?.display_name ?? (playerId === myPlayerId ? "You" : null)}
      avatarFor={(playerId) => profileOf(playerId)?.avatar_id ?? null}
      roomCode={roomCode}
      chat={{
        events: chat,
        unread: chatUnread,
        latestReactions,
        myUserId: userId,
        onSendReaction: sendReaction,
        onSendMessage: sendMessage,
        onOpened: markChatRead,
      }}
    />
  );
}
