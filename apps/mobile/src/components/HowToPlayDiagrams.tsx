/**
 * Small Skia illustrations for the How-to-play screen, drawn in the player's
 * selected board theme so the guide matches their game. Each diagram renders
 * into a fixed-height transparent canvas placed on a Raised Slate card.
 */

import { Canvas, Circle, Group, Path, RoundedRect, Skia } from "@shopify/react-native-skia";
import { BoardSurface, PawnShape } from "./Board";
import type { BoardTheme } from "../render/boardThemes";
import { palette } from "../theme";

export const DIAGRAM_HEIGHT = 120;

interface DiagramProps {
  width: number;
  theme: BoardTheme;
}

// --- Shared bits --------------------------------------------------------------

const CELL = 34;

function cellsRow(x: number, y: number, n: number, theme: BoardTheme, highlight?: Record<number, string>) {
  return Array.from({ length: n }, (_unused, i) => (
    <Group key={`cell-${i}`}>
      <RoundedRect x={x + i * CELL} y={y} width={CELL - 1} height={CELL - 1} r={3} color={highlight?.[i] ?? theme.cellFill} />
      <RoundedRect x={x + i * CELL} y={y} width={CELL - 1} height={CELL - 1} r={3} color={theme.cellBorder} style="stroke" strokeWidth={1} />
    </Group>
  ));
}

function pawnAt(x: number, y: number, r: number, color: string, theme: BoardTheme) {
  return (
    <Group transform={[{ translateX: x }, { translateY: y }]}>
      <PawnShape r={r} color={color} stroke={theme.pawnStroke} />
    </Group>
  );
}

function arrow(fromX: number, fromY: number, toX: number, toY: number, color: string, curve = 0) {
  const p = Skia.Path.Make();
  p.moveTo(fromX, fromY);
  const mx = (fromX + toX) / 2;
  const my = (fromY + toY) / 2 - curve;
  p.quadTo(mx, my, toX, toY);
  const stroked = p.copy();
  stroked.stroke({ width: 2.5 });

  // Arrowhead oriented along the end tangent.
  const angle = Math.atan2(toY - my, toX - mx);
  const head = Skia.Path.Make();
  const size = 9;
  head.moveTo(toX, toY);
  head.lineTo(toX - size * Math.cos(angle - 0.5), toY - size * Math.sin(angle - 0.5));
  head.lineTo(toX - size * Math.cos(angle + 0.5), toY - size * Math.sin(angle + 0.5));
  head.close();

  return (
    <Group>
      <Path path={stroked} color={color} />
      <Path path={head} color={color} />
    </Group>
  );
}

function star(cx: number, cy: number, outer: number, inner: number, color: string) {
  const p = Skia.Path.Make();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / 5 - Math.PI / 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.close();
  return <Path path={p} color={color} />;
}

function die(x: number, y: number, size: number, value: number, theme: BoardTheme) {
  const PIPS: Record<number, [number, number][]> = {
    6: [
      [0.28, 0.24],
      [0.72, 0.24],
      [0.28, 0.5],
      [0.72, 0.5],
      [0.28, 0.76],
      [0.72, 0.76],
    ],
    1: [[0.5, 0.5]],
  };
  return (
    <Group>
      <RoundedRect x={x} y={y} width={size} height={size} r={size * 0.22} color={theme.dice.face} />
      <RoundedRect x={x} y={y} width={size} height={size} r={size * 0.22} color={palette.hairline} style="stroke" strokeWidth={1.5} />
      {(PIPS[value] ?? PIPS[1]!).map(([px, py], i) => (
        <Circle key={i} cx={x + px! * size} cy={y + py! * size} r={size * 0.08} color={theme.dice.pip} />
      ))}
    </Group>
  );
}

// --- Diagrams -------------------------------------------------------------------

/** The full board at a glance. */
export function ObjectiveDiagram({ width, theme }: DiagramProps) {
  const size = DIAGRAM_HEIGHT - 10;
  return (
    <Canvas style={{ width, height: DIAGRAM_HEIGHT }}>
      <Group transform={[{ translateX: (width - size) / 2 }, { translateY: 5 }]}>
        <BoardSurface size={size} theme={theme} />
      </Group>
    </Canvas>
  );
}

/** A six frees a pawn from its yard. */
export function RollSixDiagram({ width, theme }: DiagramProps) {
  const cy = DIAGRAM_HEIGHT / 2;
  const yardX = width * 0.62;
  const outX = width * 0.86;
  return (
    <Canvas style={{ width, height: DIAGRAM_HEIGHT }}>
      {die(width * 0.14, cy - 24, 48, 6, theme)}
      {/* Yard slot with a waiting pawn */}
      <Circle cx={yardX} cy={cy} r={22} color={theme.team.red} />
      <Circle cx={yardX} cy={cy} r={18} color={theme.cellFill} />
      {pawnAt(yardX, cy, 12, theme.team.red, theme)}
      {arrow(yardX + 26, cy - 14, outX, cy - 22, palette.mutedSteel, 18)}
      {cellsRow(outX - CELL / 2, cy - 6, 1, theme, { 0: theme.team.red })}
    </Canvas>
  );
}

