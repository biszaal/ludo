/**
 * Tactile primary/secondary button. Fill buttons are raised game pieces: a face
 * over a darker under-edge, light catching the top. Pressing seats the piece
 * into the table (the edge collapses; total height never changes, so siblings
 * don't shift). Ghost stays a quiet flat outline.
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
}

export function Button({
  label,
  onPress,
  color = palette.porcelain,
  textColor = palette.feltCharcoal,
  variant = "fill",
  disabled = false,
}: ButtonProps) {
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
          minHeight: 52 + depth.edge, // match a fill button's total height
          paddingHorizontal: space.xl,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: palette.hairline,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ fontFamily: font.semibold, fontSize: 16, color: disabled ? palette.mutedSteel : palette.porcelain }}>
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
                minHeight: 52,
                paddingHorizontal: space.xl,
                borderRadius: radius.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: face,
                borderTopWidth: 1,
                borderTopColor: depth.highlight,
              }}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 16, color: disabled ? palette.mutedSteel : textColor }}>
                {label}
              </Text>
            </View>
          </View>
        );
      }}
    </Pressable>
  );
}
