/**
 * Skia-rendered Ludo board on the dark felt table, skinned by a BoardTheme
 * (classic = the bright Ludo Club look). Pure projection of the engine
 * GameState. The static surface is memoized (size + theme); tokens are glossy
 * 3D pawns that hop cell-by-cell along their path and fan out when several
 * share a cell. Taps are captured by transparent RN overlays.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { Canvas, Circle, Group, Path, RadialGradient, RoundedRect, Skia, vec } from "@shopify/react-native-skia";
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import {
  FINISH_REL_INDEX,
  SAFE_SQUARES,
  fromRelativeIndex,
  toRelativeIndex,
  type Color as PlayerColor,
  type GameState,
  type Token,
  type TokenPosition,
} from "@ludo/engine";
import { playHop } from "../lib/sound";
import { hopTick } from "../lib/haptics";
import { shade } from "../theme";
import type { BoardTheme } from "../render/boardThemes";
import {
  HOME_CELLS,
  START_CELL_INDEX,
  TRACK_CELLS,
  YARD_BLOCKS,
  YARD_SLOTS,
  cellSize,
  tokenCenterPx,
} from "../render/boardLayout";

const COLORS: PlayerColor[] = ["red", "green", "yellow", "blue"];
const SAFE = new Set(SAFE_SQUARES);

/** Per-cell hop duration (ms). Slower = more playful, child's-game pacing. */
const HOP_STEP_MS = 175;

/**
 * One hop's sound + haptic, throttled globally. Driven from the animation's
 * landing callback (not a setTimeout), so it stays locked to the visible hop
 * regardless of JS-thread load. The throttle collapses the case where several
 * pawns land on the same frame — e.g. a move that also sends a captured pawn
 * home — into a single thock instead of a smeared overlap. HOP_STEP_MS (175) is
 * well above the gate, so genuine per-cell hops are never dropped.
 */
let lastHopAt = 0;
function hopFeedback(): void {
  const now = Date.now();
  if (now - lastHopAt < 70) return;
  lastHopAt = now;
  playHop();
  hopTick();
}

interface BoardProps {
  size: number;
  state: GameState;
  theme: BoardTheme;
  isMovable: (tokenId: string) => boolean;
  onSelectToken: (tokenId: string) => void;
  /**
   * The local player's color. The whole board is rotated so this color's yard
   * always sits bottom-left (Ludo Club style) — each player sees their own seat
   * in the same, easy-to-reach corner. Omit for a fixed default orientation.
   */
  viewColor?: PlayerColor;
}

/** Quarter-turns (90° CW) needed to bring each yard to the bottom-left. */
const VIEW_QUARTER: Record<PlayerColor, number> = { red: 3, green: 2, yellow: 1, blue: 0 };

interface Spot {
  x: number;
  y: number;
  r: number;
}

