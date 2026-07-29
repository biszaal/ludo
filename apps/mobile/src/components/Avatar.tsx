/**
 * Skia-drawn cartoon avatars — twelve Ludo Club–style characters (faces, a cat,
 * crowns/caps/headphones) on vibrant gradient chips. Drawn from SVG path data
 * scaled to size, so one definition serves list chips and the big profile
 * picker. The catalog data (ids, palette, style) lives in render/avatars.ts so
 * it stays importable without Skia; this file is just the rendering.
 */

import { useMemo } from "react";
import { Canvas, Circle, Group, LinearGradient, Oval, Path, Skia, vec } from "@shopify/react-native-skia";
import { shade } from "../theme";
import { avatarById, type AvatarSpec } from "../render/avatars";

export { AVATARS, DEFAULT_AVATAR, avatarById } from "../render/avatars";
export type { AvatarSpec, AvatarStyle } from "../render/avatars";

// --- Drawing --------------------------------------------------------------
// All geometry lives on a 100×100 canvas (matching the design mocks) and is
// scaled by a Group transform, so stroke widths scale with the chip.

type Op =
  | { t: "path"; d: string; fill: string; op?: number }
  | { t: "stroke"; d: string; color: string; w: number; op?: number; round?: boolean }
  | { t: "circle"; cx: number; cy: number; r: number; fill: string; op?: number }
  | { t: "ring"; cx: number; cy: number; r: number; color: string; w: number; op?: number }
  | { t: "oval"; cx: number; cy: number; rx: number; ry: number; fill: string; op?: number };

/** Hat/band styles hide the hairline, so brows fall back to a warm neutral. */
const NEUTRAL_BROW = "#5A4632";

export function AvatarGlyph({ id, size }: { id: string | null | undefined; size: number }) {
  const spec = avatarById(id);
  const ops = useMemo(() => buildOps(spec), [spec]);
  const clip = useMemo(() => {
    const p = Skia.Path.Make();
    p.addCircle(50, 50, 50);
    return p;
  }, []);
  const k = size / 100;

  return (
    <Canvas style={{ width: size, height: size }}>
      <Group transform={[{ scale: k }]}>
        <Group clip={clip}>
          {/* Gradient chip */}
          <Circle cx={50} cy={50} r={50}>
            <LinearGradient start={vec(50, 0)} end={vec(50, 100)} colors={[spec.bgTop, spec.bgBottom]} />
          </Circle>
          {ops.map((o, i) => (
            <OpShape key={i} o={o} />
          ))}
          {/* Top gloss */}
          <Path path="M0 0 H100 V30 Q50 46 0 30 Z" color="rgba(255,255,255,0.14)" />
        </Group>
        <Circle cx={50} cy={50} r={49} color="rgba(0,0,0,0.15)" style="stroke" strokeWidth={2} />
      </Group>
    </Canvas>
  );
}

function OpShape({ o }: { o: Op }) {
  switch (o.t) {
    case "path":
      return <Path path={o.d} color={o.fill} opacity={o.op} />;
    case "stroke":
      return <Path path={o.d} color={o.color} style="stroke" strokeWidth={o.w} strokeCap={o.round ? "round" : "butt"} strokeJoin="round" opacity={o.op} />;
    case "circle":
      return <Circle cx={o.cx} cy={o.cy} r={o.r} color={o.fill} opacity={o.op} />;
    case "ring":
      return <Circle cx={o.cx} cy={o.cy} r={o.r} color={o.color} style="stroke" strokeWidth={o.w} opacity={o.op} />;
    case "oval":
      return <Oval rect={Skia.XYWHRect(o.cx - o.rx, o.cy - o.ry, o.rx * 2, o.ry * 2)} color={o.fill} opacity={o.op} />;
  }
}

