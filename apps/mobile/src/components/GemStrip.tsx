/**
 * Where gems come from, at the top of the Shop.
 *
 * A promotion surface, not a checkout. The pack chips open the Gems sheet,
 * which already owns the purchase state and is reachable from Home and the
 * cosmetics browser too — one buy flow, not two. The ad chip is different: a
 * rewarded view has no purchase state to own, so it starts the ad directly.
 *
 * Deliberately a single tight row rather than the showcase rail this replaced.
 * That rail listed every gem-priced item above a browser that already showed
 * the same items, which is how the top of the screen got crowded in the first
 * place. Two ways in, one line, then out of the way.
 *
 * The free chip carries the marigold accent and the paid ones stay neutral —
 * the one deliberate colour decision here, because "costs nothing" is the
 * distinction a player is actually scanning for.
 */

import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { GemGlyph } from "./GemGlyph";
import { SectionLabel } from "./SectionLabel";
import { Surface3D } from "./Surface3D";
import { gemAdRowView } from "../lib/gemAdRow";
import { gemPriceView } from "../lib/gemPricing";
import { gemStripView } from "../lib/gemStrip";
import { useConfig } from "../store/configStore";
import { useAdsReady } from "../lib/ads/useAdsReady";
import { watchForReward } from "../lib/ads/rewarded";
import { getGemProducts, isPurchasesConfigured } from "../lib/purchases";
import { adRewardQuota, type AdRewardQuota } from "../net/api";
import { font, palette, radius, space, teamColor } from "../theme";

export function GemStrip({ onOpenGems }: { onOpenGems: () => void }) {
  const cfg = useConfig((s) => s.config.gems);
  const rewarded = useConfig((s) => s.config.ads.rewarded);
  const adsAvailable = useAdsReady();
  const [gemQuota, setGemQuota] = useState<AdRewardQuota | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [pricesLoaded, setPricesLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void adRewardQuota("gems").then((q) => live && setGemQuota(q));
    void getGemProducts(cfg.products.map((p) => p.id))
      .then((products) => {
        if (!live) return;
        const next: Record<string, string> = {};
        for (const [id, product] of Object.entries(products)) next[id] = product.priceString;
        setPrices(next);
      })
      .finally(() => live && setPricesLoaded(true));
    return () => {
      live = false;
    };
  }, [cfg.products]);

  const ad = gemAdRowView({
    flagOn: !!rewarded.gemGrant,
    tierOn: cfg.enabled,
    adsAvailable,
    busy,
    amount: gemQuota?.amount ?? cfg.adGrant.amount,
    cap: gemQuota?.cap ?? cfg.adGrant.dailyCap,
    remaining: gemQuota?.remaining,
    serverEnabled: gemQuota?.enabled,
  });

  const packs = cfg.products.map((p) => ({
    ...p,
    view: gemPriceView({
      purchasesEnabled: cfg.purchasesEnabled,
      storeConfigured: isPurchasesConfigured(),
      storePrice: prices[p.id],
      pricesLoaded,
      dev: __DEV__,
    }),
  }));

  // Deliberately NOT "some pack is buyable right now": that is false until the
  // store's prices land, so the chips would pop in a beat after the strip drew
  // and shift the row. Whether packs can be bought AT ALL is stable from the
  // first frame, and each chip still shows its own price — or a "…" while it
  // waits — through gemPriceView.
  const strip = gemStripView({
    tierOn: cfg.enabled,
    packsBuyable: cfg.purchasesEnabled && (isPurchasesConfigured() || __DEV__),
    adVisible: ad.visible,
  });

  if (!strip.visible) return null;

  return (
    <View style={{ gap: space.sm, width: "100%" }}>
      <SectionLabel>Get gems</SectionLabel>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {strip.showAd ? (
          <Chip
            accent
            dimmed={ad.spent}
            label={ad.spent ? "Tomorrow" : "Watch"}
            sub={`+${gemQuota?.amount ?? cfg.adGrant.amount}`}
            accessibilityLabel={`Watch an ad for gems. ${ad.label}`}
            onPress={async () => {
              if (ad.spent) return onOpenGems();
              setBusy(true);
              try {
                await watchForReward("gems");
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}

        {strip.showPacks
          ? packs.map((p) => (
              <Chip
                key={p.id}
                label={String(p.gems)}
                sub={p.view.label}
                dimmed={!p.view.buyable}
                accessibilityLabel={`${p.gems} gems, ${p.view.label}`}
                onPress={onOpenGems}
              />
            ))
          : null}
      </View>
    </View>
  );
}

/**
 * One way in. Same raised-piece depth as every other tappable surface, sized
 * to sit four-across on a narrow phone without wrapping.
 */
function Chip({
  label,
  sub,
  accent = false,
  dimmed = false,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  sub: string;
  accent?: boolean;
  dimmed?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      {({ pressed }) => (
        <Surface3D
          pressed={pressed && !dimmed}
          rad={radius.sm}
          style={{ opacity: dimmed ? 0.45 : 1 }}
          faceStyle={{
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            paddingVertical: space.md,
            paddingHorizontal: space.xs,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <GemGlyph size={13} />
            <Text
              numberOfLines={1}
              style={{
                fontFamily: font.semibold,
                fontSize: 15,
                color: accent ? teamColor.yellow : palette.porcelain,
              }}
            >
              {label}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            style={{ fontFamily: font.mono, fontSize: 11, color: palette.mutedSteel }}
          >
            {sub}
          </Text>
        </Surface3D>
      )}
    </Pressable>
  );
}
