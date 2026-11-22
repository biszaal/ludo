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

import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  runOnJS,
  useSharedValue,
  withSequence,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { Confetti } from "./Confetti";
import { CoinGlyph } from "./CoinsPill";
import { GemGlyph } from "./GemGlyph";
import { SpinWheel } from "./SpinWheel";
import { useSpin } from "../store/spinStore";
import { formatCountdown, msUntilReset, odds, tileView, wheelTarget, type Segment, type SpinState } from "../lib/spin";
import { formatExact } from "../lib/format";
import { useFullMotion } from "../lib/useMotion";
import { playSound } from "../lib/sound";
import { tapLight, win as winHaptic } from "../lib/haptics";
import { font, palette, radius, space } from "../theme";
import { useT } from "../i18n";

const GOLD = "#F5C542";
const COIN_CONFETTI = ["#F5C542", "#FFE08A", "#C8951B"];

type Phase = "idle" | "spinning" | "won";

// The spin, full motion. It starts the moment the player taps (a short
// wind-up, then a spin-up to a steady free spin) and keeps turning while the
// server picks the prize; when the answer lands it slows over a few seconds
// onto that wedge, a touch past it, and settles back. The slowdown's opening
// speed matches the free spin's, so there is no visible jolt at the handover.
const WIND_UP = { deg: 12, ms: 180 };
const SPIN_UP = { deg: 110, ms: 320 }; // ends at about FREE_SPEED
const FREE_SPEED = 0.75; // degrees per ms
const MIN_FREE_MS = 650; // even an instant answer gets a proper spin-up
const SLOWDOWN = { turns: 4, ms: 4300, easing: Easing.bezier(0.33, 0.62, 0.25, 1) };
const SETTLE_MS = 420;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
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
  // The wheel on screen: its name picks the rim, its segments the wedges.
  const [shown, setShown] = useState<{ wheel: string; segments: Segment[] } | null>(
    next ? { wheel: next.wheel, segments: next.segments } : null,
  );
  const [heading, setHeading] = useState("");
  const [prize, setPrize] = useState<Prize | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOdds, setShowOdds] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);

  // Closed mid-spin: a claim or an animation that finishes afterwards must not
  // touch state, play the cheer or buzz over Home.
  const mounted = useRef(true);
  useEffect(() => () => {
    mounted.current = false;
  }, []);
  // One spin at a time, decided before React re-renders: two taps in the same
  // frame both see phase "idle", but only the first finds this unset.
  const busy = useRef(false);

  // While nothing is turning, show the wheel the next spin will use.
  useEffect(() => {
    if (phase === "idle") setShown(next ? { wheel: next.wheel, segments: next.segments } : null);
  }, [phase, next]);

  const label = (s: SpinState | null): string => {
    const n = s?.next;
    if (!n) return "";
    if (n.source === "first") return t("spin.source.first");
    if (n.source === "daily") return t("spin.source.daily", { tier: t(`spin.tier.${n.wheel as Tier}`) });
    return t("spin.source.match", { n: s?.owed?.match ?? 1 });
  };

  const landed = (p: Prize, segment: number) => {
    if (!mounted.current) return;
    busy.current = false;
    setWinner(segment);
    setPrize(p);
    setPhase("won");
    playSound("cheer");
    winHaptic();
  };

  // A tick per peg: a light haptic, and a click once the wheel has slowed
  // enough for clicks to be heard one by one rather than as a buzz.
  const lastHaptic = useRef(0);
  const lastClick = useRef(0);
  const onPegPass = useCallback(() => {
    const now = Date.now();
    if (now - lastHaptic.current > 60) {
      lastHaptic.current = now;
      tapLight();
    }
    if (full && now - lastClick.current > 110) {
      lastClick.current = now;
      playSound("tap");
    }
  }, [full]);

  // A spin that ends without a prize (refused, offline) coasts to a stop
  // instead of freezing mid-turn.
  const coast = () => {
    cancelAnimation(rotation);
    rotation.value = withTiming(rotation.value + 80, { duration: 700, easing: Easing.out(Easing.cubic) });
  };

  // Also behind "Spin again": straight into the next spin, no second tap.
  const onSpin = async () => {
    if (!next || busy.current) return;
    busy.current = true;
    setError(null);
    setPrize(null);
    setShown({ wheel: next.wheel, segments: next.segments });
    setHeading(label(state));
    setWinner(null);
    tapLight();
    setPhase("spinning");
    const startedFree = full ? wait(MIN_FREE_MS) : null;
    if (full) {
      const r0 = rotation.value;
      rotation.value = withSequence(
        withTiming(r0 - WIND_UP.deg, { duration: WIND_UP.ms, easing: Easing.out(Easing.quad) }),
        withTiming(r0 + SPIN_UP.deg, { duration: SPIN_UP.ms, easing: Easing.in(Easing.quad) }),
        withTiming(r0 + SPIN_UP.deg + FREE_SPEED * 60_000, { duration: 60_000, easing: Easing.linear }),
      );
    }
    try {
      const result = await claim(next.source);
      if (startedFree) await startedFree;
      if (!mounted.current) return;
      if (result === null || !result.ok) {
        busy.current = false;
        if (full) coast();
        if (result?.ok === false && result.reason === "disabled") onClose();
        else setPhase("idle"); // not owed any more: the store has refreshed what is
        return;
      }
      setShown({ wheel: result.wheel, segments: result.segments });
      const segment = result.segment;
      const prizeWon = result.prize;
      const count = result.segments.length;
      cancelAnimation(rotation);
      const from = rotation.value;
      const done = (finished?: boolean) => {
        "worklet";
        if (finished) runOnJS(landed)(prizeWon, segment);
      };
      if (full) {
        const target = wheelTarget(segment, count, from, SLOWDOWN.turns);
        const overshoot = Math.min(5, (360 / count) * 0.12);
        rotation.value = withSequence(
          withTiming(target + overshoot, { duration: SLOWDOWN.ms, easing: SLOWDOWN.easing }),
          withTiming(target, { duration: SETTLE_MS, easing: Easing.inOut(Easing.quad) }, done),
        );
      } else {
        rotation.value = withTiming(
          wheelTarget(segment, count, from, 1),
          { duration: 1200, easing: Easing.out(Easing.cubic) },
          done,
        );
      }
    } catch {
      if (!mounted.current) return;
      busy.current = false;
      if (full) coast();
      setError(t("spin.error"));
      setPhase("idle");
    }
  };

  const view = tileView(state, Date.now());
  // Shown whenever nothing is owed, the locked first-game state included.
  const untilReset = msUntilReset(state, Date.now());
  const countdown = untilReset !== null ? formatCountdown(untilReset) : null;
  const wheelSize = Math.min(width - space.xl * 4, 300);
  const segments = shown?.segments ?? next?.segments ?? null;
  const wheelName = shown?.wheel ?? next?.wheel ?? "silver";
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
              <SpinWheel
                segments={segments}
                wheel={wheelName}
                rotation={rotation}
                size={wheelSize}
                highlight={phase === "won" ? winner : null}
                spinning={phase === "spinning"}
                onPegPass={onPegPass}
              />
            </View>
          )}
        </>
      ) : null}

      {prize ? (
        <Animated.View entering={full ? ZoomIn.springify().damping(13) : FadeIn.duration(150)}>
          <Text style={{ fontFamily: font.display, fontSize: 20, color: GOLD, textAlign: "center" }}>
            {prize.gems
              ? t("spin.wonGems", { n: formatExact(prize.gems) })
              : t("spin.wonCoins", { n: formatExact(prize.coins ?? 0) })}
          </Text>
        </Animated.View>
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
        <Button label={t("spin.again")} onPress={() => void onSpin()} />
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
