/**
 * The daily bonus, promoted from a 7px dot to a real doorway: a compact
 * raised pill with a drawn chest that opens when a claim is waiting. Claiming
 * itself stays in GetCoinsSheet — one claim surface, no duplicated logic.
 */

import { Pressable, Text, View } from "react-native";
import { Surface3D } from "./Surface3D";
import { ChestGlyph } from "./HomeGlyphs";
import { CoinGlyph } from "./CoinsPill";
import { font, palette, radius, space } from "../theme";

interface DailyChestTileProps {
  onPress: () => void;
  claimable: boolean;
  /** Banked streak days (0 on a fresh streak). */
  streakDay: number;
  /** What the next claim pays — quoted only while claimable. */
  nextBonus: number;
}

export function DailyChestTile({ onPress, claimable, streakDay, nextBonus }: DailyChestTileProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={claimable ? `Daily bonus ready, ${nextBonus} coins` : `Daily bonus, day ${streakDay}`}
      onPress={onPress}
      style={{ alignSelf: "flex-start" }}
    >
      {({ pressed }) => (
        <Surface3D
          rad={radius.md}
          pressed={pressed}
          faceStyle={{
            height: 48 - 3,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.md,
          }}
        >
          <ChestGlyph size={24} open={claimable} color={claimable ? "#C8951B" : palette.mutedSteel} />
          <View style={{ gap: 1 }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 12, color: palette.porcelain }}>Daily bonus</Text>
            {claimable ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <CoinGlyph size={10} />
                <Text style={{ fontFamily: font.mono, fontSize: 11, color: "#F5C542" }}>+{nextBonus}</Text>
              </View>
            ) : (
              <Text style={{ fontFamily: font.mono, fontSize: 11, color: palette.mutedSteel }}>
                {streakDay > 0 ? `Day ${streakDay}` : "Back tomorrow"}
              </Text>
            )}
          </View>
        </Surface3D>
      )}
    </Pressable>
  );
}
