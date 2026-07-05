/**
 * Pre-game bottom sheet for local play: player count, seat preview, optional
 * house-rules toggles (per-launch, not persisted — house rules are a table
 * agreement, not a device setting), and the Start CTA.
 */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { DEFAULT_RULES, type RuleConfig } from "@ludo/engine";
import { Button } from "./Button";
import { SelectTile } from "./SelectTile";
import { SettingRow } from "./SettingRow";
import { EXPOSED_RULES } from "../lib/exposedRules";
import { seatColors } from "../lib/seating";
import { font, palette, radius, space, teamColor } from "../theme";

const COUNTS = [2, 3, 4] as const;

export type PlayMode = "ai" | "pass";

interface PlaySetupSheetProps {
  mode: PlayMode;
  onStart: (players: number, bots: number, rules: Partial<RuleConfig>) => void;
  onClose: () => void;
}

export function PlaySetupSheet({ mode, onStart, onClose }: PlaySetupSheetProps) {
  const [count, setCount] = useState<number>(2);
  const [rules, setRules] = useState<Partial<RuleConfig>>({});
  const [showRules, setShowRules] = useState(false);

  const ruleValue = (key: keyof RuleConfig) => rules[key] ?? DEFAULT_RULES[key];

  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(20,23,28,0.6)" }}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

      <Animated.View
        entering={SlideInDown.springify().stiffness(120).damping(20)}
        exiting={SlideOutDown.duration(180)}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: palette.raisedSlate,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          borderWidth: 1,
          borderColor: palette.hairline,
          paddingHorizontal: space.xl,
          paddingTop: space.lg,
          paddingBottom: space.xxl,
          gap: space.md,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>
            {mode === "ai" ? "Play vs AI" : "Pass & play"}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8}>
            <Text style={{ fontFamily: font.semibold, fontSize: 22, color: palette.mutedSteel }}>×</Text>
          </Pressable>
        </View>

        <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>
          {mode === "ai" ? "PLAYERS (YOU + AI)" : "PLAYERS"}
        </Text>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {COUNTS.map((n) => (
            <SelectTile key={n} label={`${n}`} mono selected={n === count} onPress={() => setCount(n)} />
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: space.sm, paddingLeft: space.xs }}>
          {seatColors(count).map((c) => (
            <View key={c} style={{ width: 12, height: 12, borderRadius: radius.pill, backgroundColor: teamColor[c] }} />
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="House rules"
          onPress={() => setShowRules((v) => !v)}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", minHeight: 44, opacity: pressed ? 0.85 : 1 })}
        >
          <Text style={{ flex: 1, fontFamily: font.medium, fontSize: 15, color: palette.porcelain }}>House rules</Text>
          <Text style={{ fontFamily: font.semibold, fontSize: 17, color: palette.mutedSteel }}>{showRules ? "−" : "+"}</Text>
        </Pressable>

        {showRules && (
          <Animated.View entering={FadeIn.duration(140)} style={{ gap: 2 }}>
            {EXPOSED_RULES.map((rule) => (
              <SettingRow
                key={rule.key}
                label={rule.label}
                hint={rule.hint}
                value={ruleValue(rule.key) as boolean}
                onChange={(v) => setRules((r) => ({ ...r, [rule.key]: v }))}
              />
            ))}
          </Animated.View>
        )}

        <Button label="Start game" onPress={() => onStart(count, mode === "ai" ? count - 1 : 0, rules)} />
      </Animated.View>
    </View>
  );
}
