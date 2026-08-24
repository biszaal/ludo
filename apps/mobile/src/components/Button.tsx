/**
 * Tactile primary/secondary button. Fill buttons are raised game pieces: a face
 * over a darker under-edge, light catching the top. Pressing seats the piece
 * into the table (the edge collapses; total height never changes, so siblings
 * don't shift). Ghost stays a quiet flat outline.
 *
 * Two scales. The default is a page CTA. `compact` is the in-row scale: two
 * page-scale buttons (52pt tall, 24pt of padding a side) cannot share a list
 * row with an avatar and a name on a small phone — the label ends up wrapping
 * mid-word. Compact still clears a 44pt tap target once the under-edge counts.
 */

import { Pressable, Text, View } from "react-native";
import { depth, font, palette, radius, shade, space } from "../theme";
import { playSound } from "../lib/sound";
import { tapLight } from "../lib/haptics";

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** Fill color. Defaults to Porcelain (neutral primary). */
  color?: string;
  textColor?: string;
  variant?: "fill" | "ghost";
  disabled?: boolean;
  /** Row scale: shorter, tighter, smaller label. Use inside list rows. */
  compact?: boolean;
}

export function Button({
  label,
  onPress,
  color = palette.porcelain,
  textColor = palette.feltCharcoal,
  variant = "fill",
  disabled = false,
  compact = false,
}: ButtonProps) {
  const faceHeight = compact ? 40 : 52;
  const padX = compact ? space.md : space.xl;
  // Never wrap a label, and cap how far accessibility text scaling can push a
  // compact chip — it shares its row, so it cannot grow without eating the name.
  const labelProps = { numberOfLines: 1 as const, ...(compact ? { maxFontSizeMultiplier: 1.4 } : {}) };
  const labelSize = compact ? 14 : 16;
  if (variant === "ghost") {
    return (
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          playSound("tap");
          tapLight();
        }}
        disabled={disabled}
        style={({ pressed }) => ({
          minHeight: faceHeight + depth.edge, // match a fill button's total height
          paddingHorizontal: padX,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: palette.hairline,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text
          {...labelProps}
          style={{ fontFamily: font.semibold, fontSize: labelSize, color: disabled ? palette.mutedSteel : palette.porcelain }}
        >
          {label}
        </Text>
      </Pressable>
    );
  }

  const face = disabled ? palette.liftedSlate : color;
  const edge = shade(face, -0.45);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        playSound("tap");
        tapLight();
      }}
      disabled={disabled}
    >
      {({ pressed }) => {
        const down = pressed && !disabled;
        return (
          <View
            style={{
              borderRadius: radius.md,
              backgroundColor: edge,
              paddingBottom: down ? 1 : depth.edge,
              marginTop: down ? depth.edge - 1 : 0,
              ...(disabled ? {} : depth.shadow),
            }}
          >
            <View
              style={{
                minHeight: faceHeight,
                paddingHorizontal: padX,
                borderRadius: radius.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: face,
                borderTopWidth: 1,
                borderTopColor: depth.highlight,
              }}
            >
              <Text
                {...labelProps}
                style={{ fontFamily: font.semibold, fontSize: labelSize, color: disabled ? palette.mutedSteel : textColor }}
              >
                {label}
              </Text>
            </View>
          </View>
        );
      }}
    </Pressable>
  );
}
