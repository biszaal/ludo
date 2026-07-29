/**
 * Coin-balance pill (home header, profile). Reads the wallet store; renders
 * nothing until the first balance arrives so a signed-out fresh install
 * doesn't flash a meaningless zero.
 */

import { Pressable, Text, View } from "react-native";
import { useWallet } from "../store/walletStore";
import { formatCompact } from "../lib/format";
import { font, palette, radius, space } from "../theme";

/** Pass `onPress` to make the pill a doorway to the Get Coins sheet. A dot
 *  marks an unclaimed daily bonus so the balance itself is the entry point. */
export function CoinsPill({ compact = false, onPress }: { compact?: boolean; onPress?: () => void }) {
  const balance = useWallet((s) => s.balance);
  const bonusClaimable = useWallet((s) => s.bonusClaimable);
  if (balance === null) return null;

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
      <CoinGlyph size={compact ? 14 : 16} />
      {/* Compact form here; the sheet this opens shows the exact number. */}
      <Text style={{ fontFamily: font.mono, fontSize: compact ? 13 : 15, color: palette.porcelain }}>
        {formatCompact(balance)}
      </Text>
      {onPress && bonusClaimable ? (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 3.5,
            backgroundColor: "#F5C542",
            marginLeft: 1,
          }}
        />
      ) : null}
    </View>
  );

  if (!onPress) {
    return <View accessibilityLabel={`${balance} coins`}>{body(false)}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bonusClaimable ? `${balance} coins, daily bonus ready` : `${balance} coins, get more`}
      onPress={onPress}
      hitSlop={8}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
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
