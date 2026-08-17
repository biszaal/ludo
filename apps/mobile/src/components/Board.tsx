/**
 * Skia-rendered Ludo board on the dark felt table, skinned by a BoardTheme
 * (classic = the bright Ludo Club look). Pure projection of the engine
 * GameState. The static surface is memoized (size + theme); tokens are glossy
 * 3D pawns that hop cell-by-cell along their path and fan out when several
 * share a cell. Taps are captured by transparent RN overlays.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import { Canvas, Circle, Group, Line, LinearGradient, Path, RadialGradient, RoundedRect, Skia, vec } from "@shopify/react-native-skia";
import {
  cancelAnimation,
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
  SAFE_SQUARES,
  type Color as PlayerColor,
  type GameState,
  type Token,
  type TokenPosition,
} from "@ludo/engine";
import { playHop } from "../lib/sound";
import { hopTick } from "../lib/haptics";
import { FLY_MS, computeWaypoints, originsFromLastAction, walkDurationMs } from "../render/waypoints";
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

/**
 * The track grid + pawns are scaled toward the board centre by this factor, so a
 * board-coloured frame rings the whole play area — the outer cells sit clearly
 * INSIDE the plate instead of running off its rounded edge. Applied identically
 * to the drawn cells (a Skia scale in BoardSurface) and to pawn seats/waypoints
 * (in JS, so the tap layer stays aligned). 1 = no frame; lower = thicker frame.
 */
const BOARD_INTERIOR_SCALE = 0.94;
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

  // Scale a board point toward the centre so pawns land on the framed (inset)
  // cells. Rotation and this inset both pivot on the centre, so they commute —
  // pawns line up with BoardSurface's scaled interior at any view angle.
  const insetPt = useCallback(
    (x: number, y: number): Spot2 => ({ x: center + (x - center) * BOARD_INTERIOR_SCALE, y: center + (y - center) * BOARD_INTERIOR_SCALE }),
    [center],
  );

  // Extra Skia canvas room around the plate so a tall pawn (or its bob) on the
  // top row rises past the board's edge instead of being clipped. The board's
  // layout footprint stays `size`; the canvas just bleeds outward (see below).
  const pad = Math.round(cell * 0.7);

  // Theme objects are module constants, so reference equality keeps this memo effective.
  const staticBoard = useMemo(() => <BoardSurface size={size} theme={theme} />, [size, theme]);
  const layout = useMemo(() => computeLayout(state.tokens, cell), [state.tokens, cell]);

  // Where each pawn came from, read out of the state's own lastAction rather
  // than remembered across renders. See originsFromLastAction: a ref updated in
  // an effect is a cache of render history, and it only has to be wrong once —
  // wiped, or already run ahead — to flatten a move into a straight fly. This
  // derivation gives the same answer on every re-render of the same state, so
  // render order, effect timing and remounts stop being able to break it.
  const origins = useMemo(() => originsFromLastAction(state), [state]);

  const renderData = state.tokens.map((token) => {
    const spot = layout.get(token.id)!;
    const prev = origins.get(token.id);
    const walked = computeWaypoints(token.color, prev, token.position, spot, cell);
    const waypoints = walked.points.map((p) => {
      const r = rotatePt(p.x, p.y);
      return insetPt(r.x, r.y);
    });
    const rotated = rotatePt(spot.x, spot.y);
    const seat = insetPt(rotated.x, rotated.y);
    return {
      token,
      spot: { x: seat.x, y: seat.y, r: spot.r * BOARD_INTERIOR_SCALE },
      prev,
      waypoints,
      walk: walked.walk,
      stepMs: walked.stepMs,
      retrace: walked.retrace,
    };
  });

  // How long each capturing mover takes to reach a track cell, so a captured
  // token can wait until the mover arrives before starting its walk home.
  const moverHopMs = new Map<number, number>();
  for (const { token, prev } of renderData) {
    if (prev && positionKey(prev) !== positionKey(token.position) && typeof token.position === "object" && token.position.type === "track") {
      const ms = walkDurationMs(token.color, prev, token.position);
      moverHopMs.set(token.position.index, Math.max(moverHopMs.get(token.position.index) ?? 0, ms));
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
        // Let the oversized canvas (and pawns rising past the top row) draw
        // beyond this footprint instead of being clipped to it.
        overflow: "visible",
      }}
    >
      {/* Canvas bleeds `pad` past every edge (offset back by -pad) so the board
          plate still sits exactly on this View's footprint, while tall pawns get
          clear room above the top row. Everything is drawn shifted by +pad to
          compensate for the -pad offset. */}
      <Canvas style={{ position: "absolute", left: -pad, top: -pad, width: size + pad * 2, height: size + pad * 2 }}>
        <Group transform={[{ translateX: pad }, { translateY: pad }]}>
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
            .map(({ token, spot, prev, waypoints, walk, stepMs, retrace }) => (
              <AnimatedPawn
                key={token.id}
                waypoints={waypoints}
                walk={walk}
                stepMs={stepMs}
                retrace={retrace}
                posKey={positionKey(token.position)}
                r={spot.r}
                color={theme.team[token.color]}
                stroke={theme.pawnStroke}
                delay={capturedDelay(token, prev, moverHopMs)}
                movable={isMovable(token.id)}
                phase={tokenIndex(token.id) % 4}
              />
            ))}
        </Group>
      </Canvas>

      {/* The tap-me cue lives inside each movable pawn now (a gentle vertical
          bob + squashing ground shadow, in AnimatedPawn) — it rides the same
          cheap Skia transform path the hop uses, so no compositor overlay and
          no picture re-record. */}

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
  const center = size / 2;
  return (
    <Group>
      {/* Plate: vertical light-to-dark wash + bevel (outer edge, inner light lip).
          The plate fills the full footprint; the track interior below is scaled
          in (BOARD_INTERIOR_SCALE) so a board-coloured frame rings the cells. */}
      <RoundedRect x={0} y={0} width={size} height={size} r={18}>
        <LinearGradient start={vec(0, 0)} end={vec(0, size)} colors={[shade(theme.boardBase, 0.02), shade(theme.boardBase, -0.07)]} />
      </RoundedRect>
      <RoundedRect x={1.5} y={1.5} width={size - 3} height={size - 3} r={16} color={theme.boardEdge} style="stroke" strokeWidth={2.5} />
      <RoundedRect x={4} y={4} width={size - 8} height={size - 8} r={14} color="rgba(255,255,255,0.5)" style="stroke" strokeWidth={1.5} />

      <Group origin={{ x: center, y: center }} transform={[{ scale: BOARD_INTERIOR_SCALE }]}>

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
      </Group>

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
  /** True for a walkable move — hop cell-by-cell even for one cell. */
  walk: boolean;
  /** Duration of each step. Forward moves are leisurely; a capture retrace is
   *  a fast scurry, since it can cover the whole lap back to the yard. */
  stepMs: number;
  /** This walk is a captured pawn's trip home: it glides the route as one
   *  continuous slide rather than hopping it, and sounds one thock on arrival
   *  instead of 50. */
  retrace: boolean;
  posKey: string;
  r: number;
  color: string;
  stroke: string;
  /** Wait this many ms before animating — captured tokens wait for the mover. */
  delay: number;
  /** True while this pawn is a legal move this turn — shows the bob + shadow cue. */
  movable: boolean;
  /** 0–3 stagger bucket so co-located movable pawns don't bob in lockstep. */
  phase: number;
}

