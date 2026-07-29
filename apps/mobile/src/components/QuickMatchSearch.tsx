/**
 * The matchmaking wait for a quick match: your avatar is already in its seat and
 * the table ripples while the remaining seats look for someone. Each arrival
 * springs into their corner with a tap and a pop, so the wait has a visible
 * shape instead of a spinner counting nothing (DESIGN.md §4).
 *
 * The player-count text tracks the real lobby, which the online store keeps live
 * over the realtime `players` subscription.
 */

import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "./TableBackground";
import { Button } from "./Button";
import { AdSlot } from "./AdSlot";
import { TableSeats, type SeatOccupant } from "./TableSeats";
import { useOnlineStore } from "../store/onlineStore";
import { tapLight } from "../lib/haptics";
import { playSound } from "../lib/sound";
import { font, palette, space, teamColor } from "../theme";
import type { Color as PlayerColor } from "@ludo/engine";

export function QuickMatchSearch() {
  const lobby = useOnlineStore((s) => s.lobby);
  const profiles = useOnlineStore((s) => s.profiles);
  const userId = useOnlineStore((s) => s.userId);
  const quickSize = useOnlineStore((s) => s.quickSize);
  const error = useOnlineStore((s) => s.error);
  const leave = useOnlineStore((s) => s.leave);

  const size: 2 | 4 = quickSize === 4 ? 4 : 2;
  const seated = Math.min(lobby.length, size);

  // Cheer arrivals, but only ones we actually witness — the lobby we mount with
  // already has us (and possibly an opponent) in it, and chirping on entry
  // would make the screen feel like it fired twice.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(lobby.map((p) => p.user_id));
    const previous = seen.current;
    seen.current = ids;
    if (previous === null) return;
    let joined = false;
    ids.forEach((id) => {
      if (!previous.has(id) && id !== userId) joined = true;
    });
    if (joined) {
      tapLight();
      playSound("pop");
    }
  }, [lobby, userId]);

  const occupants: Partial<Record<PlayerColor, SeatOccupant>> = {};
  for (const p of lobby) {
    occupants[p.color] = { avatarId: profiles[p.user_id]?.avatar_id };
  }

  const headline = size === 4 ? `Finding players… ${seated}/4` : "Finding an opponent…";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Quick match</Text>
          <Button label="Cancel" onPress={leave} variant="ghost" />
        </View>

        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.xl }}
          accessibilityRole="progressbar"
          accessibilityLabel={`Finding players, ${seated} of ${size} seated`}
        >
          <TableSeats size={size} occupants={occupants} searching boardSize={230} />

          <View style={{ alignItems: "center", gap: space.sm }}>
            <Text style={{ fontFamily: font.semibold, fontSize: 18, color: palette.porcelain }}>{headline}</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 14, color: palette.mutedSteel, textAlign: "center" }}>
              {size === 4 ? "Filling a 4-player table." : "Matching you with another player."}
              {"\n"}This usually takes a few seconds.
            </Text>
            {error ? (
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: teamColor.red, textAlign: "center" }}>{error}</Text>
            ) : null}
          </View>
        </View>

        {/* Matchmaking parks the player here for 8-14s on an otherwise empty
            screen — the best banner inventory in the app. */}
        <View style={{ paddingBottom: space.lg }}>
          <AdSlot slot="lobby" />
        </View>
      </View>
    </SafeAreaView>
  );
}
