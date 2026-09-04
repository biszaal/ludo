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
import { useDockClearance } from "../components/TabDock";
import { ContentColumn } from "../components/ContentColumn";
import { SectionLabel } from "../components/SectionLabel";
import { Surface3D } from "../components/Surface3D";
import { AvatarGlyph } from "../components/Avatar";
import { PeopleGlyph } from "../components/HomeGlyphs";
import { PresenceDot } from "../components/PresenceDot";
import { pollPresence, useFriends } from "../store/friendsStore";
import { useOnlineStore } from "../store/onlineStore";
import { registerForPush } from "../lib/push";
import { confirm } from "../store/confirmStore";
import { useNav } from "../store/navStore";
import {
  acceptedFriendIds,
  incomingRequests,
  isOnline,
  outgoingRequests,
  sortFriendsByPresence,
} from "../lib/friendship";
import { font, palette, radius, space } from "../theme";
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from "../components/Skeleton";
import { LoadFailed } from "../components/LoadFailed";
import { useLoadPhase } from "../lib/useLoadPhase";

export function FriendsScreen() {
  const push = useNav((s) => s.push);
  const userId = useFriends((s) => s.userId);
  const friendships = useFriends((s) => s.friendships);
  const profiles = useFriends((s) => s.profiles);
  const presence = useFriends((s) => s.presence);
  const accept = useFriends((s) => s.accept);
  const remove = useFriends((s) => s.remove);
  const inviteToRoom = useFriends((s) => s.inviteToRoom);
  const stake = useOnlineStore((s) => s.stake);
  const viewPlayer = useFriends((s) => s.viewPlayer);
  const refresh = useFriends((s) => s.refresh);
  const loaded = useFriends((s) => s.loaded);
  const failed = useFriends((s) => s.failed);

  const roomCode = useOnlineStore((s) => s.roomCode);
  const onlineStatus = useOnlineStore((s) => s.status);
  const canInvite = !!roomCode && (onlineStatus === "lobby" || onlineStatus === "active");

  // Re-tick so dots go grey as heartbeats age out, not only when data arrives.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void useFriends.getState().init();
    void refresh();
    // Ask for notification permission here rather than at launch: this is the
    // first screen where "a friend wants you to play" is a thing that could
    // actually happen, so the prompt arrives with its reason already on screen.
    void registerForPush();
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

  const dockPad = useDockClearance();

  // `loaded` lives on the module-level store, not in this component, so the
  // cold wait is only the first fetch of the session: a later remount reads it
  // true and goes straight to the rows while the refresh happens underneath.
  const view = useLoadPhase(loaded, failed);

  // No bottom edge: the dock floats over this screen and pays that inset
  // itself. The scroll content buys its own room back with dockClearance.
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: palette.tableBlue }}>
      <TableBackground />
      <ScreenHeader title="Friends" />

      <ScrollView contentContainerStyle={{ paddingTop: space.lg, paddingBottom: space.xxl + dockPad, alignItems: "center" }}>
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
                <Button compact label="Accept" onPress={() => void accept(r.id)} />
                <Button
                  compact
                  label="Ignore"
                  variant="ghost"
                  onPress={() =>
                    void (async () => {
                      const name = nameOf(r.requester_user_id);
                      const ok = await confirm({
                        title: `Ignore ${name}?`,
                        message: "Their request disappears. They can send another one later.",
                        confirmLabel: "Ignore",
                        destructive: true,
                      });
                      if (ok) await remove(r.id);
                    })()
                  }
                />
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
                <TextLink
                  label="Cancel"
                  onPress={() =>
                    void (async () => {
                      const ok = await confirm({
                        title: "Cancel this request?",
                        message: `${nameOf(r.addressee_user_id)} won't see it. You can send it again any time.`,
                        confirmLabel: "Cancel request",
                        cancelLabel: "Keep it",
                      });
                      if (ok) await remove(r.id);
                    })()
                  }
                />
              </Row>
            ))}
          </View>
        ) : null}

        {/* Friends */}
        <View style={{ gap: space.sm }}>
          {/* No count until the list is actually in hand. "(0)" over a shimmer
              is the last fragment of the original defect — and to a screen
              reader it may be the only part of this section that gets read. */}
          <SectionLabel>{view === "content" ? `Your friends (${friendIds.length})` : "Your friends"}</SectionLabel>
          {view === "hidden" ? null : view === "stalled" ? (
            <LoadFailed
              message="Your friends list didn't load. Check your connection and try again."
              // init(), not refresh(): the likeliest way to reach this card is
              // ensureSignedIn() throwing, which leaves init returning before
              // it ever calls refresh — retrying refresh alone would fail the
              // same way forever. init redoes the sign-in, and falls through to
              // a refresh when that was the half that failed.
              onRetry={() => void useFriends.getState().init()}
            />
          ) : view === "skeleton" ? (
            <SkeletonGroup label="Loading your friends" style={{ gap: space.sm }}>
              {[0, 1, 2].map((i) => (
                // Geometry copied from <Row> below: edge={2}, padding space.md,
                // space.sm between the identity half and the actions, space.md
                // inside the identity half, a 36pt avatar and ONE 15pt name
                // line. A taller block or a second caption line would make the
                // list jump when the real rows land.
                <Surface3D
                  key={`sk-${i}`}
                  edge={2}
                  faceStyle={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, flex: 1 }}>
                    <SkeletonBlock width={36} height={36} rad={radius.pill} index={i} />
                    <View style={{ flex: 1 }}>
                      <SkeletonLine width="60%" size={15} index={i} />
                    </View>
                  </View>
                  {/* A friend row's action is <TextLink> — a 32pt pill — not a
                      Button, unless you happen to be in a room. Standing in at
                      a Button's 44 would be right for the rarer case and 12pt
                      wrong for the one a player is almost always in, so this
                      matches the pill: 32 tall, and about the width "Remove"
                      takes at 13pt plus its 12pt side padding. */}
                  <SkeletonBlock width={76} height={32} rad={radius.pill} index={i + 1} />
                </Surface3D>
              ))}
            </SkeletonGroup>
          ) : friendIds.length === 0 ? (
            <Surface3D faceStyle={{ padding: space.lg, gap: space.sm, alignItems: "center" }}>
              <PeopleGlyph size={36} />
              <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>No friends yet</Text>
              <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
                Share your friend code, or add someone you've played with — tap “Add a friend” above.
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
                  <Button compact label="Invite" onPress={() => void inviteToRoom(uid, roomCode!, stake)} />
                ) : (
                  <TextLink
                    label="Remove"
                    onPress={() =>
                      void (async () => {
                        const id = rowIdForFriend(uid);
                        if (!id) return;
                        const ok = await confirm({
                          title: `Remove ${nameOf(uid)}?`,
                          message:
                            "You'll both drop off each other's friends list, and you'll need their friend code to add them back.",
                          confirmLabel: "Remove",
                          destructive: true,
                        });
                        if (ok) await remove(id);
                      })()
                    }
                  />
                )}
              </Row>
            ))
          )}
        </View>

        <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel, textAlign: "center" }}>
          Invites reach you even when the app is closed, if you allow notifications.
        </Text>
      </ContentColumn>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Minimum width the identity half keeps before the actions give up and wrap
 *  onto their own line. Two actions plus an avatar plus a name do not fit on a
 *  small phone (or at a large text size); rather than shave the name down to an
 *  ellipsis, the row becomes two lines and everything stays readable. */
const IDENTITY_MIN = 150;

/** One player row: avatar (with an optional presence dot), name, then actions.
 *  The row itself opens the public profile; the action buttons sit outside the
 *  Pressable so tapping Accept never also navigates. Actions are grouped so
 *  they wrap as a pair — never one button stranded on a line of its own. */
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
    <Surface3D
      edge={2}
      faceStyle={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        // Only bites on a wrapped second line: on one line the identity half
        // has already grown into the slack, so there is nothing left to justify.
        justifyContent: "flex-end",
        gap: space.sm,
        padding: space.md,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${name}'s profile`}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: IDENTITY_MIN,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <View>
          <AvatarGlyph id={avatar} size={36} />
          {online !== undefined ? <PresenceDot online={online} /> : null}
        </View>
        <Text
          style={{ flexShrink: 1, fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}
          numberOfLines={1}
        >
          {name}
        </Text>
      </Pressable>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        {children}
      </View>
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
