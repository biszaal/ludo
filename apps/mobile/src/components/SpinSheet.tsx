/**
 * The reward spin sheet (server: migration 0086).
 *
 * The server picks every prize. Tapping Spin claims first; the wheel then turns
 * onto the segment the server answered with, using the wheel the server says
 * it drew from (not the one shown before the tap), so a tier that changed at
 * the daily reset can never land on the wrong prize. A claim that fails leaves
 * the spin owed and the button live; the store retries with the same request
 * id, so a lost reply can't pay twice.
 *
 * Opened with nothing owed (from a countdown or locked tile), it explains when
 * the next spin comes instead of showing a wheel.
 */

import { useEffect, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Easing, runOnJS, useSharedValue, withTiming } from "react-native-reanimated";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { Confetti } from "./Confetti";
import { CoinGlyph } from "./CoinsPill";
import { GemGlyph } from "./GemGlyph";
import { SpinWheel } from "./SpinWheel";
import { useSpin } from "../store/spinStore";
import { formatCountdown, odds, tileView, wheelTarget, type Segment, type SpinState } from "../lib/spin";
import { formatExact } from "../lib/format";
import { useFullMotion } from "../lib/useMotion";
import { playSound } from "../lib/sound";
import { tapLight, win as winHaptic } from "../lib/haptics";
import { font, palette, radius, space } from "../theme";
import { useT } from "../i18n";

const GOLD = "#F5C542";
const COIN_CONFETTI = ["#F5C542", "#FFE08A", "#C8951B"];

type Phase = "idle" | "spinning" | "won";
type Prize = { coins?: number; gems?: number };
type Tier = "bronze" | "silver" | "gold";

export function SpinSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { width } = useWindowDimensions();
  const full = useFullMotion();
  const state = useSpin((s) => s.state);
  const claim = useSpin((s) => s.claim);
  const next = state?.next ?? null;

  const rotation = useSharedValue(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [shown, setShown] = useState<Segment[] | null>(next?.segments ?? null);
  const [heading, setHeading] = useState("");
  const [prize, setPrize] = useState<Prize | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOdds, setShowOdds] = useState(false);

  // While nothing is turning, show the wheel the next spin will use.
  useEffect(() => {
    if (phase === "idle") setShown(next?.segments ?? null);
  }, [phase, next]);

  const label = (s: SpinState | null): string => {
    const n = s?.next;
    if (!n) return "";
    if (n.source === "first") return t("spin.source.first");
    if (n.source === "daily") return t("spin.source.daily", { tier: t(`spin.tier.${n.wheel as Tier}`) });
    return t("spin.source.match", { n: s?.owed?.match ?? 1 });
  };

  const landed = (p: Prize) => {
    setPrize(p);
    setPhase("won");
    playSound("cheer");
    winHaptic();
  };

  const onSpin = async () => {
    if (!next || phase !== "idle") return;
    setError(null);
    setPrize(null);
    setHeading(label(state));
    tapLight();
    setPhase("spinning");
    try {
      const result = await claim(next.source);
      if (result === null) {
        setPhase("idle");
        return;
      }
      if (!result.ok) {
        if (result.reason === "disabled") onClose();
        else setPhase("idle"); // not owed any more: the store has refreshed what is
        return;
      }
      setShown(result.segments);
      const target = wheelTarget(result.segment, result.segments.length, rotation.value, full ? 5 : 1);
      rotation.value = withTiming(
        target,
        { duration: full ? 4000 : 1200, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(landed)(result.prize);
        },
      );
    } catch {
      setError(t("spin.error"));
      setPhase("idle");
    }
  };

  const view = tileView(state, Date.now());
  const countdown = view.kind === "countdown" ? formatCountdown(view.ms) : null;
  const wheelSize = Math.min(width - space.xl * 4, 300);
  const segments = shown ?? next?.segments ?? null;
  const caption = phase === "idle" ? label(state) : heading;

  return (
    <Sheet onClose={onClose} title={t("spin.title")}>
      {segments && (phase !== "idle" || next) ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>{caption}</Text>
            <Pressable
              onPress={() => setShowOdds((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={t("spin.odds")}
              hitSlop={10}
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: palette.mutedSteel,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 13, color: palette.mutedSteel }}>i</Text>
            </Pressable>
          </View>

          {showOdds ? (
            <OddsList segments={segments} title={t("spin.odds")} />
          ) : (
            <View style={{ alignItems: "center", paddingVertical: space.sm }}>
              <SpinWheel segments={segments} rotation={rotation} size={wheelSize} />
            </View>
          )}
        </>
      ) : null}

      {prize ? (
        <Text style={{ fontFamily: font.semibold, fontSize: 18, color: GOLD, textAlign: "center" }}>
          {prize.gems
            ? t("spin.wonGems", { n: formatExact(prize.gems) })
            : t("spin.wonCoins", { n: formatExact(prize.coins ?? 0) })}
        </Text>
      ) : null}

      {error ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
          {error}
        </Text>
      ) : null}

      {phase === "idle" && next ? (
        <Button label={t("spin.button")} onPress={() => void onSpin()} />
      ) : phase === "spinning" ? (
        <Button label={t("spin.button")} onPress={() => {}} disabled />
      ) : phase === "won" && next ? (
        <Button
          label={t("spin.again")}
          onPress={() => {
            setPrize(null);
            setPhase("idle");
          }}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          {view.kind === "locked" ? (
            <Text style={{ fontFamily: font.medium, fontSize: 14, color: palette.porcelain, textAlign: "center" }}>
              {t("spin.tileLocked")}
            </Text>
          ) : null}
          {countdown ? (
            <Text style={{ fontFamily: font.medium, fontSize: 14, color: palette.porcelain, textAlign: "center" }}>
              {t("spin.next", { time: t("spin.countdown", { h: countdown.h, m: countdown.m }) })}
            </Text>
          ) : null}
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
            {t("spin.matchHint", { max: state?.matchMax ?? 3 })}
          </Text>
          <Button label={t("spin.done")} onPress={onClose} variant="ghost" />
        </View>
      )}

      {phase === "won" ? (
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
          <Confetti width={width} height={520} originX={width / 2} originY={160} colors={COIN_CONFETTI} />
        </View>
      ) : null}
    </Sheet>
  );
}

/** Each prize on this wheel and its chance, from the same segments the server draws from. */
function OddsList({ segments, title }: { segments: Segment[]; title: string }) {
  return (
    <View style={{ gap: space.xs, backgroundColor: palette.raisedSlate, borderRadius: radius.md, padding: space.md }}>
      <Text style={{ fontFamily: font.semibold, fontSize: 13, color: palette.mutedSteel }}>{title}</Text>
      {odds(segments).map(({ label, pct }, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {"gems" in label ? <GemGlyph size={13} /> : <CoinGlyph size={13} />}
            <Text style={{ fontFamily: font.mono, fontSize: 13, color: palette.porcelain }}>
              {"gems" in label ? formatExact(label.gems) : formatExact(label.coins)}
            </Text>
          </View>
          <Text style={{ fontFamily: font.mono, fontSize: 13, color: palette.mutedSteel }}>{pct}</Text>
        </View>
      ))}
    </View>
  );
}
