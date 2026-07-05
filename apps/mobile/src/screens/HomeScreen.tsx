/**
 * Home — the Ludo wordmark up top, then two ways to play: local (pass-and-play
 * or vs AI) and online (create a room to get a share code, or join with a code).
 */

import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { Logo } from "../components/Logo";
import { useGameStore } from "../store/gameStore";
import { useOnlineStore } from "../store/onlineStore";
import { font, palette, radius, space, teamColor } from "../theme";

const COUNTS = [2, 3, 4] as const;
const SEAT_COLORS = ["red", "green", "yellow", "blue"] as const;
const MODES = [
  { key: "local", label: "Pass & play" },
  { key: "ai", label: "vs AI" },
] as const;
type Mode = (typeof MODES)[number]["key"];

export function HomeScreen() {
  const [count, setCount] = useState<number>(2);
  const [mode, setMode] = useState<Mode>("local");
  const [code, setCode] = useState<string>("");
  const newLocalGame = useGameStore((s) => s.newLocalGame);

  const createOnline = useOnlineStore((s) => s.create);
  const joinOnline = useOnlineStore((s) => s.join);
  const onlineStatus = useOnlineStore((s) => s.status);
  const onlineError = useOnlineStore((s) => s.error);
  const connecting = onlineStatus === "connecting";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.feltCharcoal }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: space.xl, gap: space.xl }}>
        <View style={{ alignItems: "center", gap: space.sm }}>
          <Logo />
          <Text style={{ fontFamily: font.regular, fontSize: 15, color: palette.mutedSteel }}>The classic board game.</Text>
        </View>

        {/* Local play */}
        <View style={{ gap: space.md }}>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>PLAY ON THIS DEVICE</Text>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {COUNTS.map((n) => (
              <SelectTile key={n} label={`${n}`} mono selected={n === count} onPress={() => setCount(n)} />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: space.sm, paddingLeft: space.xs }}>
            {SEAT_COLORS.slice(0, count).map((c) => (
              <View key={c} style={{ width: 12, height: 12, borderRadius: radius.pill, backgroundColor: teamColor[c] }} />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            {MODES.map((m) => (
              <SelectTile key={m.key} label={m.label} selected={m.key === mode} onPress={() => setMode(m.key)} />
            ))}
          </View>
          <Button label="Start game" onPress={() => newLocalGame(count, mode === "ai" ? count - 1 : 0)} />
        </View>

        {/* Online play */}
        <View style={{ gap: space.md }}>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>PLAY WITH FRIENDS</Text>
          <Button label={connecting ? "Creating…" : "Create a room"} onPress={() => void createOnline()} />
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <TextInput
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
    </SafeAreaView>
  );
}

function SelectTile({ label, selected, onPress, mono }: { label: string; selected: boolean; onPress: () => void; mono?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 54,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: selected ? palette.liftedSlate : "transparent",
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? palette.porcelain : palette.hairline,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <Text style={{ fontFamily: mono ? font.mono : font.semibold, fontSize: mono ? 20 : 15, color: palette.porcelain }}>{label}</Text>
    </Pressable>
  );
}
