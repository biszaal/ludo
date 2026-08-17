/**
 * Lobby — shows the shareable room code, the pot, who has joined, and (for the
 * host) the Start control. The host can start with 2–3 players or wait; the room
 * auto-starts when a 4th joins. A host cannot start alone.
 *
 * The pot line quotes stake × seats and says plainly that everyone pays at
 * start. It deliberately does NOT show who can afford it: balances are
 * self-read-only under RLS, and surfacing other players' coin counts to settle
 * a UI question would be a worse trade than the start-time error, which names
 * whoever is short and costs nothing until someone actually presses start.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { Button } from "../components/Button";
import { AvatarGlyph } from "../components/Avatar";
import { AddFriendButton } from "../components/AddFriendButton";
import { SettingRow } from "../components/SettingRow";
import { InviteFriendsSheet } from "../components/InviteFriendsSheet";
import { Surface3D } from "../components/Surface3D";
import { QuickMatchSearch } from "../components/QuickMatchSearch";
import { useOnlineStore } from "../store/onlineStore";
import { setBackInterceptor } from "../store/navStore";
import { seatColors } from "../lib/seating";
import { CoinGlyph } from "../components/CoinsPill";
import { copyCode } from "../lib/invite";
import { formatCompact } from "../lib/format";
import { potFor } from "../lib/economy";
import { font, palette, radius, space, teamColor } from "../theme";

const COLOR_LABEL = { red: "Red", green: "Green", yellow: "Yellow", blue: "Blue" } as const;

export function LobbyScreen() {
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

  const isQuick = useOnlineStore((s) => s.isQuick);
  const stake = useOnlineStore((s) => s.stake);

  // Leaving is one tap from both the header button and Android back, and for a
  // host it closes the room out from under everyone already waiting in it — so
  // it asks first. Nothing is staked yet (friend rooms collect at start), so the
  // question is about the room, not coins.
  const confirmLeave = useCallback(() => {
    // Quick match renders QuickMatchSearch instead of this screen; cancelling a
    // search is cheap and the entry is refunded, so it just backs out.
    if (isQuick) {
      leave();
      return;
    }
    Alert.alert(
      isHost ? "Close this room?" : "Leave this room?",
      isHost
        ? "Everyone waiting will be sent back to the home screen."
        : "You can rejoin with the same code while the room is open.",
      [
        { text: "Stay", style: "cancel" },
        { text: isHost ? "Close room" : "Leave", style: "destructive", onPress: () => leave() },
      ],
    );
  }, [isHost, isQuick, leave]);

  // Android back = leave the room (clears presence + subscription), not a bare
  // pop — through the same confirmation as the button.
  useEffect(() => {
    setBackInterceptor(() => {
      confirmLeave();
      return true;
    });
    return () => setBackInterceptor(null);
  }, [confirmLeave]);

  const [fillWithBots, setFillWithBots] = useState(false);
  const [inviting, setInviting] = useState(false);

  const full = lobby.length >= 4;
  // Friendly rooms only. The pot counts every seat and the house funds the bot
  // ones, so a host who could summon bots into a staked room would be farming
  // the house — opStart refuses it too, this just doesn't offer it.
  const canFill = stake === 0 && !full;
  const fill = fillWithBots && canFill;
  // Filling supplies the opponents, so it also lets a host who is still alone
  // start — the 2-player floor is about having someone to play against.
  const canStart = isHost && (lobby.length >= 2 || fill) && !starting;
  const emptySlots = Math.max(0, 4 - lobby.length);
  // Preview the colors the game will actually use (diagonal for 2 players).
  const previewColors = seatColors(lobby.length);

  // Quick match: no shareable code, no start button — just the search state.
  // The game starts on its own the moment the table fills.
  if (isQuick) return <QuickMatchSearch />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flex: 1, paddingHorizontal: space.xl, paddingTop: space.sm, justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Lobby</Text>
          <Button label="Leave" onPress={confirmLeave} variant="ghost" />
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
              {/* Opens the friends list in place. It used to go straight to the
                  OS share sheet, so inviting an in-app friend meant leaving the
                  lobby for the Friends screen to invite them back to it. */}
              <Button label="Invite friends" onPress={() => setInviting(true)} />
            </View>
          ) : null}
        </View>

        {/* The pot. Quoted for the table as it stands, so it grows visibly as
            friends arrive rather than jumping at start. */}
        <View style={{ alignItems: "center", gap: 2, marginTop: space.md }}>
          {stake > 0 ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <CoinGlyph size={16} />
                <Text style={{ fontFamily: font.mono, fontSize: 18, color: "#F5C542" }}>
                  {formatCompact(potFor(stake, Math.max(lobby.length, 2)))}
                </Text>
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>pot</Text>
              </View>
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
                Everyone pays {formatCompact(stake)} when the game starts.
              </Text>
            </>
          ) : (
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
              Friendly game — no coins at stake.
            </Text>
          )}
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
                {p.is_bot ? <Tag label="Bot" /> : null}
                {!p.is_bot && !p.is_connected && p.user_id !== userId ? <Tag label="Away" /> : null}
                {p.user_id === userId ? <Tag label="You" /> : null}
                {p.is_host ? <Tag label="Host" /> : null}
                {/* No friend request to a bot. */}
                {p.user_id !== userId && !p.is_bot ? <AddFriendButton userId={p.user_id} /> : null}
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
              {/* Waiting on a fourth who isn't coming is the common case here,
                  so the host can fill the empty chairs with bots instead. They
                  are labelled for everyone (unlike quick match's hidden
                  fill-ins) — in a private room an unexplained extra name would
                  read as a stranger walking in. */}
              {canFill ? (
                <SettingRow
                  label={`Fill ${emptySlots === 1 ? "the empty seat" : `${emptySlots} empty seats`} with bots`}
                  hint="Everyone sees which players are bots"
                  value={fillWithBots}
                  onChange={setFillWithBots}
                />
              ) : null}
              <Button
                label={
                  starting || full
                    ? "Starting…"
                    : fill
                      ? `Start with ${lobby.length} + ${emptySlots} ${emptySlots === 1 ? "bot" : "bots"}`
                      : lobby.length < 2
                        ? "Need 2+ players"
                        : `Start with ${lobby.length}`
                }
                onPress={() => void start(fill)}
                disabled={!canStart}
              />
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
                {fill
                  ? "Bots take the empty seats."
                  : stake > 0 && !full
                    ? "Coin games need real players — bots can only fill a friendly room."
                    : "Starts automatically when the room is full."}
              </Text>
            </>
          ) : (
            <Text style={{ fontFamily: font.medium, fontSize: 15, color: palette.porcelain, textAlign: "center" }}>
              Waiting for the host to start…
            </Text>
          )}
        </View>
      </View>

      {inviting && roomCode ? (
        <InviteFriendsSheet
          roomCode={roomCode}
          stake={stake}
          seatedUserIds={lobby.map((p) => p.user_id)}
          onClose={() => setInviting(false)}
        />
      ) : null}
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
