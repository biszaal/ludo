/**
 * Online game screen — wires the shared GameView to the online store. Input is
 * enabled only on the local player's turn. Seats show profile names/avatars
 * when a profile row exists (color labels otherwise). A rematch is proposed
 * from the results overlay and voted on by everyone still seated; the
 * accepters are dealt the new board.
 */

import { View } from "react-native";
import { ConnectionStrip } from "../components/ConnectionStrip";
import { DealingOverlay } from "../components/DealingOverlay";
import { GameView } from "../components/GameView";
import { useOnlineStore } from "../store/onlineStore";
import { useProfile } from "../store/profileStore";

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

export function OnlineGameScreen() {
  const state = useOnlineStore((s) => s.state);
  const lobby = useOnlineStore((s) => s.lobby);
  const validMoves = useOnlineStore((s) => s.validMoves);
  const lastRoll = useOnlineStore((s) => s.lastRoll);
  const rollSeq = useOnlineStore((s) => s.rollSeq);
  const message = useOnlineStore((s) => s.message);
  const myPlayerId = useOnlineStore((s) => s.myPlayerId);
  const profiles = useOnlineStore((s) => s.profiles);
  const roll = useOnlineStore((s) => s.roll);
  const selectToken = useOnlineStore((s) => s.selectToken);
  const reportPlayer = useOnlineStore((s) => s.reportPlayer);
  const rematchProposal = useOnlineStore((s) => s.rematchProposal);
  const rematchNotice = useOnlineStore((s) => s.rematchNotice);
  const proposeRematch = useOnlineStore((s) => s.proposeRematch);
  const answerRematch = useOnlineStore((s) => s.answerRematch);
  const leave = useOnlineStore((s) => s.leave);
  const userId = useOnlineStore((s) => s.userId);
  const chat = useOnlineStore((s) => s.chat);
  const chatUnread = useOnlineStore((s) => s.chatUnread);
  const latestBubbles = useOnlineStore((s) => s.latestBubbles);
  const sendReaction = useOnlineStore((s) => s.sendReaction);
  const sendMessage = useOnlineStore((s) => s.sendMessage);
  const markChatRead = useOnlineStore((s) => s.markChatRead);
  const turnSeq = useOnlineStore((s) => s.turnSeq);
  // The server's clock for this turn, not an assumed one: an away seat gets a
  // short one, and the ring has to sweep over what the room is actually waiting.
  const turnSeconds = useOnlineStore((s) => s.turnSeconds);
  const autoPilot = useOnlineStore((s) => s.autoPilot);
  const bustHold = useOnlineStore((s) => s.bustHold);
  const dealing = useOnlineStore((s) => s.dealing);
  const takeControl = useOnlineStore((s) => s.takeControl);
  const stake = useOnlineStore((s) => s.stake);
  const myName = useProfile((s) => s.displayName);
  const myAvatar = useProfile((s) => s.avatarId);
  const myDiceSkin = useProfile((s) => s.diceSkinId);

  if (!state) return null;

  const myTurn = state.status === "active" && state.currentTurnPlayerId === myPlayerId;
  const active = state.players.find((p) => p.id === state.currentTurnPlayerId)!;
  const myColor = state.players.find((p) => p.id === myPlayerId)?.color;

  const profileOf = (playerId: string) => {
    const player = state.players.find((p) => p.id === playerId);
    return player ? profiles[player.userId] : undefined;
  };

  /**
   * Is this seat mine? Checked against the auth user id as well as myPlayerId.
   *
   * myPlayerId is a per-game handle handed out at join time; userId comes
   * straight from the session and can't drift. When only the handle was
   * consulted and it didn't line up, my own seat fell through to the
   * "stranger" branch below — no local profile, and if the profiles cache
   * hadn't picked my row up either, the chip rendered a bare color disc
   * labelled "Red"/"Yellow" while everyone else's showed normally.
   */
  const isMe = (playerId: string): boolean => {
    if (playerId === myPlayerId) return true;
    const player = state.players.find((p) => p.id === playerId);
    return !!userId && player?.userId === userId;
  };

  // Presence comes from the live players table (fresh via realtime), not the
  // game-state snapshot. Never flag my own seat.
  const offlineOf = (playerId: string): boolean => {
    const player = state.players.find((p) => p.id === playerId);
    if (!player || isMe(playerId)) return false;
    const row = lobby.find((l) => l.user_id === player.userId);
    return row ? !row.is_connected : false;
  };

  // Gone for good (explicit leave or idled out) — from the authoritative state.
  const leftOf = (playerId: string): boolean =>
    !!state.players.find((p) => p.id === playerId)?.hasLeft;

  // A bot the host filled a friend room with. Reads the same players row as
  // presence; quick-match fill-ins are never flagged, so this stays false for
  // them and their camouflage holds.
  const botOf = (playerId: string): boolean => {
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return false;
    return lobby.find((l) => l.user_id === player.userId)?.is_bot ?? false;
  };

  return (
    // The overlay sits OVER a fully rendered board rather than replacing it, so
    // the table is already there when the cover lifts — no second layout pass,
    // and nothing pops in. It also swallows taps, which is the point: the die
    // underneath is not ready to be rolled yet.
    <View style={{ flex: 1 }}>
    <GameView
      state={state}
      validMoves={validMoves}
      lastRoll={lastRoll}
      rollSeq={rollSeq}
      message={message}
      canAct={myTurn && !autoPilot && !bustHold}
      bustHold={bustHold}
      waitingLabel={
        autoPilot && myTurn
          ? "Bot is playing for you — tap your avatar to take control"
          : `Waiting for ${profileOf(active.id)?.display_name ?? COLOR_LABEL[active.color]}…`
      }
      onRoll={() => void roll()}
      onSelectToken={(id) => void selectToken(id)}
      onLeave={leave}
      confirmLeave
      rematch={{
        proposal: rematchProposal,
        myUserId: userId,
        notice: rematchNotice,
        onPropose: () => void proposeRematch(),
        onAnswer: (accept) => void answerRematch(accept),
      }}
      nameFor={(playerId) => (isMe(playerId) ? myName : null) ?? profileOf(playerId)?.display_name ?? null}
      // Local-first for my own seat (like nameFor / diceSkinFor): my profile row
      // may not be in the fetched cache yet, and I always know my own avatar.
      avatarFor={(playerId) => (isMe(playerId) ? myAvatar : (profileOf(playerId)?.avatar_id ?? null))}
      // Local-first for my own seat: the profiles cache is fetched once per
      // user per session and skips users already cached (onlineStore's
      // fetchProfiles), so it can go stale if I re-equip a skin mid-session.
      // Everyone else — bots included, they carry an ordinary profiles row —
      // resolves the same way a name or avatar does.
      diceSkinFor={(playerId) => (isMe(playerId) ? myDiceSkin : (profileOf(playerId)?.dice_skin ?? null))}
      offlineFor={offlineOf}
      leftFor={leftOf}
      botFor={botOf}
      turnTimer={state.status === "active" ? { seq: turnSeq, seconds: turnSeconds } : null}
      autoPilot={autoPilot && myPlayerId ? { playerId: myPlayerId, onTakeControl: takeControl } : null}
      notice={<ConnectionStrip />}
      stake={stake}
      viewColor={myColor}
      chat={{
        events: chat,
        unread: chatUnread,
        latestBubbles,
        myUserId: userId,
        onSendReaction: sendReaction,
        onSendMessage: sendMessage,
        onReport: (userId, message) => void reportPlayer(userId, message),
        onOpened: markChatRead,
      }}
    />
    {dealing ? <DealingOverlay /> : null}
    </View>
  );
}
