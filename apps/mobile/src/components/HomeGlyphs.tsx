/**
 * Drawn glyphs for the Home hub's dock, tiles and chest — pure Skia/View
 * shapes in the GearGlyph/CoinGlyph tradition. No icon fonts, no emojis.
 * All default to Muted Steel and take a `size` in px.
 */

import { View } from "react-native";
import { Canvas, Circle, Group, Path, RoundedRect } from "@shopify/react-native-skia";
import { palette } from "../theme";

/** Shop: a carrier bag — stroked handle arc behind a rounded body. */
export function BagGlyph({ size, color = palette.mutedSteel }: { size: number; color?: string }) {
  const s = size;
  return (
    <Canvas style={{ width: s, height: s }}>
      {/* Handle: upper half of a circle; its lower half hides behind the body. */}
      <Circle cx={s * 0.5} cy={s * 0.38} r={s * 0.2} color={color} style="stroke" strokeWidth={s * 0.09} />
      <RoundedRect x={s * 0.14} y={s * 0.34} width={s * 0.72} height={s * 0.56} r={s * 0.12} color={color} />
      {/* Flap crease, in the backdrop's own dark so it reads on any surface. */}
      <RoundedRect x={s * 0.14} y={s * 0.46} width={s * 0.72} height={s * 0.035} r={s * 0.02} color="rgba(0,0,0,0.35)" />
    </Canvas>
  );
}

/** Friends: two pawn silhouettes, the rear one a step back and dimmer. */
export function PeopleGlyph({ size, color = palette.mutedSteel }: { size: number; color?: string }) {
  const s = size;
  // Children take their fill from the wrapping Group's paint.
  const pawn = (cx: number, cy: number, r: number) => (
    <>
      <Circle cx={cx} cy={cy - r * 1.35} r={r * 0.62} />
      <Path
        path={`M ${cx - r} ${cy + r * 0.9} Q ${cx - r * 0.5} ${cy - r * 0.9} ${cx} ${cy - r * 0.9} Q ${cx + r * 0.5} ${cy - r * 0.9} ${cx + r} ${cy + r * 0.9} Z`}
      />
    </>
  );
  return (
    <Canvas style={{ width: s, height: s }}>
      <Group color={color} opacity={0.55}>{pawn(s * 0.66, s * 0.6, s * 0.24)}</Group>
      <Group color={color}>{pawn(s * 0.38, s * 0.66, s * 0.3)}</Group>
    </Canvas>
  );
}

/** Account: a single pawn silhouette — one person, you. */
export function UserGlyph({ size, color = palette.mutedSteel }: { size: number; color?: string }) {
  const s = size;
  const cx = s * 0.5;
  const cy = s * 0.6;
  const r = s * 0.3;
  return (
    <Canvas style={{ width: s, height: s }}>
      <Group color={color}>
        <Circle cx={cx} cy={cy - r * 1.35} r={r * 0.62} />
        <Path
          path={`M ${cx - r} ${cy + r * 0.9} Q ${cx - r * 0.5} ${cy - r * 0.9} ${cx} ${cy - r * 0.9} Q ${cx + r * 0.5} ${cy - r * 0.9} ${cx + r} ${cy + r * 0.9} Z`}
        />
      </Group>
    </Canvas>
  );
}

/** Stats: three bars at deliberately unequal heights. View-only. */
export function BarChartGlyph({ size, color = palette.mutedSteel }: { size: number; color?: string }) {
  const bar = (h: number) => (
    <View
      style={{
        width: size * 0.2,
        height: size * h,
        borderRadius: size * 0.07,
        backgroundColor: color,
      }}
    />
  );
  return (
    <View style={{ width: size, height: size, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: size * 0.1 }}>
      {bar(0.45)}
      {bar(0.9)}
      {bar(0.65)}
    </View>
  );
}

