/**
 * Skia-rendered Ludo board on the dark felt table, skinned by a BoardTheme
 * (classic = the bright Ludo Club look). Pure projection of the engine
 * GameState. The static surface is memoized (size + theme); tokens are glossy
 * 3D pawns that hop cell-by-cell along their path and fan out when several
 * share a cell. Taps are captured by transparent RN overlays.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { Canvas, Circle, Group, Line, LinearGradient, Oval, Path, RadialGradient, RoundedRect, Skia, vec } from "@shopify/react-native-skia";
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
import { FLY_MS, HOP_STEP_MS } from "../lib/moveTiming";
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
// Hop/fly durations live in lib/moveTiming: feedback.ts mirrors them so landing
// sounds (capture, safe chime) fire when the pawn arrives, not when state lands.

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
        {/* Painter's order: pawns lower on screen draw over the ones above, so
            a tall piece overlapping the cell behind it reads as standing depth. */}
        {[...renderData]
          .sort((a, b) => a.spot.y - b.spot.y)
          .map(({ token, spot, prev, waypoints }) => (
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
      {/* Plate: vertical light-to-dark wash + bevel (outer edge, inner light lip). */}
      <RoundedRect x={0} y={0} width={size} height={size} r={18}>
        <LinearGradient start={vec(0, 0)} end={vec(0, size)} colors={[shade(theme.boardBase, 0.02), shade(theme.boardBase, -0.07)]} />
      </RoundedRect>
      <RoundedRect x={1.5} y={1.5} width={size - 3} height={size - 3} r={16} color={theme.boardEdge} style="stroke" strokeWidth={2.5} />
      <RoundedRect x={4} y={4} width={size - 8} height={size - 8} r={14} color="rgba(255,255,255,0.5)" style="stroke" strokeWidth={1.5} />

      {/* Yards: raised gradient tile (drop shadow + top lip), inset inner plate,
          and recessed slot discs ringed in the team color. */}
      {COLORS.map((color) => {
        const b = YARD_BLOCKS[color];
        const team = theme.team[color];
        const pad = cell * 0.12;
        const x = b.col * cell + pad;
        const y = b.row * cell + pad;
        const w = b.size * cell - pad * 2;
        const ix = b.col * cell + cell * 0.9;
        const iy = b.row * cell + cell * 0.9;
        const iw = b.size * cell - cell * 1.8;
        return (
          <Group key={`yard-${color}`}>
            <RoundedRect x={x} y={y + 3} width={w} height={w} r={16} color="rgba(0,0,0,0.18)" />
            <RoundedRect x={x} y={y} width={w} height={w} r={16}>
              <LinearGradient start={vec(x, y)} end={vec(x, y + w)} colors={[shade(team, 0.22), team, shade(team, -0.18)]} positions={[0, 0.55, 1]} />
            </RoundedRect>
            <RoundedRect x={x + 1.5} y={y + 1.5} width={w - 3} height={w - 3} r={14} color="rgba(255,255,255,0.35)" style="stroke" strokeWidth={2} />
            <RoundedRect x={ix} y={iy} width={iw} height={iw} r={12} color={theme.cellFill} />
            <RoundedRect x={ix} y={iy} width={iw} height={iw} r={12} color={shade(team, -0.3)} opacity={0.35} style="stroke" strokeWidth={1.5} />
            {YARD_SLOTS[color].map(([gx, gy], i) => {
              const cx = gx * cell;
              const cy = gy * cell;
              const r = cell * 0.38;
              return (
                <Group key={`slot-${color}-${i}`}>
                  <Circle cx={cx} cy={cy} r={cell * 0.44} color={shade(theme.slotEmpty, -0.22)} />
                  <Circle cx={cx} cy={cy} r={r}>
                    <RadialGradient c={vec(cx, cy - r * 0.3)} r={r * 1.6} colors={[shade(theme.slotEmpty, -0.14), shade(theme.slotEmpty, 0.1)]} />
                  </Circle>
                  {/* Inner-shadow crescent along the top — reads as a recess. */}
                  <Path path={topArc(cx, cy, r)} color="rgba(0,0,0,0.18)" style="stroke" strokeWidth={3} />
                  <Circle cx={cx} cy={cy} r={cell * 0.44} color={shade(team, -0.12)} opacity={0.5} style="stroke" strokeWidth={1.5} />
                </Group>
              );
            })}
          </Group>
        );
      })}

      {/* Home-column runs: gradient colored path cells */}
      {COLORS.map((color) =>
        HOME_CELLS[color].map(([col, row], i) => (
          <ColorCell key={`home-${color}-${i}`} x={col * cell} y={row * cell} cell={cell} team={theme.team[color]} />
        )),
      )}

      {/* Track cells: plain cells get a subtle emboss (light top / dark bottom
          hairline); start cells are colored like the path with a white star. */}
      {TRACK_CELLS.map(([col, row], idx) => {
        const isStart = startIndices.has(idx);
        const cx = (col + 0.5) * cell;
        const cy = (row + 0.5) * cell;
        if (isStart) {
          return (
            <Group key={`track-${idx}`}>
              <ColorCell x={col * cell} y={row * cell} cell={cell} team={startColor(idx, theme)} />
              <Path path={starPath(cx, cy, cell * 0.3, cell * 0.13)} color="rgba(255,255,255,0.9)" />
            </Group>
          );
        }
        const g = cellInset(cell);
        return (
          <Group key={`track-${idx}`}>
            <RoundedRect x={col * cell + g} y={row * cell + g} width={cell - g * 2} height={cell - g * 2} r={2} color={theme.cellFill} />
            <RoundedRect x={col * cell + g} y={row * cell + g} width={cell - g * 2} height={cell - g * 2} r={2} color={theme.cellBorder} style="stroke" strokeWidth={1} />
            <Line p1={vec(col * cell + g + 2.5, row * cell + g + 1.1)} p2={vec(col * cell + cell - g - 2.5, row * cell + g + 1.1)} color="rgba(255,255,255,0.75)" strokeWidth={1.2} />
            <Line p1={vec(col * cell + g + 2.5, row * cell + cell - g - 1.1)} p2={vec(col * cell + cell - g - 2.5, row * cell + cell - g - 1.1)} color="rgba(0,0,0,0.06)" strokeWidth={1.2} />
            {SAFE.has(idx) && <Path path={starPath(cx, cy, cell * 0.28, cell * 0.12)} color={theme.starColor} />}
          </Group>
        );
      })}

      {/* Center finishing triangles: soft drop shadow, gradient wedges, white seams */}
      <RoundedRect x={6 * cell - 2} y={6 * cell + 2} width={3 * cell + 4} height={3 * cell + 4} r={4} color="rgba(0,0,0,0.15)" />
      {(
        [
          ["green", [6, 6], [9, 6]],
          ["yellow", [9, 6], [9, 9]],
          ["blue", [9, 9], [6, 9]],
          ["red", [6, 9], [6, 6]],
        ] as const
      ).map(([color, a, b]) => (
        <Group key={`center-${color}`}>
          <Path path={triangle([a[0], a[1]], [b[0], b[1]], [7.5, 7.5], cell)}>
            <LinearGradient
              start={vec(7.5 * cell, 6 * cell)}
              end={vec(7.5 * cell, 9 * cell)}
              colors={[shade(theme.team[color], 0.22), theme.team[color], shade(theme.team[color], -0.18)]}
              positions={[0, 0.55, 1]}
            />
          </Path>
          <Path path={triangle([a[0], a[1]], [b[0], b[1]], [7.5, 7.5], cell)} color="rgba(255,255,255,0.5)" style="stroke" strokeWidth={1} />
        </Group>
      ))}
      <RoundedRect x={6 * cell} y={6 * cell} width={3 * cell} height={3 * cell} r={3} color={theme.boardEdge} style="stroke" strokeWidth={1.5} />

      {/* Soft diagonal sheen over the whole plate (plastic-board gloss). */}
      <Path path={`M 0 0 L ${size} 0 L 0 ${size * 0.55} Z`} color="rgba(255,255,255,0.05)" />
    </Group>
  );
}

/** A colored path cell (home runs + start cells): vertical gradient + tonal edge. */
function ColorCell({ x, y, cell, team }: { x: number; y: number; cell: number; team: string }) {
  const g = cellInset(cell);
  return (
    <Group>
      <RoundedRect x={x + g} y={y + g} width={cell - g * 2} height={cell - g * 2} r={2}>
        <LinearGradient start={vec(x, y)} end={vec(x, y + cell)} colors={[shade(team, 0.16), shade(team, -0.1)]} />
      </RoundedRect>
      <RoundedRect x={x + g} y={y + g} width={cell - g * 2} height={cell - g * 2} r={2} color={shade(team, -0.25)} opacity={0.4} style="stroke" strokeWidth={1} />
    </Group>
  );
}

/**
 * Gap between a cell's edge and its tile, scaled with the board so the plate
 * color shows through as "grout" at every size — this is what makes Night /
 * Walnut / Sand actually read as their plate color in-game, exactly like the
 * Settings thumbnails (which render this same surface small, where the gaps
 * are proportionally huge).
 */
function cellInset(cell: number): number {
  return Math.max(0.5, cell * 0.045);
}

/** Stroke path along a circle's top half — the slot recess's inner shadow. */
function topArc(cx: number, cy: number, r: number) {
  const p = Skia.Path.Make();
  p.addArc(Skia.XYWHRect(cx - r, cy - r, r * 2, r * 2), 180, 180);
  return p;
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
        tx.value = withDelay(delay, withTiming(last.x, { duration: FLY_MS, easing: Easing.out(Easing.cubic) }));
        ty.value = withDelay(delay, withTiming(last.y, { duration: FLY_MS, easing: Easing.out(Easing.cubic) }, onLand));
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

  // Movable pawns pulsate — a gentle scale breath plus a white ground ring
  // around the base (the piece stands inside it).
  const transform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: 1 + pulse.value * 0.12 },
  ]);
  const ringRect = useDerivedValue(() => {
    const rw = r * 1.06 + pulse.value * 2.5;
    const rh = rw * 0.4;
    return Skia.XYWHRect(-rw, r * 0.45 - rh, rw * 2, rh * 2);
  });

  return (
    <Group transform={transform}>
      {movable && <Oval rect={ringRect} color="#FFFFFF" style="stroke" strokeWidth={2.5} />}
      <PawnShape r={r} color={color} stroke={stroke} />
    </Group>
  );
}