export function Board({ size, state, theme, isMovable, onSelectToken, viewColor }: BoardProps) {
  const cell = cellSize(size);
  const q = viewColor ? VIEW_QUARTER[viewColor] : 0;
  const center = size / 2;

  // Rotate a logical board point into on-screen coordinates for the current view.
  // The static surface below is rotated with the same angle, so pawns (drawn
  // upright at these points) and the board line up exactly. Taps use these too.
  const rotatePt = useCallback(
    (x: number, y: number): Spot2 => {
      if (q === 0) return { x, y };
      const dx = x - center;
      const dy = y - center;
      if (q === 1) return { x: center - dy, y: center + dx };
      if (q === 2) return { x: center - dx, y: center - dy };
      return { x: center + dy, y: center - dx }; // q === 3
    },
    [q, center],
  );

  // Theme objects are module constants, so reference equality keeps this memo effective.
  const staticBoard = useMemo(() => <BoardSurface size={size} theme={theme} />, [size, theme]);
  const layout = useMemo(() => computeLayout(state.tokens, cell), [state.tokens, cell]);

  // Remember each token's last position so a move can be animated cell-by-cell.
  const prevPos = useRef<Map<string, TokenPosition>>(new Map());
  useEffect(() => {
    const m = prevPos.current;
    for (const t of state.tokens) m.set(t.id, t.position);
  });

  const renderData = state.tokens.map((token) => {
    const spot = layout.get(token.id)!;
    const prev = prevPos.current.get(token.id);
    const waypoints = computeWaypoints(token.color, prev, token.position, spot, cell).map((p) => rotatePt(p.x, p.y));
    const rotated = rotatePt(spot.x, spot.y);
    return { token, spot: { x: rotated.x, y: rotated.y, r: spot.r }, prev, waypoints };
  });

  // How long each capturing mover takes to reach a track cell, so a captured
  // token can wait until the mover arrives before animating home.
  const moverHopMs = new Map<number, number>();
  for (const { token, prev, waypoints } of renderData) {
    if (prev && positionKey(prev) !== positionKey(token.position) && typeof token.position === "object" && token.position.type === "track") {
      moverHopMs.set(token.position.index, Math.max(moverHopMs.get(token.position.index) ?? 0, waypoints.length * HOP_STEP_MS));
    }
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 18,
        backgroundColor: theme.boardBase,
        // Lifts the board off the blue table (Ludo Club look).
        shadowColor: "#000",
        shadowOpacity: 0.4,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
        elevation: 14,
      }}
    >
      <Canvas style={{ width: size, height: size }}>
        {q === 0 ? (
          staticBoard
        ) : (
          <Group origin={{ x: center, y: center }} transform={[{ rotate: (q * Math.PI) / 2 }]}>
            {staticBoard}
          </Group>
        )}
        {renderData.map(({ token, spot, prev, waypoints }) => (
          <AnimatedPawn
            key={token.id}
            waypoints={waypoints}
            posKey={positionKey(token.position)}
            r={spot.r}
            color={theme.team[token.color]}
            stroke={theme.pawnStroke}
            movable={isMovable(token.id)}
            delay={capturedDelay(token, prev, moverHopMs)}
          />
        ))}
      </Canvas>

      {/* Single tap layer: selects the movable token NEAREST the tap, so fanned
          tokens sharing a cell are disambiguated precisely (no overlapping hit
          boxes stealing the touch). */}
      {renderData.some(({ token }) => isMovable(token.id)) && (
        <Pressable
          accessibilityLabel="Board — tap a highlighted token to move it"
          style={{ position: "absolute", left: 0, top: 0, width: size, height: size }}
          onPress={(e) => {
            const { locationX, locationY } = e.nativeEvent;
            let bestId: string | null = null;
            let bestDist = Infinity;
            for (const { token, spot } of renderData) {
              if (!isMovable(token.id)) continue;
              const dx = spot.x - locationX;
              const dy = spot.y - locationY;
              const dist = dx * dx + dy * dy;
              if (dist < bestDist) {
                bestDist = dist;
                bestId = token.id;
              }
            }
            if (bestId && Math.sqrt(bestDist) <= cell * 1.1) onSelectToken(bestId);
          }}
        />
      )}
    </View>
  );
}

// --- Static board surface -----------------------------------------------------
// Exported so previews (theme swatches, how-to-play art) can draw a board with
// no GameState. Pure Skia; safe inside any Canvas.

