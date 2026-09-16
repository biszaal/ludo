/**
 * Declarative banner. Renders nothing when no ad is expected here — no SDK, ads
 * off in config, this slot switched off, or a "remove ads" entitlement. When one
 * IS expected it holds the banner's full height from the first frame, with a
 * skeleton while a request is out, so the screen never moves when an ad lands or
 * fails to.
 *
 * The entitlement only reaches that first check, so whatever turns ads off for a
 * player — the one-off purchase today, a subscription later — takes the reserved
 * space and the skeleton away with the banner.
 */

import { useEffect, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { adsSdk } from "../lib/ads/native";
import { bannerUnitId, type BannerSlot } from "../lib/ads/units";
import { useAdsReady } from "../lib/ads/useAdsReady";
import { useT } from "../i18n";
import { radius } from "../theme";
import { useConfig } from "../store/configStore";
import { adsEnabled, anchoredBannerHeight } from "../store/adsStore";
import { useNoAds } from "../store/entitlementsStore";
import { SkeletonBlock, SkeletonGroup } from "./Skeleton";

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

/** The lobby's fixed format: Google's medium rectangle. */
const RECT = { width: 300, height: 250 };

export function AdSlot({ slot }: AdSlotProps) {
  const t = useT();
  const config = useConfig((s) => s.config);
  // Subscribed, not just read: this mounts well before initAds() resolves, and
  // a plain adsReady() call left the slot stuck on its first `false`.
  const ready = useAdsReady();
  const { width: screenWidth } = useWindowDimensions();

  // Bumped per retry; also the BannerAd's key, so each attempt is a fresh
  // request rather than a re-render of the failed one.
  const [attempt, setAttempt] = useState(0);
  // True from a failure until the next attempt — and for good once the retries
  // run out, since the effect below then never clears it.
  const [waiting, setWaiting] = useState(false);
  // The current request filled: the skeleton's cue to step aside.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!waiting) return;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) return; // out of retries — stay empty
    const timer = setTimeout(() => {
      setAttempt((a) => a + 1);
      setWaiting(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [waiting, attempt]);

  // The real entitlement (0063). Subscribed rather than read once: a purchase
  // made from the shop has to take the banner off this screen without a
  // remount, and the sheet the player bought from is mounted over it.
  const entitled = useNoAds();

  const expected = adsSdk !== null && adsEnabled(config, entitled) && config.ads.banner[slot];
  if (!expected || !adsSdk) return null;
  const { BannerAd, BannerAdSize } = adsSdk;

  const rect = slot === "lobby";
  const height = rect ? RECT.height : anchoredBannerHeight(screenWidth);
  const requesting = ready && !waiting;
  // Outside a SkeletonGroup a block has no wave, which is what "flat" means.
  const block = <SkeletonBlock width={rect ? RECT.width : "100%"} height={height} rad={rect ? radius.sm : 0} />;
  const fill = [StyleSheet.absoluteFill, { alignItems: "center" as const, justifyContent: "center" as const }];

  return (
    // minHeight, not height: if the SDK ever hands back a taller banner than
    // anchoredBannerHeight predicts, the box grows a few pt instead of clipping
    // the ad.
    <View style={{ minHeight: height, alignItems: "center", justifyContent: "center" }}>
      {/* Until an ad fills it, the box shows the banner's shape: shimmering
          while a request is out, flat otherwise (before the SDK is ready, which
          consent can hold back indefinitely, and after a failure). Flat because
          a slot that never fills must not shimmer at the player forever; a shape
          rather than nothing because an empty band reads as a broken layout. */}
      {!loaded &&
        (requesting ? (
          <SkeletonGroup label={t("common.loading")} style={fill}>
            {block}
          </SkeletonGroup>
        ) : (
          <View style={fill} pointerEvents="none">
            {block}
          </View>
        ))}
      {requesting && (
        <BannerAd
          key={attempt}
          unitId={bannerUnitId(slot)}
          // Lobby has a guaranteed 8-14s dwell on an otherwise empty screen, so
          // it earns the far higher-eCPM medium rectangle. Home is a thin anchor
          // that has to share space with the play cards.
          size={rect ? BannerAdSize.MEDIUM_RECTANGLE : BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          onAdLoaded={() => setLoaded(true)}
          onAdFailedToLoad={() => {
            setLoaded(false);
            setWaiting(true);
          }}
        />
      )}
    </View>
  );
}
