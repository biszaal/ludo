/**
 * Centers page content in a readable column on tablets and leaves phones
 * untouched. `maxWidth` is undefined on phone (a style no-op → full bleed,
 * pixel-identical to before); on tablet it clamps and centers so nothing
 * stretches edge-to-edge across a 1024pt iPad.
 */

import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useLayout } from "../lib/useLayout";

export function ContentColumn({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { maxWidth } = useLayout();
  return <View style={[{ width: "100%", maxWidth, alignSelf: "center" }, style]}>{children}</View>;
}
