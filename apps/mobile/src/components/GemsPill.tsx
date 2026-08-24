/**
 * Gem-balance pill — CoinsPill's premium sibling. Compact form everywhere
 * (formatCompact). Renders nothing until the first wallet read, same as
 * CoinsPill.
 *
 * Tapping goes to the Shop's Gems tab, from wherever it is pressed. It used to
 * open a slide-up sheet, which meant the answer to "where do gems come from"
 * was a different surface depending on which pill you tapped; now there is one
 * destination and the pill is a doorway to it. Pass `onPress` to override.
 */

import { Pressable, Text, View } from "react-native";
import { GemGlyph } from "./GemGlyph";
import { useWallet } from "../store/walletStore";
import { useCosmeticsUI } from "../store/cosmeticsUI";
import { goToTab } from "./TabDock";
import { formatCompact } from "../lib/format";
import { font, palette, radius, space } from "../theme";

export function GemsPill({ compact = false, onPress }: { compact?: boolean; onPress?: () => void }) {
  const gems = useWallet((s) => s.gems);
  const setTab = useCosmeticsUI((s) => s.setTab);
  if (gems === null) return null;

  const press =
    onPress ??
    (() => {
      setTab("gems");
      goToTab("shop");
    });

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

  if (press === undefined) {
    return <View accessibilityLabel={`${gems} gems`}>{body(false)}</View>;
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${gems} gems, get more`} onPress={press} hitSlop={8}>
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}
