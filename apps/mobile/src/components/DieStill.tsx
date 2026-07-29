/**
 * A die at rest, drawn as a composable Skia group — the still-life shared by
 * the hero diorama (and formerly ModeCard's card art). Flat colors only: a
 * still die never tumbles, so shaped pips/gradients/glow would be wasted here.
 */

import { Circle, Group, RoundedRect } from "@shopify/react-native-skia";
import type { BoardTheme } from "../render/boardThemes";
import type { DiceSkin } from "../render/diceSkins";

/** Pip centers on a unit face for a rolled 6 (mirrors Dice.tsx PIP_XY). */
const SIX_PIPS: [number, number][] = [
  [0.26, 0.22], [0.74, 0.22], [0.26, 0.5], [0.74, 0.5], [0.26, 0.78], [0.74, 0.78],
];

/** Flat face/pip colors for a still die: the equipped skin's colors when set,
 *  else the board theme's die (classic keeps the original themed look). */
export function stillDieColors(diceSkin: DiceSkin | undefined, theme: BoardTheme): { face: string; pip: string } {
  const face = diceSkin?.face
    ? diceSkin.face.type === "solid"
      ? diceSkin.face.color
      : diceSkin.face.colors[0]!
    : theme.dice.face;
  const pip = diceSkin?.pip?.color ?? theme.dice.pip;
  return { face, pip };
}

/** The die itself, centered on (0,0) — position it with a wrapping Group. */
export function DieStill({ size, face, pip }: { size: number; face: string; pip: string }) {
  return (
    <Group>
      <Group transform={[{ translateY: size * 0.62 }, { scaleY: 0.35 }]}>
        <Circle cx={0} cy={0} r={size * 0.58} color="rgba(0,0,0,0.28)" />
      </Group>
      <RoundedRect x={-size / 2} y={-size / 2} width={size} height={size} r={size * 0.24} color={face} />
      <RoundedRect
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        r={size * 0.24}
        color="rgba(0,0,0,0.22)"
        style="stroke"
        strokeWidth={1.2}
      />
      {SIX_PIPS.map(([px, py], i) => (
        <Circle key={i} cx={(px - 0.5) * size} cy={(py - 0.5) * size} r={size * 0.09} color={pip} />
      ))}
    </Group>
  );
}
