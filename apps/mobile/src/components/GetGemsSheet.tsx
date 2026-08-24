/**
 * Where gems come from and where they go: real-money packs (dark behind the
 * remote flag until real billing ships — rows read "Coming soon"), a rare
 * rewarded-ad drip, and the one-way gems→coins exchange. The balance line shows
 * the EXACT number — the compact pill's tap-to-reveal lands here.
 *
 * The ad row is deliberately the smallest thing on this sheet. Gems are the
 * premium tier, and the amount and the daily cap are BOTH server-owned — the
 * sheet only renders what it is told, so the drip can be retuned without a
 * store release (0027 set it to 1/day, 0048 to 5 gems x 5/day).
 *
 * When the day's allowance is gone the row greys but stays tappable, and says
 * so. It does not disappear: a reward that vanishes looks like a bug, where a
 * grey row that answers when poked reads as a limit.
 *
 * Everything gems buy is access or appearance. Nothing here, now or later,
 * may improve anyone's chance of winning a match.
 */

import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sheet } from "./Sheet";
import { SectionLabel } from "./SectionLabel";
import { Surface3D } from "./Surface3D";
import { GemGlyph } from "./GemGlyph";
import { CoinGlyph } from "./CoinsPill";
import { formatCompact, formatExact } from "../lib/format";
import { playSound } from "../lib/sound";
import { getGemProducts, isPurchasesConfigured } from "../lib/purchases";
import { gemPriceView } from "../lib/gemPricing";
import { gemAdRowView } from "../lib/gemAdRow";
import { watchForReward } from "../lib/ads/rewarded";
import { adRewardQuota, type AdRewardQuota } from "../net/api";
import { useAdsReady } from "../lib/ads/useAdsReady";
import { confirm, notice, type ConfirmRequest } from "../store/confirmStore";
import { buyGemsPrompt, exchangeGemsPrompt } from "../lib/gemPrompts";
import { useWallet } from "../store/walletStore";
import { useConfig } from "../store/configStore";
import { font, palette, space } from "../theme";

const EXCHANGE_PRESETS = [10, 50, 100];

/** Mirrors economy.ts CAP_REACHED. The server refuses in these words and the
 *  sheet pre-empts it in the same ones, so a player who taps anyway is never
 *  told two different stories about the same limit. */
const CAP_MESSAGE = "No more ads left for today — come back tomorrow.";

