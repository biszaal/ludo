/**
 * Home hub — identity + settings up top (left-aligned wordmark, per DESIGN.md
 * no centered hero), play-mode cards bottom-weighted with deliberately unequal
 * heights, then the online section. Local modes open the PlaySetupSheet.
 */

import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { Button } from "../components/Button";
import { Logo } from "../components/Logo";
import { ModeCard } from "../components/ModeCard";
import { PlaySetupSheet, type PlayMode } from "../components/PlaySetupSheet";
import { ProfileChip } from "../components/ProfileChip";
import { BOARD_THEMES } from "../render/boardThemes";
import { useGameStore } from "../store/gameStore";
import { useOnlineStore } from "../store/onlineStore";
import { useFriends } from "../store/friendsStore";
import { useNav } from "../store/navStore";
import { useSettings } from "../store/settingsStore";
import { incomingRequests } from "../lib/friendship";
import { font, palette, radius, space, teamColor } from "../theme";

export function HomeScreen() {
  const [sheetMode, setSheetMode] = useState<PlayMode | null>(null);
  const [code, setCode] = useState<string>("");
  const newLocalGame = useGameStore((s) => s.newLocalGame);
  const boardTheme = BOARD_THEMES[useSettings((s) => s.boardThemeId)];

  const createOnline = useOnlineStore((s) => s.create);
  const joinOnline = useOnlineStore((s) => s.join);
  const onlineStatus = useOnlineStore((s) => s.status);
  const onlineError = useOnlineStore((s) => s.error);
  const connecting = onlineStatus === "connecting";

  const push = useNav((s) => s.push);
  const friendships = useFriends((s) => s.friendships);
  const myUserId = useFriends((s) => s.userId);
  const requestCount = incomingRequests(friendships, myUserId).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Logo tile={36} />
        <ProfileChip />
      </View>

      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: space.xl, paddingTop: space.xl, paddingBottom: space.xl, gap: space.xl }}>
        <Text style={{ fontFamily: font.regular, fontSize: 15, color: palette.mutedSteel }}>The classic board game.</Text>

        {/* Spacer pushes play actions into the thumb zone. */}
        <View style={{ flex: 1 }} />

        {/* Local play */}
        <View style={{ gap: space.md }}>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>PLAY ON THIS DEVICE</Text>
          <ModeCard
            title="Play vs AI"
            subtitle="You against 1–3 bots"
            minHeight={112}
            boardArt={boardTheme}
            onPress={() => setSheetMode("ai")}
          />
          <ModeCard title="Pass & play" subtitle="Share this phone around the table" onPress={() => setSheetMode("pass")} />
        </View>

        {/* Online play */}
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>PLAY WITH FRIENDS</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={requestCount > 0 ? `Friends, ${requestCount} requests` : "Friends"}
              onPress={() => push("friends")}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, opacity: pressed ? 0.7 : 1 })}
            >
              <Text style={{ fontFamily: font.semibold, fontSize: 14, color: palette.porcelain }}>Friends</Text>
              {requestCount > 0 ? (
                <View style={{ minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: teamColor.red, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontFamily: font.semibold, fontSize: 11, color: palette.porcelain }}>{requestCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
          <Button label={connecting ? "Creating…" : "Create a room"} onPress={() => void createOnline()} />
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <TextInput
              accessibilityLabel="Room code"
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
              placeholder="CODE"
              placeholderTextColor={palette.mutedSteel}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={4}
              style={{
                flex: 1,
                minHeight: 56,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.hairline,
                color: palette.porcelain,
                fontFamily: font.mono,
                fontSize: 22,
                letterSpacing: 6,
                textAlign: "center",
              }}
            />
            <View style={{ width: 130 }}>
              <Button
                label="Join"
                variant="ghost"
                onPress={() => {
                  if (code.length >= 3) void joinOnline(code);
                }}
              />
            </View>
          </View>
          {onlineError ? (
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: teamColor.red }}>{onlineError}</Text>
          ) : null}
        </View>
      </ScrollView>

      {sheetMode && (
        <PlaySetupSheet
          mode={sheetMode}
          onClose={() => setSheetMode(null)}
          onStart={(players, bots, rules) => {
            setSheetMode(null);
            newLocalGame({ players, bots, rules });
          }}
        />
      )}
    </SafeAreaView>
  );
}
