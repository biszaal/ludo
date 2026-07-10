/**
 * A play-mode card on the Home hub. Cards are deliberately unequal in height
 * (DESIGN.md: no three-equal-card rows); the large variant shows a still-life
 * of game pieces — your pawn facing a bot's over a rolled die — colored by the
 * active board theme. Raised-piece surface: pressing seats it into the felt.
 */

import { Pressable, Text, View } from "react-native";
import { Canvas, Circle, Group, RoundedRect } from "@shopify/react-native-skia";
import { PawnShape } from "./Board";
import { Surface3D } from "./Surface3D";
import type { BoardTheme } from "../render/boardThemes";
import { font, palette, radius, space } from "../theme";

interface ModeCardProps {
  title: string;
  subtitle: string;
  onPress: () => void;
  /** Show the game-pieces still-life as card art, colored by the board theme. */
  piecesArt?: BoardTheme;
  minHeight?: number;
}

/** Pip centers on a unit face for a rolled 6 (mirrors Dice.tsx PIP_XY). */
const SIX_PIPS: [number, number][] = [
  [0.26, 0.22], [0.74, 0.22], [0.26, 0.5], [0.74, 0.5], [0.26, 0.78], [0.74, 0.78],
];

const ART_WIDTH = 110;

/** Two pawns squaring off over a die that just landed on 6. */
function PiecesArt({ theme, height }: { theme: BoardTheme; height: number }) {
  const die = 34;
  return (
    <Canvas style={{ width: ART_WIDTH, height }}>
      {/* The die, tossed at a slight angle (drawn first: it sits behind) */}
      <Group transform={[{ translateX: 70 }, { translateY: height * 0.34 }, { rotate: -0.18 }]}>
        <Group transform={[{ translateY: die * 0.62 }, { scaleY: 0.35 }]}>
          <Circle cx={0} cy={0} r={die * 0.58} color="rgba(0,0,0,0.28)" />
        </Group>
        <RoundedRect x={-die / 2} y={-die / 2} width={die} height={die} r={8} color={theme.dice.face} />
        <RoundedRect
          x={-die / 2}
          y={-die / 2}
          width={die}
          height={die}
          r={8}
          color="rgba(0,0,0,0.22)"
          style="stroke"
          strokeWidth={1.2}
        />
        {SIX_PIPS.map(([px, py], i) => (
          <Circle key={i} cx={(px - 0.5) * die} cy={(py - 0.5) * die} r={die * 0.09} color={theme.dice.pip} />
        ))}
      </Group>

      {/* The bot's pawn, a step back… */}
      <Group transform={[{ translateX: 80 }, { translateY: height - 26 }]}>
        <PawnShape r={14} color={theme.team.blue} stroke={theme.pawnStroke} />
      </Group>
      {/* …and yours up front. */}
      <Group transform={[{ translateX: 36 }, { translateY: height - 32 }]}>
        <PawnShape r={19} color={theme.team.red} stroke={theme.pawnStroke} />
      </Group>
    </Canvas>
  );
}

export function ModeCard({ title, subtitle, onPress, piecesArt, minHeight = 84 }: ModeCardProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>
      {({ pressed }) => (
        <Surface3D rad={radius.lg} pressed={pressed} faceStyle={{ minHeight, flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, paddingHorizontal: space.lg, paddingVertical: space.md, gap: 4 }}>
            <Text style={{ fontFamily: font.display, fontSize: 18, color: palette.porcelain }}>{title}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>{subtitle}</Text>
          </View>

          {piecesArt ? (
            <View style={{ width: ART_WIDTH, height: minHeight }}>
              <PiecesArt theme={piecesArt} height={minHeight} />
            </View>
          ) : (
            <Text style={{ fontFamily: font.semibold, fontSize: 22, color: palette.mutedSteel, paddingRight: space.lg }}>›</Text>
          )}
        </Surface3D>
      )}
    </Pressable>
  );
}