export function BoardSurface({ size, theme }: { size: number; theme: BoardTheme }) {
  const cell = cellSize(size);
  const startIndices = new Set(Object.values(START_CELL_INDEX));
  return (
    <Group>
      <RoundedRect x={0} y={0} width={size} height={size} r={18} color={theme.boardBase} />
      <RoundedRect x={1.5} y={1.5} width={size - 3} height={size - 3} r={16} color={theme.boardEdge} style="stroke" strokeWidth={2.5} />

      {/* Yards: solid color corner, plate-colored inner, color-ringed slots */}
      {COLORS.map((color) => {
        const b = YARD_BLOCKS[color];
        const pad = cell * 0.12;
        return (
          <Group key={`yard-${color}`}>
            <RoundedRect x={b.col * cell + pad} y={b.row * cell + pad} width={b.size * cell - pad * 2} height={b.size * cell - pad * 2} r={16} color={theme.team[color]} />
            <RoundedRect x={b.col * cell + cell * 0.9} y={b.row * cell + cell * 0.9} width={b.size * cell - cell * 1.8} height={b.size * cell - cell * 1.8} r={12} color={theme.cellFill} />
            {YARD_SLOTS[color].map(([gx, gy], i) => (
              <Group key={`slot-${color}-${i}`}>
                {/* Recessed gray disc: darker rim + gray fill (empty slot look). */}
                <Circle cx={gx * cell} cy={gy * cell} r={cell * 0.44} color={shade(theme.slotEmpty, -0.16)} />
                <Circle cx={gx * cell} cy={gy * cell} r={cell * 0.38} color={theme.slotEmpty} />
              </Group>
            ))}
          </Group>
        );
      })}

      {/* Home-column runs */}
      {COLORS.map((color) =>
        HOME_CELLS[color].map(([col, row], i) => (
          <RoundedRect key={`home-${color}-${i}`} x={col * cell + 0.5} y={row * cell + 0.5} width={cell - 1} height={cell - 1} r={2} color={theme.team[color]} />
        )),
      )}

      {/* Track cells */}
      {TRACK_CELLS.map(([col, row], idx) => {
        const isStart = startIndices.has(idx);
        const cx = (col + 0.5) * cell;
        const cy = (row + 0.5) * cell;
        return (
          <Group key={`track-${idx}`}>
            <RoundedRect x={col * cell + 0.5} y={row * cell + 0.5} width={cell - 1} height={cell - 1} r={2} color={isStart ? startColor(idx, theme) : theme.cellFill} />
            <RoundedRect x={col * cell + 0.5} y={row * cell + 0.5} width={cell - 1} height={cell - 1} r={2} color={theme.cellBorder} style="stroke" strokeWidth={1} />
            {SAFE.has(idx) && !isStart && <Path path={starPath(cx, cy, cell * 0.28, cell * 0.12)} color={theme.starColor} />}
          </Group>
        );
      })}

      {/* Center finishing triangles */}
      <Path path={triangle([6, 6], [9, 6], [7.5, 7.5], cell)} color={theme.team.green} />
      <Path path={triangle([9, 6], [9, 9], [7.5, 7.5], cell)} color={theme.team.yellow} />
      <Path path={triangle([9, 9], [6, 9], [7.5, 7.5], cell)} color={theme.team.blue} />
      <Path path={triangle([6, 9], [6, 6], [7.5, 7.5], cell)} color={theme.team.red} />
      <RoundedRect x={6 * cell} y={6 * cell} width={3 * cell} height={3 * cell} r={3} color={theme.boardEdge} style="stroke" strokeWidth={1.5} />
    </Group>
  );
}

// --- 3D animated pawn -------------------------------------------------------

interface AnimatedPawnProps {
  waypoints: Spot2[];
  posKey: string;
  r: number;
  color: string;
  stroke: string;
  movable: boolean;
  /** Wait this many ms before animating — captured tokens wait for the mover. */
  delay: number;
}

interface Spot2 {
  x: number;
  y: number;
}

