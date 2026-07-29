/**
 * Shared text field — the RoomSheet code-input treatment generalized so
 * inputs stop being styled ad-hoc per screen.
 */

import { TextInput, type TextInputProps } from "react-native";
import { font, palette, radius } from "../theme";

interface FieldProps extends TextInputProps {
  /** Mono + centered + letter-spaced (room codes). Default is plain text. */
  mono?: boolean;
  focused?: boolean;
}

export function Field({ mono = false, focused = false, style, ...rest }: FieldProps) {
  return (
    <TextInput
      placeholderTextColor={palette.mutedSteel}
      {...rest}
      style={[
        {
          minHeight: 56,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: focused ? palette.porcelain : palette.hairline,
          backgroundColor: palette.raisedSlate,
          color: palette.porcelain,
          paddingHorizontal: 16,
          fontFamily: mono ? font.mono : font.regular,
          fontSize: mono ? 22 : 16,
          ...(mono ? { letterSpacing: 6, textAlign: "center" as const } : null),
        },
        style,
      ]}
    />
  );
}
