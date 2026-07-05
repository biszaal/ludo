/**
 * Skia-drawn avatar chips — six geometric motifs across two muted palettes
 * (12 avatars). Deliberately NOT the four team colors (those stay board-only)
 * and no emojis, per DESIGN.md. Avatar ids are stable slugs stored in the
 * profile (and later the Supabase profiles table).
 */

import { Canvas, Circle, Group, Path, RoundedRect, Skia } from "@shopify/react-native-skia";

export interface AvatarSpec {
  id: string;
  /** Chip fill. */
  bg: string;
  /** Motif ink. */
  fg: string;
  motif: "orbit" | "peak" | "quad" | "wave" | "ring" | "spark";
}

// Muted gem/earth palette pairs: [bg, fg].
const DUSK: [string, string] = ["#3D4A63", "#C9D4E8"];
const MOSS: [string, string] = ["#44523B", "#D3DEC4"];
const CLAY: [string, string] = ["#6E4A3A", "#EBD5C4"];
const SAND: [string, string] = ["#8A7551", "#F1E6CB"];
const PLUM: [string, string] = ["#5A4059", "#E3CFE1"];
const TEAL: [string, string] = ["#2F5A5C", "#C4E2E0"];

export const AVATARS: AvatarSpec[] = [
  { id: "orbit-moss", bg: MOSS[0], fg: MOSS[1], motif: "orbit" },
  { id: "peak-dusk", bg: DUSK[0], fg: DUSK[1], motif: "peak" },
  { id: "quad-clay", bg: CLAY[0], fg: CLAY[1], motif: "quad" },
  { id: "wave-teal", bg: TEAL[0], fg: TEAL[1], motif: "wave" },
  { id: "ring-plum", bg: PLUM[0], fg: PLUM[1], motif: "ring" },
  { id: "spark-sand", bg: SAND[0], fg: SAND[1], motif: "spark" },
  { id: "orbit-plum", bg: PLUM[0], fg: PLUM[1], motif: "orbit" },
  { id: "peak-moss", bg: MOSS[0], fg: MOSS[1], motif: "peak" },
  { id: "quad-teal", bg: TEAL[0], fg: TEAL[1], motif: "quad" },
  { id: "wave-dusk", bg: DUSK[0], fg: DUSK[1], motif: "wave" },
  { id: "ring-sand", bg: SAND[0], fg: SAND[1], motif: "ring" },
  { id: "spark-clay", bg: CLAY[0], fg: CLAY[1], motif: "spark" },
];

export const DEFAULT_AVATAR = AVATARS[0]!;

export function avatarById(id: string | null | undefined): AvatarSpec {
  return AVATARS.find((a) => a.id === id) ?? DEFAULT_AVATAR;
}

export function AvatarGlyph({ id, size }: { id: string | null | undefined; size: number }) {
  const spec = avatarById(id);
  const c = size / 2;
  return (
    <Canvas style={{ width: size, height: size }}>
      <Circle cx={c} cy={c} r={c} color={spec.bg} />
      <Motif spec={spec} size={size} />
    </Canvas>
  );
}

function Motif({ spec, size }: { spec: AvatarSpec; size: number }) {
  const c = size / 2;
  const u = size / 10; // motif unit
  const ink = spec.fg;

  switch (spec.motif) {
    case "orbit":
      return (
        <Group>
          <Circle cx={c} cy={c} r={u * 2.6} color={ink} style="stroke" strokeWidth={u * 0.55} />
          <Circle cx={c + u * 2.6 * Math.cos(-0.9)} cy={c + u * 2.6 * Math.sin(-0.9)} r={u * 0.9} color={ink} />
        </Group>
      );
    case "peak": {
      const p = Skia.Path.Make();
      p.moveTo(c - u * 3.2, c + u * 2.2);
      p.lineTo(c - u * 0.9, c - u * 1.6);
      p.lineTo(c + u * 0.6, c + u * 0.6);
      p.lineTo(c + u * 1.8, c - u * 2.4);
      p.lineTo(c + u * 3.4, c + u * 2.2);
      p.close();
      return <Path path={p} color={ink} />;
    }
    case "quad": {
      const s = u * 1.9;
      const gap = u * 0.5;
      const x0 = c - s - gap / 2;
      const y0 = c - s - gap / 2;
      return (
        <Group>
          <RoundedRect x={x0} y={y0} width={s} height={s} r={u * 0.5} color={ink} />
          <RoundedRect x={c + gap / 2} y={y0} width={s} height={s} r={u * 0.5} color={ink} />
          <RoundedRect x={x0} y={c + gap / 2} width={s} height={s} r={u * 0.5} color={ink} />
          <RoundedRect x={c + gap / 2} y={c + gap / 2} width={s} height={s} r={u * 0.5} color={ink} opacity={0.55} />
        </Group>
      );
    }
    case "wave": {
      const p = Skia.Path.Make();
      for (let row = -1; row <= 1; row++) {
        const y = c + row * u * 1.7;
        p.moveTo(c - u * 3, y);
        p.quadTo(c - u * 1.5, y - u * 1.3, c, y);
        p.quadTo(c + u * 1.5, y + u * 1.3, c + u * 3, y);
      }
      const stroked = p.copy();
      stroked.stroke({ width: u * 0.55 });
      return <Path path={stroked} color={ink} />;
    }
    case "ring":
      return (
        <Group>
          <Circle cx={c} cy={c} r={u * 3} color={ink} style="stroke" strokeWidth={u * 0.55} />
          <Circle cx={c} cy={c} r={u * 1.4} color={ink} />
        </Group>
      );
    case "spark": {
      const p = Skia.Path.Make();
      const outer = u * 3.4;
      const inner = u * 1.1;
      for (let i = 0; i < 8; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (Math.PI * i) / 4 - Math.PI / 2;
        const x = c + Math.cos(a) * r;
        const y = c + Math.sin(a) * r;
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.close();
      return <Path path={p} color={ink} />;
    }
  }
}
