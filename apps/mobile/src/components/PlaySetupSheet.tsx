/**
 * Pre-game bottom sheet for local play: player count, seat preview, optional
 * house-rules toggles (per-launch, not persisted — house rules are a table
 * agreement, not a device setting), and the Start CTA.
 */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { DEFAULT_RULES, type RuleConfig } from "@ludo/engine";
import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { SectionLabel } from "./SectionLabel";
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
    <Sheet onClose={onClose} title={mode === "ai" ? "Play vs AI" : "Pass & play"}>
      <SectionLabel>{mode === "ai" ? "Players (you + AI)" : "Players"}</SectionLabel>
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
    </Sheet>
  );
}
