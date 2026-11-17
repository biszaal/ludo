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
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { create } from "zustand";
import { adsSdk } from "../lib/ads/native";
import { bannerUnitId, type BannerSlot } from "../lib/ads/units";
import { useAdsReady } from "../lib/ads/useAdsReady";
import { noteAdError } from "../lib/ads/provider";
import { nextPromo, promosFor } from "../lib/ads/promos";
import { PromoCard } from "./PromoCard";
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

/**
 * Slots that have given up for this session: every retry came back empty and
 * there is none of our own apps to show in their place (Android, today). The
 * slot then takes no space at all, rather than leaving a grey band where a
 * banner never arrives. Shared rather than component state because Home budgets
 * its column around the slot's height before the slot renders. Not persisted —
 * the next launch tries again.
 */
const useGaveUp = create<{ slots: Partial<Record<BannerSlot, true>>; give: (slot: BannerSlot) => void }>((set) => ({
  slots: {},
  give: (slot) => set((s) => ({ slots: { ...s.slots, [slot]: true } })),
}));

/**
 * The height a slot holds from its first frame — 0 when it renders nothing (ads
 * off, Remove Ads owned, or a client without the ads SDK).
 *
 * For a screen that budgets its own height around the banner: Home places the
 * banner inside its column, above the dock, so its budget has to know the
 * banner's size before layout rather than discover it a frame late. One
 * definition, shared with AdSlot below, so the two cannot drift.
 */
export function useAdSlotHeight(slot: BannerSlot): number {
  const config = useConfig((s) => s.config);
  const entitled = useNoAds();
  const { width: screenWidth } = useWindowDimensions();
  const gaveUp = useGaveUp((s) => s.slots[slot] === true);
  const expected = adsSdk !== null && adsEnabled(config, entitled) && config.ads.banner[slot];
  if (!expected || gaveUp) return 0;
  return slot === "lobby" ? RECT.height : anchoredBannerHeight(screenWidth);
}

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
  // Google has said "no" at least once on this mount. From then until a banner
  // fills, the slot shows one of our own apps where there is one to show.
  const [failed, setFailed] = useState(false);
  // Chosen once per mount, so the card does not change under the player's
  // thumb on every retry.
  const [promo] = useState(() => nextPromo(promosFor(Platform.OS)));
  const gaveUp = useGaveUp((s) => s.slots[slot] === true);
  const giveUp = useGaveUp((s) => s.give);

  useEffect(() => {
    if (!waiting) return;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      // Out of retries. With a promo up, it simply stays; without one, the slot
      // folds away instead of holding an empty box for the rest of the session.
      if (!promo) giveUp(slot);
      return;
    }
    const timer = setTimeout(() => {
      setAttempt((a) => a + 1);
      setWaiting(false);
    }, delay);
    return () => clearTimeout(timer);
  }, [waiting, attempt, promo, giveUp, slot]);

  // The real entitlement (0063). Subscribed rather than read once: a purchase
  // made from the shop has to take the banner off this screen without a
  // remount, and the sheet the player bought from is mounted over it.
  const entitled = useNoAds();

  const expected = adsSdk !== null && adsEnabled(config, entitled) && config.ads.banner[slot];
  if (!expected || gaveUp || !adsSdk) return null;
  const { BannerAd, BannerAdSize } = adsSdk;

  const rect = slot === "lobby";
  const height = rect ? RECT.height : anchoredBannerHeight(screenWidth);
  const requesting = ready && !waiting;
  // Outside a SkeletonGroup a block has no wave, which is what "flat" means.
  const block = <SkeletonBlock width={rect ? RECT.width : "100%"} height={height} rad={rect ? radius.sm : 0} />;
  const fill = [StyleSheet.absoluteFill, { alignItems: "center" as const, justifyContent: "center" as const }];
  const showPromo = !loaded && failed && promo !== null;

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
        !showPromo &&
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
          onAdFailedToLoad={(err) => {
            noteAdError("banner", err);
            setLoaded(false);
            setFailed(true);
            setWaiting(true);
          }}
        />
      )}
      {/* After the banner so it draws on top: a retry's banner view is mounted
          (and empty) underneath until it fills, and must not catch the tap
          meant for the card. A banner that does fill takes the card away. */}
      {showPromo && promo && (
        <View style={fill}>
          <PromoCard promo={promo} shape={rect ? "rect" : "strip"} height={height} />
        </View>
      )}
    </View>
  );
}
