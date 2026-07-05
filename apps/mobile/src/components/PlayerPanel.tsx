/**
 * Compact player status row. The active player's panel lifts and shows a ring in
 * their color; inactive panels recede. Finished-token count is mono.
 */

import { Text, View } from "react-native";
import { TOKENS_PER_PLAYER, type GameState, type PlayerState } from "@ludo/engine";
import { font, palette, radius, space, teamColor } from "../theme";

const COLOR_LABEL: Record<PlayerState["color"], string> = {
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
};

interface PlayerPanelProps {
  player: PlayerState;
  state: GameState;
  active: boolean;
}

export function PlayerPanel({ player, state, active }: PlayerPanelProps) {
  const finished = state.tokens.filter((t) => t.playerId === player.id && t.position === "finished").length;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: active ? palette.liftedSlate : "transparent",
        borderWidth: active ? 1.5 : 1,
        borderColor: active ? teamColor[player.color] : palette.hairline,
      }}
    >
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: radius.pill,
          backgroundColor: teamColor[player.color],
        }}
      />
      <Text style={{ fontFamily: font.semibold, fontSize: 15, color: active ? palette.porcelain : palette.mutedSteel }}>
        {COLOR_LABEL[player.color]}
      </Text>
      <Text style={{ marginLeft: "auto", fontFamily: font.mono, fontSize: 13, color: palette.mutedSteel }}>
        {finished}/{TOKENS_PER_PLAYER}
      </Text>
    </View>
  );
}
