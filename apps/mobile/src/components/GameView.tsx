/**
 * Presentational game view shared by local and online play. It renders the
 * board, players, dice and the context action from props alone — the local and
 * online screens wire it to their respective stores. `canAct` gates all input
 * (false during a bot turn or an opponent's online turn).
 *
 * Overlays live here (DESIGN d5): the pause sheet and the results screen render
 * over the live board without touching game state or the realtime socket.
 * Android back pauses/resumes instead of leaving.
 */

import { useEffect, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { GameState, Move } from "@ludo/engine";
import { Board } from "./Board";
import { Button } from "./Button";
import { ChatSheet } from "./ChatSheet";
import { Dice } from "./Dice";
import { PauseMenu } from "./PauseMenu";
import { PlayerPanel } from "./PlayerPanel";
import { ReactionBar } from "./ReactionBar";
import { ReactionBubble } from "./ReactionBubble";
import { ResultsOverlay } from "./ResultsOverlay";
import type { ChatEvent } from "../store/onlineStore";
import { font, onTeamColor, palette, radius, space, teamColor } from "../theme";
import { BOARD_THEMES } from "../render/boardThemes";
import { setBackInterceptor } from "../store/navStore";
import { useSettings } from "../store/settingsStore";
import { shareInvite } from "../lib/invite";

interface GameViewProps {
  state: GameState;
  validMoves: Move[];
  lastRoll: number | null;
  rollSeq: number;
  message: string;
  /** May the local user act right now? */
  canAct: boolean;
  /** Shown in the action area when it's not the local user's turn (and not finished). */
  waitingLabel?: string | null;
  onRoll: () => void;
  onSelectToken: (tokenId: string) => void;
  onLeave: () => void;
  /** Results: hidden when undefined (online guest waits for the host). */
  onRematch?: () => void;
  /** Two-step leave confirmation (online). */
  confirmLeave?: boolean;
  /** Seat display names/avatars; fall back to color labels/chips. */
  nameFor?: (playerId: string) => string | null;
  avatarFor?: (playerId: string) => string | null;
  /** Small line under the results buttons (e.g. "Waiting for the host…"). */
  resultsFootnote?: string | null;
  /** Online room code, shown in the top bar. */
  roomCode?: string | null;
  /** In-room reactions + chat (online only; local play omits it). */
  chat?: GameChat;
}

export interface GameChat {
  events: ChatEvent[];
  unread: number;
  latestReactions: Record<string, { value: string; seq: number }>;
  myUserId: string | null;
  onSendReaction: (value: string) => void;
  onSendMessage: (text: string) => void;
  /** Called when the sheet opens — clears the unread badge. */
  onOpened: () => void;
}

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

export function GameView({
  state,
  validMoves,
  lastRoll,
  rollSeq,
  message,
  canAct,
  waitingLabel,
  onRoll,
  onSelectToken,
  onLeave,
  onRematch,
  confirmLeave,
  nameFor,
  avatarFor,
  resultsFootnote,
  roomCode,
  chat,
}: GameViewProps) {
  const { width, height } = useWindowDimensions();
  const theme = BOARD_THEMES[useSettings((s) => s.boardThemeId)];
  const [paused, setPaused] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const boardSize = Math.floor(Math.min(width - space.xl * 2, height * 0.46));
  const active = state.players.find((p) => p.id === state.currentTurnPlayerId)!;
  const accent = teamColor[active.color];
  const finished = state.status === "finished";

  // Android back: toggle the pause sheet instead of abandoning the game.
  useEffect(() => {
    setBackInterceptor(() => {
      setPaused((p) => !p);
      return true;
    });
    return () => setBackInterceptor(null);
  }, []);

  const movable = (id: string) => canAct && validMoves.some((m) => m.tokenId === id);
  const noop = () => {};

  const nameForUser = (userId: string): string => {
    if (chat && userId === chat.myUserId) return "You";
    const pl = state.players.find((p) => p.userId === userId);
    if (!pl) return "Player";
    return nameFor?.(pl.id) ?? COLOR_LABEL[pl.color];
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.feltCharcoal }}>
      <View style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Ludo</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            {roomCode ? (
              // Tapping the code opens the share sheet — invite a friend mid-room.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Share room code ${roomCode}`}
                onPress={() => void shareInvite(roomCode)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: space.sm,
                  paddingVertical: 4,
                  borderRadius: radius.sm,
                  backgroundColor: palette.liftedSlate,
                  borderTopWidth: 1,
                  borderTopColor: "rgba(255,255,255,0.10)",
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ fontFamily: font.mono, fontSize: 14, color: palette.porcelain, letterSpacing: 2 }}>{roomCode}</Text>
                <Text style={{ fontFamily: font.semibold, fontSize: 12, color: palette.mutedSteel }}>SHARE</Text>
              </Pressable>
            ) : null}
            {chat ? (
              <>
                <IconButton label="Reactions" glyph="🙂" onPress={() => setReactionsOpen((v) => !v)} />
                <IconButton
                  label="Chat"
                  glyph="💬"
                  showDot={chat.unread > 0}
                  onPress={() => {
                    chat.onOpened();
                    setChatOpen(true);
                  }}
                />
              </>
            ) : null}
            <MenuButton onPress={() => setPaused(true)} />
          </View>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md }}>
          {state.players.map((p) => {
            const reaction = chat?.latestReactions[p.userId];
            return (
              <View key={p.id} style={{ width: "48%" }}>
                <PlayerPanel
                  player={p}
                  state={state}
                  active={p.id === state.currentTurnPlayerId && !finished}
                  label={nameFor?.(p.id) ?? undefined}
                />
                {reaction ? <ReactionBubble value={reaction.value} seq={reaction.seq} /> : null}
              </View>
            );
          })}
        </View>

        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Board size={boardSize} state={state} theme={theme} isMovable={movable} onSelectToken={canAct && !paused ? onSelectToken : noop} />
        </View>

        <View style={{ gap: space.md, marginBottom: space.sm }}>
          <Text style={{ fontFamily: font.medium, fontSize: 16, color: palette.porcelain, textAlign: "center" }}>{message}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
            <Dice value={state.diceValue ?? lastRoll} muted={state.phase === "awaiting-roll"} accent={accent} spinSeq={rollSeq} theme={theme} />
            <View style={{ flex: 1 }}>
              {finished ? null : !canAct ? (
                <Text style={{ fontFamily: font.medium, fontSize: 14, color: palette.mutedSteel, textAlign: "center" }}>
                  {waitingLabel ?? "Waiting…"}
                </Text>
              ) : state.phase === "awaiting-roll" ? (
                <Button label="Roll" onPress={onRoll} color={accent} textColor={onTeamColor(active.color)} />
              ) : (
                <Text style={{ fontFamily: font.medium, fontSize: 14, color: palette.mutedSteel, textAlign: "center" }}>
                  {validMoves.length === 0 ? "No moves — passing…" : "Tap a highlighted token"}
                </Text>
              )}
            </View>
          </View>
        </View>
      </View>

      {finished && (
        <ResultsOverlay state={state} nameFor={nameFor} avatarFor={avatarFor} onRematch={onRematch} footnote={resultsFootnote} onHome={onLeave} />
      )}

      {paused && !finished && (
        <PauseMenu
          onResume={() => setPaused(false)}
          onLeave={() => {
            setPaused(false);
            onLeave();
          }}
          confirmLeave={confirmLeave}
        />
      )}

      {reactionsOpen && chat && !finished && (
        <ReactionBar onSend={chat.onSendReaction} onClose={() => setReactionsOpen(false)} />
      )}

      {chatOpen && chat && (
        <ChatSheet
          events={chat.events}
          nameForUser={nameForUser}
          myUserId={chat.myUserId}
          onSend={chat.onSendMessage}
          onClose={() => setChatOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

/** Round emoji-glyph button in the game top bar (reactions, chat). */
function IconButton({ label, glyph, onPress, showDot = false }: { label: string; glyph: string; onPress: () => void; showDot?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: palette.raisedSlate,
        borderWidth: 1,
        borderColor: palette.hairline,
        borderTopColor: "rgba(255,255,255,0.10)",
        alignItems: "center",
        justifyContent: "center",
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      <Text style={{ fontSize: 20 }}>{glyph}</Text>
      {showDot ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 9,
            height: 9,
            borderRadius: radius.pill,
            backgroundColor: teamColor.red,
          }}
        />
      ) : null}
    </Pressable>
  );
}

/** Drawn ≡ menu glyph — 44px target, no icon fonts. */
function MenuButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Game menu"
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md,
        backgroundColor: palette.raisedSlate,
        borderWidth: 1,
        borderColor: palette.hairline,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        transform: [{ scale: pressed ? 0.94 : 1 }],
      })}
    >
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 18, height: 2, borderRadius: 1, backgroundColor: palette.porcelain }} />
      ))}
    </Pressable>
  );
}
