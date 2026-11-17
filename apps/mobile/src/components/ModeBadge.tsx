/** A small pill naming a game's mode. Classic wears nothing. */

import { Text, View } from "react-native";
import type { Variant } from "../lib/standings";
import { font, palette, radius, space } from "../theme";
import { useT } from "../i18n";

export function ModeBadge({ variant }: { variant: Variant }) {
  const t = useT();
  if (variant === "classic") return null;
  return (
    <View
      accessibilityLabel={`${t(`mode.${variant}`)}: ${t(`mode.${variant}Hint`)}`}
      style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, borderWidth: 1, borderColor: palette.hairline }}
    >
      <Text style={{ fontFamily: font.semibold, fontSize: 12, color: palette.porcelain }}>{t(`mode.${variant}`).toUpperCase()}</Text>
    </View>
  );
}
