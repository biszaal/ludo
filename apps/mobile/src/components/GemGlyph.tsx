/**
 * Drawn faceted gem — the premium-currency mark, sibling to CoinGlyph. A
 * hex brilliant-cut in blue-violet so it can't be mistaken for the gold coin
 * even at 12px. Pure Skia, no icon fonts, no emojis.
 */

import { Canvas, Path, vec, LinearGradient } from "@shopify/react-native-skia";

const TABLE = "#8A7BFF"; // top facet
const PAVILION = "#5B4BD6"; // lower body
const SPECULAR = "#C9C2FF"; // light-catch edge

export function GemGlyph({ size = 16 }: { size?: number }) {
  const s = size;
  // Hexagonal silhouette: flat top (the "table"), angled shoulders, pointed
  // pavilion. Coordinates on a unit square scaled by s.
  const w = (x: number) => x * s;
  const outline = `M ${w(0.3)} ${w(0.12)} L ${w(0.7)} ${w(0.12)} L ${w(0.94)} ${w(0.42)} L ${w(0.5)} ${w(0.92)} L ${w(0.06)} ${w(0.42)} Z`;
  // Crown facet lines: table edge + two diagonals down to the girdle.
  const facets =
    `M ${w(0.3)} ${w(0.12)} L ${w(0.36)} ${w(0.42)} L ${w(0.5)} ${w(0.92)} ` +
    `M ${w(0.7)} ${w(0.12)} L ${w(0.64)} ${w(0.42)} L ${w(0.5)} ${w(0.92)} ` +
    `M ${w(0.06)} ${w(0.42)} L ${w(0.94)} ${w(0.42)}`;
  return (
    <Canvas style={{ width: s, height: s }}>
      <Path path={outline}>
        <LinearGradient start={vec(0, 0)} end={vec(0, s)} colors={[TABLE, PAVILION]} />
      </Path>
      <Path path={facets} color="rgba(20,23,28,0.35)" style="stroke" strokeWidth={Math.max(0.8, s * 0.05)} />
      <Path path={outline} color={SPECULAR} style="stroke" strokeWidth={Math.max(1, s * 0.07)} />
    </Canvas>
  );
}