function AnimatedPawn({ waypoints, posKey, r, color, stroke, movable, delay }: AnimatedPawnProps) {
  const last = waypoints[waypoints.length - 1]!;
  const tx = useSharedValue(last.x);
  const ty = useSharedValue(last.y);
  const pulse = useSharedValue(0);
  const mounted = useRef(false);
  const prevKey = useRef(posKey);
  const wpRef = useRef(waypoints);
  wpRef.current = waypoints;

  // Re-run only on a real position/spot change (not when `movable` toggles).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      prevKey.current = posKey;
      tx.value = last.x;
      ty.value = last.y;
      return;
    }
    const wps = wpRef.current;
    if (posKey !== prevKey.current) {
      prevKey.current = posKey;
      // The hop sound fires from each landing's completion callback, so it is
      // locked to the animation itself — no setTimeout drift when several pawns
      // move at once. `finished` guards against interrupted moves.
      const onLand = (finished?: boolean) => {
        "worklet";
        if (finished) runOnJS(hopFeedback)();
      };
      if (wps.length <= 1) {
        tx.value = withDelay(delay, withTiming(last.x, { duration: 240, easing: Easing.out(Easing.cubic) }));
        ty.value = withDelay(delay, withTiming(last.y, { duration: 240, easing: Easing.out(Easing.cubic) }, onLand));
      } else {
        const HOP = r * 0.5;
        tx.value = withDelay(delay, withSequence(...wps.map((p) => withTiming(p.x, { duration: HOP_STEP_MS, easing: Easing.linear }))));
        ty.value = withDelay(
          delay,
          withSequence(
            ...wps.flatMap((p) => [
              withTiming(p.y - HOP, { duration: HOP_STEP_MS / 2, easing: Easing.out(Easing.quad) }),
              withTiming(p.y, { duration: HOP_STEP_MS / 2, easing: Easing.in(Easing.quad) }, onLand),
            ]),
          ),
        );
      }
    } else {
      // Same cell, fan offset shifted (a co-located token came or went).
      tx.value = withTiming(last.x, { duration: 200 });
      ty.value = withTiming(last.y, { duration: 200 });
    }
  }, [posKey, last.x, last.y, r, delay, tx, ty]);

  useEffect(() => {
    pulse.value = movable ? withRepeat(withTiming(1, { duration: 1100 }), -1, true) : 0;
  }, [movable, pulse]);

  const transform = useDerivedValue(() => [{ translateX: tx.value }, { translateY: ty.value }]);
  const ringR = useDerivedValue(() => r * 1.18 + pulse.value * 2);

  return (
    <Group transform={transform}>
      <PawnShape r={r} color={color} stroke={stroke} />
      {movable && <Circle cx={0} cy={0} r={ringR} color="#FFFFFF" style="stroke" strokeWidth={2.5} />}
    </Group>
  );
}

/**
 * The glossy 3D pawn drawn at the origin (exported for static uses like
 * how-to-play diagrams — wrap in a translated Group to place it).
 */
export function PawnShape({ r, color, stroke }: { r: number; color: string; stroke: string }) {
  const bodyGrad = [shade(color, 0.55), color, shade(color, -0.42)];
  const headGrad = [shade(color, 0.72), shade(color, 0.12), shade(color, -0.3)];

  return (
    <Group>
      {/* Ground shadow (flattened circle) — a touch stronger for a 3D lift */}
      <Group transform={[{ translateY: r * 0.78 }, { scaleY: 0.4 }]}>
        <Circle cx={0} cy={0} r={r * 0.95} color="rgba(0,0,0,0.3)" />
      </Group>

      {/* Body */}
      <Circle cx={0} cy={r * 0.3} r={r * 0.8}>
        <RadialGradient c={vec(-r * 0.3, 0)} r={r * 1.25} colors={bodyGrad} />
      </Circle>
      <Circle cx={0} cy={r * 0.3} r={r * 0.8} color={stroke} style="stroke" strokeWidth={1.2} />

      {/* Head */}
      <Circle cx={0} cy={-r * 0.55} r={r * 0.52}>
        <RadialGradient c={vec(-r * 0.2, -r * 0.75)} r={r * 0.9} colors={headGrad} />
      </Circle>
      <Circle cx={0} cy={-r * 0.55} r={r * 0.52} color={stroke} style="stroke" strokeWidth={1.2} />

      {/* Gloss highlight */}
      <Circle cx={-r * 0.16} cy={-r * 0.72} r={r * 0.16} color="rgba(255,255,255,0.65)" />
    </Group>
  );
}

// --- Layout / geometry helpers ---------------------------------------------

