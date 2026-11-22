/**
 * The reward spin's doorway on Home, beside the daily chest (server: 0086).
 *
 * Three faces, from lib/spin's tileView: spins owed (a count badge), nothing
 * owed (a countdown to the 00:00 UTC reset), or the first-game spin still
 * locked. The countdown ticks here, once a minute, so Home itself never
 * re-renders on a timer. It takes the rest of the chest's row and keeps the
 * chest's height, so Home's height budget is unchanged.
 */

import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Canvas, Circle, Path, Skia } from "@shopify/react-native-skia";
import { Surface3D } from "./Surface3D";
import { formatCountdown, tileTickMs, tileView, type SpinState } from "../lib/spin";
import { useSpin } from "../store/spinStore";
import { font, palette, radius, space } from "../theme";
import { useT } from "../i18n";

const GOLD = "#F5C542";
const RIM = "#C8951B";

interface SpinTileProps {
  state: SpinState | null;
  onPress: () => void;
  /** Total height from the hub's budget (the chest's). */
  height?: number;
}

export function SpinTile({ state, onPress, height = 44 }: SpinTileProps) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const view = tileView(state, now);

  // The countdown re-reads the clock once a minute, and just after the reset
  // when it is near. At the reset the server is asked what the new day owes;
  // without that the tile sat on "0h 1m" until something else refreshed it.
  const countdownMs = view.kind === "countdown" ? view.ms : null;
  useEffect(() => {
    if (countdownMs === null) return;
    if (countdownMs === 0) void useSpin.getState().refresh();
    const timer = setTimeout(() => setNow(Date.now()), tileTickMs(countdownMs));
    return () => clearTimeout(timer);
  }, [countdownMs]);

  if (view.kind === "hidden") return null;

  let text: string;
  if (view.kind === "ready") text = t("spin.tileReady");
  else if (view.kind === "locked") text = t("spin.tileLocked");
  else {
    const { h, m } = formatCountdown(view.ms);
    text = t("spin.next", { time: t("spin.countdown", { h, m }) });
  }
  const live = view.kind === "ready";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={live ? `${text} ${view.count}` : text}
      onPress={onPress}
      style={{ flex: 1, minWidth: 0 }}
    >
      {({ pressed }) => (
        <Surface3D
          rad={radius.md}
          pressed={pressed}
          faceStyle={{
            height: height - 3,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.md,
          }}
        >
          <WheelGlyph size={Math.min(22, height - 18)} live={live} />
          <Text
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={{
              flex: 1,
              fontFamily: live ? font.semibold : font.medium,
              fontSize: 12,
              color: live ? palette.porcelain : palette.mutedSteel,
            }}
          >
            {text}
          </Text>
          {view.kind === "ready" ? (
            <View
              style={{
                minWidth: 20,
                height: 20,
                borderRadius: 10,
                paddingHorizontal: 5,
                backgroundColor: GOLD,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 11, color: palette.feltCharcoal }}>{view.count}</Text>
            </View>
          ) : null}
        </Surface3D>
      )}
    </Pressable>
  );
}

/**
 * A small prize wheel: eight wedges in two alternating shades inside a rim,
 * with a hub — gold when a spin is waiting, grey otherwise. (Three wedges on a
 * dark disc read as a hazard sign; eight read as a wheel.)
 */
function WheelGlyph({ size, live }: { size: number; live: boolean }) {
  const r = size / 2;
  const rim = live ? RIM : palette.mutedSteel;
  const light = live ? GOLD : palette.mutedSteel;
  const dark = live ? "#8A6512" : palette.raisedSlate;
  const oval = Skia.XYWHRect(1.5, 1.5, size - 3, size - 3);
  const wedges = Array.from({ length: 8 }, (_, i) =>
    Skia.PathBuilder.Make().moveTo(r, r).arcToOval(oval, -90 + i * 45 - 22.5, 45, false).close().detach(),
  );
  return (
    <Canvas style={{ width: size, height: size }}>
      <Circle cx={r} cy={r} r={r} color={rim} />
      {wedges.map((p, i) => (
        <Path key={i} path={p} color={i % 2 === 0 ? light : dark} />
      ))}
      <Circle cx={r} cy={r} r={r * 0.22} color={rim} />
      <Circle cx={r} cy={r} r={r * 0.1} color={palette.feltCharcoal} />
    </Canvas>
  );
}
