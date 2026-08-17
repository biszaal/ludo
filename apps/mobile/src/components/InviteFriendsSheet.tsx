/**
 * Invite people to the room you're already sitting in.
 *
 * The invite pipeline (room_invites, push, the InviteBanner on the other end)
 * already existed, but the only way to reach it was the Friends screen — which
 * meant leaving the lobby to invite someone to it. This puts the friends list
 * where the room is, and keeps the share-a-link route for people who aren't
 * friends in the app yet.
 *
 * Online friends sort first: they're the ones who can actually turn up before
 * the host gets bored of waiting.
 */

import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { AvatarGlyph } from "./Avatar";
import { PresenceDot } from "./PresenceDot";
import { PeopleGlyph } from "./HomeGlyphs";
import { SectionLabel } from "./SectionLabel";
import { useFriends } from "../store/friendsStore";
import { acceptedFriendIds, isOnline, sortFriendsByPresence } from "../lib/friendship";
import { shareInvite } from "../lib/invite";
import { font, palette, radius, space, teamColor } from "../theme";

interface InviteFriendsSheetProps {
  roomCode: string;
  stake: number;
  /** Auth user ids already seated — they can't be invited again. */
  seatedUserIds: string[];
  onClose: () => void;
}

type SendState = "idle" | "sending" | "sent" | "failed";

export function InviteFriendsSheet({ roomCode, stake, seatedUserIds, onClose }: InviteFriendsSheetProps) {
  const userId = useFriends((s) => s.userId);
  const friendships = useFriends((s) => s.friendships);
  const profiles = useFriends((s) => s.profiles);
  const presence = useFriends((s) => s.presence);
  const inviteToRoom = useFriends((s) => s.inviteToRoom);
  const refresh = useFriends((s) => s.refresh);

  const [sent, setSent] = useState<Record<string, SendState>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void useFriends.getState().init();
    void refresh();
  }, [refresh]);

  // Re-tick so the presence dots age out while the sheet is open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const seated = useMemo(() => new Set(seatedUserIds), [seatedUserIds]);
  const friendIds = useMemo(
    () => sortFriendsByPresence(acceptedFriendIds(friendships, userId), presence, now),
    [friendships, userId, presence, now],
  );

  const send = async (uid: string) => {
    setSent((s) => ({ ...s, [uid]: "sending" }));
    try {
      await inviteToRoom(uid, roomCode, stake);
      setSent((s) => ({ ...s, [uid]: "sent" }));
    } catch {
      // Rate limit, blocked, or offline — say so rather than showing a silent
      // "Sent" for an invite that never left.
      setSent((s) => ({ ...s, [uid]: "failed" }));
    }
  };

  return (
    <Sheet onClose={onClose} title="Invite to your room">
      <View style={{ gap: space.md }}>
        <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel }}>
          {stake > 0
            ? `They'll see the room code and that ${stake} coins are on the line.`
            : "They'll get a notification with your room code."}
        </Text>

        <SectionLabel>{`Your friends (${friendIds.length})`}</SectionLabel>

        {friendIds.length === 0 ? (
          <View style={{ alignItems: "center", gap: space.sm, paddingVertical: space.lg }}>
            <PeopleGlyph size={36} />
            <Text style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain }}>No friends yet</Text>
            <Text style={{ fontFamily: font.regular, fontSize: 13, color: palette.mutedSteel, textAlign: "center" }}>
              Share the link below instead — you can add each other after the game.
            </Text>
          </View>
        ) : (
          friendIds.map((uid) => {
            const inRoom = seated.has(uid);
            const stateFor = sent[uid] ?? "idle";
            return (
              <View
                key={uid}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  paddingVertical: space.sm,
                }}
              >
                <View style={{ opacity: inRoom ? 0.5 : 1 }}>
                  <AvatarGlyph id={profiles[uid]?.avatar_id ?? "orbit-moss"} size={36} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={{ fontFamily: font.semibold, fontSize: 15, color: palette.porcelain, opacity: inRoom ? 0.5 : 1 }}
                  >
                    {profiles[uid]?.display_name ?? "Ludo player"}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <PresenceDot online={isOnline(presence[uid], now)} />
                    <Text style={{ fontFamily: font.regular, fontSize: 12, color: palette.mutedSteel }}>
                      {inRoom ? "Already here" : isOnline(presence[uid], now) ? "Online" : "Offline"}
                    </Text>
                  </View>
                </View>
                {inRoom ? null : (
                  <View style={{ width: 96 }}>
                    <InviteAction state={stateFor} onPress={() => void send(uid)} />
                  </View>
                )}
              </View>
            );
          })
        )}

        <View style={{ height: 1, backgroundColor: palette.hairline, marginVertical: space.xs }} />

        <Button
          label="Share a link instead"
          variant="ghost"
          onPress={() => void shareInvite(roomCode, stake)}
        />
      </View>
    </Sheet>
  );
}

/** Invite / Sending… / Sent / Retry, in one 96px-wide slot so the rows don't
 *  reflow as their state changes. */
function InviteAction({ state, onPress }: { state: SendState; onPress: () => void }) {
  if (state === "sent") {
    return (
      <View style={{ alignItems: "center", paddingVertical: space.sm }}>
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: palette.mutedSteel }}>Sent</Text>
      </View>
    );
  }
  if (state === "sending") {
    return (
      <View style={{ alignItems: "center", paddingVertical: space.sm }}>
        <Text style={{ fontFamily: font.regular, fontSize: 14, color: palette.mutedSteel }}>Sending…</Text>
      </View>
    );
  }
  if (state === "failed") {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry invite"
        onPress={onPress}
        style={({ pressed }) => ({ alignItems: "center", paddingVertical: space.sm, opacity: pressed ? 0.8 : 1 })}
      >
        <Text style={{ fontFamily: font.semibold, fontSize: 14, color: teamColor.red }}>Retry</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Invite to room"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        paddingVertical: space.sm,
        borderRadius: radius.sm,
        backgroundColor: palette.liftedSlate,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ fontFamily: font.semibold, fontSize: 14, color: palette.porcelain }}>Invite</Text>
    </Pressable>
  );
}
