/**
 * The bottom dock: one continuous raised tray with four drawn-glyph doorways
 * (Home / Shop / Friends / Account). Counts and handlers come in as props —
 * the dock renders, its owner decides.
 *
 * How to play is deliberately not here: it is a leaf reached from Settings and
 * the pause menu, and a fifth item would crowd four labels off the tray.
 */

import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Surface3D } from "./Surface3D";
import { BagGlyph, HouseGlyph, PeopleGlyph, UserGlyph } from "./HomeGlyphs";
import { useLayout } from "../lib/useLayout";
import type { TabName } from "../lib/tabs";
import { font, palette, radius, space, teamColor } from "../theme";

interface HomeDockProps {
  onHome: () => void;
  onShop: () => void;
  onFriends: () => void;
  onAccount: () => void;
  /** Pending friend requests → red badge on Friends. */
  requestCount: number;
  /** Friends online right now → green dot on Friends. */
  onlineCount: number;
  /** Equipped dice colors → tiny "your look" chip on the Shop bag. */
  equipped: { face: string; pip: string };
  /** Tray height from the hub's budget; natural size when unset. */
  height?: number;
  /**
   * The doorway you are currently standing in, lit up. Null on the hub — home
   * is the room behind the dock, not one of its four items.
   */
  active?: TabName | null;
}

export function HomeDock({
  onHome,
  onShop,
  onFriends,
  onAccount,
  requestCount,
  onlineCount,
  equipped,
  height: budget,
  active = null,
}: HomeDockProps) {
  const { scale } = useLayout();
  const natural = Math.round(64 * scale);
  const height = budget ?? natural;
  // Glyphs and labels ride the tray: a compressed dock keeps both readable
  // instead of clipping fixed-size art against a shorter face.
  const k = height / natural;
  const g = Math.round(Math.max(18, 24 * scale * k));
  const lbl = Math.round(Math.max(9, Math.min(14, 11 * scale * k)));
  return (
    <Surface3D rad={radius.lg} faceStyle={{ height: height - 3, flexDirection: "row", alignItems: "stretch" }}>
      <DockItem label="Home" onPress={onHome} labelSize={lbl} active={active === "home"}>
        <HouseGlyph size={g} />
      </DockItem>

      <DockItem label="Shop" onPress={onShop} labelSize={lbl} active={active === "shop"}>
        <BagGlyph size={g} />
        {/* The equipped look leaks into the dock: a chip in your dice colors. */}
        <View
          style={{
            position: "absolute",
            right: -3,
            bottom: -1,
            width: 10,
            height: 10,
            borderRadius: 3,
            backgroundColor: equipped.face,
            borderWidth: 1,
            borderColor: "rgba(0,0,0,0.35)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: equipped.pip }} />
        </View>
      </DockItem>

      <DockItem label="Friends" onPress={onFriends} badge={requestCount} labelSize={lbl} active={active === "friends"}>
        <PeopleGlyph size={g} />
        {onlineCount > 0 ? (
          <View
            style={{
              position: "absolute",
              right: -3,
              bottom: -1,
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: "#4ADE80",
              borderWidth: 1,
              borderColor: palette.raisedSlate,
            }}
          />
        ) : null}
      </DockItem>

      <DockItem label="Account" onPress={onAccount} labelSize={lbl} active={active === "account"}>
        <UserGlyph size={g} />
      </DockItem>
    </Surface3D>
  );
}

function DockItem({ label, onPress, badge = 0, labelSize = 11, active = false, children }: { label: string; onPress: () => void; badge?: number; labelSize?: number; active?: boolean; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={badge > 0 ? `${label}, ${badge} requests` : label}
      onPress={onPress}
      style={({ pressed }) => ({ flex: 1, alignItems: "center", justifyContent: "center", gap: 4, opacity: pressed ? 0.7 : 1 })}
    >
      <View>
        {children}
        {badge > 0 ? (
          <View
            style={{
              position: "absolute",
              top: -5,
              right: -9,
              minWidth: 16,
              height: 16,
              paddingHorizontal: 4,
              borderRadius: radius.pill,
              backgroundColor: teamColor.red,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontFamily: font.semibold, fontSize: 10, color: palette.porcelain }}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={{
          fontFamily: active ? font.semibold : font.medium,
          fontSize: labelSize,
          color: active ? palette.porcelain : palette.mutedSteel,
        }}
      >
        {label}
      </Text>
      {/* Not colour alone: the lit doorway also carries a pip. */}
      <View
        style={{
          position: "absolute",
          bottom: 2,
          width: 14,
          height: 2,
          borderRadius: 1,
          backgroundColor: active ? palette.porcelain : "transparent",
        }}
      />
    </Pressable>
  );
}
