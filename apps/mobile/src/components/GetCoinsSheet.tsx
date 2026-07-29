/**
 * Where coins come from. Replaces 0010's invisible auto-refill with something
 * the player actually does: claim the daily bonus, or — only when truly at
 * zero — take the once-a-day rescue grant.
 *
 * Everything offered here buys ACCESS (match entry) or APPEARANCE. Nothing on
 * this sheet, now or later, may improve anyone's chance of winning a match.
 *
 * The rewarded-ad row lands in Phase 5; the layout leaves room for it.
 */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CoinGlyph } from "./CoinsPill";
import { Sheet } from "./Sheet";
import { Surface3D } from "./Surface3D";
import { useWallet } from "../store/walletStore";
import { useConfig } from "../store/configStore";
import { watchForReward } from "../lib/ads/rewarded";
import { adsReady } from "../lib/ads/provider";
import { nextDailyBonus } from "../lib/economy";
import { formatExact } from "../lib/format";
import { playSound } from "../lib/sound";
import { depth, font, palette, radius, space } from "../theme";

export function GetCoinsSheet({ onClose }: { onClose: () => void }) {
  const balance = useWallet((s) => s.balance);
  const streakDay = useWallet((s) => s.streakDay);
  const bonusClaimable = useWallet((s) => s.bonusClaimable);
  const pityAvailable = useWallet((s) => s.pityAvailable);
  const claimDailyBonus = useWallet((s) => s.claimDailyBonus);
  const claimPity = useWallet((s) => s.claimPity);
  const economy = useConfig((s) => s.config.economy);
  const rewarded = useConfig((s) => s.config.ads.rewarded);

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Shown so the streak reads as worth keeping rather than as a mystery number.
  const nextBonus = nextDailyBonus(streakDay, economy);

  /** `none` is the message for a zero-coin outcome; pass undefined to keep
   *  whatever note the claim already set for itself. */
  const run = async (claim: () => Promise<number>, none?: string) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const got = await claim();
      if (got > 0) {
        playSound("ding");
        setNote(`+${got} coins`);
      } else if (none !== undefined) {
        setNote(none);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} title="Get coins">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <CoinGlyph size={16} />
        {/* Exact here — this is where the compact pill's tap-to-reveal lands. */}
        <Text style={{ fontFamily: font.mono, fontSize: 15, color: palette.porcelain }}>{formatExact(balance ?? 0)}</Text>
        {note ? (
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, marginLeft: space.sm }}>
            {note}
          </Text>
        ) : null}
      </View>

      <CoinRow
        title="Daily bonus"
        subtitle={
          bonusClaimable
            ? streakDay > 0
              ? `Day ${Math.min(streakDay + 1, economy.streakMaxDay)} streak — claim ${nextBonus}`
              : `Claim ${nextBonus} coins`
            : "Come back tomorrow to keep the streak"
        }
        amount={bonusClaimable ? nextBonus : null}
        disabled={!bonusClaimable || busy}
        onPress={() => void run(claimDailyBonus, "Already claimed today")}
      />

      {/* Rewarded video. Buys coins for match entry and cosmetics only —
          never an in-game advantage. */}
      {rewarded.coinGrant && adsReady() ? (
        <CoinRow
          title="Watch an ad"
          subtitle={busy ? "Loading…" : "A short video for coins"}
          amount={null}
          disabled={busy}
          onPress={() =>
            void run(async () => {
              const res = await watchForReward("coins");
              if (res.status === "granted") return res.coins;
              if (res.status === "pending") {
                setNote("Reward on its way — it'll appear shortly");
                return 0;
              }
              if (res.status === "unavailable") setNote(res.message ?? "No ad available right now");
              return 0;
            })
          }
        />
      ) : null}

      {/* Only surfaces at zero — a safety net, not an income stream. */}
      {pityAvailable ? (
        <CoinRow
          title="Out of coins"
          subtitle="Here's enough for one more game"
          amount={economy.quickStake}
          disabled={busy}
          onPress={() => void run(claimPity, "Not available right now")}
        />
      ) : null}

      <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
        Coins are for entering matches and unlocking looks. They never affect how a game plays out.
      </Text>
    </Sheet>
  );
}

function CoinRow({
  title,
  subtitle,
  amount,
  disabled,
  onPress,
}: {
  title: string;
  subtitle: string;
  amount: number | null;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}>
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
          <View style={{ gap: 2, flexShrink: 1, paddingRight: space.md }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>{title}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>{subtitle}</Text>
          </View>
          {amount !== null ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <CoinGlyph size={14} />
              <Text style={{ fontFamily: font.mono, fontSize: 14, color: palette.porcelain }}>+{amount}</Text>
            </View>
          ) : null}
        </Surface3D>
      )}
    </Pressable>
  );
}
