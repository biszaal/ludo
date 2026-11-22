/**
 * The reward spin's doorway on Home, beside the daily chest (server: 0086;
 * design: Claude Design canvas "Ludo spin wheel redesign", Home row board).
 *
 * Three faces, from lib/spin's tileView:
 *   - spins owed: the next wheel in miniature, its name, a gold edge and a count;
 *   - nothing owed: a grey wheel and a countdown to the 00:00 UTC reset;
 *   - first-game spin still locked: a grey wheel with a lock, and what unlocks it.
 * The countdown ticks here, so Home itself never re-renders on a timer. It
 * shares the chest's row equally and keeps the chest's height, so Home's height
 * budget is unchanged.
 */

import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Surface3D } from "./Surface3D";
import { MiniWheel } from "./SpinWheel";
import { formatCountdown, tileTickMs, tileView, type SpinState } from "../lib/spin";
import { useSpin } from "../store/spinStore";
import { font, palette, radius, space } from "../theme";
import { useT } from "../i18n";

const GOLD = "#F5C542";

interface SpinTileProps {
  state: SpinState | null;
  onPress: () => void;
  /** Total height from the hub's budget (the chest's). */
  height?: number;
}

export function SpinTile({ state, onPress, height = 48 }: SpinTileProps) {
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

  const live = view.kind === "ready";
  const wheel = state?.next?.wheel ?? state?.tier ?? "silver";
  let title: string;
  let detail: string;
  let mono = false;
  if (view.kind === "ready") {
    title = t("spin.tileReadyTitle");
    detail =
      wheel === "firstGame"
        ? t("spin.source.first")
        : t("spin.tileWheel", { tier: t(`spin.tier.${wheel === "gold" || wheel === "bronze" ? wheel : "silver"}`) });
  } else if (view.kind === "locked") {
    title = t("spin.tileLockedTitle");
    detail = t("spin.tileLockedSub");
  } else {
    const { h, m } = formatCountdown(view.ms);
    title = t("spin.tileNextTitle");
    detail = t("spin.tileIn", { time: t("spin.countdown", { h, m }) });
    mono = true;
  }
  const glyph = Math.max(24, Math.min(40, height - 16));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={live ? `${title}, ${detail}, ${view.count}` : `${title}, ${detail}`}
      onPress={onPress}
      style={{ flex: 1, minWidth: 0 }}
    >
      {({ pressed }) => (
        <Surface3D
          rad={radius.md}
          pressed={pressed}
          faceColor={live ? palette.liftedSlate : undefined}
          faceStyle={{
            height: height - 3,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.md,
            borderWidth: live ? 1 : 0,
            borderColor: "rgba(245,197,66,0.42)",
          }}
        >
          <View style={{ width: glyph, height: glyph }}>
            <MiniWheel size={glyph} wheel={wheel} muted={!live} />
            {view.kind === "locked" ? (
              <View
                style={{
                  position: "absolute",
                  right: -4,
                  bottom: -4,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  backgroundColor: palette.liftedSlate,
                  borderWidth: 2,
                  borderColor: palette.raisedSlate,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 4,
                    borderWidth: 1.4,
                    borderBottomWidth: 0,
                    borderColor: palette.mutedSteel,
                    borderTopLeftRadius: 3,
                    borderTopRightRadius: 3,
                    marginBottom: -0.5,
                  }}
                />
                <View style={{ width: 8, height: 5, borderRadius: 1.2, backgroundColor: palette.mutedSteel }} />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: font.display, fontSize: 14, color: palette.porcelain }}>
              {title}
            </Text>
            <Text
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={{ fontFamily: mono ? font.mono : font.medium, fontSize: 11, lineHeight: 14, color: palette.mutedSteel }}
            >
              {detail}
            </Text>
          </View>
          {view.kind === "ready" ? (
            <View
              style={{
                minWidth: 22,
                height: 22,
                paddingHorizontal: 5,
                borderRadius: 11,
                backgroundColor: GOLD,
                borderWidth: 1,
                borderColor: "#C8951B",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: font.display, fontSize: 12, color: palette.feltCharcoal }}>{view.count}</Text>
            </View>
          ) : null}
        </Surface3D>
      )}
    </Pressable>
  );
}
