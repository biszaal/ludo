/**
 * Declarative banner. Renders nothing whenever an ad can't or shouldn't show —
 * no config, no consent, no fill, or a "remove ads" entitlement — so an empty
 * slot costs no layout at all.
 */

import { useEffect, useState } from "react";
import { View } from "react-native";
import { adsSdk } from "../lib/ads/native";
import { bannerUnitId, type BannerSlot } from "../lib/ads/units";
import { useAdsReady } from "../lib/ads/useAdsReady";
import { useConfig } from "../store/configStore";
import { adsEnabled } from "../store/adsStore";

interface AdSlotProps {
  slot: BannerSlot;
}

/**
 * "No fill" is the normal answer, not an error — especially for a young app,
 * where a unit can take days before it reliably serves. A BannerAd requests
 * once per mount, so treating the first failure as final (which is what this
 * did) hid the slot for the entire time the screen stayed up, on exactly the
 * accounts that most need the impressions.
 *
 * Retry a few times instead, backing off so a genuinely unfillable slot stops
 * costing requests. Home is a long-lived screen; three tries over ~2 minutes
 * covers the common case of an SDK that just came up.
 */
const RETRY_DELAYS_MS = [20_000, 45_000, 90_000];

export function AdSlot({ slot }: AdSlotProps) {
  const config = useConfig((s) => s.config);
  // Subscribed, not just read: this mounts well before initAds() resolves, and
  // a plain adsReady() call left the slot stuck on its first `false`.
  const ready = useAdsReady();

  // Bumped per retry; also the BannerAd's key, so each attempt is a fresh
  // request rather than a re-render of the failed one.
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return; // out of retries — stay hidden
    const t = setTimeout(() => {
      setAttempt((a) => a + 1);
      setWaiting(false);
    }, delay);
    return () => clearTimeout(t);
  }, [waiting, attempt]);

  // TODO(phase-8): swap `false` for the real `noads` entitlement once coin
  // packs ship. Wired through now so nothing has to be re-plumbed then.
  const entitled = false;

  const givenUp = waiting && RETRY_DELAYS_MS[attempt] === undefined;
  const allowed =
    adsSdk !== null && adsEnabled(config, entitled) && config.ads.banner[slot] && ready && !waiting && !givenUp;

  if (!allowed || !adsSdk) return null;
  const { BannerAd, BannerAdSize } = adsSdk;

  return (
    <View style={{ alignItems: "center", justifyContent: "center" }}>
      <BannerAd
        key={attempt}
        unitId={bannerUnitId(slot)}
        // Lobby has a guaranteed 8-14s dwell on an otherwise empty screen, so
        // it earns the far higher-eCPM medium rectangle. Home is a thin anchor
        // that has to share space with the play cards.
        size={slot === "lobby" ? BannerAdSize.MEDIUM_RECTANGLE : BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => setWaiting(true)}
      />
    </View>
  );
}