interface Spot2 {
  x: number;
  y: number;
}

function AnimatedPawn({ waypoints, walk, stepMs, retrace, posKey, r, color, stroke, delay, movable, phase }: AnimatedPawnProps) {
  const last = waypoints[waypoints.length - 1]!;
  const tx = useSharedValue(last.x);
  const ty = useSharedValue(last.y);
  // The "tap me" cue: `bob` yo-yos 0→1 forever; `cue` fades the whole effect
  // (lift + shadow) in and out with `movable` so it never pops on/off.
  const bob = useSharedValue(0);
  const cue = useSharedValue(0);
  const mounted = useRef(false);
  const prevKey = useRef(posKey);
  const prevSpot = useRef(last);
  // Latch the animation intent for THIS posKey the first time we see it. The
  // render that first detects a position change still holds the true `prev`
  // (a captured pawn's last track cell), so its retrace waypoints are correct.
  // A later re-render for the SAME posKey recomputes prev = current and would
  // flatten the walk into a straight fly — the "captured pawn teleports home"
  // bug. Keying by posKey preserves the cell-by-cell intent even if React
  // defers this effect until after that recompute.
  const intentKey = useRef(posKey);
  const intent = useRef({ waypoints, walk, stepMs, retrace, delay });
  if (posKey !== intentKey.current) {
    intentKey.current = posKey;
    intent.current = { waypoints, walk, stepMs, retrace, delay };
  }

  // Animate ONLY on a real position/spot change. Everything else (re-renders
  // from toasts, highlight toggles, unrelated store writes) must leave the
  // running animation alone — a captured token sits waiting out `delay` while
  // its mover walks over, and that wait must survive intermediate renders
  // (whose recomputed props would otherwise re-trigger this effect and cut the
  // choreography short).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      prevKey.current = posKey;
      prevSpot.current = last;
      tx.value = last.x;
      ty.value = last.y;
      return;
    }
    if (posKey !== prevKey.current) {
      prevKey.current = posKey;
      prevSpot.current = last;
      const { waypoints: wps, walk: doWalk, stepMs: step, retrace: isRetrace, delay: startDelay } = intent.current;
      const target = wps[wps.length - 1]!;
      // The hop sound fires from each landing's completion callback, so it is
      // locked to the animation itself — no setTimeout drift when several pawns
      // move at once. `finished` guards against interrupted moves.
      const onLand = (finished?: boolean) => {
        "worklet";
        if (finished) runOnJS(hopFeedback)();
      };
      // A retrace can cross 50 cells; thocking each one is a machine-gun. Only
      // the arrival in the yard sounds.
      const silent = () => {
        "worklet";
      };
      if (!doWalk) {
        tx.value = withDelay(startDelay, withTiming(target.x, { duration: FLY_MS, easing: Easing.out(Easing.cubic) }));
        ty.value = withDelay(startDelay, withTiming(target.y, { duration: FLY_MS, easing: Easing.out(Easing.cubic) }, onLand));
      } else {
        const lastIndex = wps.length - 1;
        tx.value = withDelay(startDelay, withSequence(...wps.map((p) => withTiming(p.x, { duration: step, easing: Easing.linear }))));
        ty.value = withDelay(
          startDelay,
          isRetrace
            ? // A captured pawn glides its route home instead of hopping it. Both
              // axes run linearly through the same cells, so the pawn tracks the
              // path as one continuous slide — including around the board's
              // corners — rather than bouncing 50 times on the way back. Only the
              // cell list and the step duration decide the route, so the trip
              // still takes exactly as long as it did (walkDurationMs is
              // unchanged) and still lands on the same frame.
              withSequence(
                ...wps.map((p, i) =>
                  withTiming(
                    p.y,
                    { duration: step, easing: Easing.linear },
                    i < lastIndex ? silent : onLand,
                  ),
                ),
              )
            : // Forward moves keep the hop — it is the move's whole character.
              withSequence(
                ...wps.flatMap((p) => [
                  withTiming(p.y - r * 0.5, { duration: step / 2, easing: Easing.out(Easing.quad) }),
                  withTiming(p.y, { duration: step / 2, easing: Easing.in(Easing.quad) }, onLand),
                ]),
              ),
        );
      }
    } else if (last.x !== prevSpot.current.x || last.y !== prevSpot.current.y) {
      // Same cell, fan offset shifted (a co-located token came or went).
      prevSpot.current = last;
      tx.value = withTiming(last.x, { duration: 200 });
      ty.value = withTiming(last.y, { duration: 200 });
    }
  }, [posKey, last.x, last.y, tx, ty]);

  // Drive the bob only while this pawn is a legal move. It's a transform-only
  // animation on the Skia Group (the same cheap path the hop uses), so an idle
  // board's picture is still never re-recorded — only the matrix re-submits.
  // The `phase` delay staggers co-located movers so they don't bob in lockstep.
  useEffect(() => {
    if (movable) {
      // Reset to 0 FIRST: withRepeat(reverse) yoyos between the value at start
      // and 1, so a bob frozen mid-cycle from a previous turn would otherwise
      // give a short (or, if frozen at ~1, invisible) bounce. Starting from 0
      // guarantees every mover swings the identical full 0→1→0 amplitude.
      cancelAnimation(bob);
      bob.value = 0;
      cue.value = withTiming(1, { duration: 200 });
      bob.value = withDelay(phase * 80, withRepeat(withTiming(1, { duration: 650, easing: Easing.inOut(Easing.sin) }), -1, true));
    } else {
      // Freeze bob where it is (don't reset here) and let `cue` fade to 0 so the
      // lift eases down smoothly. The next activation resets bob to 0 itself.
      cancelAnimation(bob);
      cue.value = withTiming(0, { duration: 200 });
    }
    return () => {
      cancelAnimation(bob);
      cancelAnimation(cue);
    };
  }, [movable, phase, bob, cue]);

  // Pawn: hop/fly position (tx/ty) plus the cued vertical lift.
  const transform = useDerivedValue(() => [{ translateX: tx.value }, { translateY: ty.value - bob.value * cue.value * (r * 0.4) }]);

  // Ground shadow: sits at the pawn's foot (not lifted), squashed into an
  // ellipse, and shrinks + fades a touch as the pawn rises.
  const shadowTransform = useDerivedValue(() => {
    const s = 1 - bob.value * cue.value * 0.18;
    return [{ translateX: tx.value }, { translateY: ty.value + r * 0.5 }, { scaleX: s }, { scaleY: 0.32 * s }];
  });
  const shadowOpacity = useDerivedValue(() => cue.value * (1 - bob.value * cue.value * 0.4));

  return (
    <Group>
      <Group transform={shadowTransform} opacity={shadowOpacity}>
        <Circle cx={0} cy={0} r={r * 0.95}>
          <RadialGradient c={vec(0, 0)} r={r * 0.95} colors={["rgba(9,12,16,0.55)", "rgba(9,12,16,0)"]} />
        </Circle>
      </Group>
      <Group transform={transform}>
        <PawnShape r={r} color={color} stroke={stroke} />
      </Group>
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

/**
 * Delay (ms) before a captured token starts walking home: it waits until the
 * capturing mover reaches its cell. Zero for ordinary moves.
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
