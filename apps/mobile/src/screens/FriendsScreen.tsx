/**
 * Friends — accept incoming requests, see your friends, and (when you're in a
 * room) invite them to join. You add people you've played with from the lobby
 * or results screen; this is where those requests land and where the friend
 * list lives. Anonymous identities, so this is device-to-device by uid.
 */

import { useEffect } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { Button } from "../components/Button";
import { Surface3D } from "../components/Surface3D";
import { AvatarGlyph } from "../components/Avatar";
import { useFriends } from "../store/friendsStore";
import { useOnlineStore } from "../store/onlineStore";
import { useNav } from "../store/navStore";
import { acceptedFriendIds, incomingRequests } from "../lib/friendship";
import { font, palette, radius, space } from "../theme";

export function FriendsScreen() {
  const pop = useNav((s) => s.pop);
  const ready = useFriends((s) => s.ready);
  const userId = useFriends((s) => s.userId);
  const friendships = useFriends((s) => s.friendships);
  const profiles = useFriends((s) => s.profiles);
  const accept = useFriends((s) => s.accept);
  const remove = useFriends((s) => s.remove);
  const inviteToRoom = useFriends((s) => s.inviteToRoom);
  const refresh = useFriends((s) => s.refresh);

  const roomCode = useOnlineStore((s) => s.roomCode);
  const onlineStatus = useOnlineStore((s) => s.status);
  const canInvite = !!roomCode && (onlineStatus === "lobby" || onlineStatus === "active");

  useEffect(() => {
    void useFriends.getState().init();
    void refresh();
  }, [refresh]);

  const requests = incomingRequests(friendships, userId);
  const friendIds = acceptedFriendIds(friendships, userId);
  const nameOf = (uid: string) => profiles[uid]?.display_name ?? "Ludo player";
  const avatarOf = (uid: string) => profiles[uid]?.avatar_id ?? "orbit-moss";

  // Map an accepted friend's uid back to its friendship row id (for remove).
  const rowIdForFriend = (uid: string) =>
    friendships.find(
      (f) =>
        f.status === "accepted" &&
        (f.requester_user_id === uid || f.addressee_user_id === uid),
    )?.id;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: space.xl, paddingTop: space.sm }}>
        <Text style={{ fontFamily: font.display, fontSize: 22, color: palette.porcelain }}>Friends</Text>
        <Button label="Back" onPress={pop} variant="ghost" />
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl, gap: space.xl }}>
        {canInvite ? (
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
            You're in room {roomCode} — invite a friend to join.
          </Text>
        ) : null}

        {/* Incoming requests */}
        {requests.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>
              REQUESTS ({requests.length})
            </Text>
            {requests.map((r) => (
              <Surface3D key={r.id} edge={2} faceStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
                <AvatarGlyph id={avatarOf(r.requester_user_id)} size={36} />
                <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }} numberOfLines={1}>
                  {nameOf(r.requester_user_id)}
                </Text>
                <View style={{ width: 96 }}>
                  <Button label="Accept" onPress={() => void accept(r.id)} />
                </View>
                <View style={{ width: 90 }}>
                  <Button label="Ignore" variant="ghost" onPress={() => void remove(r.id)} />
                </View>
              </Surface3D>
            ))}
          </View>
        ) : null}

        {/* Friends */}
        <View style={{ gap: space.sm }}>
          <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, letterSpacing: 0.5 }}>
            YOUR FRIENDS ({friendIds.length})
          </Text>
          {friendIds.length === 0 ? (
            <Surface3D faceStyle={{ padding: space.lg, gap: 6 }}>
              <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>No friends yet</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
                {ready
                  ? "Play an online game, then tap “Add friend” on another player in the lobby or results screen."
                  : "Connecting…"}
              </Text>
            </Surface3D>
          ) : (
            friendIds.map((uid) => (
              <Surface3D key={uid} edge={2} faceStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
                <AvatarGlyph id={avatarOf(uid)} size={36} />
                <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }} numberOfLines={1}>
                  {nameOf(uid)}
                </Text>
                {canInvite ? (
                  <View style={{ width: 100 }}>
                    <Button label="Invite" onPress={() => void inviteToRoom(uid, roomCode!)} />
                  </View>
                ) : (
                  <RemoveLink onPress={() => {
                    const id = rowIdForFriend(uid);
                    if (id) void remove(id);
                  }} />
                )}
              </Surface3D>
            ))
          )}
        </View>

        <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel, textAlign: "center" }}>
          Invites arrive while the app is open.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function RemoveLink({ onPress }: { onPress: () => void }) {
  return (
    <Text
      accessibilityRole="button"
      onPress={onPress}
      style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel, paddingHorizontal: space.sm }}
    >
      Remove
    </Text>
  );
}
