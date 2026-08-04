/**
 * Declarative banner. Renders nothing whenever an ad can't or shouldn't show —
 * no config, no consent, no fill, or a "remove ads" entitlement — so an empty
 * slot costs no layout at all.
 */

import { useState } from "react";
import { View } from "react-native";
import { adsSdk } from "../lib/ads/native";
import { bannerUnitId, type BannerSlot } from "../lib/ads/units";
import { useAdsReady } from "../lib/ads/useAdsReady";
import { useConfig } from "../store/configStore";
import { adsEnabled } from "../store/adsStore";

interface AdSlotProps {
  slot: BannerSlot;
}

export function AdSlot({ slot }: AdSlotProps) {
  const config = useConfig((s) => s.config);
  const [failed, setFailed] = useState(false);
  // Subscribed, not just read: this mounts well before initAds() resolves, and
  // a plain adsReady() call left the slot stuck on its first `false`.
  const ready = useAdsReady();

  // TODO(phase-8): swap `false` for the real `noads` entitlement once coin
  // packs ship. Wired through now so nothing has to be re-plumbed then.
  const entitled = false;

  const allowed =
    adsSdk !== null && adsEnabled(config, entitled) && config.ads.banner[slot] && ready && !failed;

  if (!allowed || !adsSdk) return null;
  const { BannerAd, BannerAdSize } = adsSdk;

  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <BannerAd
        unitId={bannerUnitId(slot)}
        // Lobby has a guaranteed 8-14s dwell on an otherwise empty screen, so
        // it earns the far higher-eCPM medium rectangle. Home is a thin anchor
        // that has to share space with the play cards.
        size={slot === "lobby" ? BannerAdSize.MEDIUM_RECTANGLE : BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}
