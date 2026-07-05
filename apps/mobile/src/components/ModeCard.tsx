/**
 * A play-mode card on the Home hub. Cards are deliberately unequal in height
 * (DESIGN.md: no three-equal-card rows); the large variant shows a clipped
 * corner of the live board theme as art. Raised-piece surface: pressing seats
 * it into the felt.
 */

import { Pressable, Text, View } from "react-native";
import { Canvas, Group } from "@shopify/react-native-skia";
import { BoardSurface } from "./Board";
import { Surface3D } from "./Surface3D";
import type { BoardTheme } from "../render/boardThemes";
import { font, palette, radius, space } from "../theme";

interface ModeCardProps {
  title: string;
  subtitle: string;
  onPress: () => void;
  /** Show a peeking corner of the board as card art (the large card). */
  boardArt?: BoardTheme;
  minHeight?: number;
}

export function ModeCard({ title, subtitle, onPress, boardArt, minHeight = 84 }: ModeCardProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
      {({ pressed }) => (
        <Surface3D rad={radius.lg} pressed={pressed} faceStyle={{ minHeight, flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, paddingHorizontal: space.lg, paddingVertical: space.md, gap: 4 }}>
            <Text style={{ fontFamily: font.display, fontSize: 18, color: palette.porcelain }}>{title}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>{subtitle}</Text>
          </View>

          {boardArt ? (
            // A corner of the board peeks in from the card's right edge.
            <View style={{ width: 96, height: minHeight, opacity: 0.9 }}>
              <Canvas style={{ width: 96, height: minHeight }}>
                <Group transform={[{ translateX: 14 }, { translateY: 12 }]}>
                  <BoardSurface size={170} theme={boardArt} />
                </Group>
              </Canvas>
            </View>
          ) : (
            <Text style={{ fontFamily: font.semibold, fontSize: 22, color: palette.mutedSteel, paddingRight: space.lg }}>›</Text>
          )}
        </Surface3D>
      )}
    </Pressable>
  );
}
