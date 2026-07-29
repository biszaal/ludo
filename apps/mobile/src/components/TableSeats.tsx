/**
 * A miniature of the table with a seat pad at each corner — the shared picture
 * of "who is sitting where" for both the quick-match table picker (static, all
 * seats empty) and the matchmaking search (animated, seats filling live).
 *
 * Seat colors come from seatColors(), so a 2-player table shows red and yellow
 * on the diagonal — the same seating the game will actually deal.
 *
 * When `searching` is on, the plate sends out a slow radar ripple and the empty
 * pads breathe on one shared clock; an arriving player springs into their pad.
 * DESIGN.md §4 bans spinners for exactly this state, and §6 asks for perpetual
 * pulses over progress bars — the seats themselves are the progress.
 */

import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { AvatarGlyph } from "./Avatar";
import { arc } from "../lib/motion";
import { seatColors } from "../lib/seating";
import { palette, radius, teamColor, teamTint } from "../theme";
import type { Color as PlayerColor } from "@ludo/engine";

export interface SeatOccupant {
  /** Avatar id from the player's profile; a null id falls back to a default face. */
  avatarId: string | null | undefined;
}

interface TableSeatsProps {
  /** Table size — 2 seats diagonally, or 4 around the table. */
  size: 2 | 4;
  /** Taken seats, keyed by the color sitting there. Absent = still empty. */
  occupants?: Partial<Record<PlayerColor, SeatOccupant>>;
  /** Radar ripple + breathing empty pads. Off for the static picker preview. */
  searching?: boolean;
  /** Outer edge length in px. */
  boardSize?: number;
}

/** Corner per color: clockwise from red, which puts red/yellow on the diagonal. */
const CORNER: Record<PlayerColor, { x: 0 | 1; y: 0 | 1 }> = {
  red: { x: 0, y: 0 },
  green: { x: 1, y: 0 },
  yellow: { x: 1, y: 1 },
  blue: { x: 0, y: 1 },
};

const RIPPLES = 3;
const CYCLE_MS = 2600;
/** Fraction of the cycle an empty pad spends breathing, and the seat-to-seat offset. */
const PULSE_SPAN = 0.5;
const PULSE_STAGGER = 0.12;

export function TableSeats({ size, occupants = {}, searching = false, boardSize = 220 }: TableSeatsProps) {
  const wave = useSharedValue(0);

  useEffect(() => {
    if (!searching) return;
    wave.value = withRepeat(withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(wave);
  }, [searching, wave]);

  const colors = seatColors(size);
  const pad = boardSize * 0.3;
  const inset = boardSize * 0.055;

  return (
    <View style={{ width: boardSize, height: boardSize }}>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          borderRadius: radius.lg,
          backgroundColor: palette.raisedSlate,
          borderWidth: 1,
          borderColor: palette.hairline,
        }}
      />

      {/* Center diamond — just enough board to read as one without drawing 52 cells. */}
      <View
        style={{
          position: "absolute",
          left: boardSize / 2 - boardSize * 0.11,
          top: boardSize / 2 - boardSize * 0.11,
          width: boardSize * 0.22,
          height: boardSize * 0.22,
          backgroundColor: palette.liftedSlate,
          borderWidth: 1,
          borderColor: palette.hairline,
          transform: [{ rotate: "45deg" }],
        }}
      />

      {searching
        ? Array.from({ length: RIPPLES }, (_, i) => (
            <Ripple key={i} index={i} wave={wave} boardSize={boardSize} />
          ))
        : null}

      {colors.map((color, i) => {
        const corner = CORNER[color];
        return (
          <SeatPad
            key={color}
            color={color}
            occupant={occupants[color]}
            searching={searching}
            index={i}
            wave={wave}
            size={pad}
            style={{
              position: "absolute",
              left: corner.x === 0 ? inset : undefined,
              right: corner.x === 1 ? inset : undefined,
              top: corner.y === 0 ? inset : undefined,
              bottom: corner.y === 1 ? inset : undefined,
            }}
          />
        );
      })}
    </View>
  );
}

/** Expanding ring from the table center; three of them share one clock at
 *  even phase offsets so the ripple never stops going out. */
function Ripple({ index, wave, boardSize }: { index: number; wave: SharedValue<number>; boardSize: number }) {
  const ring = boardSize * 0.34;
  const style = useAnimatedStyle(() => {
    const phase = (wave.value + index / RIPPLES) % 1;
    return {
      opacity: 0.3 * (1 - phase),
      transform: [{ scale: 0.35 + phase * 1.5 }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          left: boardSize / 2 - ring,
          top: boardSize / 2 - ring,
          width: ring * 2,
          height: ring * 2,
          borderRadius: ring,
          borderWidth: 1.5,
          borderColor: palette.porcelain,
        },
        style,
      ]}
    />
  );
}

function SeatPad({
  color,
  occupant,
  searching,
  index,
  wave,
  size,
  style,
}: {
  color: PlayerColor;
  occupant: SeatOccupant | undefined;
  searching: boolean;
  index: number;
  wave: SharedValue<number>;
  size: number;
  style: object;
}) {
  const taken = occupant !== undefined;
  // Seats already filled when this mounts (yours, always) start settled — only
  // an arrival we actually witness is worth a pop.
  const fill = useSharedValue(taken ? 1 : 0);

  useEffect(() => {
    if (taken) fill.value = withSpring(1, { stiffness: 100, damping: 20 });
    else fill.value = 0;
  }, [taken, fill]);

  const avatarStyle = useAnimatedStyle(() => ({
    opacity: fill.value,
    transform: [{ scale: 0.6 + fill.value * 0.4 }],
  }));

  const emptyStyle = useAnimatedStyle(() => {
    const breath = searching ? arc(wave.value, index, PULSE_SPAN, PULSE_STAGGER) : 0;
    return {
      opacity: (1 - fill.value) * (0.5 + breath * 0.4),
      transform: [{ scale: 1 + breath * 0.06 }],
    };
  });

  return (
    <View style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderStyle: "dashed",
            borderColor: teamColor[color],
            backgroundColor: teamTint[color],
          },
          emptyStyle,
        ]}
      />
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 2,
            borderColor: teamColor[color],
            backgroundColor: palette.liftedSlate,
            overflow: "hidden",
          },
          avatarStyle,
        ]}
      >
        {occupant ? <AvatarGlyph id={occupant.avatarId} size={size - 4} /> : null}
      </Animated.View>
    </View>
  );
}