/** How to play: an open book — two mirrored pages over a center spine. */
export function BookGlyph({ size, color = palette.mutedSteel }: { size: number; color?: string }) {
  const s = size;
  return (
    <Canvas style={{ width: s, height: s }}>
      <Group origin={{ x: s * 0.31, y: s * 0.5 }} transform={[{ rotate: -0.09 }]}>
        <RoundedRect x={s * 0.1} y={s * 0.18} width={s * 0.36} height={s * 0.64} r={s * 0.06} color={color} />
      </Group>
      <Group origin={{ x: s * 0.69, y: s * 0.5 }} transform={[{ rotate: 0.09 }]}>
        <RoundedRect x={s * 0.54} y={s * 0.18} width={s * 0.36} height={s * 0.64} r={s * 0.06} color={color} />
      </Group>
      <RoundedRect x={s * 0.47} y={s * 0.14} width={s * 0.06} height={s * 0.72} r={s * 0.03} color="rgba(0,0,0,0.35)" />
    </Canvas>
  );
}

/** Pass & play: a hand-off loop — two arcs with arrowheads. */
export function CycleGlyph({ size, color = palette.mutedSteel }: { size: number; color?: string }) {
  const s = size;
  const r = s * 0.32;
  const c = s / 2;
  const sw = s * 0.1;
  return (
    <Canvas style={{ width: s, height: s }}>
      {/* Two opposing arcs (gaps at the ends for the arrowheads). */}
      <Path path={`M ${c - r} ${c} A ${r} ${r} 0 0 1 ${c + r * 0.7} ${c - r * 0.7}`} color={color} style="stroke" strokeWidth={sw} strokeCap="round" />
      <Path path={`M ${c + r} ${c} A ${r} ${r} 0 0 1 ${c - r * 0.7} ${c + r * 0.7}`} color={color} style="stroke" strokeWidth={sw} strokeCap="round" />
      {/* Arrowheads. */}
      <Path path={`M ${c + r * 0.55} ${c - r * 1.15} L ${c + r * 1.15} ${c - r * 0.55} L ${c + r * 1.2} ${c - r * 1.2} Z`} color={color} />
      <Path path={`M ${c - r * 0.55} ${c + r * 1.15} L ${c - r * 1.15} ${c + r * 0.55} L ${c - r * 1.2} ${c + r * 1.2} Z`} color={color} />
    </Canvas>
  );
}

/** Row chevron: a drawn ›  (never the text glyph). */
export function ChevronGlyph({ size, color = palette.mutedSteel }: { size: number; color?: string }) {
  const s = size;
  return (
    <Canvas style={{ width: s, height: s }}>
      <Path
        path={`M ${s * 0.35} ${s * 0.1} L ${s * 0.75} ${s * 0.5} L ${s * 0.35} ${s * 0.9}`}
        color={color}
        style="stroke"
        strokeWidth={s * 0.16}
        strokeCap="round"
        strokeJoin="round"
      />
    </Canvas>
  );
}

/** Sound effects: a speaker cone with sound arcs. */
export function SpeakerGlyph({ size, color = palette.mutedSteel }: { size: number; color?: string }) {
  const s = size;
  return (
    <Canvas style={{ width: s, height: s }}>
      <Path
        path={`M ${s * 0.12} ${s * 0.38} L ${s * 0.3} ${s * 0.38} L ${s * 0.52} ${s * 0.18} L ${s * 0.52} ${s * 0.82} L ${s * 0.3} ${s * 0.62} L ${s * 0.12} ${s * 0.62} Z`}
        color={color}
      />
      <Path path={`M ${s * 0.64} ${s * 0.36} A ${s * 0.16} ${s * 0.16} 0 0 1 ${s * 0.64} ${s * 0.64}`} color={color} style="stroke" strokeWidth={s * 0.08} strokeCap="round" />
      <Path path={`M ${s * 0.74} ${s * 0.26} A ${s * 0.3} ${s * 0.3} 0 0 1 ${s * 0.74} ${s * 0.74}`} color={color} style="stroke" strokeWidth={s * 0.08} strokeCap="round" />
    </Canvas>
  );
}

