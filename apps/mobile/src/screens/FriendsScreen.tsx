/**
 * Friends — accept incoming requests, track ones you've sent, see who's around,
 * and (when you're in a room) invite them to join. You add people from the
 * lobby, the results screen, or the Add Friend screen (code / recent players).
 * Anonymous identities, so this is device-to-device by uid.
 *
 * Online friends sort to the top: a list that is mostly grey still leads with
 * whoever you could actually play right now.
 */

import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TableBackground } from "../components/TableBackground";
import { Button } from "../components/Button";
import { ScreenHeader } from "../components/ScreenHeader";
import { ContentColumn } from "../components/ContentColumn";
import { SectionLabel } from "../components/SectionLabel";
import { Surface3D } from "../components/Surface3D";
import { AvatarGlyph } from "../components/Avatar";
import { PeopleGlyph } from "../components/HomeGlyphs";
import { PresenceDot } from "../components/PresenceDot";
import { pollPresence, useFriends } from "../store/friendsStore";
import { useOnlineStore } from "../store/onlineStore";
import { useNav } from "../store/navStore";
import {
  acceptedFriendIds,
  incomingRequests,
  isOnline,
  outgoingRequests,
  sortFriendsByPresence,
} from "../lib/friendship";
import { font, palette, space } from "../theme";

export function FriendsScreen() {
  const push = useNav((s) => s.push);
  const ready = useFriends((s) => s.ready);
  const userId = useFriends((s) => s.userId);
  const friendships = useFriends((s) => s.friendships);
  const profiles = useFriends((s) => s.profiles);
  const presence = useFriends((s) => s.presence);
  const accept = useFriends((s) => s.accept);
  const remove = useFriends((s) => s.remove);
  const inviteToRoom = useFriends((s) => s.inviteToRoom);
  const viewPlayer = useFriends((s) => s.viewPlayer);
  const refresh = useFriends((s) => s.refresh);

  const roomCode = useOnlineStore((s) => s.roomCode);
  const onlineStatus = useOnlineStore((s) => s.status);
  const canInvite = !!roomCode && (onlineStatus === "lobby" || onlineStatus === "active");

  // Re-tick so dots go grey as heartbeats age out, not only when data arrives.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void useFriends.getState().init();
    void refresh();
    const stopPolling = pollPresence();
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      stopPolling();
      clearInterval(tick);
    };
  }, [refresh]);

  const requests = incomingRequests(friendships, userId);
  const sent = outgoingRequests(friendships, userId);
  const friendIds = sortFriendsByPresence(acceptedFriendIds(friendships, userId), presence, now);

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
      <ScreenHeader title="Friends" />

      <ScrollView contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl, alignItems: "center" }}>
        <ContentColumn style={{ paddingHorizontal: space.xl, gap: space.xl }}>
        {canInvite ? (
          <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
            You're in room {roomCode} — invite a friend to join.
          </Text>
        ) : null}

        <Button label="Add a friend" onPress={() => push("addFriend")} />

        {/* Incoming requests */}
        {requests.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <SectionLabel>{`Requests (${requests.length})`}</SectionLabel>
            {requests.map((r) => (
              <Row
                key={r.id}
                name={nameOf(r.requester_user_id)}
                avatar={avatarOf(r.requester_user_id)}
                onPress={() => void viewPlayer(r.requester_user_id)}
              >
                <View style={{ width: 96 }}>
                  <Button label="Accept" onPress={() => void accept(r.id)} />
                </View>
                <View style={{ width: 90 }}>
                  <Button label="Ignore" variant="ghost" onPress={() => void remove(r.id)} />
                </View>
              </Row>
            ))}
          </View>
        ) : null}

        {/* Requests I sent — cancellable */}
        {sent.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <SectionLabel>{`Sent (${sent.length})`}</SectionLabel>
            {sent.map((r) => (
              <Row
                key={r.id}
                name={nameOf(r.addressee_user_id)}
                avatar={avatarOf(r.addressee_user_id)}
                onPress={() => void viewPlayer(r.addressee_user_id)}
              >
                <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>Pending</Text>
                <TextLink label="Cancel" onPress={() => void remove(r.id)} />
              </Row>
            ))}
          </View>
        ) : null}

        {/* Friends */}
        <View style={{ gap: space.sm }}>
          <SectionLabel>{`Your friends (${friendIds.length})`}</SectionLabel>
          {friendIds.length === 0 ? (
            <Surface3D faceStyle={{ padding: space.lg, gap: space.sm, alignItems: "center" }}>
              <PeopleGlyph size={36} />
              <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>No friends yet</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
                {ready
                  ? "Share your friend code, or add someone you've played with — tap “Add a friend” above."
                  : "Connecting…"}
              </Text>
            </Surface3D>
          ) : (
            friendIds.map((uid) => (
              <Row
                key={uid}
                name={nameOf(uid)}
                avatar={avatarOf(uid)}
                online={isOnline(presence[uid], now)}
                onPress={() => void viewPlayer(uid)}
              >
                {canInvite ? (
                  <View style={{ width: 100 }}>
                    <Button label="Invite" onPress={() => void inviteToRoom(uid, roomCode!)} />
                  </View>
                ) : (
                  <TextLink
                    label="Remove"
                    onPress={() => {
                      const id = rowIdForFriend(uid);
                      if (id) void remove(id);
                    }}
                  />
                )}
              </Row>
            ))
          )}
        </View>

        <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel, textAlign: "center" }}>
          Invites arrive while the app is open.
        </Text>
      </ContentColumn>
      </ScrollView>
    </SafeAreaView>
  );
}

/** One player row: avatar (with an optional presence dot), name, then actions.
 *  The row itself opens the public profile; the action buttons sit outside the
 *  Pressable so tapping Accept never also navigates. */
function Row({
  name,
  avatar,
  online,
  onPress,
  children,
}: {
  name: string;
  avatar: string;
  online?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Surface3D edge={2} faceStyle={{ flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${name}'s profile`}
        onPress={onPress}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: space.md, flex: 1, opacity: pressed ? 0.85 : 1 })}
      >
        <View>
          <AvatarGlyph id={avatar} size={36} />
          {online !== undefined ? <PresenceDot online={online} /> : null}
        </View>
        <Text style={{ flex: 1, fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }} numberOfLines={1}>
          {name}
        </Text>
      </Pressable>
      {children}
    </Surface3D>
  );
}

/** Quiet secondary action as a bordered ghost chip (44pt tap target). */
function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        minHeight: 32,
        paddingHorizontal: space.md,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: palette.hairline,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontFamily: font.medium, fontSize: 13, color: palette.mutedSteel }}>{label}</Text>
    </Pressable>
  );
}
