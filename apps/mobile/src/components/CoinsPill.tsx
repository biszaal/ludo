/**
 * Coin-balance pill (home header, profile). Reads the wallet store; renders
 * nothing until the first balance arrives so a signed-out fresh install
 * doesn't flash a meaningless zero.
 */

import { Text, View } from "react-native";
import { useWallet } from "../store/walletStore";
import { font, palette, radius, space } from "../theme";

export function CoinsPill({ compact = false }: { compact?: boolean }) {
  const balance = useWallet((s) => s.balance);
  if (balance === null) return null;
  return (
    <View
      accessibilityLabel={`${balance} coins`}
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
      }}
    >
      <CoinGlyph size={compact ? 14 : 16} />
      <Text style={{ fontFamily: font.mono, fontSize: compact ? 13 : 15, color: palette.porcelain }}>
        {balance}
      </Text>
    </View>
  );
}

/** Drawn coin: a gold disc with a darker rim — no icon fonts, matches the
 *  app's flat-drawn glyph style. */
export function CoinGlyph({ size = 16 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#F5C542",
        borderWidth: Math.max(1.5, size * 0.12),
        borderColor: "#C8951B",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: size * 0.34,
          height: size * 0.34,
          borderRadius: size * 0.17,
          backgroundColor: "#FFE08A",
        }}
      />
    </View>
  );
}
