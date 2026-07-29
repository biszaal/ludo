/**
 * A selectable dice-skin tile: a static preview of the landed face — same
 * face treatment, pip shape and glow Dice.tsx paints in the game, built
 * declaratively since a shop tile never animates — plus label and price.
 * Mirrors ThemeSwatch.tsx's layout and lock treatment exactly.
 *
 * The face's decorative overlay (grain/veins/stars/facets) is skipped here on
 * purpose: at this size it would be a few near-invisible flecks, not worth
 * the extra draw calls. It's the payoff for playing with the skin equipped —
 * this tile only needs to sell color, pip shape and glow.
 */

import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { BlurMask, Canvas, Circle, Group, LinearGradient, Path, RoundedRect, Skia, vec } from "@shopify/react-native-skia";
import { PriceTag, type PriceCurrency } from "./PriceTag";
import type { BoardTheme } from "../render/boardThemes";
import { diceRenderParams, type DiceSkin } from "../render/diceSkins";
import { appendPip, type PipShape } from "../render/pipShapes";
import { font, palette, radius, shade, space } from "../theme";

const THUMB = 72;
const PAD = 6;
const FACE = THUMB - PAD * 2;
/** Value-5 pip layout on a unit face — mirrors Dice.tsx's PIP_XY[5] (each
 *  Skia die-face surface keeps its own small copy; see DieStill.tsx too). */
const PIP5: [number, number][] = [
  [0.26, 0.26],
  [0.74, 0.26],
  [0.5, 0.5],
  [0.26, 0.74],
  [0.74, 0.74],
];

interface DiceSwatchProps {
  skin: DiceSkin;
  /** The viewer's board theme — classic previews against it, like in-game. */
  theme: BoardTheme;
  selected: boolean;
  /** Coins to unlock; 0 (or owned) means selectable. */
  price?: number;
  /** Which wallet the price charges (display only). */
  currency?: PriceCurrency;
  locked?: boolean;
  onSelect: () => void;
}

export function DiceSwatch({ skin, theme, selected, price = 0, currency = "coins", locked = false, onSelect }: DiceSwatchProps) {
  const sp = useMemo(() => diceRenderParams(skin, theme), [skin, theme]);
  const faceHex = skin.face ? (skin.face.type === "solid" ? skin.face.color : skin.face.colors[0]!) : theme.dice.face;
  const pipHex = skin.pip?.color ?? theme.dice.pip;
  const edgeHex = skin.edge ?? shade(faceHex, -0.25);
  // A darker rim around shaped pips (mirrors Dice.tsx): at this thumbnail size
  // a diamond/star/crown/flame's outline is what actually reads as a distinct
  // shape — the fill color alone looks like a plain dot.
  const outlineHex = shade(pipHex, -0.45);
  const rounded = FACE * 0.24;
  const dotR = FACE * 0.085;
  const shapedR = FACE * 0.11;

  const pipPaths = useMemo(() => {
    if (sp.pipShape === "dot") return null;
    const shape = sp.pipShape as Exclude<PipShape, "dot">;
    return PIP5.map(([px, py]) => {
      const p = Skia.Path.Make();
      appendPip(p, shape, px * FACE, py * (FACE - 2), shapedR);
      return p;
    });
  }, [sp.pipShape, shapedR]);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={locked ? `${skin.label} dice, locked, ${price} ${currency}` : `${skin.label} dice`}
      onPress={onSelect}
      style={({ pressed }) => ({
        width: "22%",
        alignItems: "center",
        padding: space.xs,
        borderRadius: radius.md,
        borderWidth: 1.5,
        borderColor: selected ? palette.porcelain : "transparent",
        backgroundColor: selected ? palette.raisedSlate : "transparent",
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      <View>
        <View style={{ width: THUMB, height: THUMB, opacity: locked ? 0.4 : 1 }}>
          <Canvas style={{ width: THUMB, height: THUMB }}>
            <Group transform={[{ translateX: PAD }, { translateY: PAD }]}>
              <RoundedRect x={0} y={2} width={FACE} height={FACE} r={rounded} color={edgeHex} />
              <RoundedRect x={0} y={0} width={FACE} height={FACE - 2} r={rounded} color={sp.gradient ? undefined : faceHex}>
                {sp.gradient ? (
                  <LinearGradient start={vec(0, 0)} end={vec(FACE, FACE - 2)} colors={sp.gradient.colors} positions={sp.gradient.stops ?? undefined} />
                ) : null}
              </RoundedRect>
              {sp.frame ? (
                <RoundedRect
                  x={0}
                  y={0}
                  width={FACE}
                  height={FACE - 2}
                  r={rounded}
                  color={sp.frame}
                  style="stroke"
                  strokeWidth={FACE * 0.045}
                />
              ) : null}
              {PIP5.map(([px, py], i) =>
                sp.pipShape === "dot" ? (
                  <Circle key={i} cx={px * FACE} cy={py * (FACE - 2)} r={dotR} color={pipHex}>
                    {sp.glow ? <BlurMask style="normal" blur={FACE * 0.05} respectCTM /> : null}
                  </Circle>
                ) : (
                  <Group key={i}>
                    {sp.glow ? (
                      <Path path={pipPaths![i]!} color={sp.glow}>
                        <BlurMask style="normal" blur={FACE * 0.07} respectCTM />
                      </Path>
                    ) : null}
                    <Path path={pipPaths![i]!} color={outlineHex} style="stroke" strokeWidth={FACE * 0.03} strokeJoin="round" />
                    <Path path={pipPaths![i]!} color={pipHex} />
                  </Group>
                ),
              )}
            </Group>
          </Canvas>
        </View>
        {locked ? (
          <View style={{ position: "absolute", left: 0, right: 0, bottom: -6, alignItems: "center" }}>
            <PriceTag price={price} currency={currency} />
          </View>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        style={{
          marginTop: space.xs,
          fontFamily: font.medium,
          fontSize: 12,
          color: selected ? palette.porcelain : palette.mutedSteel,
        }}
      >
        {skin.label}
      </Text>
    </Pressable>
  );
}
