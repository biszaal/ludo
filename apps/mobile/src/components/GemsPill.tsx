/**
 * Gem-balance pill — CoinsPill's premium sibling. Compact form everywhere
 * (formatCompact); the sheet it opens shows the exact number. Renders nothing
 * until the first wallet read, same as CoinsPill.
 */

import { Pressable, Text, View } from "react-native";
import { GemGlyph } from "./GemGlyph";
import { useWallet } from "../store/walletStore";
import { formatCompact } from "../lib/format";
import { font, palette, radius, space } from "../theme";

export function GemsPill({ compact = false, onPress }: { compact?: boolean; onPress?: () => void }) {
  const gems = useWallet((s) => s.gems);
  if (gems === null) return null;

  const body = (pressed: boolean) => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: compact ? space.sm : space.md,
        paddingVertical: compact ? 4 : 6,
        borderRadius: radius.pill,
        backgroundColor: palette.liftedSlate,
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.10)",
        opacity: pressed ? 0.75 : 1,
      }}
    >
      <GemGlyph size={compact ? 14 : 16} />
      <Text style={{ fontFamily: font.mono, fontSize: compact ? 13 : 15, color: palette.porcelain }}>
        {formatCompact(gems)}
      </Text>
    </View>
  );

  if (!onPress) {
    return <View accessibilityLabel={`${gems} gems`}>{body(false)}</View>;
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${gems} gems, get more`} onPress={onPress} hitSlop={8}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}
