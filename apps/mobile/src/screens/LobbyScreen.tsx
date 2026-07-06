/**
 * Lobby — shows the shareable room code, who has joined, and (for the host) the
 * Start control. The host can start with 2–3 players or wait; the room auto-starts
 * when a 4th joins. A host cannot start alone.
 */

import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { AvatarGlyph } from "../components/Avatar";
import { Surface3D } from "../components/Surface3D";
import { useOnlineStore } from "../store/onlineStore";
import { setBackInterceptor } from "../store/navStore";
import { seatColors } from "../lib/seating";
import { copyCode, shareInvite } from "../lib/invite";
import { font, palette, radius, space, teamColor } from "../theme";

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

export function LobbyScreen() {
  // Android back = leave the room (clears presence + subscription), not a bare pop.
  useEffect(() => {
    setBackInterceptor(() => {
      useOnlineStore.getState().leave();
      return true;
    });
    return () => setBackInterceptor(null);
  }, []);

  const roomCode = useOnlineStore((s) => s.roomCode);
  const lobby = useOnlineStore((s) => s.lobby);
  const profiles = useOnlineStore((s) => s.profiles);
  const isHost = useOnlineStore((s) => s.isHost);
  const userId = useOnlineStore((s) => s.userId);
  const starting = useOnlineStore((s) => s.starting);
  const error = useOnlineStore((s) => s.error);
  const start = useOnlineStore((s) => s.start);
  const leave = useOnlineStore((s) => s.leave);

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);
  const handleCopy = async (code: string) => {
    await copyCode(code);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1800);
  };

  const full = lobby.length >= 4;
  const canStart = isHost && lobby.length >= 2 && !starting;
  const emptySlots = Math.max(0, 4 - lobby.length);
  // Preview the colors the game will actually use (diagonal for 2 players).
  const previewColors = seatColors(lobby.length);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.feltCharcoal }}>
      <View style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.sm, justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Lobby</Text>
          <Button label="Leave" onPress={leave} variant="ghost" />
        </View>

        {/* Share code */}
        <View style={{ alignItems: "center", gap: space.sm, marginTop: space.lg }}>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>SHARE THIS CODE</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy room code"
            disabled={!roomCode}
            onPress={() => {
              if (roomCode) void handleCopy(roomCode);
            }}
          >
            {({ pressed }) => (
              <Surface3D rad={radius.lg} faceColor={palette.liftedSlate} pressed={pressed} faceStyle={{ paddingHorizontal: space.xl, paddingVertical: space.md }}>
                <Text style={{ fontFamily: font.mono, fontSize: 48, color: palette.porcelain, letterSpacing: 10 }}>{roomCode ?? "----"}</Text>
              </Surface3D>
            )}
          </Pressable>
          <Text style={{ fontFamily: font.regular, fontSize: 14, color: copied ? palette.porcelain : palette.mutedSteel }}>
            {copied ? "Copied to clipboard" : "Tap the code to copy it."}
          </Text>
          {roomCode ? (
            <View style={{ alignSelf: "stretch" }}>
              <Button label="Invite friends" onPress={() => void shareInvite(roomCode)} />
            </View>
          ) : null}
        </View>

        {/* Players */}
        <View style={{ flex: 1, justifyContent: "center", gap: space.sm }}>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>
            PLAYERS ({lobby.length}/4)
          </Text>
          {lobby.map((p, i) => {
            const color = previewColors[i] ?? p.color;
            const profile = profiles[p.user_id];
            return (
              <Surface3D
                key={p.id}
                edge={2}
                faceStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}
              >
                {profile ? (
                  <AvatarGlyph id={profile.avatar_id} size={32} />
                ) : (
                  <View style={{ width: 18, height: 18, borderRadius: radius.pill, backgroundColor: teamColor[color] }} />
                )}
                <View style={{ flex: 1, gap: 1 }}>
                  <Text numberOfLines={1} style={{ fontFamily: font.semibold, fontSize: 16, color: palette.porcelain }}>
                    {profile?.display_name ?? COLOR_LABEL[color]}
                  </Text>
                  {profile ? (
                    <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>{COLOR_LABEL[color]}</Text>
                  ) : null}
                </View>
                {!p.is_connected && p.user_id !== userId ? <Tag label="Away" /> : null}
                {p.user_id === userId ? <Tag label="You" /> : null}
                {p.is_host ? <Tag label="Host" /> : null}
              </Surface3D>
            );
          })}
          {Array.from({ length: emptySlots }, (_unused, i) => (
            <View
              key={`empty-${i}`}
              style={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, borderColor: palette.hairline, borderStyle: "dashed" }}
            >
              <View style={{ width: 18, height: 18, borderRadius: radius.pill, backgroundColor: palette.liftedSlate }} />
              <Text style={{ fontFamily: font.regular, fontSize: 15, color: palette.mutedSteel }}>Waiting for a player…</Text>
            </View>
          ))}
        </View>

        {/* Start / wait */}
        <View style={{ gap: space.sm, marginBottom: space.lg }}>
          {error ? <Text style={{ fontFamily: font.regular, fontSize: 13, color: teamColor.red, textAlign: "center" }}>{error}</Text> : null}
          {isHost ? (
            <>
              <Button
                label={starting || full ? "Starting…" : lobby.length < 2 ? "Need 2+ players" : `Start with ${lobby.length}`}
                onPress={() => void start()}
                disabled={!canStart}
              />
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
                Starts automatically when the room is full.
              </Text>
            </>
          ) : (
            <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.porcelain, textAlign: "center" }}>
              Waiting for the host to start…
            </Text>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <View style={{ paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: palette.liftedSlate }}>
      <Text style={{ fontFamily: font.medium, fontSize: 12, color: palette.mutedSteel }}>{label}</Text>
    </View>
  );
}
