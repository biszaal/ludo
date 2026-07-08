/**
 * The deep-blue game table: a vertical gradient with a faint dot grid, drawn
 * once in Skia and sized to fill its parent. Matches the Ludo Club backdrop the
 * board floats on. Purely decorative — it takes no state and is memoized on size.
 */

import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { Canvas, Circle, Group, LinearGradient, Rect, vec } from "@shopify/react-native-skia";
import { palette } from "../theme";

const DOT_SPACING = 30;
const DOT_R = 3;

/** Fills its parent; dimensions default to the full window when omitted. */
export function TableBackground({ width: w, height: h }: { width?: number; height?: number } = {}) {
  const win = useWindowDimensions();
  const width = w ?? win.width;
  const height = h ?? win.height;
  const dots = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    for (let y = DOT_SPACING / 2; y < height; y += DOT_SPACING) {
      for (let x = DOT_SPACING / 2; x < width; x += DOT_SPACING) out.push({ x, y });
    }
    return out;
  }, [width, height]);

  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width, height }}>
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient
          start={vec(width / 2, 0)}
          end={vec(width / 2, height)}
          colors={[palette.tableBlue, palette.tableBlueDeep]}
        />
      </Rect>
      <Group>
        {dots.map((d, i) => (
          <Circle key={i} cx={d.x} cy={d.y} r={DOT_R} color={palette.tableDot} />
        ))}
      </Group>
    </Canvas>
  );
}
