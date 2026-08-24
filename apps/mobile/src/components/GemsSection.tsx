/**
 * Everything gems: where they come from, and the one thing they turn into.
 *
 * This is the Shop's fourth tab rather than a sheet. Gems used to live behind a
 * slide-up that every gem pill opened, which put a whole surface between
 * wanting gems and getting them — and then a second confirm dialog in front of
 * the store's own. The tab is the destination now: the pill navigates here, and
 * a pack tap goes straight to the store's confirmation.
 *
 * Two kinds of action, deliberately treated differently:
 *
 *   BUYING  the store shows the price and takes the approval, so asking first
 *           would be one decision confirmed twice.
 *   EXCHANGING  one-way, irreversible, and no system dialog stands behind it,
 *           so this one asks — the only place a prompt earns its place here.
 */

import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Pressable } from "react-native";
import { GemRow } from "./GemRow";
import { GemHoard } from "./GemHoard";
import { Surface3D } from "./Surface3D";
import { SectionLabel } from "./SectionLabel";
import { gemAdRowView } from "../lib/gemAdRow";
import { gemPriceView } from "../lib/gemPricing";
import { gemWaysView, hoardTierFor } from "../lib/gemWays";
import { formatCompact } from "../lib/format";
import { playSound } from "../lib/sound";
import { getGemProducts, isPurchasesConfigured } from "../lib/purchases";
import { watchForReward } from "../lib/ads/rewarded";
import { adRewardQuota, type AdRewardQuota } from "../net/api";
import { useAdsReady } from "../lib/ads/useAdsReady";
import { confirm, notice } from "../store/confirmStore";
import { buyGemsPrompt, exchangeGemsPrompt } from "../lib/gemPrompts";
import { useWallet } from "../store/walletStore";
import { useConfig } from "../store/configStore";
import { font, palette, radius, space, teamColor } from "../theme";

const EXCHANGE_PRESETS = [10, 50, 100];

/** Mirrors economy.ts CAP_REACHED, so a player who taps the spent row is never
 *  told a different story than the server would tell them. */
const CAP_MESSAGE = "No more ads left for today — come back tomorrow.";

