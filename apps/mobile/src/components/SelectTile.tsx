/** A selectable option tile (player count, mode). Extracted from HomeScreen. */

import { Pressable, Text } from "react-native";
import { font, palette, radius } from "../theme";

interface SelectTileProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Render the label in mono (numbers). */
  mono?: boolean;
}

export function SelectTile({ label, selected, onPress, mono }: SelectTileProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 54,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: selected ? palette.liftedSlate : "transparent",
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? palette.porcelain : palette.hairline,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Text style={{ fontFamily: mono ? font.mono : font.semibold, fontSize: mono ? 20 : 15, color: palette.porcelain }}>{label}</Text>
    </Pressable>
  );
}
