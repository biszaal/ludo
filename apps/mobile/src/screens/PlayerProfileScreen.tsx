/**
 * Another player's public profile: who they are, whether they're around, and
 * what you can do about it (add / invite / unfriend / block).
 *
 * The record shows games played and games WON — never a loss count. In a party
 * game a visible "2 wins, 31 losses" is a churn driver and an argument for
 * sandbagging, and it's hidden entirely below MIN_GAMES_FOR_RECORD so a new
 * player doesn't read as empty.
 *
 * Only online games count, because only they reach the server (0016): local AI
 * and pass-and-play never leave the device. The label says so rather than
 * quietly disagreeing with the player's own stats screen.
 */

import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { Button } from "../components/Button";
import { Surface3D } from "../components/Surface3D";
import { AvatarGlyph } from "../components/Avatar";
import { PresenceDot } from "../components/PresenceDot";
import { useFriends } from "../store/friendsStore";
import { useOnlineStore } from "../store/onlineStore";
import { useNav } from "../store/navStore";
import { formatRecord, isOnline, relationshipTo } from "../lib/friendship";
import { font, palette, space } from "../theme";

export function PlayerProfileScreen() {
  const pop = useNav((s) => s.pop);
  const userId = useFriends((s) => s.viewingUserId);
  const profiles = useFriends((s) => s.profiles);
  const stats = useFriends((s) => s.stats);
  const presence = useFriends((s) => s.presence);
  const friendships = useFriends((s) => s.friendships);
  const me = useFriends((s) => s.userId);
  const sendRequest = useFriends((s) => s.sendRequest);
  const accept = useFriends((s) => s.accept);
  const remove = useFriends((s) => s.remove);
  const block = useFriends((s) => s.block);
  const inviteToRoom = useFriends((s) => s.inviteToRoom);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);

  const roomCode = useOnlineStore((s) => s.roomCode);
  const onlineStatus = useOnlineStore((s) => s.status);
  const canInvite = !!roomCode && (onlineStatus === "lobby" || onlineStatus === "active");

  useEffect(() => {
    if (!userId) pop(); // opened without a target (e.g. state cleared) — bail out
  }, [userId, pop]);

  if (!userId) return null;

  const profile = profiles[userId];
  const name = profile?.display_name ?? "Ludo player";
  const record = stats[userId] ? formatRecord(stats[userId]!.games_played, stats[userId]!.games_won) : null;
  // Derived from the subscribed rows, not getState(): accepting a request has
  // to flip these buttons without needing a remount.
  const rel = relationshipTo(friendships, me, userId);
  const online = isOnline(presence[userId], Date.now());
  const known = me != null && rel.kind !== "none";

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Profile</Text>
        <Button label="Back" onPress={pop} variant="ghost" />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.xl }}>
        <Surface3D faceStyle={{ padding: space.xl, gap: space.md, alignItems: "center" }}>
          <View>
            <AvatarGlyph id={profile?.avatar_id ?? "orbit-moss"} size={88} />
            {known ? <PresenceDot online={online} size={20} /> : null}
          </View>
          <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }} numberOfLines={1}>
            {name}
          </Text>
          {known ? (
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
              {online ? "Online now" : "Offline"}
            </Text>
          ) : null}
        </Surface3D>

        {/* Record — hidden until there's enough of one to be worth showing. */}
        {record ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>
              ONLINE RECORD
            </Text>
            <Surface3D faceStyle={{ padding: space.lg, gap: 6 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 17, color: palette.porcelain }}>{record}</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
                Online games only.
              </Text>
            </Surface3D>
          </View>
        ) : null}

        {/* Actions */}
        <View style={{ gap: space.md }}>
          {rel.kind === "none" ? (
            <Button label="Add friend" disabled={busy} onPress={() => void run(() => sendRequest(userId))} />
          ) : null}
          {rel.kind === "outgoing" ? (
            <>
              <Button label="Request sent" disabled onPress={() => {}} />
              <Button label="Cancel request" variant="ghost" disabled={busy} onPress={() => void run(async () => { await remove(rel.id); pop(); })} />
            </>
          ) : null}
          {rel.kind === "incoming" ? (
            <>
              <Button label="Accept request" disabled={busy} onPress={() => void run(() => accept(rel.id))} />
              <Button label="Ignore" variant="ghost" disabled={busy} onPress={() => void run(async () => { await remove(rel.id); pop(); })} />
            </>
          ) : null}
          {rel.kind === "friends" ? (
            <>
              {canInvite ? (
                <Button label="Invite to room" disabled={busy} onPress={() => void run(() => inviteToRoom(userId, roomCode!))} />
              ) : null}
              <Button label="Remove friend" variant="ghost" disabled={busy} onPress={() => void run(async () => { await remove(rel.id); pop(); })} />
            </>
          ) : null}

          {/* Two-step, because blocking also severs the friendship server-side
              (0015 cascade) and there is no undo in this screen. */}
          {confirmBlock ? (
            <Button
              label="Tap again to block"
              variant="ghost"
              disabled={busy}
              onPress={() => void run(async () => { await block(userId); pop(); })}
            />
          ) : (
            <Button label="Block" variant="ghost" disabled={busy} onPress={() => setConfirmBlock(true)} />
          )}
        </View>

        {error ? (
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
