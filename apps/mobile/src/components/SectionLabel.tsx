/**
 * The uppercase tracked section caption every screen used to hand-roll.
 */

import { Text } from "react-native";
import { font, palette } from "../theme";

export function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>
      {children.toUpperCase()}
    </Text>
  );
}
