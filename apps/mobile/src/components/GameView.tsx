/**
 * Presentational game view shared by local and online play. It renders the
 * board, players, dice and the context action from props alone — the local and
 * online screens wire it to their respective stores. `canAct` gates all input
 * (false during a bot turn or an opponent's online turn).
 */

import { Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { GameState, Move } from "@ludo/engine";
import { Board } from "./Board";
import { Button } from "./Button";
import { Dice } from "./Dice";
import { PlayerPanel } from "./PlayerPanel";
import { font, onTeamColor, palette, radius, space, teamColor } from "../theme";

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
  finishedLabel?: string;
  /** Online room code, shown in the top bar. */
  roomCode?: string | null;
}

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
  finishedLabel = "New game",
  roomCode,
}: GameViewProps) {
  const { width, height } = useWindowDimensions();
  const boardSize = Math.floor(Math.min(width - space.xl * 2, height * 0.46));
  const active = state.players.find((p) => p.id === state.currentTurnPlayerId)!;
  const accent = teamColor[active.color];
  const finished = state.status === "finished";

  const movable = (id: string) => canAct && validMoves.some((m) => m.tokenId === id);
  const noop = () => {};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.feltCharcoal }}>
      <View style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Ludo</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            {roomCode ? (
              <View style={{ paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: palette.liftedSlate }}>
                <Text style={{ fontFamily: font.mono, fontSize: 14, color: palette.porcelain, letterSpacing: 2 }}>{roomCode}</Text>
              </View>
            ) : null}
            <Button label="Leave" onPress={onLeave} variant="ghost" />
          </View>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md }}>
          {state.players.map((p) => (
            <View key={p.id} style={{ width: "48%" }}>
              <PlayerPanel player={p} state={state} active={p.id === state.currentTurnPlayerId && !finished} />
            </View>
          ))}
        </View>

        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Board size={boardSize} state={state} isMovable={movable} onSelectToken={canAct ? onSelectToken : noop} />
        </View>

        <View style={{ gap: space.md, marginBottom: space.sm }}>
          <Text style={{ fontFamily: font.medium, fontSize: 16, color: palette.porcelain, textAlign: "center" }}>{message}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
            <Dice value={state.diceValue ?? lastRoll} muted={state.phase === "awaiting-roll"} accent={accent} spinSeq={rollSeq} />
            <View style={{ flex: 1 }}>
              {finished ? (
                <Button label={finishedLabel} onPress={onLeave} />
              ) : !canAct ? (
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
    </SafeAreaView>
  );
}
