/**
 * A settings row with a custom animated toggle (no stock Switch). ON reads as
 * Porcelain per the dynamic-accent rule — neutral chrome, never a team color.
 */

import { Pressable, Text, View } from "react-native";
import Animated, { interpolateColor, useAnimatedStyle, useDerivedValue, withSpring, withTiming } from "react-native-reanimated";
import { font, palette, radius, space } from "../theme";

const TRACK_W = 48;
const TRACK_H = 28;
const KNOB = 22;
const PAD = (TRACK_H - KNOB) / 2;

interface SettingRowProps {
  label: string;
  /** Secondary line under the label. */
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export function SettingRow({ label, hint, value, onChange }: SettingRowProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 52,
        gap: space.md,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: font.medium, fontSize: 16, color: palette.porcelain }}>{label}</Text>
        {hint ? <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>{hint}</Text> : null}
      </View>
      <Toggle value={value} />
    </Pressable>
  );
}

function Toggle({ value }: { value: boolean }) {
  const progress = useDerivedValue(() => withTiming(value ? 1 : 0, { duration: 180 }), [value]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [palette.liftedSlate, palette.porcelain]),
  }));

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withSpring(value ? TRACK_W - KNOB - PAD : PAD, { stiffness: 220, damping: 22 }) }],
    backgroundColor: interpolateColor(progress.value, [0, 1], [palette.mutedSteel, palette.feltCharcoal]),
  }));

  return (
    <Animated.View
      style={[
        { width: TRACK_W, height: TRACK_H, borderRadius: radius.pill, justifyContent: "center", borderWidth: 1, borderColor: palette.hairline },
        trackStyle,
      ]}
    >
      <Animated.View style={[{ width: KNOB, height: KNOB, borderRadius: radius.pill }, knobStyle]} />
    </Animated.View>
  );
}
