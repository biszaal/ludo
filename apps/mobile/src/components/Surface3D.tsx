/**
 * A raised slate tray on the felt: face over a darker under-edge, light-catch
 * hairline on top, soft shadow below (the same depth language as Button).
 * Non-interactive by default; pass `pressed` from a parent Pressable to seat
 * an interactive card into the table without its total height changing.
 */

import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { depth, palette, radius as radiusToken, shade } from "../theme";

interface Surface3DProps {
  children: ReactNode;
  /** Corner radius of the piece. */
  rad?: number;
  /** Under-edge height; smaller than Button's — cards sit lower than controls. */
  edge?: number;
  /** Face background. */
  faceColor?: string;
  /** From a wrapping Pressable: seat the card while held. */
  pressed?: boolean;
  /** Outer styles (margins, flex). */
  style?: StyleProp<ViewStyle>;
  /** Face styles (padding, row layout). */
  faceStyle?: StyleProp<ViewStyle>;
}

export function Surface3D({
  children,
  rad = radiusToken.md,
  edge = 3,
  faceColor = palette.raisedSlate,
  pressed = false,
  style,
  faceStyle,
}: Surface3DProps) {
  const down = pressed && edge > 0;
  return (
    <View
      style={[
        {
          borderRadius: rad,
          backgroundColor: shade(faceColor, -0.5),
          paddingBottom: down ? 1 : edge,
          marginTop: down ? edge - 1 : 0,
        },
        depth.shadow,
        style,
      ]}
    >
      <View
        style={[
          {
            borderRadius: rad,
            backgroundColor: faceColor,
            borderTopWidth: 1,
            borderTopColor: depth.highlight,
            overflow: "hidden",
          },
          faceStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}
