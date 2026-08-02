/**
 * The hub's bottom dock: one continuous raised tray with four drawn-glyph
 * doorways (Shop / Friends / Stats / How to play). Counts and handlers come
 * in as props — the dock renders, HomeScreen decides.
 */

import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Surface3D } from "./Surface3D";
import { BagGlyph, BookGlyph, PeopleGlyph, UserGlyph } from "./HomeGlyphs";
import { useLayout } from "../lib/useLayout";
import { font, palette, radius, space, teamColor } from "../theme";

interface HomeDockProps {
  onShop: () => void;
  onFriends: () => void;
  onAccount: () => void;
  onHowToPlay: () => void;
  /** Pending friend requests → red badge on Friends. */
  requestCount: number;
  /** Friends online right now → green dot on Friends. */
  onlineCount: number;
  /** Equipped dice colors → tiny "your look" chip on the Shop bag. */
  equipped: { face: string; pip: string };
}

export function HomeDock({ onShop, onFriends, onAccount, onHowToPlay, requestCount, onlineCount, equipped }: HomeDockProps) {
  const { scale } = useLayout();
  const g = Math.round(24 * scale);
  const lbl = Math.round(11 * scale);
  const height = Math.round(64 * scale);
  return (
    <Surface3D rad={radius.lg} faceStyle={{ height: height - 3, flexDirection: "row", alignItems: "stretch" }}>
      <DockItem label="Shop" onPress={onShop} labelSize={lbl}>
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

      <DockItem label="Friends" onPress={onFriends} badge={requestCount} labelSize={lbl}>
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

      <DockItem label="Account" onPress={onAccount} labelSize={lbl}>
        <UserGlyph size={g} />
      </DockItem>

      <DockItem label="How to play" onPress={onHowToPlay} labelSize={lbl}>
        <BookGlyph size={g} />
      </DockItem>
    </Surface3D>
  );
}

function DockItem({ label, onPress, badge = 0, labelSize = 11, children }: { label: string; onPress: () => void; badge?: number; labelSize?: number; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
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
      <Text style={{ fontFamily: font.medium, fontSize: labelSize, color: palette.mutedSteel }}>{label}</Text>
    </Pressable>
  );
}