/** Compute each token's pixel spot, fanning out tokens that share a cell. */
function computeLayout(tokens: Token[], cell: number): Map<string, Spot> {
  const groups = new Map<string, Token[]>();
  for (const t of tokens) {
    const key = cellKey(t);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }

  const layout = new Map<string, Spot>();
  const baseR = cell * 0.34;
  for (const group of groups.values()) {
    const n = group.length;
    group.forEach((token, i) => {
      const base = tokenCenterPx(token.color, token.position, tokenIndex(token.id), cell);
      if (n === 1) {
        layout.set(token.id, { x: base.x, y: base.y, r: baseR });
        return;
      }
      const ringR = cell * (n <= 4 ? 0.2 : 0.26);
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      const scale = n <= 2 ? 0.78 : n <= 4 ? 0.66 : 0.52;
      layout.set(token.id, {
        x: base.x + Math.cos(angle) * ringR,
        y: base.y + Math.sin(angle) * ringR,
        r: baseR * scale,
      });
    });
  }
  return layout;
}

/** Pixel waypoints from a token's previous position to its new spot, cell by cell. */
function computeWaypoints(
  color: PlayerColor,
  prev: TokenPosition | undefined,
  current: TokenPosition,
  finalSpot: Spot,
  cell: number,
): Spot2[] {
  const dest: Spot2 = { x: finalSpot.x, y: finalSpot.y };
  if (prev === undefined || prev === "home") return [dest]; // first render or leaving yard

  const oldRel = prev === "finished" ? FINISH_REL_INDEX : toRelativeIndex(color, prev);
  const newRel = current === "home" ? -1 : current === "finished" ? FINISH_REL_INDEX : toRelativeIndex(color, current);
  if (oldRel === null || newRel === null) return [dest];

  if (newRel > oldRel && newRel - oldRel <= 6) {
    const pts: Spot2[] = [];
    for (let rel = oldRel + 1; rel < newRel; rel++) {
      pts.push(tokenCenterPx(color, fromRelativeIndex(color, rel), 0, cell));
    }
    pts.push(dest);
    return pts;
  }
  return [dest];
}

/**
 * Delay (ms) before a captured token animates home: it waits until the capturing
 * mover reaches its cell. Zero for ordinary moves.
 */
function capturedDelay(token: Token, prev: TokenPosition | undefined, moverHopMs: Map<number, number>): number {
  if (prev && typeof prev === "object" && prev.type === "track" && token.position === "home") {
    return moverHopMs.get(prev.index) ?? 0;
  }
  return 0;
}

/** Tokens sharing this key occupy the same board cell and fan out. */
function cellKey(t: Token): string {
  if (t.position === "home") return `home-${t.id}`;
  if (t.position === "finished") return `fin-${t.id}`;
  if (t.position.type === "track") return `t${t.position.index}`;
  return `h${t.color}-${t.position.index}`;
}

function positionKey(p: TokenPosition): string {
  return typeof p === "string" ? p : `${p.type}${p.index}`;
}

function tokenIndex(tokenId: string): number {
  return Number(tokenId.split("-")[1] ?? 0);
}

function startColor(idx: number, theme: BoardTheme): string {
  const entry = (Object.entries(START_CELL_INDEX) as [PlayerColor, number][]).find(([, v]) => v === idx);
  return entry ? theme.team[entry[0]] : theme.cellFill;
}

/** Lighten (amt > 0) or darken (amt < 0) a #RRGGBB color toward white/black. */
function triangle(a: number[], b: number[], c: number[], cell: number) {
  const p = Skia.Path.Make();
  p.moveTo(a[0]! * cell, a[1]! * cell);
  p.lineTo(b[0]! * cell, b[1]! * cell);
  p.lineTo(c[0]! * cell, c[1]! * cell);
  p.close();
  return p;
}

function starPath(cx: number, cy: number, outer: number, inner: number, points = 5) {
  const p = Skia.Path.Make();
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.close();
  return p;
}
