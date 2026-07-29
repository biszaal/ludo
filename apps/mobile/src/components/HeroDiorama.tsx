/**
 * The hub's centerpiece: the player's EQUIPPED board, pawns and die staged in
 * the table's lamplight — a showcase of real cosmetics, never stock art. Pure
 * still-life on one Canvas; the parent measures and passes the box.
 */

import { Canvas, Circle, Group } from "@shopify/react-native-skia";
import { BoardSurface, PawnShape } from "./Board";
import { DieStill, stillDieColors } from "./DieStill";
import type { BoardTheme } from "../render/boardThemes";
import type { DiceSkin } from "../render/diceSkins";

interface HeroDioramaProps {
  theme: BoardTheme;
  diceSkin: DiceSkin;
  width: number;
  height: number;
  /** >1 on tablets: lets the board fill more of the box and the pieces grow,
   *  so a big screen shows a substantial still-life rather than a tiny one. */
  scale?: number;
}

export function HeroDiorama({ theme, diceSkin, width, height, scale = 1 }: HeroDioramaProps) {
  // Skia canvases at zero size on the first frame are a known trap.
  if (width <= 0 || height <= 0) return null;

  const big = scale > 1;
  const board = Math.min(width * (big ? 0.72 : 0.62), height * 0.82);
  const cx = width / 2;
  const cy = height / 2;
  const die = stillDieColors(diceSkin, theme);
  const dieSize = Math.max(30, Math.min(44 * scale, board * 0.26));
  const pawnR = Math.max(16, Math.min(26 * scale, board * 0.15));

  return (
    <Canvas style={{ width, height }}>
      {/* Table shadow pooling under the board. */}
      <Group transform={[{ translateX: cx }, { translateY: cy + board * 0.5 }, { scaleY: 0.22 }]}>
        <Circle cx={0} cy={0} r={board * 0.62} color="rgba(0,0,0,0.22)" />
      </Group>

      {/* The equipped board, dealt onto the felt at a casual angle. */}
      <Group
        origin={{ x: cx, y: cy }}
        transform={[{ translateX: cx - board / 2 }, { translateY: cy - board / 2 }, { rotate: -0.05 }]}
      >
        <BoardSurface size={board} theme={theme} />
      </Group>

      {/* Opponents' pawns peeking from behind the far corner… */}
      <Group transform={[{ translateX: cx + board * 0.42 }, { translateY: cy - board * 0.34 }]}>
        <PawnShape r={pawnR * 0.55} color={theme.team.green} stroke={theme.pawnStroke} />
      </Group>
      <Group transform={[{ translateX: cx + board * 0.52 }, { translateY: cy - board * 0.18 }]}>
        <PawnShape r={pawnR * 0.68} color={theme.team.blue} stroke={theme.pawnStroke} />
      </Group>

      {/* …your pawn up front, biggest piece on the table… */}
      <Group transform={[{ translateX: cx - board * 0.52 }, { translateY: cy + board * 0.36 }]}>
        <PawnShape r={pawnR} color={theme.team.red} stroke={theme.pawnStroke} />
      </Group>

      {/* …and your die, freshly landed on 6. */}
      <Group transform={[{ translateX: cx + board * 0.48 }, { translateY: cy + board * 0.34 }, { rotate: 0.16 }]}>
        <DieStill size={dieSize} face={die.face} pip={die.pip} />
      </Group>
    </Canvas>
  );
}
