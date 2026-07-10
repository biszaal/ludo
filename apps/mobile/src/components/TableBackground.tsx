/**
 * The game table at night — this app's own backdrop (not Ludo Club's dotted
 * blue): a deep blue→charcoal gradient with a soft pool of lamplight where the
 * board sits, and the game's own iconography — safe-square stars, die pips,
 * pawn silhouettes, yard rings — woven into the felt as barely-there line
 * work, like the monogrammed baize of a card table. Drawn once in Skia and
 * sized to fill its parent; purely decorative and memoized on size.
 */

import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Circle, Group, LinearGradient, Path, RadialGradient, Rect, Skia, vec } from "@shopify/react-native-skia";
import { palette } from "../theme";

/** Staggered weave: row pitch is tighter than column pitch (hex-like packing). */
const TILE_X = 104;
const TILE_Y = 88;
/** Alternating glyph tilt, so the weave reads hand-set rather than stamped. */
const TILT = 0.24;

const STAR = starPath(9);

interface Glyph {
  x: number;
  y: number;
  /** 0 star · 1 die-five pips · 2 pawn silhouette · 3 yard ring */
  kind: number;
  rotate: number;
}

/** Fills its parent; dimensions default to the full window when omitted. */
export function TableBackground({ width: w, height: h }: { width?: number; height?: number } = {}) {
  const win = useWindowDimensions();
  const width = w ?? win.width;
  const height = h ?? win.height;

  const glyphs = useMemo(() => {
    const out: Glyph[] = [];
    let row = 0;
    for (let y = TILE_Y / 2; y < height + TILE_Y; y += TILE_Y, row++) {
      const offset = row % 2 === 0 ? TILE_X / 2 : 0;
      let col = 0;
      for (let x = offset; x < width + TILE_X; x += TILE_X, col++) {
        out.push({ x, y, kind: (row * 3 + col) % 4, rotate: (row + col) % 2 === 0 ? TILT : -TILT });
      }
    }
    return out;
  }, [width, height]);

  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width, height }}>
      {/* Night falls down the table: blue felt sinking into charcoal. */}
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient
          start={vec(width / 2, 0)}
          end={vec(width / 2, height)}
          colors={[palette.tableBlue, palette.tableBlueDeep, palette.feltCharcoal]}
          positions={[0, 0.52, 1]}
        />
      </Rect>

      {/* The game's pieces, embossed into the felt. */}
      <Group>
        {glyphs.map((g, i) => (
          <Group key={i} transform={[{ translateX: g.x }, { translateY: g.y }, { rotate: g.rotate }]}>
            {g.kind === 0 ? (
              <Path path={STAR} color={palette.tableDot} />
            ) : g.kind === 1 ? (
              <>
                {[[-5, -5], [5, -5], [0, 0], [-5, 5], [5, 5]].map(([px, py], j) => (
                  <Circle key={j} cx={px!} cy={py!} r={1.7} color={palette.tableDot} />
                ))}
              </>
            ) : g.kind === 2 ? (
              <>
                <Circle cx={0} cy={-4.5} r={3.4} color={palette.tableDot} />
                <Circle cx={0} cy={3} r={5.4} color={palette.tableDot} />
              </>
            ) : (
              <Circle cx={0} cy={0} r={6.5} color={palette.tableDot} style="stroke" strokeWidth={1.5} />
            )}
          </Group>
        ))}
      </Group>

      {/* A soft lamp pool over the board's seat; the edges fall into shadow. */}
      <Rect x={0} y={0} width={width} height={height}>
        <RadialGradient
          c={vec(width / 2, height * 0.38)}
          r={width * 0.95}
          colors={["rgba(255,255,255,0.055)", "rgba(255,255,255,0)"]}
        />
      </Rect>
    </Canvas>
  );
}

/** A 5-point star centered at the origin (the board's safe-square glyph). */
function starPath(outer: number) {
  const inner = outer * 0.45;
  const p = Skia.Path.Make();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.close();
  return p;
}