/** Landing on an opponent sends them home. */
export function CaptureDiagram({ width, theme }: DiagramProps) {
  const y = DIAGRAM_HEIGHT / 2 - CELL / 2 + 8;
  const rowW = CELL * 5;
  const x0 = (width - rowW) / 2;
  const midX = x0 + CELL * 2 + CELL / 2;
  const yardX = width * 0.87;
  const yardY = 22;
  return (
    <Canvas style={{ width, height: DIAGRAM_HEIGHT }}>
      {cellsRow(x0, y, 5, theme)}
      {pawnAt(x0 + CELL / 2, y + CELL / 2 - 4, 11, theme.team.red, theme)}
      {arrow(x0 + CELL, y - 8, midX - 8, y - 2, palette.mutedSteel, 20)}
      {pawnAt(midX, y + CELL / 2 - 4, 11, theme.team.green, theme)}
      {/* Captured pawn returns to its yard */}
      <Circle cx={yardX} cy={yardY} r={13} color={theme.team.green} />
      <Circle cx={yardX} cy={yardY} r={10} color={theme.cellFill} />
      {arrow(midX + 14, y - 2, yardX - 12, yardY + 8, theme.team.green, 26)}
    </Canvas>
  );
}

/** Starred squares are safe — no captures there. */
export function SafeSquareDiagram({ width, theme }: DiagramProps) {
  const y = DIAGRAM_HEIGHT / 2 - CELL / 2;
  const rowW = CELL * 3;
  const x0 = (width - rowW) / 2;
  const midX = x0 + CELL + CELL / 2;
  return (
    <Canvas style={{ width, height: DIAGRAM_HEIGHT }}>
      {cellsRow(x0, y, 3, theme)}
      {star(midX, y + CELL / 2, CELL * 0.34, CELL * 0.15, theme.starColor)}
      {pawnAt(midX - 8, y + CELL / 2 - 2, 9, theme.team.red, theme)}
      {pawnAt(midX + 8, y + CELL / 2 - 2, 9, theme.team.green, theme)}
    </Canvas>
  );
}

/** The colored home run leads to the center. */
export function HomeColumnDiagram({ width, theme }: DiagramProps) {
  const y = DIAGRAM_HEIGHT / 2 - CELL / 2;
  const rowW = CELL * 5 + 30;
  const x0 = (width - rowW) / 2;
  const triX = x0 + CELL * 5 + 4;
  const tri = Skia.Path.Make();
  tri.moveTo(triX, y - 6);
  tri.lineTo(triX + 30, y + CELL / 2);
  tri.lineTo(triX, y + CELL + 5);
  tri.close();
  return (
    <Canvas style={{ width, height: DIAGRAM_HEIGHT }}>
      {cellsRow(x0, y, 5, theme, { 0: theme.team.red, 1: theme.team.red, 2: theme.team.red, 3: theme.team.red, 4: theme.team.red })}
      <Path path={tri} color={theme.team.red} />
      {pawnAt(x0 + CELL * 2 + CELL / 2, y + CELL / 2 - 4, 11, theme.team.red, theme)}
    </Canvas>
  );
}

/** First to bring all four pawns home wins. */
export function WinDiagram({ width, theme }: DiagramProps) {
  const baseY = DIAGRAM_HEIGHT - 22;
  const cx = width / 2;
  const stepW = 58;
  return (
    <Canvas style={{ width, height: DIAGRAM_HEIGHT }}>
      {/* Podium */}
      <RoundedRect x={cx - stepW * 1.5 - 6} y={baseY - 26} width={stepW} height={26} r={6} color={palette.liftedSlate} />
      <RoundedRect x={cx - stepW / 2} y={baseY - 44} width={stepW} height={44} r={6} color={palette.liftedSlate} />
      <RoundedRect x={cx + stepW / 2 + 6} y={baseY - 18} width={stepW} height={18} r={6} color={palette.liftedSlate} />
      {pawnAt(cx - stepW - 6, baseY - 40, 12, theme.team.green, theme)}
      {pawnAt(cx, baseY - 60, 14, theme.team.red, theme)}
      {pawnAt(cx + stepW + 6, baseY - 32, 12, theme.team.blue, theme)}
      {star(cx, 20, 11, 4.5, theme.team.yellow)}
    </Canvas>
  );
}