export function GetGemsSheet({ onClose }: { onClose: () => void }) {
  const gems = useWallet((s) => s.gems);
  const buyGems = useWallet((s) => s.buyGems);
  const exchangeGems = useWallet((s) => s.exchangeGems);
  const cfg = useConfig((s) => s.config.gems);
  const rewarded = useConfig((s) => s.config.ads.rewarded);
  const adsAvailable = useAdsReady();

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Localized store prices (RevenueCat) keyed by product id — the store picks
  // the figure for the customer's storefront, so this is the ONLY price we may
  // show. `pricesLoaded` separates "still asking" from "asked, got nothing":
  // one waits, the other admits the pack can't be bought right now.
  const [storePrices, setStorePrices] = useState<Record<string, string>>({});
  const [pricesLoaded, setPricesLoaded] = useState(false);
  // Server-owned: how many gem ads are left today, and what one pays. Null
  // means "not asked yet / ask failed", which is deliberately NOT the same as
  // zero — see loadQuota.
  const [quota, setQuota] = useState<AdRewardQuota | null>(null);
  const have = gems ?? 0;

  /** Re-read the allowance. Every failure path leaves the previous answer in
   *  place: greying the row out because one request timed out would hide a
   *  reward the player can actually collect, and the server refuses on its own
   *  count anyway, so an optimistic tap costs nothing but a message. */
  const loadQuota = useCallback(async () => {
    try {
      setQuota(await adRewardQuota("gems"));
    } catch {
      // Offline, or a server too old to know the op.
    }
  }, []);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  useEffect(() => {
    if (!isPurchasesConfigured()) return;
    let alive = true;
    void getGemProducts(cfg.products.map((p) => p.id)).then((products) => {
      if (!alive) return;
      const prices: Record<string, string> = {};
      for (const [id, product] of Object.entries(products)) prices[id] = product.priceString;
      setStorePrices(prices);
      setPricesLoaded(true);
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

  /**
   * Confirm, then run. The busy check happens BEFORE the prompt: `run` only
   * raises the flag once it starts, so without this a second row could open a
   * second dialog while the first is still being decided.
   *
   * Declining is not a failure — it leaves the note untouched and spends
   * nothing.
   */
  const ask = async (request: ConfirmRequest, op: () => Promise<number>, gained: (n: number) => string, none?: string) => {
    if (busy) return;
    if (!(await confirm(request))) return;
    await run(op, gained, none);
  };

  const gemWord = (n: number) => `${n} gem${n === 1 ? "" : "s"}`;
  // Config drives the row before the quota lands so it never renders blank;
  // the server's figures win the moment they arrive.
  const adRow = gemAdRowView({
    flagOn: rewarded.gemGrant,
    tierOn: cfg.enabled,
    adsAvailable,
    busy,
    amount: quota?.amount ?? cfg.adGrant.amount,
    cap: quota?.cap ?? cfg.adGrant.dailyCap,
    remaining: quota?.remaining,
    serverEnabled: quota?.enabled,
  });

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
      {cfg.products.map((p) => {
        // The store's own localized string or nothing — never the config's USD
        // figure, which is right for one storefront and wrong for every other.
        const price = storePrices[p.id];
        const view = gemPriceView({
          purchasesEnabled: cfg.purchasesEnabled,
          storeConfigured: isPurchasesConfigured(),
          storePrice: price,
          pricesLoaded,
          dev: typeof __DEV__ !== "undefined" && __DEV__,
        });
        return (
          <GemRow
            key={p.id}
            title={`${p.gems} gems`}
            subtitle={view.label}
            disabled={!view.buyable || busy}
            onPress={() => void ask(buyGemsPrompt(p.gems, price), () => buyGems(p.id), (n) => `+${n} gems`, "Purchase didn't go through")}
          />
        );
      })}

      {adRow.visible ? (
        <GemRow
          title="Watch an ad"
          subtitle={adRow.label}
          // Spent is DIMMED, not disabled. The tap still has to land so the row
          // can say why it's grey — a dead button explains nothing, and this is
          // the one state a player is most likely to poke at twice.
          dimmed={adRow.spent}
          disabled={busy}
          onPress={() => {
            if (adRow.spent) {
              void notice({ title: "That's all for today", message: CAP_MESSAGE });
              return;
            }
            void run(
              async () => {
                const res = await watchForReward("gems");
                // Re-read rather than decrementing locally, on every outcome:
                // only a settled SSV callback actually spends a slot, and the
                // client is in no position to know whether one landed.
                void loadQuota();
                if (res.status === "granted") return res.coins; // amount, in gems
                if (res.status === "pending") {
                  setNote("Reward on its way — it'll appear shortly");
                  return 0;
                }
                if (res.status === "unavailable") setNote(res.message ?? "No ad available right now");
                return 0;
              },
              (n) => `+${gemWord(n)}`,
              "",
            );
          }}
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
          onPress={() =>
            void ask(
              exchangeGemsPrompt(n, n * cfg.exchangeRate),
              () => exchangeGems(n),
              (c) => `+${formatCompact(c)} coins`,
              "Exchange failed",
            )
          }
        />
      ))}

      <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
        Gems unlock premium looks and convert to coins. They never affect how a game plays out.
      </Text>
    </Sheet>
  );
}

/**
 * `disabled` and `dimmed` are both greyed, and the difference is whether the
 * tap does anything: disabled is "busy, wait", dimmed is "spent, and here's
 * why". Separating them is what lets the exhausted ad row look inert and still
 * answer for itself.
 */
function GemRow({
  title,
  subtitle,
  coinYield = false,
  disabled,
  dimmed = false,
  onPress,
}: {
  title: string;
  subtitle: string;
  coinYield?: boolean;
  disabled: boolean;
  dimmed?: boolean;
  onPress: () => void;
}) {
  const grey = disabled || dimmed;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      accessibilityState={{ disabled: grey }}
      disabled={disabled}
      onPress={onPress}
    >
      {({ pressed }) => (
        <Surface3D
          pressed={pressed && !grey}
          style={{ opacity: grey ? 0.45 : 1 }}
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