/** Full draw list for one avatar: torso, head, hair/hat, face. */
function buildOps(spec: AvatarSpec): Op[] {
  const { skin, hair, style, bgBottom } = spec;
  const ops: Op[] = [
    { t: "oval", cx: 50, cy: 102, rx: 30, ry: 20, fill: shade(bgBottom, -0.25) }, // torso
    { t: "circle", cx: 50, cy: 55, r: 26, fill: skin },
    { t: "ring", cx: 50, cy: 55, r: 26, color: "rgba(0,0,0,0.12)", w: 1.5 },
    { t: "circle", cx: 24, cy: 56, r: 5, fill: skin },
    { t: "ring", cx: 24, cy: 56, r: 5, color: "rgba(0,0,0,0.12)", w: 1.2 },
    { t: "circle", cx: 76, cy: 56, r: 5, fill: skin },
    { t: "ring", cx: 76, cy: 56, r: 5, color: "rgba(0,0,0,0.12)", w: 1.2 },
  ];

  switch (style) {
    case "crown":
      ops.push(
        { t: "path", d: "M50 24 A26 26 0 0 1 76 52 L24 52 A26 26 0 0 1 50 24 Z", fill: hair },
        { t: "path", d: "M34 22 L37 8 L45 17 L50 4 L55 17 L63 8 L66 22 Z", fill: "#FFE45C" },
        { t: "stroke", d: "M34 22 L37 8 L45 17 L50 4 L55 17 L63 8 L66 22 Z", color: "#B8770A", w: 2.5 },
        { t: "path", d: "M33.5 20 H66.5 A3.5 3.5 0 0 1 66.5 27 H33.5 A3.5 3.5 0 0 1 33.5 20 Z", fill: "#FFE45C" },
        { t: "stroke", d: "M33.5 20 H66.5 A3.5 3.5 0 0 1 66.5 27 H33.5 A3.5 3.5 0 0 1 33.5 20 Z", color: "#B8770A", w: 2.5 },
      );
      break;
    case "spiky":
      ops.push({
        t: "path",
        d: "M26 48 C24 30 34 24 38 30 L40 22 L45 29 L50 19 L55 29 L60 22 L62 30 C68 24 76 30 74 48 C66 38 34 38 26 48 Z",
        fill: hair,
      });
      break;
    case "afro":
      ops.push(
        { t: "circle", cx: 50, cy: 31, r: 19, fill: hair },
        { t: "circle", cx: 33, cy: 38, r: 10, fill: hair },
        { t: "circle", cx: 67, cy: 38, r: 10, fill: hair },
        { t: "path", d: "M26 47 A26 26 0 0 1 74 47 L74 42 A26 26 0 0 0 26 42 Z", fill: hair },
      );
      break;
    case "bun":
      ops.push(
        { t: "circle", cx: 50, cy: 22, r: 10, fill: hair },
        { t: "path", d: "M24 56 C22 34 36 27 50 27 C64 27 78 34 76 56 C74 44 66 40 50 40 C34 40 26 44 24 56 Z", fill: hair },
        { t: "ring", cx: 24, cy: 63, r: 4, color: "#F5C542", w: 2.4 },
        { t: "ring", cx: 76, cy: 63, r: 4, color: "#F5C542", w: 2.4 },
      );
      break;
    case "cap":
      ops.push(
        { t: "path", d: "M26 46 A25 25 0 0 1 74 46 L74 42 L26 42 Z", fill: hair },
        { t: "path", d: "M25 44 A25 22 0 0 1 75 44 L75 47 L25 47 Z", fill: "#D93636" },
        { t: "path", d: "M23 43 H77 A3.5 3.5 0 0 1 77 50 H23 A3.5 3.5 0 0 1 23 43 Z", fill: "#B52A2A" },
        { t: "circle", cx: 50, cy: 27, r: 4, fill: "#B52A2A" },
      );
      break;
    case "pigtails":
      ops.push(
        { t: "circle", cx: 22, cy: 40, r: 9, fill: hair },
        { t: "circle", cx: 78, cy: 40, r: 9, fill: hair },
        { t: "path", d: "M24 54 C24 32 38 26 50 26 C62 26 76 32 76 54 C70 42 62 38 50 38 C38 38 30 42 24 54 Z", fill: hair },
      );
      break;
    case "side":
      ops.push({
        t: "path",
        d: "M24 52 C24 30 40 24 54 27 C68 30 76 38 75 52 C70 40 62 40 58 34 C50 42 32 40 24 52 Z",
        fill: hair,
      });
      for (const fx of [40, 46, 54, 60]) ops.push({ t: "circle", cx: fx, cy: 63, r: 1.3, fill: "rgba(160,90,40,0.55)" });
      break;
    case "beanie":
      ops.push(
        { t: "circle", cx: 50, cy: 21, r: 6.5, fill: "#5E9E3A" },
        { t: "path", d: "M23 45 A27 25 0 0 1 77 45 Z", fill: "#4C7F2C" },
        { t: "path", d: "M22 41 H78 A4.2 4.2 0 0 1 78 49.5 H22 A4.2 4.2 0 0 1 22 41 Z", fill: "#3E6A23" },
      );
      break;
    case "headphones":
      ops.push(
        { t: "path", d: "M26 50 C26 30 42 25 50 25 C58 25 74 30 74 50 C66 36 34 36 26 50 Z", fill: hair },
        { t: "stroke", d: "M24 52 A26 26 0 0 1 76 52", color: "#2A2E39", w: 5 },
        { t: "path", d: "M19 48 H29 A5 5 0 0 1 29 62 H19 A5 5 0 0 1 19 48 Z", fill: "#2A2E39" },
        { t: "path", d: "M71 48 H81 A5 5 0 0 1 81 62 H71 A5 5 0 0 1 71 48 Z", fill: "#2A2E39" },
        { t: "path", d: "M21.5 51 H26.5 A2.5 2.5 0 0 1 26.5 59 H21.5 A2.5 2.5 0 0 1 21.5 51 Z", fill: "#4E56C9" },
        { t: "path", d: "M73.5 51 H78.5 A2.5 2.5 0 0 1 78.5 59 H73.5 A2.5 2.5 0 0 1 73.5 51 Z", fill: "#4E56C9" },
      );
      break;
    case "bow":
      ops.push(
        {
          t: "path",
          d: "M24 54 C24 32 36 26 50 26 C64 26 76 32 76 54 C72 44 64 41 58 42 C60 38 58 34 54 33 C50 40 32 42 24 54 Z",
          fill: hair,
        },
        // Bow at (66,30), rotated ~18°: two triangles + knot (pre-transformed points).
        { t: "path", d: "M66 30 L57.4 22.9 L53.7 34.3 Z", fill: "#E8386D" },
        { t: "path", d: "M66 30 L78.3 25.7 L74.6 37.1 Z", fill: "#E8386D" },
        { t: "circle", cx: 66, cy: 30, r: 3.4, fill: "#C21850" },
      );
      break;
    case "beard":
      ops.push(
        { t: "path", d: "M27 50 A25 25 0 0 1 73 50 L73 44 A25 25 0 0 0 27 44 Z", fill: hair },
        { t: "path", d: "M31 60 C31 76 40 81 50 81 C60 81 69 76 69 60 C66 70 58 72 50 72 C42 72 34 70 31 60 Z", fill: hair },
      );
      break;
    case "cat":
      ops.push(
        { t: "path", d: "M28 40 L22 20 L40 30 Z", fill: hair },
        { t: "path", d: "M72 40 L78 20 L60 30 Z", fill: hair },
        { t: "path", d: "M31 38 L27 25 L38 31 Z", fill: "#FFC9A3" },
        { t: "path", d: "M69 38 L73 25 L62 31 Z", fill: "#FFC9A3" },
        { t: "path", d: "M26 50 A26 24 0 0 1 74 50 L74 44 A26 26 0 0 0 26 44 Z", fill: hair },
      );
      break;
  }

  // Mouth (cat gets a muzzle + whiskers instead of the open smile).
  if (style === "cat") {
    ops.push(
      { t: "oval", cx: 50, cy: 66, rx: 10, ry: 7, fill: "#FFE8D6" },
      { t: "path", d: "M47 62 L53 62 L50 66 Z", fill: "#E8698A" },
      {
        t: "stroke",
        d: "M50 66 L50 69 M50 69 C48 71 46 71 45 70 M50 69 C52 71 54 71 55 70",
        color: "rgba(0,0,0,0.5)",
        w: 1.4,
        round: true,
      },
      { t: "stroke", d: "M36 62 L26 61 M36 66 L26 65 M64 62 L74 61 M64 66 L74 65", color: "rgba(0,0,0,0.35)", w: 1.3, round: true },
    );
  } else {
    ops.push({ t: "path", d: "M42 66 Q50 75 58 66 Q50 70 42 66 Z", fill: "#7A3B2E" });
  }

  // Eyes + shine.
  const eyeCy = style === "cat" ? 54 : 55;
  const eyeRy = style === "cat" ? 6.2 : 5.6;
  for (const ex of [41, 59]) {
    ops.push(
      { t: "oval", cx: ex, cy: eyeCy, rx: 4.6, ry: eyeRy, fill: "#26221E" },
      { t: "circle", cx: ex + 1.6, cy: eyeCy - 2.5, r: 1.7, fill: "#FFFFFF" },
    );
  }

  // Brows (cats skip them; hat styles use the neutral brow tone).
  if (style !== "cat") {
    const brow = style === "cap" || style === "beanie" || style === "headphones" ? NEUTRAL_BROW : hair;
    ops.push(
      { t: "stroke", d: "M36 47 Q41 44 46 47", color: brow, w: 2.2, round: true },
      { t: "stroke", d: "M54 47 Q59 44 64 47", color: brow, w: 2.2, round: true },
    );
  }

  // Blush.
  ops.push(
    { t: "oval", cx: 33, cy: 62, rx: 4.5, ry: 2.8, fill: "rgba(255,120,120,0.35)" },
    { t: "oval", cx: 67, cy: 62, rx: 4.5, ry: 2.8, fill: "rgba(255,120,120,0.35)" },
  );
  return ops;
}
