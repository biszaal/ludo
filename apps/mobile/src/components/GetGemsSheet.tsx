/**
 * Where gems come from and where they go: real-money packs (dark behind the
 * remote flag until real billing ships — rows read "Coming soon"), a rare
 * rewarded-ad drip, and the one-way gems→coins exchange. The balance line shows
 * the EXACT number — the compact pill's tap-to-reveal lands here.
 *
 * The ad row is deliberately the smallest thing on this sheet. Gems are the
 * premium tier; if watching a video were a serious way to accumulate them,
 * buying them would be for fools and the tier would stop meaning anything. The
 * server caps it at one grant a day and owns the amount.
 *
 * Everything gems buy is access or appearance. Nothing here, now or later,
 * may improve anyone's chance of winning a match.
 */

import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sheet } from "./Sheet";
import { SectionLabel } from "./SectionLabel";
import { Surface3D } from "./Surface3D";
import { GemGlyph } from "./GemGlyph";
import { CoinGlyph } from "./CoinsPill";
import { formatCompact, formatExact } from "../lib/format";
import { playSound } from "../lib/sound";
import { getGemProducts, isPurchasesConfigured } from "../lib/purchases";
import { watchForReward } from "../lib/ads/rewarded";
import { useAdsReady } from "../lib/ads/useAdsReady";
import { useWallet } from "../store/walletStore";
import { useConfig } from "../store/configStore";
import { font, palette, space } from "../theme";

const EXCHANGE_PRESETS = [10, 50, 100];

export function GetGemsSheet({ onClose }: { onClose: () => void }) {
  const gems = useWallet((s) => s.gems);
  const buyGems = useWallet((s) => s.buyGems);
  const exchangeGems = useWallet((s) => s.exchangeGems);
  const cfg = useConfig((s) => s.config.gems);
  const rewarded = useConfig((s) => s.config.ads.rewarded);
  const adsAvailable = useAdsReady();

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Localized store prices (RevenueCat) keyed by product id. App Store requires
  // showing the real charged price, not a hardcoded USD figure; the config
  // priceUsd is only the fallback before the SDK answers / when billing is off.
  const [storePrices, setStorePrices] = useState<Record<string, string>>({});
  const have = gems ?? 0;

  useEffect(() => {
    if (!isPurchasesConfigured()) return;
    let alive = true;
    void getGemProducts(cfg.products.map((p) => p.id)).then((products) => {
      if (!alive) return;
      const prices: Record<string, string> = {};
      for (const [id, product] of Object.entries(products)) prices[id] = product.priceString;
      setStorePrices(prices);
    });
    return () => {
      alive = false;
    };
  }, [cfg.products]);

  /** `none` is the message for a zero outcome; pass undefined to keep whatever
   *  note the op already set for itself (the ad row explains its own failures).
   *  Matches GetCoinsSheet.run. */
  const run = async (op: () => Promise<number>, gained: (n: number) => string, none?: string) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const got = await op();
      if (got > 0) {
        playSound("ding");
        setNote(gained(got));
      } else if (none !== undefined) {
        setNote(none);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} title="Gems">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <GemGlyph size={18} />
        <Text style={{ fontFamily: font.mono, fontSize: 16, color: palette.porcelain }}>{formatExact(have)}</Text>
        {note ? (
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, marginLeft: space.sm }}>
            {note}
          </Text>
        ) : null}
      </View>

      <SectionLabel>Get gems</SectionLabel>
      {cfg.products.map((p) => (
        <GemRow
          key={p.id}
          title={`${p.gems} gems`}
          subtitle={cfg.purchasesEnabled ? storePrices[p.id] ?? `$${p.priceUsd.toFixed(2)}` : "Coming soon"}
          disabled={!cfg.purchasesEnabled || busy}
          onPress={() => void run(() => buyGems(p.id), (n) => `+${n} gems`, "Purchase didn't go through")}
        />
      ))}

      {rewarded.gemGrant && cfg.enabled && adsAvailable ? (
        <GemRow
          title="Watch an ad"
          subtitle={
            busy
              ? "Loading…"
              : `${cfg.adGrant.amount} gem${cfg.adGrant.amount === 1 ? "" : "s"} · once a day`
          }
          disabled={busy}
          onPress={() =>
            void run(
              async () => {
                const res = await watchForReward("gems");
                if (res.status === "granted") return res.coins; // amount, in gems
                if (res.status === "pending") {
                  setNote("Reward on its way — it'll appear shortly");
                  return 0;
                }
                if (res.status === "unavailable") setNote(res.message ?? "No ad available right now");
                return 0;
              },
              (n) => `+${n} gem${n === 1 ? "" : "s"}`,
              "",
            )
          }
        />
      ) : null}

      <SectionLabel>Exchange for coins</SectionLabel>
      <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel, marginTop: -4 }}>
        1 gem = {cfg.exchangeRate} coins. One-way — coins never turn back into gems.
      </Text>
      {EXCHANGE_PRESETS.map((n) => (
        <GemRow
          key={n}
          title={`${n} gems`}
          subtitle={`→ ${formatCompact(n * cfg.exchangeRate)} coins`}
          coinYield
          disabled={busy || have < n || n < cfg.exchangeMin}
          onPress={() => void run(() => exchangeGems(n), (c) => `+${formatCompact(c)} coins`, "Exchange failed")}
        />
      ))}

      <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
        Gems unlock premium looks and convert to coins. They never affect how a game plays out.
      </Text>
    </Sheet>
  );
}

function GemRow({
  title,
  subtitle,
  coinYield = false,
  disabled,
  onPress,
}: {
  title: string;
  subtitle: string;
  coinYield?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${subtitle}`} disabled={disabled} onPress={onPress}>
      {({ pressed }) => (
        <Surface3D
          pressed={pressed && !disabled}
          style={{ opacity: disabled ? 0.45 : 1 }}
          faceStyle={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <GemGlyph size={16} />
            <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>{title}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {coinYield ? <CoinGlyph size={13} /> : null}
            <Text style={{ fontFamily: font.mono, fontSize: 13, color: palette.mutedSteel }}>{subtitle}</Text>
          </View>
        </Surface3D>
      )}
    </Pressable>
  );
}