export function GemsSection() {
  const have = useWallet((s) => s.gems) ?? 0;
  const buyGems = useWallet((s) => s.buyGems);
  const exchangeGems = useWallet((s) => s.exchangeGems);
  const cfg = useConfig((s) => s.config.gems);
  const rewarded = useConfig((s) => s.config.ads.rewarded);
  const adsAvailable = useAdsReady();

  const [quota, setQuota] = useState<AdRewardQuota | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [pricesLoaded, setPricesLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  /** Re-read the allowance rather than decrementing locally: only a settled
   *  SSV callback actually spends a slot, and the client cannot know whether
   *  one landed. */
  const loadQuota = () => void adRewardQuota("gems").then(setQuota);

  useEffect(() => {
    let live = true;
    void adRewardQuota("gems").then((q) => live && setQuota(q));
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

  /** Run an op and say what it gained. `none` is the message for a zero
   *  outcome; undefined keeps whatever note the op set for itself. */
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

  const ad = gemAdRowView({
    flagOn: rewarded.gemGrant,
    tierOn: cfg.enabled,
    adsAvailable,
    busy,
    amount: quota?.amount ?? cfg.adGrant.amount,
    cap: quota?.cap ?? cfg.adGrant.dailyCap,
    remaining: quota?.remaining,
    serverEnabled: quota?.enabled,
  });

  const packs = cfg.products.map((p) => ({
    ...p,
    view: gemPriceView({
      purchasesEnabled: cfg.purchasesEnabled,
      storeConfigured: isPurchasesConfigured(),
      storePrice: prices[p.id],
      pricesLoaded,
      dev: typeof __DEV__ !== "undefined" && __DEV__,
    }),
  }));

  const ways = gemWaysView({
    tierOn: cfg.enabled,
    packsBuyable: cfg.purchasesEnabled && (isPurchasesConfigured() || (typeof __DEV__ !== "undefined" && __DEV__)),
    adVisible: ad.visible,
  });

  return (
    <View style={{ gap: space.sm }}>
      {note ? (
        <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>{note}</Text>
      ) : null}

      {ways.visible ? <SectionLabel>Get gems</SectionLabel> : null}

      {ways.showPacks ? (
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {packs.map((p, i) => (
            <PackCard
              key={p.id}
              gems={p.gems}
              price={p.view.label}
              tier={hoardTierFor(i, packs.length)}
              disabled={!p.view.buyable || busy}
              onPress={async () => {
                // Normally straight to the store's own sheet: it names the
                // price and takes the approval, so asking first would confirm
                // one decision twice. The dev stub has no sheet, and without
                // this a tap would grant a pack with nothing in between —
                // which is exactly what it looked like.
                if (busy) return;
                if (p.view.confirmFirst && !(await confirm(buyGemsPrompt(p.gems, prices[p.id])))) return;
                await run(() => buyGems(p.id), (n) => `+${n} gems`);
              }}
            />
          ))}
        </View>
      ) : null}

      {ways.showAd ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Watch an ad for gems. ${ad.label}`}
          disabled={busy}
          onPress={() => {
            // Both greyed states still take the tap, because a dead button
            // explains nothing and these are the two a player pokes twice.
            if (ad.unavailable) {
              void notice({
                title: "Ads aren't ready",
                message: "This build can't show an ad right now. Gem packs still work.",
              });
              return;
            }
            if (ad.spent) {
              void notice({ title: "That's all for today", message: CAP_MESSAGE });
              return;
            }
            void run(
              async () => {
                const res = await watchForReward("gems");
                loadQuota();
                if (res.status === "granted") return res.coins; // the amount, in gems
                if (res.status === "pending") {
                  setNote("Reward on its way — it'll appear shortly");
                  return 0;
                }
                if (res.status === "unavailable") setNote(res.message ?? "No ad available right now");
                return 0;
              },
              (n) => `+${n} gem${n === 1 ? "" : "s"}`,
              "",
            );
          }}
        >
          {({ pressed }) => (
            <Surface3D
              pressed={pressed && !ad.spent && !ad.unavailable && !busy}
              rad={radius.md}
              style={{ opacity: ad.spent || ad.unavailable || busy ? 0.5 : 1 }}
              faceStyle={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingVertical: space.md,
                paddingHorizontal: space.lg,
              }}
            >
              <GemHoard tier="small" size={44} />
              <View style={{ flex: 1, gap: 1 }}>
                <Text style={{ fontFamily: font.semibold, fontSize: 16, color: palette.porcelain }}>
                  Watch an ad
                </Text>
                <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
                  {ad.label}
                </Text>
              </View>
              {/* Marigold, alone on the screen: the one thing here that costs
                  nothing, and the only place the free-vs-paid split is stated
                  in colour rather than words. */}
              <Text style={{ fontFamily: font.display, fontSize: 18, color: teamColor.yellow }}>
                {ad.spent || ad.unavailable ? "—" : `+${quota?.amount ?? cfg.adGrant.amount}`}
              </Text>
            </Surface3D>
          )}
        </Pressable>
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
          onPress={async () => {
            // The one prompt that earns its place: irreversible, and no system
            // dialog stands behind it to ask on our behalf.
            if (busy) return;
            if (!(await confirm(exchangeGemsPrompt(n, n * cfg.exchangeRate)))) return;
            await run(() => exchangeGems(n), (c) => `+${formatCompact(c)} coins`, "Exchange failed");
          }}
        />
      ))}

      <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
        Gems unlock premium looks and convert to coins. They never affect how a game plays out.
      </Text>
    </View>
  );
}

/**
 * One pack, sold by its hoard rather than its number.
 *
 * The art does the comparing — loose stones, a heap, a chest — so the eye picks
 * a tier before it reads a digit. Everything else stays quiet: one count, one
 * price, no badges, no "best value" ribbon. The chest is the loudest thing here
 * and that is the whole point.
 */
function PackCard({
  gems,
  price,
  tier,
  disabled,
  onPress,
}: {
  gems: number;
  price: string;
  tier: "small" | "medium" | "large";
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Buy ${gems} gems, ${price}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      {({ pressed }) => (
        <Surface3D
          pressed={pressed && !disabled}
          rad={radius.md}
          style={{ opacity: disabled ? 0.5 : 1 }}
          faceStyle={{ alignItems: "center", paddingVertical: space.md, paddingHorizontal: space.xs, gap: 2 }}
        >
          <GemHoard tier={tier} size={72} />
          <Text style={{ fontFamily: font.display, fontSize: 20, color: palette.porcelain }}>{gems}</Text>
          <Text numberOfLines={1} style={{ fontFamily: font.mono, fontSize: 12, color: palette.mutedSteel }}>
            {price}
          </Text>
        </Surface3D>
      )}
    </Pressable>
  );
}
