/** Tactile primary/secondary button. Presses scale down (spring-like) per DESIGN. */

import { Pressable, Text } from "react-native";
import { font, palette, radius, space } from "../theme";
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
  const ghost = variant === "ghost";
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => {
        playSound("tap");
        tapLight();
      }}
      disabled={disabled}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: space.xl,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: disabled ? palette.liftedSlate : ghost ? "transparent" : color,
        borderWidth: ghost ? 1 : 0,
        borderColor: palette.hairline,
        opacity: pressed ? 0.92 : 1,
        transform: [{ scale: pressed ? 0.96 : 1 }, { translateY: pressed ? 1 : 0 }],
      })}
    >
      <Text
        style={{
          fontFamily: font.semibold,
          fontSize: 16,
          color: disabled ? palette.mutedSteel : ghost ? palette.porcelain : textColor,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