/**
 * The glossy 3D pawn drawn at the origin (exported for static uses like
 * how-to-play diagrams — wrap in a translated Group to place it).
 *
 * Ludo Club-style standing piece: the base disc sits on the cell (origin ≈
 * cell center) and the tapered body + ball head rise ~1.6r above it, tall
 * enough to overlap the cell behind — the pieces read as standing ON the
 * board, not printed in the squares.
 */
export function PawnShape({ r, color, stroke }: { r: number; color: string; stroke: string }) {
  const bodyGrad = [shade(color, 0.55), color, shade(color, -0.45)];
  const headGrad = [shade(color, 0.72), shade(color, 0.12), shade(color, -0.3)];

  // Base-and-body silhouette: elliptical foot bulging to ±0.70r, sides pulling
  // in to a 0.20r-wide neck at -0.62r (the head sphere sits above it).
  const body = useMemo(() => {
    const p = Skia.Path.Make();
    p.moveTo(-0.7 * r, 0.42 * r);
    p.quadTo(0, 0.7 * r, 0.7 * r, 0.42 * r); // foot underside
    p.quadTo(0.72 * r, 0.16 * r, 0.5 * r, 0.02 * r); // foot shoulder
    p.quadTo(0.24 * r, -0.18 * r, 0.2 * r, -0.62 * r); // taper to neck
    p.lineTo(-0.2 * r, -0.62 * r);
    p.quadTo(-0.24 * r, -0.18 * r, -0.5 * r, 0.02 * r);
    p.quadTo(-0.72 * r, 0.16 * r, -0.7 * r, 0.42 * r);
    p.close();
    return p;
  }, [r]);

  return (
    <Group>
      {/* Ground shadow under the foot — sells the lift off the cell */}
      <Group transform={[{ translateY: r * 0.5 }, { scaleY: 0.36 }]}>
        <Circle cx={0} cy={0} r={r * 0.92} color="rgba(0,0,0,0.32)" />
      </Group>

      {/* Foot + tapered body */}
      <Path path={body}>
        <RadialGradient c={vec(-r * 0.35, -r * 0.15)} r={r * 1.7} colors={bodyGrad} />
      </Path>
      <Path path={body} color={stroke} style="stroke" strokeWidth={1.2} />

      {/* Collar where the neck meets the head */}
      <Group transform={[{ translateY: -r * 0.62 }, { scaleY: 0.4 }]}>
        <Circle cx={0} cy={0} r={r * 0.34} color={shade(color, -0.2)} />
      </Group>

      {/* Head */}
      <Circle cx={0} cy={-r * 1.08} r={r * 0.46}>
        <RadialGradient c={vec(-r * 0.18, -r * 1.26)} r={r * 0.8} colors={headGrad} />
      </Circle>
      <Circle cx={0} cy={-r * 1.08} r={r * 0.46} color={stroke} style="stroke" strokeWidth={1.2} />

      {/* Gloss highlight */}
      <Circle cx={-r * 0.14} cy={-r * 1.22} r={r * 0.14} color="rgba(255,255,255,0.65)" />
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
  // Sized so the standing pawn (≈2.2r tall) clearly overtops its cell.
  const baseR = cell * 0.4;
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
