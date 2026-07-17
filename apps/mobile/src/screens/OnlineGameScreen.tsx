/**
 * Online game screen — wires the shared GameView to the online store. Input is
 * enabled only on the local player's turn. Seats show profile names/avatars
 * when a profile row exists (color labels otherwise). The host can trigger a
 * rematch from the results overlay; guests follow via the realtime update.
 */

import { GameView } from "../components/GameView";
import { TURN_SECONDS, useOnlineStore } from "../store/onlineStore";
import { useProfile } from "../store/profileStore";

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

export function OnlineGameScreen() {
  const state = useOnlineStore((s) => s.state);
  const lobby = useOnlineStore((s) => s.lobby);
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
  const latestBubbles = useOnlineStore((s) => s.latestBubbles);
  const sendReaction = useOnlineStore((s) => s.sendReaction);
  const sendMessage = useOnlineStore((s) => s.sendMessage);
  const markChatRead = useOnlineStore((s) => s.markChatRead);
  const turnSeq = useOnlineStore((s) => s.turnSeq);
  const autoPilot = useOnlineStore((s) => s.autoPilot);
  const takeControl = useOnlineStore((s) => s.takeControl);
  const stake = useOnlineStore((s) => s.stake);
  const myName = useProfile((s) => s.displayName);

  if (!state) return null;

  const myTurn = state.status === "active" && state.currentTurnPlayerId === myPlayerId;
  const active = state.players.find((p) => p.id === state.currentTurnPlayerId)!;
  const myColor = state.players.find((p) => p.id === myPlayerId)?.color;

  const profileOf = (playerId: string) => {
    const player = state.players.find((p) => p.id === playerId);
    return player ? profiles[player.userId] : undefined;
  };

  // Presence comes from the live players table (fresh via realtime), not the
  // game-state snapshot. Never flag my own seat.
  const offlineOf = (playerId: string): boolean => {
    const player = state.players.find((p) => p.id === playerId);
    if (!player || player.id === myPlayerId) return false;
    const row = lobby.find((l) => l.user_id === player.userId);
    return row ? !row.is_connected : false;
  };

  // Gone for good (explicit leave or idled out) — from the authoritative state.
  const leftOf = (playerId: string): boolean =>
    !!state.players.find((p) => p.id === playerId)?.hasLeft;

  return (
    <GameView
      state={state}
      validMoves={validMoves}
      lastRoll={lastRoll}
      rollSeq={rollSeq}
      message={message}
      canAct={myTurn && !autoPilot}
      waitingLabel={
        autoPilot && myTurn
          ? "Bot is playing for you — tap your avatar to take control"
          : `Waiting for ${profileOf(active.id)?.display_name ?? COLOR_LABEL[active.color]}…`
      }
      onRoll={() => void roll()}
      onSelectToken={(id) => void selectToken(id)}
      onLeave={leave}
      confirmLeave
      onRematch={isHost ? () => void rematch() : undefined}
      resultsFootnote={isHost ? null : "Waiting for the host to start a rematch…"}
      nameFor={(playerId) => profileOf(playerId)?.display_name ?? (playerId === myPlayerId ? myName : null)}
      avatarFor={(playerId) => profileOf(playerId)?.avatar_id ?? null}
      offlineFor={offlineOf}
      leftFor={leftOf}
      turnTimer={state.status === "active" ? { seq: turnSeq, seconds: TURN_SECONDS } : null}
      autoPilot={autoPilot && myPlayerId ? { playerId: myPlayerId, onTakeControl: takeControl } : null}
      roomCode={roomCode}
      stake={stake}
      viewColor={myColor}
      chat={{
        events: chat,
        unread: chatUnread,
        latestBubbles,
        myUserId: userId,
        onSendReaction: sendReaction,
        onSendMessage: sendMessage,
        onOpened: markChatRead,
      }}
    />
  );
}
