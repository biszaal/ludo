/**
 * A single restrained confetti burst (Skia + Reanimated): ~70 particles in the
 * winner's color, Porcelain, and one tint — never rainbow (DESIGN.md). Fires
 * once on mount, ~1.8s with gravity, no loop, no touches.
 */

import { useEffect, useMemo } from "react";
import { Canvas, Group, RoundedRect } from "@shopify/react-native-skia";
import { Easing, useDerivedValue, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

const COUNT = 70;
const DURATION_MS = 1800;

interface Particle {
  x0: number;
  y0: number;
  vx: number;
  vy: number;
  spin: number;
  w: number;
  h: number;
  color: string;
}

interface ConfettiProps {
  width: number;
  height: number;
  /** Burst origin (usually just above the winner block). */
  originX: number;
  originY: number;
  /** Winner color + Porcelain + a tint of the winner color. */
  colors: string[];
}

export function Confetti({ width, height, originX, originY, colors }: ConfettiProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: DURATION_MS, easing: Easing.out(Easing.quad) });
  }, [progress]);

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: COUNT }, (_unused, i) => {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9; // upward cone
        const speed = height * (0.35 + Math.random() * 0.55);
        return {
          x0: originX + (Math.random() - 0.5) * 60,
          y0: originY + (Math.random() - 0.5) * 20,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          spin: (Math.random() - 0.5) * 10,
          w: 5 + Math.random() * 5,
          h: 8 + Math.random() * 6,
          color: colors[i % colors.length]!,
        };
      }),
    [originX, originY, height, colors],
  );

  return (
    <Canvas pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width, height }}>
      {particles.map((p, i) => (
        <ConfettiPiece key={i} p={p} progress={progress} gravity={height * 1.1} />
      ))}
    </Canvas>
  );
}

function ConfettiPiece({ p, progress, gravity }: { p: Particle; progress: SharedValue<number>; gravity: number }) {
  const transform = useDerivedValue(() => {
    const t = progress.value;
    return [
      { translateX: p.x0 + p.vx * t },
      { translateY: p.y0 + p.vy * t + gravity * t * t },
      { rotate: p.spin * t * Math.PI },
      { scaleY: 0.6 + 0.4 * Math.abs(Math.cos(p.spin * t * Math.PI * 2)) }, // tumbling foil
    ];
  });
  const opacity = useDerivedValue(() => 1 - Math.max(0, (progress.value - 0.72) / 0.28));

  return (
    <Group transform={transform} opacity={opacity}>
      <RoundedRect x={-p.w / 2} y={-p.h / 2} width={p.w} height={p.h} r={1.5} color={p.color} />
    </Group>
  );
}
