/**
 * The Remove Ads offer, and its receipt once bought.
 *
 * Sits in the Shop above the cosmetics browser rather than inside it: the
 * browser sells appearance for earned currency, and this is the one thing in
 * the app bought with money that changes how the app behaves rather than how
 * it looks. Mixing it into the cosmetic grid would price it in coins by
 * association.
 *
 * Restore lives here too, next to the thing it restores. Apple requires a
 * restore path for any non-consumable, and burying it in Settings — where it
 * is genuinely conventional — means the player who needs it most (reinstalled,
 * ads back, feeling cheated) has to go looking for it.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Surface3D } from "./Surface3D";
import { SectionLabel } from "./SectionLabel";
import { Button } from "./Button";
import { getNoAdsProduct, isPurchasesConfigured } from "../lib/purchases";
import { removeAdsView } from "../lib/removeAdsView";
import { useConfig } from "../store/configStore";
import { useEntitlements, useNoAds } from "../store/entitlementsStore";
import { playSound } from "../lib/sound";
import { font, palette, space } from "../theme";

export function RemoveAdsSection() {
  const cfg = useConfig((s) => s.config.ads.removeAds);
  const owned = useNoAds();
  const buyNoAds = useEntitlements((s) => s.buyNoAds);
  const restore = useEntitlements((s) => s.restore);
  const buying = useEntitlements((s) => s.buying);

  const [price, setPrice] = useState<string | undefined>(undefined);
  const [priceLoaded, setPriceLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Owned needs no price, and asking for one costs a store round trip on a
    // screen the player opens often.
    if (owned || !cfg.enabled) {
      setPriceLoaded(true);
      return;
    }
    void getNoAdsProduct(cfg.productId)
      .then((p) => live && setPrice(p?.priceString))
      .finally(() => live && setPriceLoaded(true));
    return () => {
      live = false;
    };
  }, [cfg.enabled, cfg.productId, owned]);

  const view = removeAdsView({
    offerEnabled: cfg.enabled,
    owned,
    storeConfigured: isPurchasesConfigured(),
    storePrice: price,
    priceLoaded,
  });

  if (view.kind === "hidden") return null;

  const working = busy || buying !== null;

  const onBuy = async () => {
    if (working) return;
    setBusy(true);
    setNote(null);
    try {
      const err = await buyNoAds(cfg.productId);
      if (err) setNote(err);
      else playSound("ding");
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async () => {
    if (working) return;
    setBusy(true);
    setNote(null);
    try {
      const restored = await restore();
      // Both outcomes need saying. Silence after a restore that found nothing
      // is the same screen as a restore that never ran.
      setNote(restored ? "Purchases restored." : "Nothing to restore on this account.");
      if (restored) playSound("ding");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: space.sm, width: "100%" }}>
      <SectionLabel>{view.kind === "owned" ? "Ad-free" : "Remove ads"}</SectionLabel>

      <Surface3D
        faceStyle={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>
            {view.kind === "owned" ? "Ads are off" : "Play without ads"}
          </Text>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>
            {view.kind === "owned"
              ? "Thanks — banners and between-match ads stay off."
              : "One purchase. Removes banners and between-match ads for good."}
          </Text>
        </View>

        {view.kind === "offer" ? (
          <Button label={view.price} compact disabled={working} onPress={() => void onBuy()} />
        ) : view.kind === "blocked" ? (
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>
            {view.label}
          </Text>
        ) : null}
      </Surface3D>

      {note ? (
        <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>{note}</Text>
      ) : null}

      {/* Always available, including when already owned: a player on a second
          device has the purchase but not the entitlement, and that is exactly
          who needs this button. */}
      <Button
        label="Restore purchases"
        variant="ghost"
        compact
        disabled={working}
        onPress={() => void onRestore()}
      />
    </View>
  );
}
