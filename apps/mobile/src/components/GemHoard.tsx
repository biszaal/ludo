/**
 * How much treasure a pack is, drawn rather than counted.
 *
 * The three tiers are the same faceted gem from GemGlyph at three scales of
 * ambition: a few loose stones, a heaped pile, then a chest with the lid up and
 * the hoard spilling over the rim. A player should be able to tell the packs
 * apart at a glance, across a room, without reading a number — which is the one
 * job a price list cannot do.
 *
 * Same materials as everything else on the table: pure Skia, no icon fonts, no
 * emoji. The chest is slate with a marigold band so it reads as treasure in the
 * dark blue room without introducing a wood brown the palette has never had.
 */

import { Canvas, Group, LinearGradient, Path, vec } from "@shopify/react-native-skia";
import { palette, teamColor } from "../theme";

export type HoardTier = "small" | "medium" | "large";

const TABLE = "#8A7BFF";
const PAVILION = "#5B4BD6";
const SPECULAR = "#C9C2FF";
const BAND = teamColor.yellow;

/** One gem, as a path, centred on (cx, cy) with width w. Mirrors GemGlyph's
 *  silhouette so a stone in the hoard and the mark on a pill are the same cut. */
function gemPath(cx: number, cy: number, w: number): string {
  const h = w * 1.05;
  const x = (t: number) => cx + (t - 0.5) * w;
  const y = (t: number) => cy + (t - 0.5) * h;
  return (
    `M ${x(0.3)} ${y(0.12)} L ${x(0.7)} ${y(0.12)} L ${x(0.94)} ${y(0.42)} ` +
    `L ${x(0.5)} ${y(0.92)} L ${x(0.06)} ${y(0.42)} Z`
  );
}

/** Where the stones sit, per tier. Hand-placed rather than scattered by a
 *  random seed: these need to look identical every render, and a heap reads as
 *  a heap only when the overlaps are deliberate. */
const LAYOUTS: Record<HoardTier, { cx: number; cy: number; w: number }[]> = {
  // Three loose stones, slightly stepped so it reads as "some", not "a set".
  small: [
    { cx: 0.5, cy: 0.4, w: 0.34 },
    { cx: 0.31, cy: 0.62, w: 0.28 },
    { cx: 0.68, cy: 0.63, w: 0.26 },
  ],
  // A heap: a base course with two riding on top.
  medium: [
    { cx: 0.22, cy: 0.68, w: 0.3 },
    { cx: 0.5, cy: 0.72, w: 0.34 },
    { cx: 0.78, cy: 0.68, w: 0.3 },
    { cx: 0.35, cy: 0.45, w: 0.3 },
    { cx: 0.65, cy: 0.45, w: 0.3 },
    { cx: 0.5, cy: 0.24, w: 0.32 },
  ],
  // Spilling over a chest rim — the stones sit high, the chest is drawn under.
  large: [
    { cx: 0.28, cy: 0.36, w: 0.26 },
    { cx: 0.5, cy: 0.26, w: 0.32 },
    { cx: 0.72, cy: 0.36, w: 0.26 },
    { cx: 0.5, cy: 0.46, w: 0.26 },
  ],
};

export function GemHoard({ tier, size = 64 }: { tier: HoardTier; size?: number }) {
  const s = size;
  const u = (t: number) => t * s;
  const stones = LAYOUTS[tier];

  // Chest: a rounded body with the lid thrown back, drawn behind the stones so
  // they sit IN it rather than on it.
  const bodyTop = 0.52;
  const chest =
    `M ${u(0.12)} ${u(bodyTop)} L ${u(0.88)} ${u(bodyTop)} ` +
    `L ${u(0.84)} ${u(0.9)} Q ${u(0.5)} ${u(0.96)} ${u(0.16)} ${u(0.9)} Z`;
  const lid =
    `M ${u(0.14)} ${u(bodyTop)} Q ${u(0.5)} ${u(0.3)} ${u(0.86)} ${u(bodyTop)} ` +
    `L ${u(0.86)} ${u(bodyTop - 0.06)} Q ${u(0.5)} ${u(0.22)} ${u(0.14)} ${u(bodyTop - 0.06)} Z`;
  const strap = `M ${u(0.44)} ${u(bodyTop)} L ${u(0.56)} ${u(bodyTop)} L ${u(0.55)} ${u(0.92)} L ${u(0.45)} ${u(0.92)} Z`;

  return (
    <Canvas style={{ width: s, height: s }}>
      {tier === "large" ? (
        <Group>
          <Path path={lid} color={palette.liftedSlate} />
          <Path path={lid} color={BAND} style="stroke" strokeWidth={Math.max(1, s * 0.02)} />
          <Path path={chest}>
            <LinearGradient
              start={vec(0, u(bodyTop))}
              end={vec(0, s)}
              colors={[palette.liftedSlate, palette.raisedSlate]}
            />
          </Path>
          <Path path={strap} color={BAND} opacity={0.85} />
          <Path path={chest} color={BAND} style="stroke" strokeWidth={Math.max(1, s * 0.022)} opacity={0.9} />
        </Group>
      ) : null}

      {stones.map((g, i) => {
        const p = gemPath(u(g.cx), u(g.cy), u(g.w));
        return (
          <Group key={i}>
            <Path path={p}>
              <LinearGradient
                start={vec(u(g.cx), u(g.cy - g.w / 2))}
                end={vec(u(g.cx), u(g.cy + g.w / 2))}
                colors={[TABLE, PAVILION]}
              />
            </Path>
            <Path path={p} color={SPECULAR} style="stroke" strokeWidth={Math.max(1, s * 0.016)} />
          </Group>
        );
      })}
    </Canvas>
  );
}
