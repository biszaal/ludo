/**
 * Pre-game setup for online quick match, as a popup off the Home hub: pick
 * the table (1v1 / 4-player), pick the stake tier, then one PLAY. Structure
 * follows the arcade pre-game modal convention; every surface is the app's
 * own (Surface3D trays, drawn glyphs, TableSeats preview).
 *
 * Watching an ad covers the ENTRY FEE only — a seat at the table, never an
 * edge in play. Stake tiers are validated server-side; this list is display.
 */

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sheet } from "./Sheet";
import { SectionLabel } from "./SectionLabel";
import { Surface3D } from "./Surface3D";
import { TableSeats } from "./TableSeats";
import { CoinGlyph } from "./CoinsPill";
import { PlayCta } from "./PlayCta";
import { formatCompact } from "../lib/format";
import { canAfford, potFor } from "../lib/economy";
import { seatColors } from "../lib/seating";
import { watchForReward } from "../lib/ads/rewarded";
import { adsReady } from "../lib/ads/provider";
import { useWallet } from "../store/walletStore";
import { useConfig } from "../store/configStore";
import { useOnlineStore } from "../store/onlineStore";
import { font, palette, radius, space, teamColor } from "../theme";

interface QuickSetupSheetProps {
  onClose: () => void;
  /** The player is short on coins and tapped a tier they can't afford. */
  onNeedCoins: () => void;
}

export function QuickSetupSheet({ onClose, onNeedCoins }: QuickSetupSheetProps) {
  const balance = useWallet((s) => s.balance);
  const tiers = useConfig((s) => s.config.economy.stakeTiers);
  const freeEntryOn = useConfig((s) => s.config.ads.rewarded.freeEntry);
  const quickMatch = useOnlineStore((s) => s.quickMatch);
  const connecting = useOnlineStore((s) => s.status === "connecting");
  const error = useOnlineStore((s) => s.error);

  const [size, setSize] = useState<2 | 4>(2);
  const [stake, setStake] = useState<number>(tiers[0] ?? 100);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const lowest = tiers[0] ?? 100;
  const broke = !canAfford(balance, lowest);
  const canWatchIn = broke && freeEntryOn && adsReady();
  const stakeAffordable = canAfford(balance, stake);

  const watchForEntry = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await watchForReward("free-entry");
      if (res.status === "granted") setNote("Entry covered — press play");
      else if (res.status === "pending") setNote("Reward on its way — try again in a moment");
      else if (res.status === "unavailable") setNote(res.message ?? "No ad available right now");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} title="Quick match">
      <SectionLabel>Table</SectionLabel>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <TableTile size={2} title="1 vs 1" selected={size === 2} onPress={() => setSize(2)} />
        <TableTile size={4} title="4 players" selected={size === 4} onPress={() => setSize(4)} />
      </View>

      <SectionLabel>Entry</SectionLabel>
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {tiers.map((t) => (
          <StakeTile
            key={t}
            stake={t}
            pot={potFor(t, size)}
            selected={stake === t}
            affordable={canAfford(balance, t)}
            onPress={() => {
              if (canAfford(balance, t)) setStake(t);
              else onNeedCoins();
            }}
          />
        ))}
      </View>

      {broke ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Watch an ad to cover the entry fee"
          disabled={!canWatchIn || busy}
          onPress={() => void watchForEntry()}
          style={{
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            borderRadius: radius.md,
            backgroundColor: palette.liftedSlate,
            borderWidth: 1,
            borderColor: palette.hairline,
            opacity: canWatchIn && !busy ? 1 : 0.5,
            gap: 2,
          }}
        >
          <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>
            {canWatchIn ? "Watch an ad to play free" : `You need ${lowest} coins to enter`}
          </Text>
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
            {note ?? (busy ? "Loading…" : "Covers your entry — the game itself plays exactly the same")}
          </Text>
        </Pressable>
      ) : null}

      {error ? (
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: teamColor.red, textAlign: "center" }}>{error}</Text>
      ) : null}

      <PlayCta
        stake={stake}
        busy={connecting}
        onPress={() => {
          if (!stakeAffordable) {
            onNeedCoins();
            return;
          }
          void quickMatch(size, stake);
        }}
      />
    </Sheet>
  );
}

/** Selectable table-size tile: seats preview + diagonal/clockwise seat dots. */
function TableTile({ size, title, selected, onPress }: { size: 2 | 4; title: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected }} onPress={onPress} style={{ flex: 1 }}>
      {({ pressed }) => (
        <Surface3D
          pressed={pressed}
          faceColor={selected ? palette.liftedSlate : palette.raisedSlate}
          faceStyle={{
            alignItems: "center",
            paddingVertical: space.md,
            gap: space.sm,
            borderWidth: selected ? 1.5 : 0,
            borderColor: palette.porcelain,
            borderRadius: radius.md,
          }}
        >
          <TableSeats size={size} boardSize={64} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 14, color: palette.porcelain }}>{title}</Text>
            <View style={{ flexDirection: "row", gap: 4 }}>
              {seatColors(size).map((c) => (
                <View key={c} style={{ width: 8, height: 8, borderRadius: radius.pill, backgroundColor: teamColor[c] }} />
              ))}
            </View>
          </View>
        </Surface3D>
      )}
    </Pressable>
  );
}

/** A stake tier: entry big, pot beneath. Unaffordable renders dimmed. */
function StakeTile({
  stake,
  pot,
  selected,
  affordable,
  onPress,
}: {
  stake: number;
  pot: number;
  selected: boolean;
  affordable: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        affordable ? `Entry ${stake} coins, winner takes ${pot}` : `Entry ${stake} coins — not enough coins`
      }
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ flex: 1 }}
    >
      {({ pressed }) => (
        <Surface3D
          pressed={pressed}
          faceColor={selected ? palette.liftedSlate : palette.raisedSlate}
          style={{ opacity: affordable ? 1 : 0.45 }}
          faceStyle={{
            alignItems: "center",
            paddingVertical: space.md,
            gap: 3,
            borderWidth: selected ? 1.5 : 0,
            borderColor: palette.porcelain,
            borderRadius: radius.md,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <CoinGlyph size={13} />
            <Text style={{ fontFamily: font.mono, fontSize: 15, color: palette.porcelain }}>{formatCompact(stake)}</Text>
          </View>
          <Text style={{ fontFamily: font.regular, fontSize: 11, color: palette.mutedSteel }}>
            {affordable ? `Pot ${formatCompact(pot)}` : "Need coins"}
          </Text>
        </Surface3D>
      )}
    </Pressable>
  );
}