/** Music: a beamed eighth-note pair. */
export function NoteGlyph({ size, color = palette.mutedSteel }: { size: number; color?: string }) {
  const s = size;
  return (
    <Canvas style={{ width: s, height: s }}>
      <Circle cx={s * 0.3} cy={s * 0.74} r={s * 0.13} color={color} />
      <Circle cx={s * 0.72} cy={s * 0.66} r={s * 0.13} color={color} />
      <RoundedRect x={s * 0.39} y={s * 0.18} width={s * 0.06} height={s * 0.56} r={s * 0.03} color={color} />
      <RoundedRect x={s * 0.81} y={s * 0.12} width={s * 0.06} height={s * 0.54} r={s * 0.03} color={color} />
      <Path path={`M ${s * 0.39} ${s * 0.18} L ${s * 0.87} ${s * 0.12} L ${s * 0.87} ${s * 0.26} L ${s * 0.39} ${s * 0.32} Z`} color={color} />
    </Canvas>
  );
}

/** Haptics: a pulse line — flat, spike, flat. */
export function PulseGlyph({ size, color = palette.mutedSteel }: { size: number; color?: string }) {
  const s = size;
  return (
    <Canvas style={{ width: s, height: s }}>
      <Path
        path={`M ${s * 0.06} ${s * 0.5} L ${s * 0.3} ${s * 0.5} L ${s * 0.42} ${s * 0.2} L ${s * 0.58} ${s * 0.8} L ${s * 0.7} ${s * 0.5} L ${s * 0.94} ${s * 0.5}`}
        color={color}
        style="stroke"
        strokeWidth={s * 0.1}
        strokeCap="round"
        strokeJoin="round"
      />
    </Canvas>
  );
}

/** Daily bonus: a chest with a gold clasp; `open` tilts the lid back. */
export function ChestGlyph({ size, open = false, color = palette.mutedSteel }: { size: number; open?: boolean; color?: string }) {
  const s = size;
  return (
    <Canvas style={{ width: s, height: s }}>
      {/* Lid: hinged at its back-left corner when open. */}
      <Group origin={{ x: s * 0.14, y: s * 0.42 }} transform={[{ rotate: open ? -0.5 : 0 }]}>
        <RoundedRect x={s * 0.12} y={s * 0.18} width={s * 0.76} height={s * 0.28} r={s * 0.1} color={color} />
      </Group>
      {/* Base. */}
      <RoundedRect x={s * 0.14} y={s * 0.44} width={s * 0.72} height={s * 0.42} r={s * 0.08} color={color} />
      <RoundedRect x={s * 0.14} y={s * 0.44} width={s * 0.72} height={s * 0.05} r={s * 0.02} color="rgba(0,0,0,0.35)" />
      {/* Gold clasp — the CoinGlyph gold family. */}
      <Circle cx={s * 0.5} cy={s * 0.52} r={s * 0.09} color="#F5C542" />
      <Circle cx={s * 0.5} cy={s * 0.52} r={s * 0.09} color="#C8951B" style="stroke" strokeWidth={s * 0.03} />
    </Canvas>
  );
}

/** A claimed day: a tick in a filled disc. Rounded caps so it reads at 20px. */
export function CheckGlyph({
  size,
  color = palette.mutedSteel,
  discColor,
}: {
  size: number;
  color?: string;
  /** Filled backing disc; omit for a bare tick. */
  discColor?: string;
}) {
  const s = size;
  return (
    <Canvas style={{ width: s, height: s }}>
      {discColor ? <Circle cx={s * 0.5} cy={s * 0.5} r={s * 0.46} color={discColor} /> : null}
      <Path
        path={`M ${s * 0.28} ${s * 0.52} L ${s * 0.44} ${s * 0.68} L ${s * 0.73} ${s * 0.34}`}
        color={color}
        style="stroke"
        strokeWidth={s * 0.12}
        strokeCap="round"
        strokeJoin="round"
      />
    </Canvas>
  );
}
